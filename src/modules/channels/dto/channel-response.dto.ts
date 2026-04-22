import { ApiProperty } from '@nestjs/swagger';
import { Channel } from '@prisma/client';

/**
 * Sanitized channel record. The encrypted access token is NEVER exposed.
 * Clients only see a boolean indicating whether a token is configured.
 */
export class ChannelResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ enum: Channel })
  channel!: Channel;

  @ApiProperty({ example: '1089903084203607' })
  externalId!: string;

  @ApiProperty({ type: String, nullable: true })
  businessAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  label!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    description:
      'true when an encrypted access token is present in the database',
  })
  hasAccessToken!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
