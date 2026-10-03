import { Module } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service.js';
import { NotificationSharedModule } from './notification-shared.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [NotificationSharedModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSchedulerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
