import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ScheduleSubscriptionUpgradeDto {
  @ApiProperty()
  @IsUUID()
  newPlanId!: string;
}
