import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  MinLength,
  Min,
  IsInt,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Niche,
  PlanFeature,
  Channel,
  PlanCategory,
  PlanTier,
} from '@prisma/client';

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ enum: Niche })
  @IsEnum(Niche)
  niche!: Niche;

  @ApiPropertyOptional({ enum: PlanCategory })
  @IsEnum(PlanCategory)
  @IsOptional()
  category?: PlanCategory;

  @ApiPropertyOptional({ enum: PlanTier })
  @IsEnum(PlanTier)
  @IsOptional()
  tier?: PlanTier;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  priceMonthly!: number;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  priceAnnual?: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  setupFee!: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  maxCampaigns?: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

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
