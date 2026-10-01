import { Module } from '@nestjs/common';
import { MonitoringQueueModule } from './monitoring-queue.module.js';
import { MonitoringSchedulerService } from './monitoring-scheduler.service.js';

@Module({
  imports: [MonitoringQueueModule],
  providers: [MonitoringSchedulerService],
  exports: [MonitoringSchedulerService],
})
export class MonitoringSchedulerModule {}
