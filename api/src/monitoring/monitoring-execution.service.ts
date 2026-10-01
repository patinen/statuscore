import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SafeHttpClientService, type HttpMonitorCheckResult } from './safe-http-client.service.js';

@Injectable()
export class MonitorExecutionService {
  private readonly logger = new Logger(MonitorExecutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SafeHttpClientService) private readonly safeHttpClient: SafeHttpClientService,
  ) {}

  async processMonitorCheck(monitorId: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id: monitorId } });

    if (!monitor) {
      this.logger.warn(`Skipping deleted monitor ${monitorId}.`);
      return;
    }

    if (!monitor.enabled) {
      this.logger.log(`Skipping disabled monitor ${monitorId}.`);
      return;
    }

    try {
      const result = await this.safeHttpClient.executeCheck({
        url: monitor.url,
        method: monitor.method as 'GET' | 'HEAD',
        expectedStatusCode: monitor.expectedStatusCode,
        timeoutMs: monitor.timeoutMs,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.checkResult.create({
          data: {
            monitorId: monitor.id,
            success: result.success,
            statusCode: result.statusCode,
            responseTimeMs: result.responseTimeMs,
            errorType: result.errorType ?? null,
            errorMessage: result.errorMessage ?? null,
          },
        });

        const newConsecutiveFailures = result.success ? 0 : monitor.consecutiveFailures + 1;
        const nextStatus = result.success
          ? 'UP'
          : newConsecutiveFailures >= monitor.failureThreshold
            ? 'DOWN'
            : monitor.currentStatus === 'UNKNOWN'
              ? 'UNKNOWN'
              : monitor.currentStatus;

        await tx.monitor.update({
          where: { id: monitor.id },
          data: {
            currentStatus: nextStatus,
            consecutiveFailures: result.success ? 0 : newConsecutiveFailures,
            lastCheckedAt: new Date(),
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected infrastructure failure';
      this.logger.error(`Worker processing failed for monitor ${monitorId}: ${message}`);
      await this.prisma.monitor.update({
        where: { id: monitorId },
        data: {
          lastCheckedAt: new Date(),
          currentStatus: 'UNKNOWN',
        },
      });
    }
  }

  async processCronResult(result: HttpMonitorCheckResult, monitorId: string): Promise<void> {
    const monitor = await this.prisma.monitor.findUnique({ where: { id: monitorId } });

    if (!monitor) {
      return;
    }

    const nextStatus = result.success
      ? 'UP'
      : result.statusCode === null
        ? monitor.currentStatus === 'UNKNOWN'
          ? 'UNKNOWN'
          : monitor.currentStatus
        : monitor.currentStatus;

    await this.prisma.$transaction(async (tx) => {
      await tx.checkResult.create({
        data: {
          monitorId,
          success: result.success,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
          errorType: result.errorType ?? null,
          errorMessage: result.errorMessage ?? null,
        },
      });

      await tx.monitor.update({
        where: { id: monitorId },
        data: {
          currentStatus: nextStatus,
          consecutiveFailures: result.success ? 0 : monitor.consecutiveFailures + 1,
          lastCheckedAt: new Date(),
        },
      });
    });
  }
}
