import { ApiProperty } from '@nestjs/swagger';
import type { AuthenticatedUserRole } from '../../../common/decorators/current-user.decorator';

export class UserResponseDto {
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

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: String, nullable: true })
  companyId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
