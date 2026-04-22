import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { WorkingHoursService } from './working-hours.service';

@Module({
  controllers: [StaffController],
  providers: [StaffService, WorkingHoursService],
  exports: [StaffService, WorkingHoursService],
})
export class StaffModule {}
