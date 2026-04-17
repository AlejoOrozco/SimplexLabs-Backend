import { ApiProperty } from '@nestjs/swagger';

export class WebsiteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  label!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
