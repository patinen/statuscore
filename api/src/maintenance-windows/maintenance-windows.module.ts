import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MaintenanceWindowsController } from './maintenance-windows.controller.js';
import { MaintenanceWindowsService } from './maintenance-windows.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MaintenanceWindowsController],
  providers: [MaintenanceWindowsService],
  exports: [MaintenanceWindowsService],
})
export class MaintenanceWindowsModule {}
