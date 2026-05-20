import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
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
  isOwner!: boolean;

  @ApiProperty({ nullable: true, type: String })
  companyId!: string | null;

  @ApiProperty({ type: [String] })
  permissions!: string[];
}
