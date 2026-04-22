import { ApiProperty } from '@nestjs/swagger';
import { AgentRole } from '@prisma/client';

export class AgentPromptResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  agentConfigId!: string;

  @ApiProperty({ enum: AgentRole })
  role!: AgentRole;

  @ApiProperty({
    description:
      "The system prompt used for this role. Models never see internal ids, only the text you author here.",
  })
  systemPrompt!: string;

  @ApiProperty({ example: 'llama-3.3-70b-versatile' })
  model!: string;

  @ApiProperty({ example: 0.3 })
  temperature!: number;

  @ApiProperty({ example: 500 })
  maxTokens!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
