import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommentsService } from './comments.service';
import { Comment } from './comment.entity';
import { Post } from '../posts/post.entity';

describe('CommentsService', () => {
  let service: CommentsService;
  let commentsRepository: Repository<Comment>;
  let postsRepository: Repository<Post>;

  const mockCommentsRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockPostsRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        {
          provide: getRepositoryToken(Comment),
          useValue: mockCommentsRepository,
        },
        { provide: getRepositoryToken(Post), useValue: mockPostsRepository },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    commentsRepository = module.get<Repository<Comment>>(
      getRepositoryToken(Comment),
    );
    postsRepository = module.get<Repository<Post>>(getRepositoryToken(Post));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createComment', () => {
    it('creates a top-level comment when the post exists', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (commentsRepository.create as jest.Mock).mockReturnValue({
        postId: 1,
        authorId: 7,
        body: 'Nice post',
        parentId: null,
      });
      (commentsRepository.save as jest.Mock).mockResolvedValue({
        id: 10,
        postId: 1,
        authorId: 7,
        body: 'Nice post',
        parentId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createComment(1, 7, { body: 'Nice post' });

      expect(result.id).toBe(10);
      expect(result.deleted).toBe(false);
      expect(result.body).toBe('Nice post');
    });

    it('throws 404 when the post does not exist', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createComment(999, 7, { body: 'Nice post' }),
      ).rejects.toThrow(NotFoundException);
      expect(commentsRepository.save).not.toHaveBeenCalled();
    });

    it('creates a one-level reply when the parent is a top-level comment', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 5,
        postId: 1,
        parentId: null,
        deletedAt: null,
      });
      (commentsRepository.create as jest.Mock).mockReturnValue({
        postId: 1,
        authorId: 7,
        body: 'A reply',
        parentId: 5,
      });
      (commentsRepository.save as jest.Mock).mockResolvedValue({
        id: 11,
        postId: 1,
        authorId: 7,
        body: 'A reply',
        parentId: 5,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createComment(1, 7, {
        body: 'A reply',
        parentId: 5,
      });

      expect(result.parentId).toBe(5);
    });

    it('rejects a reply to a reply with 400 (depth-2 rejected)', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 6,
        postId: 1,
        parentId: 5,
        deletedAt: null,
      });

      await expect(
        service.createComment(1, 7, { body: 'Nested reply', parentId: 6 }),
      ).rejects.toThrow(BadRequestException);
      expect(commentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a reply to a nonexistent parent with 400', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createComment(1, 7, { body: 'Orphan reply', parentId: 999 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a reply to a deleted parent with 400', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 5,
        postId: 1,
        parentId: null,
        deletedAt: new Date(),
      });

      await expect(
        service.createComment(1, 7, { body: 'Reply to deleted', parentId: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listComments', () => {
    it('throws 404 when the post does not exist', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.listComments(999, { page: 1, limit: 20 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns paginated top-level comments ordered by createdAt DESC', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 2,
              postId: 1,
              authorId: 7,
              body: 'Second',
              parentId: null,
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          1,
        ]),
      };
      (commentsRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQb,
      );

      const result = await service.listComments(1, { page: 1, limit: 20 });

      expect(mockQb.andWhere).toHaveBeenCalledWith('comment.parentId IS NULL');
      expect(mockQb.orderBy).toHaveBeenCalledWith('comment.createdAt', 'DESC');
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('returns tombstone DTOs for soft-deleted comments', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 3,
              postId: 1,
              authorId: 7,
              body: 'Deleted content',
              parentId: null,
              deletedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          1,
        ]),
      };
      (commentsRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQb,
      );

      const result = await service.listComments(1, { page: 1, limit: 20 });

      expect(result.data[0].deleted).toBe(true);
      expect(result.data[0].body).toBeNull();
    });

    it('filters by parentId when provided', async () => {
      (postsRepository.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      (commentsRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQb,
      );

      await service.listComments(1, { page: 1, limit: 20, parentId: 5 });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'comment.parentId = :parentId',
        {
          parentId: 5,
        },
      );
    });
  });

  describe('updateComment', () => {
    it('updates the body when the requester is the author', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        body: 'Old body',
        deletedAt: null,
      });
      (commentsRepository.save as jest.Mock).mockImplementation((c) => c);

      const result = await service.updateComment(1, 7, { body: 'New body' });

      expect(result.body).toBe('New body');
    });

    it('throws 403 when the requester is not the author', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        body: 'Old body',
        deletedAt: null,
      });

      await expect(
        service.updateComment(1, 999, { body: 'Hijack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when the comment does not exist', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateComment(999, 7, { body: 'New body' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when the comment is soft-deleted', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        deletedAt: new Date(),
      });

      await expect(
        service.updateComment(1, 7, { body: 'New body' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteComment', () => {
    it('soft-deletes when the requester is the author', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        postId: 1,
        deletedAt: null,
      });
      (postsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 999,
      });
      (commentsRepository.save as jest.Mock).mockImplementation((c) => c);

      await service.deleteComment(1, 7);

      expect(commentsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
    });

    it('soft-deletes when the requester is the post owner', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        postId: 1,
        deletedAt: null,
      });
      (postsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 42,
      });
      (commentsRepository.save as jest.Mock).mockImplementation((c) => c);

      await service.deleteComment(1, 42);

      expect(commentsRepository.save).toHaveBeenCalled();
    });

    it('throws 403 when the requester is neither author nor post owner', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        postId: 1,
        deletedAt: null,
      });
      (postsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 42,
      });

      await expect(service.deleteComment(1, 999)).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentsRepository.save).not.toHaveBeenCalled();
    });

    it('throws 404 when the comment does not exist', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteComment(999, 7)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is idempotent when the comment is already deleted', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        authorId: 7,
        postId: 1,
        deletedAt: new Date(),
      });
      (postsRepository.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 42,
      });

      await service.deleteComment(1, 7);

      expect(commentsRepository.save).not.toHaveBeenCalled();
    });
  });
});
