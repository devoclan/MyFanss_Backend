import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    example: 'Great post, thanks for sharing!',
    description: 'Comment body text (1-2000 characters). Stored as plain text.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({
    example: 12,
    description:
      'ID of the parent comment being replied to. Only one level of nesting is allowed — replies to a reply are rejected.',
  })
  @IsOptional()
  @IsInt()
  parentId?: number;
}
