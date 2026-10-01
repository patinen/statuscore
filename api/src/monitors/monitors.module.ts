import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { MonitorsController } from './monitors.controller.js';
import { MonitorService } from './monitors.service.js';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MonitorsController],
  providers: [MonitorService, TargetUrlValidationService],
  exports: [MonitorService],
})
export class MonitorsModule {}
