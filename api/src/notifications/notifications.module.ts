import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { NotificationSchedulerService } from './notification-scheduler.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationQueueService, NotificationSchedulerService, NotificationsService],
  exports: [NotificationQueueService, NotificationsService],
})
export class NotificationsModule {}
