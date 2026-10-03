import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationQueueService } from './notification-queue.service.js';

const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

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

    await this.recoverStaleProcessingDeliveries(now);

    const dueDeliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 100,
    });

    if (dueDeliveries.length === 0) {
      return;
    }

    for (const delivery of dueDeliveries) {
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'PENDING',
          nextAttemptAt: { lte: now },
        },
        data: {
          status: 'PROCESSING',
          lastAttemptAt: now,
        },
      });

      if (claimed.count !== 1) {
        continue;
      }

      try {
        const attemptNumber = delivery.attemptCount + 1;
        await this.notificationQueueService.enqueueDelivery(delivery.id, attemptNumber);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown queue enqueue failure';
        this.logger.error(`Failed to enqueue notification delivery ${delivery.id}: ${message}`);

        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'PENDING',
            nextAttemptAt: new Date(Date.now() + 30000),
            lastError: 'Notification queue enqueue failed; delivery returned to pending retry state.',
          },
        });
      }
    }
  }

  private async recoverStaleProcessingDeliveries(now: Date): Promise<void> {
    const staleThreshold = new Date(now.getTime() - STALE_PROCESSING_TIMEOUT_MS);

    const staleDeliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'PROCESSING',
        lastAttemptAt: { lt: staleThreshold },
      },
      orderBy: { lastAttemptAt: 'asc' },
      take: 100,
    });

    for (const delivery of staleDeliveries) {
      const recovered = await this.prisma.notificationDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'PROCESSING',
          lastAttemptAt: { lt: staleThreshold },
        },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(Date.now() + 30000),
          lastError: 'Recovered stale PROCESSING notification delivery lease.',
        },
      });

      if (recovered.count === 1) {
        this.logger.warn(`Recovered stale processing lease for notification delivery ${delivery.id}.`);
      }
    }
  }
}
