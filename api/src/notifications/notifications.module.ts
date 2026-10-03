import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetAddressService } from '../monitoring/target-address.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { NotificationSchedulerService } from './notification-scheduler.service.js';
import { NotificationSecretService } from './notification-secret.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    DnsResolverService,
    TargetAddressService,
    NotificationSecretService,
    NotificationQueueService,
    NotificationDeliveryService,
    NotificationSchedulerService,
  ],
  exports: [
    DnsResolverService,
    TargetAddressService,
    NotificationSecretService,
    NotificationQueueService,
    NotificationDeliveryService,
  ],
})
export class NotificationsModule {}
