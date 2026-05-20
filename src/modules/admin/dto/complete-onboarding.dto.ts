import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel, Niche, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AGENT_NAME_MAX, MESSAGE_MAX } from '../../agents/validation/limits';

/**
 * @deprecated Prefer {@link CreateFullCompanyDto} plus {@link CreateClientUserDto}
 *   via POST /admin/companies/create-full and POST /admin/users/create-client.
 */
export class CompleteOnboardingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: CompleteOnboardingDto) => !o.companyId)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName?: string;

  @ApiPropertyOptional({ enum: Niche })
  @ValidateIf((o: CompleteOnboardingDto) => !o.companyId)
  @IsEnum(Niche)
  companyNiche?: Niche;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  companyPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyAddress?: string;

  @ApiPropertyOptional({
    description: "Operator / Juanito WhatsApp for company notifications (E.164 or local).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  notificationPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  notificationEmail?: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initialPayment!: number;

  @ApiProperty()
  @IsDateString()
  startedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  nextBillingAt?: string;

  @ApiProperty({ maxLength: AGENT_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX)
  agentName!: string;

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
}
