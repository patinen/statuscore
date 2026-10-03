import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MaintenanceWindowsModule } from '../maintenance-windows/maintenance-windows.module.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetUrlValidationService } from '../monitors/ssrf-validation.service.js';
import { NotificationSharedModule } from '../notifications/notification-shared.module.js';
import { MonitorExecutionService } from './monitoring-execution.service.js';
import { MonitoringQueueModule } from './monitoring-queue.module.js';
import { SafeHttpClientService } from './safe-http-client.service.js';
import { TargetAddressService } from './target-address.service.js';

@Module({
  imports: [DatabaseModule, MonitoringQueueModule, NotificationSharedModule, MaintenanceWindowsModule],
  providers: [
    DnsResolverService,
    TargetAddressService,
    TargetUrlValidationService,
    SafeHttpClientService,
    MonitorExecutionService,
  ],
  exports: [
    DnsResolverService,
    TargetAddressService,
    TargetUrlValidationService,
    SafeHttpClientService,
    MonitorExecutionService,
  ],
})
export class MonitoringModule {}
