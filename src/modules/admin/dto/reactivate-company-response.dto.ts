import { ApiProperty } from '@nestjs/swagger';

export class ReactivateCompanyResponseDto {
  @ApiProperty({ example: true })
  reactivated!: true;

  @ApiProperty({
    description:
      'Number of platform users set to isActive=true for this company (previously inactive only)',
  })
  usersReactivated!: number;
}
