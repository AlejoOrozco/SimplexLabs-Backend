import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Text payload for a human-sent outbound message.
 *
 * - Length cap mirrors WhatsApp's 4096-char body limit.
 * - Trim/whitespace validation is intentionally left to class-transformer
 *   defaults + `MinLength(1)` so we reject empty / whitespace-only inputs
 *   without custom decorators.
 */
export class SendHumanMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 4096 })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content!: string;
}
