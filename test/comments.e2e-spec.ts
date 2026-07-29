import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { clearDatabase, createE2eApp, E2eTestApp } from './helpers/e2e-app';
import { bearerToken, signupUser } from './helpers/auth';
import { Post } from '../src/posts/post.entity';
import { Comment } from '../src/comments/comment.entity';

describe('Comments (e2e)', () => {
  let testApp: E2eTestApp;
  let postRepository: Repository<Post>;
  let commentRepository: Repository<Comment>;

  let authorToken: string;
  let authorId: number;

  let otherToken: string;
  let otherId: number;

  let postOwnerToken: string;
  let postOwnerId: number;
  let postId: number;

  const server = () => testApp.app.getHttpServer();

  beforeAll(async () => {
    testApp = await createE2eApp();
    postRepository = testApp.moduleFixture.get<Repository<Post>>(
      getRepositoryToken(Post),
    );
    commentRepository = testApp.moduleFixture.get<Repository<Comment>>(
      getRepositoryToken(Comment),
    );
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await clearDatabase(testApp.dataSource);

    const postOwner = await signupUser(testApp.app, {
      name: 'Post Owner',
      email: 'post-owner@example.com',
    });
    postOwnerToken = postOwner.token;
    postOwnerId = postOwner.user.id;

    const author = await signupUser(testApp.app, {
      name: 'Commenter',
      email: 'commenter@example.com',
    });
    authorToken = author.token;
    authorId = author.user.id;

    const other = await signupUser(testApp.app, {
      name: 'Other User',
      email: 'other-user@example.com',
    });
    otherToken = other.token;
    otherId = other.user.id;

    const post = await postRepository.save(
      postRepository.create({
        creatorId: postOwnerId,
        title: 'A post to comment on',
        body: 'Some content',
        visibility: 'public',
        publishedAt: new Date(),
      }),
    );
    postId = post.id;
  });

  describe('POST /posts/:postId/comments', () => {
    it('requires authentication (401)', async () => {
      await request(server())
        .post(`/posts/${postId}/comments`)
        .send({ body: 'Nice post' })
        .expect(401);
    });

    it('creates a top-level comment', async () => {
      const res = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Nice post' })
        .expect(201);

      expect(res.body).toMatchObject({
        postId,
        authorId,
        body: 'Nice post',
        parentId: null,
        deleted: false,
      });
    });

    it('creates a one-level reply', async () => {
      const top = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Top level' })
        .expect(201);

      const reply = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(otherToken))
        .send({ body: 'A reply', parentId: top.body.id })
        .expect(201);

      expect(reply.body.parentId).toBe(top.body.id);
    });

    it('rejects a reply to a reply with 400 (depth-2 rejected)', async () => {
      const top = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Top level' })
        .expect(201);

      const reply = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(otherToken))
        .send({ body: 'A reply', parentId: top.body.id })
        .expect(201);

      await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Nested reply', parentId: reply.body.id })
        .expect(400);
    });

    it('rejects replies to a deleted parent', async () => {
      const top = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Will be deleted' })
        .expect(201);

      await request(server())
        .delete(`/comments/${top.body.id}`)
        .set('Authorization', bearerToken(authorToken))
        .expect(204);

      await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(otherToken))
        .send({ body: 'Reply to deleted', parentId: top.body.id })
        .expect(400);
    });

    it('returns 404 when the post does not exist', async () => {
      await request(server())
        .post('/posts/999999/comments')
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Nice post' })
        .expect(404);
    });

    it('returns 404 when the post has been deleted', async () => {
      await request(server())
        .delete(`/creators/me/posts/${postId}`)
        .set('Authorization', bearerToken(postOwnerToken))
        .expect(204);

      await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Too late' })
        .expect(404);
    });

    it('rejects an empty body (validation)', async () => {
      await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: '' })
        .expect(400);
    });
  });

  describe('GET /posts/:postId/comments', () => {
    it('is publicly accessible without authentication', async () => {
      await request(server()).get(`/posts/${postId}/comments`).expect(200);
    });

    it('returns 404 when the post does not exist', async () => {
      await request(server()).get('/posts/999999/comments').expect(404);
    });

    it('lists top-level comments ordered by createdAt DESC, stably', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(server())
          .post(`/posts/${postId}/comments`)
          .set('Authorization', bearerToken(authorToken))
          .send({ body: `Comment ${i}` })
          .expect(201);
        ids.push(res.body.id);
      }

      const page1 = await request(server())
        .get(`/posts/${postId}/comments`)
        .query({ page: 1, limit: 2 })
        .expect(200);
      const page2 = await request(server())
        .get(`/posts/${postId}/comments`)
        .query({ page: 2, limit: 2 })
        .expect(200);
      const page3 = await request(server())
        .get(`/posts/${postId}/comments`)
        .query({ page: 3, limit: 2 })
        .expect(200);

      const collected = [
        ...page1.body.data,
        ...page2.body.data,
        ...page3.body.data,
      ].map((c: { id: number }) => c.id);

      expect(new Set(collected).size).toBe(5);
      expect(collected).toEqual([...ids].reverse());
    });

    it('returns only direct replies when parentId is provided', async () => {
      const top = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Top level' })
        .expect(201);

      await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(otherToken))
        .send({ body: 'A reply', parentId: top.body.id })
        .expect(201);

      const res = await request(server())
        .get(`/posts/${postId}/comments`)
        .query({ parentId: top.body.id })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].parentId).toBe(top.body.id);
    });

    it('shows soft-deleted comments as tombstones (body null, deleted true)', async () => {
      const top = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Will be deleted' })
        .expect(201);

      await request(server())
        .delete(`/comments/${top.body.id}`)
        .set('Authorization', bearerToken(authorToken))
        .expect(204);

      const res = await request(server())
        .get(`/posts/${postId}/comments`)
        .expect(200);

      const tombstone = res.body.data.find(
        (c: { id: number }) => c.id === top.body.id,
      );
      expect(tombstone).toMatchObject({ body: null, deleted: true });
    });
  });

  describe('PATCH /comments/:id', () => {
    it('allows the author to update their comment', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Original' })
        .expect(201);

      const res = await request(server())
        .patch(`/comments/${created.body.id}`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Edited' })
        .expect(200);

      expect(res.body.body).toBe('Edited');
    });

    it('returns 403 when a non-author tries to update', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Original' })
        .expect(201);

      await request(server())
        .patch(`/comments/${created.body.id}`)
        .set('Authorization', bearerToken(otherToken))
        .send({ body: 'Hijacked' })
        .expect(403);
    });

    it('returns 404 for a non-existent comment', async () => {
      await request(server())
        .patch('/comments/999999')
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Edited' })
        .expect(404);
    });

    it('requires authentication (401)', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Original' })
        .expect(201);

      await request(server())
        .patch(`/comments/${created.body.id}`)
        .send({ body: 'Edited' })
        .expect(401);
    });
  });

  describe('DELETE /comments/:id', () => {
    it('allows the author to delete their own comment', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server())
        .delete(`/comments/${created.body.id}`)
        .set('Authorization', bearerToken(authorToken))
        .expect(204);
    });

    it('allows the post owner to delete a comment they did not author', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server())
        .delete(`/comments/${created.body.id}`)
        .set('Authorization', bearerToken(postOwnerToken))
        .expect(204);

      const comment = await commentRepository.findOne({
        where: { id: created.body.id },
      });
      expect(comment?.deletedAt).not.toBeNull();
    });

    it('returns 403 for a user who is neither author nor post owner', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server())
        .delete(`/comments/${created.body.id}`)
        .set('Authorization', bearerToken(otherToken))
        .expect(403);
    });

    it('returns 404 for a non-existent comment', async () => {
      await request(server())
        .delete('/comments/999999')
        .set('Authorization', bearerToken(authorToken))
        .expect(404);
    });

    it('requires authentication (401)', async () => {
      const created = await request(server())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', bearerToken(authorToken))
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server())
        .delete(`/comments/${created.body.id}`)
        .expect(401);
    });
  });
});
