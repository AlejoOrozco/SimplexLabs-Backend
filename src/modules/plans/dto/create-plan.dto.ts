import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  MinLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Niche, PlanFeature, Channel } from '@prisma/client';

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: Niche })
  @IsEnum(Niche)
  niche!: Niche;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  priceMonthly!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  setupFee!: number;

  @ApiPropertyOptional({ enum: PlanFeature, isArray: true })
  @IsArray()
  @IsEnum(PlanFeature, { each: true })
  @IsOptional()
  features?: PlanFeature[];

  @ApiPropertyOptional({ enum: Channel, isArray: true })
  @IsArray()
  @IsEnum(Channel, { each: true })
  @IsOptional()
  channels?: Channel[];
}
