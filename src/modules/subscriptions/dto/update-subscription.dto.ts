import { IsEnum, IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubStatus } from '@prisma/client';

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ enum: SubStatus })
  @IsEnum(SubStatus)
  @IsOptional()
  status?: SubStatus;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  nextBillingAt?: string;
}
