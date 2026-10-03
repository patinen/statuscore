import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { IncidentsModule } from './incidents/incidents.module.js';
import { MaintenanceWindowsModule } from './maintenance-windows/maintenance-windows.module.js';
import { ManualIncidentsModule } from './manual-incidents/manual-incidents.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { MonitoringSchedulerModule } from './monitoring/monitoring-scheduler.module.js';
import { MonitorsModule } from './monitors/monitors.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { StatusPagesModule } from './status-pages/status-pages.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AnalyticsModule,
    MaintenanceWindowsModule,
    ManualIncidentsModule,
    MonitorsModule,
    IncidentsModule,
    MonitoringModule,
    MonitoringSchedulerModule,
    NotificationsModule,
    StatusPagesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
