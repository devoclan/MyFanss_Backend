import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

/**
 * Stub per-user/post rate limiter for comment creation.
 * Keys the counter on `userId:postId` so a user spamming one post's thread
 * doesn't affect their limit on other posts.
 */
@Injectable()
export class CommentRateLimitGuard implements CanActivate {
  private readonly windowMs = 60 * 1000;
  private readonly maxRequests = 10;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const postId = request.params?.postId;
    const key = `ratelimit:comment-create:${userId}:${postId}`;

    const current = ((await this.cacheManager.get(key)) as number) || 0;

    if (current >= this.maxRequests) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many comments on this post, please slow down',
          code: 'RATE_LIMITED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.cacheManager.set(key, current + 1, this.windowMs);
    return true;
  }
}
