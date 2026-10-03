import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationWorkerService } from './notification-worker.service.js';
import { NotificationSharedModule } from './notification-shared.module.js';

@Module({
  imports: [ConfigModule, NotificationSharedModule],
  providers: [NotificationWorkerService],
  exports: [NotificationWorkerService],
})
export class NotificationWorkerModule {}
