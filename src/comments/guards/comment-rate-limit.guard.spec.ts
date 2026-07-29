import { HttpException, HttpStatus } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { CommentRateLimitGuard } from './comment-rate-limit.guard';

describe('CommentRateLimitGuard', () => {
  let guard: CommentRateLimitGuard;
  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const buildContext = (userId: number, postId: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId },
          params: { postId },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    guard = new CommentRateLimitGuard(mockCacheManager as any);
    jest.clearAllMocks();
  });

  it('allows the request and increments the counter when under the limit', async () => {
    mockCacheManager.get.mockResolvedValue(3);

    const result = await guard.canActivate(buildContext(1, '10'));

    expect(result).toBe(true);
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'ratelimit:comment-create:1:10',
      4,
      60 * 1000,
    );
  });

  it('throws 429 when the per user/post limit is exceeded', async () => {
    mockCacheManager.get.mockResolvedValue(10);

    await expect(guard.canActivate(buildContext(1, '10'))).rejects.toThrow(
      HttpException,
    );
    await expect(
      guard.canActivate(buildContext(1, '10')),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(mockCacheManager.set).not.toHaveBeenCalled();
  });

  it('keys the counter independently per user and per post', async () => {
    mockCacheManager.get.mockResolvedValue(0);

    await guard.canActivate(buildContext(1, '10'));
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'ratelimit:comment-create:1:10',
      1,
      60 * 1000,
    );

    await guard.canActivate(buildContext(2, '10'));
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'ratelimit:comment-create:2:10',
      1,
      60 * 1000,
    );

    await guard.canActivate(buildContext(1, '20'));
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'ratelimit:comment-create:1:20',
      1,
      60 * 1000,
    );
  });
});
