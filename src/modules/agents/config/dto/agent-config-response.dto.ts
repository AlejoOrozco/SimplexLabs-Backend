import { ApiProperty } from '@nestjs/swagger';
import { Channel } from '@prisma/client';

export class AgentConfigResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ example: 'Default' })
  name!: string;

  @ApiProperty({
    description:
      'Exactly one config per company is active at a time. Updates that touch another row will atomically flip its flag.',
  })
  isActive!: boolean;

  @ApiProperty({
    enum: Channel,
    isArray: true,
    example: [Channel.WHATSAPP],
    description: 'Channels this config applies to.',
  })
  channels!: Channel[];

  @ApiProperty({
    description:
      'Fallback text sent to the customer when the pipeline fails. Never empty after an update.',
  })
  fallbackMessage!: string;

  @ApiProperty({
    description:
      'Escalation text sent when the agent decides a human should take over.',
  })
  escalationMessage!: string;

  @ApiProperty({ example: 'es' })
  language!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
