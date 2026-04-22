import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Read-only observability DTO for AgentRun inspection endpoints.
 * Mirrors only the fields safe to expose to tenants (no PII scrubbing is
 * applied to the JSON IO blobs; consumers are CLIENT / SUPER_ADMIN roles
 * that already have access to their company's conversation data).
 */
export class AgentRunResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  messageId!: string;

  @ApiProperty({ type: Boolean })
  success!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  error!: string | null;

  @ApiProperty({ type: Number })
  totalTokens!: number;

  @ApiProperty({ type: Number })
  durationMs!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: Object, description: 'Analyzer step input' })
  analyzerInput!: unknown;

  @ApiProperty({ type: Object })
  analyzerOutput!: unknown;

  @ApiProperty({ type: Object })
  retrieverInput!: unknown;

  @ApiProperty({ type: Object })
  retrieverOutput!: unknown;

  @ApiPropertyOptional({ type: Object })
  deciderInput!: unknown;

  @ApiPropertyOptional({ type: Object })
  deciderOutput!: unknown;

  @ApiPropertyOptional({ type: Object })
  executorInput!: unknown;

  @ApiPropertyOptional({ type: Object })
  executorOutput!: unknown;

  @ApiProperty({ type: Object })
  responderInput!: unknown;

  @ApiProperty({ type: Object })
  responderOutput!: unknown;
}
