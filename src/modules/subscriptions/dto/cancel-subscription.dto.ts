import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CancelSubscriptionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}
