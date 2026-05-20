import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, Channel, Niche, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AGENT_NAME_MAX, MESSAGE_MAX } from '../../agents/validation/limits';

export class CreateFullCompanyPlanItemDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initialPayment!: number;

  @ApiProperty()
  @IsDateString()
  startedAt!: string;
}

export class CreateFullCompanyAgentConfigDto {
  @ApiProperty({ maxLength: AGENT_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX)
  name!: string;

  @ApiProperty({ maxLength: MESSAGE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  fallbackMessage!: string;

  @ApiProperty({ maxLength: MESSAGE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  escalationMessage!: string;

  @ApiProperty({ enum: Channel, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Channel, { each: true })
  channels!: Channel[];

  @ApiProperty({ enum: PaymentMethod, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PaymentMethod, { each: true })
  paymentMethods!: PaymentMethod[];
}

export class CreateFullCompanyDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: Niche })
  @IsEnum(Niche)
  niche!: Niche;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    description:
      'Operator / Juanito WhatsApp for company notifications (E.164 or local).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  notificationPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  notificationEmail?: string;

  @ApiPropertyOptional({
    description:
      'Meta WhatsApp phone_number_id. Persisting a CompanyChannel still requires a long-lived token via the Channels API.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  whatsappPhoneNumberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  whatsappPhoneNumber?: string;

  @ApiProperty({
    type: [CreateFullCompanyPlanItemDto],
    description: 'Up to one plan per product category (0–3 items).',
  })
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CreateFullCompanyPlanItemDto)
  plans!: CreateFullCompanyPlanItemDto[];

  @ApiPropertyOptional({ type: CreateFullCompanyAgentConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateFullCompanyAgentConfigDto)
  agentConfig?: CreateFullCompanyAgentConfigDto;
}
