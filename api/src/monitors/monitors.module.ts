import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { DnsResolverService } from './dns-resolver.service.js';
import { MonitorsController } from './monitors.controller.js';
import { MonitorService } from './monitors.service.js';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MonitorsController],
  providers: [DnsResolverService, MonitorService, TargetUrlValidationService],
  exports: [MonitorService],
})
export class MonitorsModule {}
