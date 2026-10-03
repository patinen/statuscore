import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { MonitoringWorkerService } from './monitoring/monitoring-worker.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { NotificationWorkerService } from './notifications/notification-worker.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule,
    MonitoringModule,
    NotificationsModule,
  ],
  providers: [MonitoringWorkerService, NotificationWorkerService],
})
export class WorkerModule {}
