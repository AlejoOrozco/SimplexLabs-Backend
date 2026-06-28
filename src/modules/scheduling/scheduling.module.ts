import { Module } from '@nestjs/common';
import { BlockedTimesService } from './blocked-times.service';
import { AvailabilityService } from './availability.service';

@Module({
  providers: [BlockedTimesService, AvailabilityService],
  exports: [BlockedTimesService, AvailabilityService],
})
export class SchedulingModule {}
