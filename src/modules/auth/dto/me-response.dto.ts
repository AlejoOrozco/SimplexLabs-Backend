import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Niche } from '@prisma/client';

class MeCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Niche })
  niche!: Niche;

  @ApiProperty()
  isPlatformOwner!: boolean;
}

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  supabaseId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ description: 'Value from `roles.name`' })
  roleName!: string;

  @ApiProperty()
  isOwner!: boolean;

  @ApiProperty({ nullable: true, type: String })
  companyId!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  timezone!: string;

  @ApiProperty()
  firstLoginCompleted!: boolean;

  @ApiPropertyOptional({ type: () => MeCompanyDto, nullable: true })
  company!: MeCompanyDto | null;

  @ApiProperty({ type: [String], description: 'Resolved permission keys' })
  permissions!: string[];
}
