import { ApiProperty } from '@nestjs/swagger';
import type { ContactSource } from '@prisma/client';

export class ClientContactResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ enum: ['WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'MANUAL'] })
  source!: ContactSource;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
