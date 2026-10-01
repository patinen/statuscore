import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { MonitoringQueueService } from './monitoring-queue.service.js';

@Injectable()
export class MonitoringSchedulerService {
  private readonly logger = new Logger(MonitoringSchedulerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MonitoringQueueService) private readonly monitoringQueueService: MonitoringQueueService,
  ) {}

  @Interval(15000)
  async runDueChecks(): Promise<void> {
    const now = new Date();

    const dueMonitors = await this.prisma.monitor.findMany({
      where: {
        enabled: true,
        nextCheckAt: {
          lte: now,
        },
      },
      take: 100,
      orderBy: {
        nextCheckAt: 'asc',
      },
    });

    for (const monitor of dueMonitors) {
      const claimed = await this.prisma.monitor.updateMany({
        where: {
          id: monitor.id,
          enabled: true,
          nextCheckAt: {
            lte: now,
          },
        },
        data: {
          nextCheckAt: new Date(Date.now() + monitor.intervalSeconds * 1000),
        },
      });

      if (claimed.count !== 1) {
        continue;
      }

      try {
        const scheduledFor = new Date();
        await this.monitoringQueueService.enqueueMonitorCheck(monitor.id, scheduledFor);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown queue failure';
        this.logger.error(`Failed to enqueue monitor ${monitor.id}: ${message}`);

        await this.prisma.monitor.update({
          where: { id: monitor.id },
          data: {
            nextCheckAt: new Date(Date.now() + 15000),
          },
        });
      }
    }
  }
}
