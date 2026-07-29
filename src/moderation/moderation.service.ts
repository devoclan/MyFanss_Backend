import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentReport } from './content-report.entity';
import { Post } from '../posts/post.entity';
import { Comment } from '../comments/comment.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import { ReportStatus } from './enums/report-status.enum';
import { CreateContentReportDto } from './dto/create-content-report.dto';
import { QueryContentReportsDto } from './dto/query-content-reports.dto';
import { UpdateContentReportDto } from './dto/update-content-report.dto';

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(ContentReport)
    private readonly reportsRepository: Repository<ContentReport>,
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentsRepository: Repository<Comment>,
    private readonly auditService: AuditService,
  ) {}

  async createReport(
    reporterId: number,
    dto: CreateContentReportDto,
  ): Promise<ContentReport> {
    await this.assertTargetExists(dto.targetType, dto.targetId);

    const existingOpenReport = await this.reportsRepository.findOne({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: ReportStatus.OPEN,
      },
    });

    if (existingOpenReport) {
      throw new ConflictException(
        'You already have an open report for this content',
      );
    }

    const report = this.reportsRepository.create({
      reporterId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
      status: ReportStatus.OPEN,
    });

    return this.reportsRepository.save(report);
  }

  async findReports(query: QueryContentReportsDto): Promise<{
    data: ContentReport[];
    total: number;
    page: number;
    limit: number;
  }> {
    const qb = this.reportsRepository.createQueryBuilder('report');

    if (query.status) {
      qb.andWhere('report.status = :status', { status: query.status });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    qb.orderBy('report.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async resolveReport(
    id: number,
    adminId: number,
    dto: UpdateContentReportDto,
  ): Promise<ContentReport> {
    const report = await this.reportsRepository.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    report.status = dto.status;
    report.resolvedBy = adminId;
    report.resolvedAt = new Date();

    const saved = await this.reportsRepository.save(report);

    void this.auditService.log({
      actorId: adminId,
      action:
        dto.status === ReportStatus.RESOLVED
          ? AuditAction.CONTENT_REPORT_RESOLVED
          : AuditAction.CONTENT_REPORT_DISMISSED,
      targetType: 'ContentReport',
      targetId: id,
      metadata: {
        reportedTargetType: saved.targetType,
        reportedTargetId: saved.targetId,
      },
    });

    return saved;
  }

  private async assertTargetExists(
    targetType: ReportTargetType,
    targetId: number,
  ): Promise<void> {
    if (targetType === ReportTargetType.POST) {
      const post = await this.postsRepository.findOne({
        where: { id: targetId },
      });
      if (!post) {
        throw new NotFoundException('Reported post not found');
      }
      return;
    }

    const comment = await this.commentsRepository.findOne({
      where: { id: targetId },
    });
    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException('Reported comment not found');
    }
  }
}
