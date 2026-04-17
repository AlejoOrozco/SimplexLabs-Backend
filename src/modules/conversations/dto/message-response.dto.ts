import { ApiProperty } from '@nestjs/swagger';
import type { SenderType } from '@prisma/client';

export class MessageResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  conversationId!: string;

  @ApiProperty({ enum: ['AGENT', 'CONTACT'] })
  senderType!: SenderType;

  @ApiProperty()
  content!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Arbitrary channel-provider payload',
  })
  metadata!: unknown;

  @ApiProperty()
  sentAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  deliveredAt!: Date | null;
}
