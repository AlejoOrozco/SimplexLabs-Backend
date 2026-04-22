import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SandboxStepDto {
  @ApiProperty({
    enum: ['analyzer', 'retriever', 'decider', 'executor', 'responder'],
  })
  step!: 'analyzer' | 'retriever' | 'decider' | 'executor' | 'responder';

  @ApiProperty()
  ok!: boolean;

  @ApiProperty()
  durationMs!: number;

  @ApiProperty()
  tokens!: number;

  @ApiPropertyOptional({ type: Object, nullable: true })
  output!: unknown | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  error!: string | null;
}

export class SandboxRunResponseDto {
  @ApiProperty({ enum: ['sandbox'], default: 'sandbox' })
  mode!: 'sandbox';

  @ApiProperty()
  simulated!: true;

  @ApiProperty({ type: [SandboxStepDto] })
  steps!: SandboxStepDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The text the customer would receive. Not sent anywhere in dry-run.",
  })
  finalResponse!: string | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty()
  totalTokens!: number;

  @ApiProperty()
  totalDurationMs!: number;

  @ApiProperty({
    description:
      'Active config used for this dry-run — surfaced so operators can confirm edits took effect.',
    example: { agentConfigId: 'abc123', fromDatabase: 4, fromDefault: 1 },
    type: Object,
  })
  resolvedConfig!: {
    companyId: string;
    agentConfigId: string | null;
    language: string;
    name: string;
    promptSources: Record<string, 'database' | 'default'>;
  };
}
