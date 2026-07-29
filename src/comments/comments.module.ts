import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './comment.entity';
import { Post } from '../posts/post.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { CommentRateLimitGuard } from './guards/comment-rate-limit.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, Post])],
  providers: [CommentsService, CommentRateLimitGuard],
  controllers: [CommentsController],
  exports: [CommentsService],
})
export class CommentsModule {}
