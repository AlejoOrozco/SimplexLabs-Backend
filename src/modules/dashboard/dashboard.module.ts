import { Module } from '@nestjs/common';
import { CompanyDashboardController } from './company-dashboard.controller';
import { CompanyDashboardService } from './company-dashboard.service';

@Module({
  controllers: [CompanyDashboardController],
  providers: [CompanyDashboardService],
})
export class DashboardModule {}
