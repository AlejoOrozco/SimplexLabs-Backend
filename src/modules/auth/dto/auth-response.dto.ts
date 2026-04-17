import { ApiProperty } from '@nestjs/swagger';
import type { AuthenticatedUserRole } from '../../../common/decorators/current-user.decorator';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: ['SUPER_ADMIN', 'CLIENT'] })
  role!: AuthenticatedUserRole;

  @ApiProperty({ nullable: true, type: String })
  companyId!: string | null;
}
