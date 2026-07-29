import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CommentResponseDto {
  @ApiProperty({ example: 1, description: 'Unique comment ID' })
  id: number;

  @ApiProperty({
    example: 42,
    description: 'ID of the post this comment belongs to',
  })
  postId: number;

  @ApiProperty({
    example: 7,
    description: 'ID of the user who wrote this comment',
  })
  authorId: number;

  @ApiPropertyOptional({
    example: 12,
    description: 'ID of the parent comment if this is a reply, otherwise null',
    nullable: true,
  })
  parentId: number | null;

  @ApiPropertyOptional({
    example: 'Great post, thanks for sharing!',
    description: 'Comment body, or null if the comment has been deleted',
    nullable: true,
  })
  body: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether this comment has been soft-deleted (tombstoned)',
  })
  deleted: boolean;

  @ApiProperty({
    example: '2024-06-15T11:50:00.000Z',
    description: 'Creation timestamp',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-06-15T12:05:00.000Z',
    description: 'Last update timestamp',
  })
  updatedAt: Date;
}
