import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { ContentReport } from './content-report.entity';
import { Post } from '../posts/post.entity';
import { Comment } from '../comments/comment.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import { ReportStatus } from './enums/report-status.enum';
import { CreateContentReportDto } from './dto/create-content-report.dto';

describe('ModerationService', () => {
  let service: ModerationService;
  let reportsRepository: Repository<ContentReport>;
  let postsRepository: Repository<Post>;
  let commentsRepository: Repository<Comment>;

  const mockReportsRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockPostsRepository = {
    findOne: jest.fn(),
  };

  const mockCommentsRepository = {
    findOne: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        {
          provide: getRepositoryToken(ContentReport),
          useValue: mockReportsRepository,
        },
        { provide: getRepositoryToken(Post), useValue: mockPostsRepository },
        {
          provide: getRepositoryToken(Comment),
          useValue: mockCommentsRepository,
        },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);
    reportsRepository = module.get<Repository<ContentReport>>(
      getRepositoryToken(ContentReport),
    );
    postsRepository = module.get<Repository<Post>>(getRepositoryToken(Post));
    commentsRepository = module.get<Repository<Comment>>(
      getRepositoryToken(Comment),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createReport', () => {
    const dto: CreateContentReportDto = {
      targetType: ReportTargetType.POST,
      targetId: 42,
      reason: 'Contains harassment',
    };

    it('creates a report when the target post exists and no open report exists', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 42 });
      (reportsRepository.findOne as jest.Mock).mockResolvedValue(null);
      (reportsRepository.create as jest.Mock).mockReturnValue({
        reporterId: 1,
        ...dto,
        status: ReportStatus.OPEN,
      });
      (reportsRepository.save as jest.Mock).mockResolvedValue({
        id: 1,
        reporterId: 1,
        ...dto,
        status: ReportStatus.OPEN,
      });

      const result = await service.createReport(1, dto);

      expect(postsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 42 },
      });
      expect(reportsRepository.save).toHaveBeenCalled();
      expect(result.status).toBe(ReportStatus.OPEN);
    });

    it('throws 404 when the reported post does not exist', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.createReport(1, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(reportsRepository.findOne).not.toHaveBeenCalled();
    });

    it('creates a report when the target comment exists', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 42,
        deletedAt: null,
      });
      (reportsRepository.findOne as jest.Mock).mockResolvedValue(null);
      (reportsRepository.create as jest.Mock).mockReturnValue({
        reporterId: 1,
        ...dto,
        targetType: ReportTargetType.COMMENT,
        status: ReportStatus.OPEN,
      });
      (reportsRepository.save as jest.Mock).mockResolvedValue({
        id: 1,
        reporterId: 1,
        ...dto,
        targetType: ReportTargetType.COMMENT,
        status: ReportStatus.OPEN,
      });

      const result = await service.createReport(1, {
        ...dto,
        targetType: ReportTargetType.COMMENT,
      });

      expect(commentsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 42 },
      });
      expect(result.status).toBe(ReportStatus.OPEN);
    });

    it('throws 404 for comment targets that do not exist', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createReport(1, {
          ...dto,
          targetType: ReportTargetType.COMMENT,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 for soft-deleted comment targets', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 42,
        deletedAt: new Date(),
      });

      await expect(
        service.createReport(1, {
          ...dto,
          targetType: ReportTargetType.COMMENT,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when the same user already has an open report on the same target', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 42 });
      (reportsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 5,
        status: ReportStatus.OPEN,
      });

      await expect(service.createReport(1, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(reportsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findReports', () => {
    it('filters by status and paginates results', async () => {
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest
          .fn()
          .mockResolvedValue([[{ id: 1, status: ReportStatus.OPEN }], 1]),
      };
      (reportsRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQb,
      );

      const result = await service.findReports({
        status: ReportStatus.OPEN,
        page: 1,
        limit: 20,
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith('report.status = :status', {
        status: ReportStatus.OPEN,
      });
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('resolveReport', () => {
    it('throws 404 when the report does not exist', async () => {
      (reportsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resolveReport(99, 1, { status: ReportStatus.RESOLVED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates status, records the admin actor, and writes an audit log on resolve', async () => {
      const report = {
        id: 1,
        status: ReportStatus.OPEN,
        targetType: ReportTargetType.POST,
        targetId: 42,
        resolvedBy: null,
        resolvedAt: null,
      };
      (reportsRepository.findOne as jest.Mock).mockResolvedValue(report);
      (reportsRepository.save as jest.Mock).mockImplementation((r) => r);

      const result = await service.resolveReport(1, 7, {
        status: ReportStatus.RESOLVED,
      });

      expect(result.status).toBe(ReportStatus.RESOLVED);
      expect(result.resolvedBy).toBe(7);
      expect(result.resolvedAt).toBeInstanceOf(Date);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 7,
          action: AuditAction.CONTENT_REPORT_RESOLVED,
          targetType: 'ContentReport',
          targetId: 1,
        }),
      );
    });

    it('writes a dismiss audit log when dismissing a report', async () => {
      const report = {
        id: 2,
        status: ReportStatus.OPEN,
        targetType: ReportTargetType.POST,
        targetId: 43,
        resolvedBy: null,
        resolvedAt: null,
      };
      (reportsRepository.findOne as jest.Mock).mockResolvedValue(report);
      (reportsRepository.save as jest.Mock).mockImplementation((r) => r);

      const result = await service.resolveReport(2, 7, {
        status: ReportStatus.DISMISSED,
      });

      expect(result.status).toBe(ReportStatus.DISMISSED);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CONTENT_REPORT_DISMISSED,
        }),
      );
    });
  });
});
