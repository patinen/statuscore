import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';

export const NOTIFICATION_DELIVERY_QUEUE = 'notification-delivery';

export interface NotificationDeliveryJobData {
  deliveryId: string;
}

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueueService.name);
  private readonly queue: Queue<NotificationDeliveryJobData>;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');

    this.queue = new Queue<NotificationDeliveryJobData>(NOTIFICATION_DELIVERY_QUEUE, {
      connection: { url: redisUrl },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }

  async enqueueDelivery(deliveryId: string): Promise<void> {
    const jobId = `notification-delivery-${deliveryId}`;
    const options: JobsOptions = {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    };

    await this.queue.add('deliver', { deliveryId }, options);
    this.logger.debug(`Queued notification delivery ${deliveryId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
