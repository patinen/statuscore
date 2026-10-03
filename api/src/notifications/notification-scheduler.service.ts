import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationQueueService } from './notification-queue.service.js';

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationQueueService) private readonly notificationQueueService: NotificationQueueService,
  ) {}

  @Cron('*/15 * * * * *')
  async runDueDeliveries(): Promise<void> {
    const now = new Date();

    const dueDeliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 100,
    });

    if (dueDeliveries.length === 0) {
      return;
    }

    const deliveryIds = dueDeliveries.map((delivery) => delivery.id);

    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: {
        id: { in: deliveryIds },
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
      },
      data: {
        status: 'PROCESSING',
        lastAttemptAt: now,
      },
    });

    if (claimed.count === 0) {
      return;
    }

    for (const delivery of dueDeliveries) {
      try {
        await this.notificationQueueService.enqueueDelivery(delivery.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown queue enqueue failure';
        this.logger.error(`Failed to enqueue notification delivery ${delivery.id}: ${message}`);

        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: delivery.status === 'FAILED' ? 'FAILED' : 'PENDING',
            nextAttemptAt: new Date(Date.now() + 30000),
          },
        });
      }
    }
  }
}
