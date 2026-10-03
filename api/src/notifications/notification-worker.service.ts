import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NOTIFICATION_DELIVERY_QUEUE, type NotificationDeliveryJobData } from './notification-queue.service.js';

@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private worker: Worker<NotificationDeliveryJobData> | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(NotificationDeliveryService) private readonly notificationDeliveryService: NotificationDeliveryService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const concurrency = Number(this.config.get<string>('NOTIFICATION_WORKER_CONCURRENCY', '5') ?? 5);

    this.worker = new Worker<NotificationDeliveryJobData>(
      NOTIFICATION_DELIVERY_QUEUE,
      async (job) => {
        await this.notificationDeliveryService.processDelivery(job.data.deliveryId);
      },
      {
        connection: { url: redisUrl },
        concurrency,
      },
    );

    this.logger.log(`Notification worker started with concurrency ${concurrency}.`);
    this.worker.on('error', (error) => {
      this.logger.error(`Notification worker error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Notification worker closed.');
    }
  }
}
