import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MonitoringQueueService } from './monitoring-queue.service.js';

@Module({
  imports: [ConfigModule],
  providers: [MonitoringQueueService],
  exports: [MonitoringQueueService],
})
export class MonitoringQueueModule {}
