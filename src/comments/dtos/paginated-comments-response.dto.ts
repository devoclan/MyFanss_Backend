import { ApiProperty } from '@nestjs/swagger';
import { CommentResponseDto } from './comment-response.dto';

export class PaginatedCommentsResponseDto {
  @ApiProperty({
    type: [CommentResponseDto],
    description: 'Array of comments for this page',
  })
  data: CommentResponseDto[];

  @ApiProperty({
    example: 53,
    description: 'Total number of comments matching the query',
  })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 20, description: 'Number of comments per page' })
  limit: number;

  @ApiProperty({ example: 3, description: 'Total number of pages' })
  totalPages: number;
}
