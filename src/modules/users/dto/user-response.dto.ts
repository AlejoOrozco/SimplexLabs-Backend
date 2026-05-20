import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ description: 'Value from `roles.name`' })
  roleName!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  firstLoginCompleted!: boolean;

  @ApiProperty({ type: String, nullable: true })
  companyId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'IANA timezone for calendar display' })
  timezone!: string;
}
