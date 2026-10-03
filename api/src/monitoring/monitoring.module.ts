import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetUrlValidationService } from '../monitors/ssrf-validation.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MonitorExecutionService } from './monitoring-execution.service.js';
import { MonitoringQueueModule } from './monitoring-queue.module.js';
import { SafeHttpClientService } from './safe-http-client.service.js';
import { TargetAddressService } from './target-address.service.js';

@Module({
  imports: [DatabaseModule, MonitoringQueueModule, NotificationsModule],
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
