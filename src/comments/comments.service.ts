import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { Post } from '../posts/post.entity';
import { CreateCommentDto } from './dtos/create-comment.dto';
import { UpdateCommentDto } from './dtos/update-comment.dto';
import { QueryCommentsDto } from './dtos/query-comments.dto';
import { CommentResponseDto } from './dtos/comment-response.dto';
import { PaginatedCommentsResponseDto } from './dtos/paginated-comments-response.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private commentsRepo: Repository<Comment>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
  ) {}

  async createComment(
    postId: number,
    authorId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    if (dto.parentId !== undefined && dto.parentId !== null) {
      const parent = await this.commentsRepo.findOne({
        where: { id: dto.parentId, postId },
      });

      if (!parent) {
        throw new BadRequestException('Parent comment not found for this post');
      }
      if (parent.parentId !== null) {
        throw new BadRequestException(
          'Cannot reply to a reply — only one level of threading is allowed',
        );
      }
      if (parent.deletedAt !== null) {
        throw new BadRequestException('Cannot reply to a deleted comment');
      }
    }

    const comment = this.commentsRepo.create({
      postId,
      authorId,
      body: dto.body,
      parentId: dto.parentId ?? null,
    });

    const saved = await this.commentsRepo.save(comment);
    return this.toDto(saved);
  }

  async listComments(
    postId: number,
    query: QueryCommentsDto,
  ): Promise<PaginatedCommentsResponseDto> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.commentsRepo
      .createQueryBuilder('comment')
      .where('comment.postId = :postId', { postId });

    if (query.parentId !== undefined && query.parentId !== null) {
      qb.andWhere('comment.parentId = :parentId', {
        parentId: query.parentId,
      });
    } else {
      qb.andWhere('comment.parentId IS NULL');
    }

    const [comments, total] = await qb
      .orderBy('comment.createdAt', 'DESC')
      .addOrderBy('comment.id', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: comments.map((c) => this.toDto(c)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateComment(
    commentId: number,
    authorId: number,
    dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.commentsRepo.findOne({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId !== authorId) {
      throw new ForbiddenException("Cannot edit another user's comment");
    }

    comment.body = dto.body;
    const updated = await this.commentsRepo.save(comment);
    return this.toDto(updated);
  }

  async deleteComment(commentId: number, requesterId: number): Promise<void> {
    const comment = await this.commentsRepo.findOne({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const post = await this.postsRepo.findOne({
      where: { id: comment.postId },
    });

    const isAuthor = comment.authorId === requesterId;
    const isPostOwner = !!post && post.creatorId === requesterId;

    if (!isAuthor && !isPostOwner) {
      throw new ForbiddenException(
        'Only the comment author or the post owner can delete this comment',
      );
    }

    if (comment.deletedAt !== null) return;

    comment.deletedAt = new Date();
    await this.commentsRepo.save(comment);
  }

  private toDto(comment: Comment): CommentResponseDto {
    const deleted = comment.deletedAt !== null;
    return {
      id: comment.id,
      postId: comment.postId,
      authorId: comment.authorId,
      parentId: comment.parentId,
      body: deleted ? null : comment.body,
      deleted,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
