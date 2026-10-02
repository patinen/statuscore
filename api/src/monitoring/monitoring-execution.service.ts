import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { SafeHttpClientService } from './safe-http-client.service.js';

@Injectable()
export class MonitorExecutionService {
  private readonly logger = new Logger(MonitorExecutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SafeHttpClientService) private readonly safeHttpClient: SafeHttpClientService,
  ) {}

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }

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

        const incidentClient = 'incident' in tx ? tx.incident : null;
        const activeIncident = incidentClient
          ? await incidentClient.findFirst({
              where: {
                monitorId: monitor.id,
                resolvedAt: null,
              },
            })
          : null;

        if (result.success && activeIncident && incidentClient) {
          await incidentClient.update({
            where: { id: activeIncident.id },
            data: {
              resolvedAt: new Date(),
              reason: activeIncident.reason ?? 'Recovered after successful checks',
              lastError: activeIncident.lastError ?? result.errorType ?? null,
            },
          });
        }

        if (!result.success && nextStatus === 'DOWN' && incidentClient) {
          const incidentReason = `Monitor failed ${newConsecutiveFailures} consecutive checks`;

          if (!activeIncident) {
            try {
              await incidentClient.create({
                data: {
                  monitorId: monitor.id,
                  reason: incidentReason,
                  lastError: result.errorMessage ?? result.errorType ?? null,
                },
              });
            } catch (error) {
              if (!this.isUniqueConstraintError(error)) {
                throw error;
              }
            }
          } else {
            await incidentClient.update({
              where: { id: activeIncident.id },
              data: {
                reason: activeIncident.reason ?? incidentReason,
                lastError: result.errorMessage ?? result.errorType ?? activeIncident.lastError ?? null,
              },
            });
          }
        }

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
      this.logger.error(`Infrastructure error processing monitor ${monitorId}: ${message}`);
      throw error;
    }
  }
}
