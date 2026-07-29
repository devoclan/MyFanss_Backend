import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentReport } from './content-report.entity';
import { Post } from '../posts/post.entity';
import { Comment } from '../comments/comment.entity';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContentReport, Post, Comment]),
    AuditModule,
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ModerationService],
})
export class ModerationModule {}
