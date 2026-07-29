# Comments API

The Comments module lets fans engage with posts through one-level-deep threaded
comments. Comments support soft-delete (tombstoning), author/post-owner
authorization, pagination, and are a valid target for the moderation reports
API (`POST /reports` with `targetType: "comment"`).

All routes are documented in Swagger under the **Comments** tag.

## Data model

`Comment`:

| Field       | Type      | Notes                                                           |
| ----------- | --------- | --------------------------------------------------------------- |
| `id`        | int       | Primary key                                                     |
| `postId`    | int       | FK → `posts.id`, `ON DELETE CASCADE`                            |
| `authorId`  | int       | FK → `users.id`, `ON DELETE CASCADE`                            |
| `body`      | text      | Nullable — set to `null` in responses once soft-deleted         |
| `parentId`  | int       | Nullable, FK → `comments.id`. Only one level of replies allowed |
| `createdAt` | timestamp | Set on creation                                                 |
| `updatedAt` | timestamp | Set on update                                                   |
| `deletedAt` | timestamp | Nullable. Non-null means the comment is soft-deleted            |

Indexes: `(postId, createdAt)` for the top-level feed, `(parentId)` for reply lookups.

### Threading rule

Only one level of nesting is supported. A comment with `parentId = null` is
top-level; a comment with a non-null `parentId` is a reply. Attempting to
reply to a reply (i.e. `parentId` points at a comment that itself has a
`parentId`) returns `400 Bad Request`. Replying to a soft-deleted parent is
also rejected with `400 Bad Request`.

### Soft-delete / tombstone behavior

Deleting a comment does not remove the row — it sets `deletedAt`. Deleted
comments **remain visible** in list results (so thread structure and reply
counts stay intact) but are returned as a tombstone:

```json
{ "id": 12, "postId": 4, "authorId": 7, "parentId": null, "body": null, "deleted": true, ... }
```

This mirrors the "keep it in the tree, redact the content" pattern (similar to
Reddit's `[deleted]`). Only `body` is redacted — `authorId`/`parentId` remain
visible so the client can still render "this comment was deleted" in place.

A soft-deleted comment cannot be edited (`PATCH` returns `404`) and cannot be
replied to (`400`).

## Endpoints

> Note: like the rest of this API's non-versioned domains (e.g. `Posts`,
> `Reports`), these routes are **not** mounted under `/api/v1` — that prefix
> is only present in Swagger's description text, not actually applied by
> `main.ts`. Routes below are the real, unprefixed paths.

| Method | Path                      | Auth                          | Description                           |
| ------ | ------------------------- | ----------------------------- | ------------------------------------- |
| POST   | `/posts/:postId/comments` | Bearer                        | Create a top-level comment or a reply |
| GET    | `/posts/:postId/comments` | Public                        | List comments for a post (paginated)  |
| PATCH  | `/comments/:id`           | Bearer (author only)          | Edit a comment's body                 |
| DELETE | `/comments/:id`           | Bearer (author or post owner) | Soft-delete a comment                 |

### POST /posts/:postId/comments

```bash
curl -X POST http://localhost:3000/posts/42/comments \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Great post!", "parentId": null }'
```

`201 Created`:

```json
{
  "id": 12,
  "postId": 42,
  "authorId": 7,
  "parentId": null,
  "body": "Great post!",
  "deleted": false,
  "createdAt": "2026-07-29T12:00:00.000Z",
  "updatedAt": "2026-07-29T12:00:00.000Z"
}
```

Errors:

- `400` — validation failure, reply depth > 1, or reply to a deleted/missing parent
- `401` — missing/invalid token
- `404` — post does not exist (or has been deleted)
- `429` — rate limit exceeded (stub: max 10 comments per user per post per minute)

### GET /posts/:postId/comments

Query params: `page` (default 1), `limit` (default 20, max 100), `parentId`
(optional — when set, returns direct replies to that comment instead of
top-level comments).

```bash
curl "http://localhost:3000/posts/42/comments?page=1&limit=20"
```

`200 OK`:

```json
{
  "data": [
    {
      "id": 12,
      "postId": 42,
      "authorId": 7,
      "parentId": null,
      "body": "Great post!",
      "deleted": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

Top-level comments are ordered `createdAt DESC`, with `id DESC` as a
tie-breaker to guarantee stable pagination even when multiple comments share
a timestamp. This is a public, unauthenticated endpoint.

Errors:

- `404` — post does not exist

### PATCH /comments/:id

Author-only. Soft-deleted comments cannot be edited.

```bash
curl -X PATCH http://localhost:3000/comments/12 \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Edited comment" }'
```

Errors:

- `401` — missing/invalid token
- `403` — requester is not the comment author
- `404` — comment does not exist or is already soft-deleted

### DELETE /comments/:id

Soft-deletes a comment. Allowed for the comment's author **or** the owning
post's creator. Idempotent — deleting an already-deleted comment is a no-op
that still returns `204`.

```bash
curl -X DELETE http://localhost:3000/comments/12 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Errors:

- `401` — missing/invalid token
- `403` — requester is neither the author nor the post owner
- `404` — comment does not exist

## Rate limiting

Comment creation is additionally guarded by `CommentRateLimitGuard`, a stub
per-user/per-post limiter (10 comments per user per post per 60s window,
backed by the app's existing `cache-manager`). This is on top of the global
throttler tiers documented in [RATE_LIMITING.md](./RATE_LIMITING.md), which
still apply to every route by default.

## Moderation

Comments are a valid report target (`ReportTargetType.COMMENT`). `POST
/reports` with `{ "targetType": "comment", "targetId": <id> }` succeeds only
if the comment exists and is not soft-deleted; otherwise it returns `404`.
