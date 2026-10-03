import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { NotificationSharedModule } from '../notifications/notification-shared.module.js';
import { ManualIncidentsController } from './manual-incidents.controller.js';
import { ManualIncidentsService } from './manual-incidents.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, NotificationSharedModule],
  controllers: [ManualIncidentsController],
  providers: [ManualIncidentsService],
  exports: [ManualIncidentsService],
})
export class ManualIncidentsModule {}
