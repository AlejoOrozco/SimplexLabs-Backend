import { ApiProperty } from '@nestjs/swagger';
import { ConversationControlMode } from '@prisma/client';

/**
 * Response body for takeover / handback. Reflects the post-transition
 * state so the client can display who is now in control without a
 * separate fetch.
 */
export class ConversationControlResponseDto {
  @ApiProperty() conversationId!: string;

  @ApiProperty({ enum: ConversationControlMode })
  controlMode!: ConversationControlMode;

  @ApiProperty({ type: String, nullable: true })
  controlledByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  controlModeChangedAt!: string;
}
