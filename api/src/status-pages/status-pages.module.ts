import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MaintenanceWindowsModule } from '../maintenance-windows/maintenance-windows.module.js';
import { PublicStatusPagesController, StatusPagesController } from './status-pages.controller.js';
import { StatusPagesService } from './status-pages.service.js';

@Module({
  imports: [AuthModule, MaintenanceWindowsModule],
  controllers: [StatusPagesController, PublicStatusPagesController],
  providers: [StatusPagesService],
  exports: [StatusPagesService],
})
export class StatusPagesModule {}