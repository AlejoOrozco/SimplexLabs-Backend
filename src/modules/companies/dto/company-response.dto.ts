import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Niche } from '@prisma/client';

export class CompanyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['GYM', 'MEDICAL', 'ENTREPRENEUR'] })
  niche!: Niche;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
