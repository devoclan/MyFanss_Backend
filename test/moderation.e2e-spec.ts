import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { clearDatabase, createE2eApp, E2eTestApp } from './helpers/e2e-app';
import { bearerToken, signupUser, loginUser } from './helpers/auth';
import { ContentReport } from '../src/moderation/content-report.entity';
import { Post } from '../src/posts/post.entity';
import { Comment } from '../src/comments/comment.entity';
import { ReportStatus } from '../src/moderation/enums/report-status.enum';
import { ReportTargetType } from '../src/moderation/enums/report-target-type.enum';

describe('Content Moderation Reports (e2e)', () => {
  let testApp: E2eTestApp;
  let contentReportRepository: Repository<ContentReport>;
  let postRepository: Repository<Post>;
  let commentRepository: Repository<Comment>;

  let reporterToken: string;
  let reporterId: number;
  let postId: number;

  let adminToken: string;
  let adminId: number;

  const server = () => testApp.app.getHttpServer();

  beforeAll(async () => {
    testApp = await createE2eApp();
    contentReportRepository = testApp.moduleFixture.get<
      Repository<ContentReport>
    >(getRepositoryToken(ContentReport));
    postRepository = testApp.moduleFixture.get<Repository<Post>>(
      getRepositoryToken(Post),
    );
    commentRepository = testApp.moduleFixture.get<Repository<Comment>>(
      getRepositoryToken(Comment),
    );
  });

  beforeEach(async () => {
    await clearDatabase(testApp.dataSource);

    const reporter = await signupUser(testApp.app, {
      name: 'Reporter',
      email: 'reporter@example.com',
    });
    reporterToken = reporter.token;
    reporterId = reporter.user.id;

    const post = await postRepository.save(
      postRepository.create({
        creatorId: reporterId,
        title: 'A post',
        body: 'Some content',
        visibility: 'public',
        publishedAt: new Date(),
      }),
    );
    postId = post.id;

    const adminSignup = await signupUser(testApp.app, {
      name: 'Admin',
      email: 'admin@example.com',
    });
    await testApp.userRepository.update(adminSignup.user.id, {
      role: 'admin',
    });
    const adminLogin = await loginUser(testApp.app, adminSignup.payload.email);
    adminToken = adminLogin.token;
    adminId = adminSignup.user.id;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('POST /reports', () => {
    it('requires authentication', async () => {
      await request(server())
        .post('/reports')
        .send({
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
        })
        .expect(401);
    });

    it('creates an open report for an existing post', async () => {
      const res = await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Contains harassment',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        reporterId,
        targetType: ReportTargetType.POST,
        targetId: postId,
        status: ReportStatus.OPEN,
      });
    });

    it('returns 404 when the reported post does not exist', async () => {
      await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.POST,
          targetId: 999999,
          reason: 'Contains harassment',
        })
        .expect(404);
    });

    it('creates an open report for an existing comment', async () => {
      const comment = await commentRepository.save(
        commentRepository.create({
          postId,
          authorId: reporterId,
          body: 'Some comment',
          parentId: null,
        }),
      );

      const res = await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.COMMENT,
          targetId: comment.id,
          reason: 'Contains harassment',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        reporterId,
        targetType: ReportTargetType.COMMENT,
        targetId: comment.id,
        status: ReportStatus.OPEN,
      });
    });

    it('returns 404 for comment targets that do not exist', async () => {
      await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.COMMENT,
          targetId: 999999,
          reason: 'Contains harassment',
        })
        .expect(404);
    });

    it('returns 409 for a duplicate open report from the same user on the same target', async () => {
      await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'First report',
        })
        .expect(201);

      await request(server())
        .post('/reports')
        .set('Authorization', bearerToken(reporterToken))
        .send({
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Second report, same target',
        })
        .expect(409);
    });
  });

  describe('GET /admin/reports', () => {
    it('returns 403 for non-admin users', async () => {
      await request(server())
        .get('/admin/reports')
        .set('Authorization', bearerToken(reporterToken))
        .expect(403);
    });

    it('returns paginated reports for admin users', async () => {
      await contentReportRepository.save(
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
      );

      const res = await request(server())
        .get('/admin/reports')
        .set('Authorization', bearerToken(adminToken))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({
        hasMore: false,
        totalCount: 1,
      });
    });

    it('filters by status', async () => {
      await contentReportRepository.save([
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Resolved already',
          status: ReportStatus.RESOLVED,
        }),
      ]);

      const res = await request(server())
        .get('/admin/reports')
        .query({ status: ReportStatus.RESOLVED })
        .set('Authorization', bearerToken(adminToken))
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe(ReportStatus.RESOLVED);
    });
  });

  describe('PATCH /admin/reports/:id', () => {
    it('returns 403 for non-admin users', async () => {
      const report = await contentReportRepository.save(
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
      );

      await request(server())
        .patch(`/admin/reports/${report.id}`)
        .set('Authorization', bearerToken(reporterToken))
        .send({ status: ReportStatus.RESOLVED })
        .expect(403);
    });

    it('returns 404 for a non-existent report', async () => {
      await request(server())
        .patch('/admin/reports/999999')
        .set('Authorization', bearerToken(adminToken))
        .send({ status: ReportStatus.RESOLVED })
        .expect(404);
    });

    it('resolves a report and records the admin actor', async () => {
      const report = await contentReportRepository.save(
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
      );

      const res = await request(server())
        .patch(`/admin/reports/${report.id}`)
        .set('Authorization', bearerToken(adminToken))
        .send({ status: ReportStatus.RESOLVED })
        .expect(200);

      expect(res.body.status).toBe(ReportStatus.RESOLVED);
      expect(res.body.resolvedBy).toBe(adminId);
      expect(res.body.resolvedAt).not.toBeNull();
    });

    it('dismisses a report and records the admin actor', async () => {
      const report = await contentReportRepository.save(
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
      );

      const res = await request(server())
        .patch(`/admin/reports/${report.id}`)
        .set('Authorization', bearerToken(adminToken))
        .send({ status: ReportStatus.DISMISSED })
        .expect(200);

      expect(res.body.status).toBe(ReportStatus.DISMISSED);
      expect(res.body.resolvedBy).toBe(adminId);
    });

    it('rejects an invalid status transition value', async () => {
      const report = await contentReportRepository.save(
        contentReportRepository.create({
          reporterId,
          targetType: ReportTargetType.POST,
          targetId: postId,
          reason: 'Spam',
          status: ReportStatus.OPEN,
        }),
      );

      await request(server())
        .patch(`/admin/reports/${report.id}`)
        .set('Authorization', bearerToken(adminToken))
        .send({ status: 'open' })
        .expect(400);
    });
  });
});
