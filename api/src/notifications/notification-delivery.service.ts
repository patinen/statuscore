import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type NotificationChannel, type NotificationDeliveryEventType, type NotificationDeliveryStatus, type Incident, type Monitor, type User } from '@prisma/client';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import * as ipaddr from 'ipaddr.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetAddressService } from '../monitoring/target-address.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationSecretService } from './notification-secret.service.js';

const MAX_DELIVERY_ATTEMPTS = 5;

type DeliveryTarget = {
  id: string;
  eventType: NotificationDeliveryEventType;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
  channel: NotificationChannel | null;
  incident: (Incident & { monitor: Monitor & { user: User } }) | null;
};

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationSecretService) private readonly notificationSecretService: NotificationSecretService,
    @Inject(DnsResolverService) private readonly dnsResolver: DnsResolverService,
    @Inject(TargetAddressService) private readonly targetAddressService: TargetAddressService,
  ) {}

  async createForIncidentTransition(
    tx: Prisma.TransactionClient,
    incidentId: string,
    eventType: NotificationDeliveryEventType,
    channelIds: string[],
    nextAttemptAt: Date,
  ): Promise<void> {
    if (channelIds.length === 0) {
      return;
    }

    await tx.notificationDelivery.createMany({
      data: channelIds.map((channelId) => ({
        channelId,
        incidentId,
        eventType,
        status: 'PENDING',
        nextAttemptAt,
      })),
      skipDuplicates: true,
    });
  }

  async processDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        channel: true,
        incident: {
          include: {
            monitor: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!delivery) {
      return;
    }

    if (delivery.status === 'SENT') {
      return;
    }

    if (!delivery.channel || !delivery.incident) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: 'Delivery target was removed or invalid.',
          nextAttemptAt: null,
        },
      });
      return;
    }

    if (delivery.channel.userId !== delivery.incident.monitor.userId) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: 'Channel ownership mismatch.',
          nextAttemptAt: null,
        },
      });
      return;
    }

    const endpoint = this.notificationSecretService.decryptEndpoint(delivery.channel.endpointEncrypted);
    const payload = this.buildPayload(delivery);

    try {
      const result = await this.sendWebhook(endpoint, payload, delivery.id, delivery.eventType);

      if (result.success) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            lastError: null,
            lastAttemptAt: new Date(),
            nextAttemptAt: null,
          },
        });
        return;
      }

      const nextAttempt = delivery.attemptCount + 1;
      const shouldRetry = result.retryable && nextAttempt < MAX_DELIVERY_ATTEMPTS;

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          attemptCount: nextAttempt,
          lastAttemptAt: new Date(),
          lastError: result.errorMessage ?? null,
          nextAttemptAt: shouldRetry ? this.computeNextAttemptTime(nextAttempt) : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown notification failure';
      const nextAttempt = delivery.attemptCount + 1;
      const shouldRetry = nextAttempt < MAX_DELIVERY_ATTEMPTS;

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          attemptCount: nextAttempt,
          lastAttemptAt: new Date(),
          lastError: message,
          nextAttemptAt: shouldRetry ? this.computeNextAttemptTime(nextAttempt) : null,
        },
      });
    }
  }

  async listForUser(userId: string, status: string | undefined, limit: number) {
    const where: Prisma.NotificationDeliveryWhereInput = {
      channel: { userId },
    };

    if (status && status !== 'all') {
      where.status = status.toUpperCase() as NotificationDeliveryStatus;
    }

    const deliveries = await this.prisma.notificationDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        channel: { select: { id: true, name: true, type: true } },
        incident: { include: { monitor: { select: { name: true } } } },
      },
    });

    return deliveries.map((delivery) => ({
      id: delivery.id,
      eventType: delivery.eventType,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      lastAttemptAt: delivery.lastAttemptAt,
      sentAt: delivery.sentAt,
      lastError: delivery.lastError,
      createdAt: delivery.createdAt,
      channel: delivery.channel ? { id: delivery.channel.id, name: delivery.channel.name, type: delivery.channel.type } : null,
      incident: delivery.incident
        ? {
            id: delivery.incident.id,
            monitorName: delivery.incident.monitor.name,
            startedAt: delivery.incident.startedAt,
            resolvedAt: delivery.incident.resolvedAt,
          }
        : null,
    }));
  }

  private buildPayload(delivery: DeliveryTarget) {
    const monitor = delivery.incident?.monitor;
    const payload: Record<string, unknown> = {
      event: delivery.eventType === 'INCIDENT_OPENED' ? 'incident.opened' : 'incident.resolved',
      deliveryId: delivery.id,
      occurredAt: new Date().toISOString(),
      monitor: {
        id: monitor?.id ?? '',
        name: monitor?.name ?? '',
        url: monitor?.url ?? '',
        status: monitor?.currentStatus ?? 'UNKNOWN',
      },
      incident: {
        id: delivery.incident?.id ?? '',
        startedAt: delivery.incident?.startedAt ?? new Date().toISOString(),
        resolvedAt: delivery.incident?.resolvedAt ?? null,
        reason: delivery.incident?.reason ?? '',
        durationMs: delivery.incident?.resolvedAt
          ? delivery.incident.resolvedAt.getTime() - delivery.incident.startedAt.getTime()
          : Date.now() - delivery.incident!.startedAt.getTime(),
      },
    };

    return payload;
  }

  private async sendWebhook(endpoint: string, payload: Record<string, unknown>, deliveryId: string, eventType: NotificationDeliveryEventType) {
    const parsed = new URL(endpoint);

    if (parsed.protocol !== 'https:') {
      return { success: false, retryable: false, errorMessage: 'Only HTTPS notification endpoints are allowed.' };
    }

    if (parsed.username || parsed.password) {
      return { success: false, retryable: false, errorMessage: 'Credentials are not allowed in notification URLs.' };
    }

    const resolvedAddress = await this.resolvePinnedAddress(parsed.hostname);
    const eventName = eventType === 'INCIDENT_OPENED' ? 'incident.opened' : 'incident.resolved';
    const body = JSON.stringify(payload);

    return new Promise<{ success: boolean; retryable: boolean; errorMessage: string | null }>((resolve) => {
      const req = httpsRequest(
        {
          protocol: parsed.protocol,
          hostname: resolvedAddress,
          port: 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'StatusCore/1.0',
            'Host': parsed.host,
            'X-StatusCore-Event': eventName,
            'X-StatusCore-Delivery': deliveryId,
            'Content-Length': Buffer.byteLength(body),
          },
          lookup: (_hostname, _options, callback) => {
            const family = ipaddr.parse(resolvedAddress).kind() === 'ipv6' ? 6 : 4;
            callback(null, resolvedAddress, family);
          },
          rejectUnauthorized: true,
          servername: parsed.hostname,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          response.resume();
          response.destroy();

          if (statusCode >= 200 && statusCode < 300) {
            resolve({ success: true, retryable: false, errorMessage: null });
            return;
          }

          if (statusCode === 429 || statusCode >= 500) {
            resolve({ success: false, retryable: true, errorMessage: `Webhook returned ${statusCode}.` });
            return;
          }

          if (statusCode >= 300 && statusCode < 400) {
            resolve({ success: false, retryable: false, errorMessage: `Webhook returned redirect ${statusCode}.` });
            return;
          }

          resolve({ success: false, retryable: false, errorMessage: `Webhook returned ${statusCode}.` });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('TIMEOUT'));
      });

      req.on('error', (error) => {
        const message = error instanceof Error ? error.message : 'Unknown webhook failure';
        const errorCode = error && typeof error === 'object' && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined;
        const retryable = this.isTransientWebhookError(message, errorCode);

        resolve({
          success: false,
          retryable,
          errorMessage: retryable ? 'Webhook delivery failed transiently.' : message,
        });
      });

      req.write(body);
      req.end();
    });
  }

  private async resolvePinnedAddress(hostname: string): Promise<string> {
    const normalized = hostname.replace(/^\[|\]$/g, '');

    if (isIP(normalized)) {
      if (this.targetAddressService.isBlockedAddress(normalized)) {
        throw new Error('Notification endpoint resolves to a blocked address.');
      }
      return this.targetAddressService.normalizeAddress(normalized);
    }

    const addresses = await this.dnsResolver.lookup(normalized, { all: true, verbatim: true });
    if (addresses.length === 0) {
      throw new Error('DNS lookup failed.');
    }

    const blocked = addresses.some((entry) => this.targetAddressService.isBlockedAddress(entry.address));
    if (blocked) {
      throw new Error('Notification endpoint resolved to a blocked private address.');
    }

    return this.targetAddressService.normalizeAddress(addresses[0].address);
  }

  private isTransientWebhookError(message: string, code?: string): boolean {
    const upper = `${message} ${code ?? ''}`.toUpperCase();
    return upper.includes('TIMEOUT') || upper.includes('ENOTFOUND') || upper.includes('EAI_AGAIN') || upper.includes('ECONNRESET') || upper.includes('ECONNREFUSED') || upper.includes('CERT') || upper.includes('TLS');
  }

  private computeNextAttemptTime(attemptNumber: number): Date {
    const delays = [30000, 60000, 300000, 900000];
    const delayMs = delays[Math.min(attemptNumber - 1, delays.length - 1)] ?? 900000;
    return new Date(Date.now() + delayMs);
  }
}
