import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { BlockedTimesService } from './blocked-times.service';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [SchedulingController],
  providers: [BlockedTimesService, AvailabilityService],
  exports: [BlockedTimesService, AvailabilityService],
})
export class SchedulingModule {}
