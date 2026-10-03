import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service.js';
import { SafeHttpClientService } from './safe-http-client.service.js';

const MAX_TRANSACTION_RETRIES = 4;

@Injectable()
export class MonitorExecutionService {
  private readonly logger = new Logger(MonitorExecutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SafeHttpClientService) private readonly safeHttpClient: SafeHttpClientService,
    @Inject(NotificationDeliveryService) private readonly notificationDeliveryService?: NotificationDeliveryService,
  ) {}

  private buildIncidentReason(result: { errorType: string | null; statusCode: number | null }, expectedStatusCode: number): string {
    switch (result.errorType) {
      case 'UNEXPECTED_STATUS':
        return `Expected HTTP ${expectedStatusCode} but received ${result.statusCode ?? 'an unexpected status'}.`;
      case 'TIMEOUT':
        return 'Request timed out.';
      case 'DNS_ERROR':
        return 'DNS lookup failed.';
      case 'CONNECTION_ERROR':
        return 'Connection failed.';
      case 'TLS_ERROR':
        return 'TLS verification failed.';
      case 'INVALID_TARGET':
        return 'Target validation failed.';
      case 'TOO_MANY_REDIRECTS':
        return 'Too many redirects.';
      case 'UNKNOWN_ERROR':
      default:
        return 'Monitoring check failed.';
    }
  }

  private isRetryableMonitorTransactionError(error: unknown): boolean {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;

    if (code === 'P2034') {
      return true;
    }

    if (code !== 'P2002') {
      return false;
    }

    const meta =
      error && typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object'
        ? error.meta
        : undefined;

    const rawTargets = meta && 'target' in meta ? meta.target : undefined;
    const targets = Array.isArray(rawTargets)
      ? rawTargets
      : typeof rawTargets === 'string'
        ? [rawTargets]
        : [];

    return targets.some((target) => typeof target === 'string' && /monitorId|Incident_monitorId_active_unique/i.test(target));
  }

  private async withSerializableRetry<T>(operation: (tx: Parameters<typeof this.prisma.$transaction>[0] extends (tx: infer T) => any ? T : never) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => operation(tx), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!this.isRetryableMonitorTransactionError(error) || attempt === MAX_TRANSACTION_RETRIES - 1) {
          throw error;
        }

        this.logger.warn(
          `Monitor transaction conflict while processing monitor; retrying ${attempt + 1}/${MAX_TRANSACTION_RETRIES}.`,
        );
      }
    }

    throw new Error('Monitor transaction retry budget exhausted.');
  }

  private async createIncidentNotifications(
    tx: any,
    incidentId: string,
    eventType: 'INCIDENT_OPENED' | 'INCIDENT_RESOLVED',
    monitorId: string,
    checkedAt: Date,
  ): Promise<void> {
    if (!this.notificationDeliveryService) {
      return;
    }

    const monitorNotificationChannel = tx.monitorNotificationChannel;
    if (!monitorNotificationChannel || typeof monitorNotificationChannel.findMany !== 'function') {
      return;
    }

    const channelRows = await monitorNotificationChannel.findMany({
      where: { monitorId },
      include: { channel: true },
    });

    const enabledChannelIds = channelRows
      .filter((row: { channel?: { enabled?: boolean } }) => Boolean(row.channel?.enabled))
      .map((row: { channelId: string }) => row.channelId);

    if (enabledChannelIds.length === 0) {
      return;
    }

    await this.notificationDeliveryService.createForIncidentTransition(
      tx,
      incidentId,
      eventType,
      enabledChannelIds,
      checkedAt,
    );
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

      await this.withSerializableRetry(async (tx) => {
        const state = await tx.monitor.findUnique({ where: { id: monitorId } });

        if (!state || !state.enabled) {
          return;
        }

        const checkedAt = new Date();
        const previousStatus = state.currentStatus;
        const newConsecutiveFailures = result.success ? 0 : state.consecutiveFailures + 1;
        const nextStatus = result.success
          ? 'UP'
          : newConsecutiveFailures >= state.failureThreshold
            ? 'DOWN'
            : previousStatus === 'UNKNOWN'
              ? 'UNKNOWN'
              : previousStatus;

        const didTransitionDown = previousStatus !== 'DOWN' && nextStatus === 'DOWN';
        const didRecover = previousStatus === 'DOWN' && nextStatus === 'UP';
        const activeIncident = await tx.incident.findFirst({
          where: {
            monitorId: state.id,
            resolvedAt: null,
          },
          orderBy: { startedAt: 'desc' },
        });

        let incidentId: string | null = activeIncident?.id ?? null;

        if (didTransitionDown) {
          const createdIncident = await tx.incident.create({
            data: {
              monitorId: state.id,
              startedAt: checkedAt,
              reason: this.buildIncidentReason(result, state.expectedStatusCode),
              lastError: result.errorMessage ?? null,
            },
          });
          incidentId = createdIncident?.id ?? null;

          if (incidentId) {
            await this.createIncidentNotifications(tx, incidentId, 'INCIDENT_OPENED', state.id, checkedAt);
          }
        } else if (didRecover) {
          if (activeIncident) {
            const resolvedIncident = await tx.incident.update({
              where: { id: activeIncident.id },
              data: {
                resolvedAt: checkedAt,
                reason: activeIncident.reason ?? this.buildIncidentReason(result, state.expectedStatusCode),
                lastError: activeIncident.lastError ?? result.errorMessage ?? null,
              },
            });
            incidentId = resolvedIncident?.id ?? activeIncident.id;

            await this.createIncidentNotifications(tx, incidentId, 'INCIDENT_RESOLVED', state.id, checkedAt);
          } else {
            this.logger.warn(
              `Monitor ${monitorId} recovered to UP without an open incident. Preserving recovered state without creating a synthetic incident.`,
            );
          }
        } else if (previousStatus === 'DOWN' && !result.success && activeIncident) {
          await tx.incident.update({
            where: { id: activeIncident.id },
            data: {
              lastError: result.errorMessage ?? activeIncident.lastError ?? null,
              reason: activeIncident.reason ?? this.buildIncidentReason(result, state.expectedStatusCode),
            },
          });
        }

        await tx.checkResult.create({
          data: {
            monitorId: state.id,
            success: result.success,
            statusCode: result.statusCode,
            responseTimeMs: result.responseTimeMs,
            errorType: result.errorType ?? null,
            errorMessage: result.errorMessage ?? null,
            checkedAt,
          },
        });

        await tx.monitor.update({
          where: { id: state.id },
          data: {
            currentStatus: nextStatus,
            consecutiveFailures: result.success ? 0 : newConsecutiveFailures,
            lastCheckedAt: checkedAt,
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
