import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type NotificationChannel, type NotificationDeliveryEventType, type NotificationDeliveryStatus, type Incident, type ManualIncidentImpact, type ManualIncidentStatus, type Monitor, type User } from '@prisma/client';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { PrismaService } from '../database/prisma.service.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetAddressService } from '../monitoring/target-address.service.js';
import { NotificationSecretService } from './notification-secret.service.js';

const MAX_DELIVERY_ATTEMPTS = 5;

type DeliveryTarget = {
  id: string;
  userId: string;
  eventType: NotificationDeliveryEventType;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
  occurredAt: Date | null;
  incidentTitleSnapshot: string | null;
  incidentImpactSnapshot: ManualIncidentImpact | null;
  incidentStatusSnapshot: ManualIncidentStatus | null;
  updateMessageSnapshot: string | null;
  monitorNamesSnapshot: Prisma.JsonValue | null;
  payloadSnapshot: Prisma.JsonValue | null;
  channel: NotificationChannel | null;
  incident: (Incident & { monitor: Monitor & { user: User } }) | null;
};

type ManualIncidentEventType =
  | 'MANUAL_INCIDENT_OPENED'
  | 'MANUAL_INCIDENT_UPDATED'
  | 'MANUAL_INCIDENT_RESOLVED';

type ManualIncidentDeliveryInput = {
  manualIncidentId: string;
  manualIncidentUpdateId: string;
  eventType: ManualIncidentEventType;
  title: string;
  impact: ManualIncidentImpact;
  incidentStatus: ManualIncidentStatus;
  updateStatus: ManualIncidentStatus;
  updateMessage: string;
  startedAt: Date;
  resolvedAt: Date | null;
  eventTimestamp: Date;
  monitorIds: string[];
  monitorNames: string[];
};

interface DeliveryResult {
  success: boolean;
  retryable: boolean;
  errorMessage: string | null;
  nextAttemptAt?: Date;
}

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationSecretService) private readonly notificationSecretService: NotificationSecretService,
    @Inject(DnsResolverService) private readonly dnsResolver: DnsResolverService,
    @Inject(TargetAddressService) private readonly targetAddressService: TargetAddressService,
  ) {}

  private static isManualEventType(eventType: NotificationDeliveryEventType): eventType is ManualIncidentEventType {
    return eventType === 'MANUAL_INCIDENT_OPENED'
      || eventType === 'MANUAL_INCIDENT_UPDATED'
      || eventType === 'MANUAL_INCIDENT_RESOLVED';
  }

  private static eventName(eventType: NotificationDeliveryEventType): string {
    switch (eventType) {
      case 'INCIDENT_OPENED':
        return 'incident.opened';
      case 'INCIDENT_RESOLVED':
        return 'incident.resolved';
      case 'MANUAL_INCIDENT_OPENED':
        return 'manual_incident.opened';
      case 'MANUAL_INCIDENT_UPDATED':
        return 'manual_incident.updated';
      case 'MANUAL_INCIDENT_RESOLVED':
        return 'manual_incident.resolved';
      default:
        return 'incident.opened';
    }
  }

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

    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      include: {
        monitor: {
          select: {
            id: true,
            userId: true,
            name: true,
            url: true,
          },
        },
      },
    });

    if (!incident) {
      return;
    }

    const channels = await tx.notificationChannel.findMany({
      where: { id: { in: channelIds }, enabled: true },
      select: { id: true, userId: true, name: true, type: true },
    });

    const rowData = channels
      .filter((channel) => channel.userId === incident.monitor.userId)
      .map((channel) => ({
        userId: incident.monitor.userId,
        channelId: channel.id,
        channelName: channel.name,
        channelType: channel.type,
        incidentId,
        eventType,
        status: 'PENDING' as const,
        attemptCount: 0,
        nextAttemptAt,
      }));

    if (rowData.length === 0) {
      return;
    }

    await tx.notificationDelivery.createMany({
      data: rowData,
      skipDuplicates: true,
    });
  }

  async createForManualIncidentUpdate(
    tx: Prisma.TransactionClient,
    userId: string,
    input: ManualIncidentDeliveryInput,
  ): Promise<void> {
    if (input.monitorIds.length === 0) {
      return;
    }

    const channels = await tx.notificationChannel.findMany({
      where: {
        userId,
        enabled: true,
        monitorAssociations: {
          some: {
            monitorId: { in: input.monitorIds },
          },
        },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        type: true,
      },
    });

    if (channels.length === 0) {
      return;
    }

    const uniqueMonitorNames = [...new Set(input.monitorNames.map((name) => name.trim()).filter((name) => name.length > 0))];

    const payloadSnapshot = {
      event: NotificationDeliveryService.eventName(input.eventType),
      incident: {
        type: 'manual',
        title: input.title,
        impact: input.impact,
        status: input.incidentStatus,
        startedAt: input.startedAt,
        resolvedAt: input.resolvedAt,
      },
      update: {
        status: input.updateStatus,
        message: input.updateMessage,
        createdAt: input.eventTimestamp,
      },
      monitors: uniqueMonitorNames.map((name) => ({ name })),
    };

    await tx.notificationDelivery.createMany({
      data: channels
        .filter((channel) => channel.userId === userId)
        .map((channel) => ({
          userId,
          channelId: channel.id,
          channelName: channel.name,
          channelType: channel.type,
          manualIncidentId: input.manualIncidentId,
          manualIncidentUpdateId: input.manualIncidentUpdateId,
          eventType: input.eventType,
          occurredAt: input.eventTimestamp,
          incidentTitleSnapshot: input.title,
          incidentImpactSnapshot: input.impact,
          incidentStatusSnapshot: input.incidentStatus,
          updateMessageSnapshot: input.updateMessage,
          monitorNamesSnapshot: uniqueMonitorNames,
          payloadSnapshot,
          status: 'PENDING' as const,
          attemptCount: 0,
          nextAttemptAt: input.eventTimestamp,
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
              include: { user: true },
            },
          },
        },
      },
    });

    if (!delivery || delivery.status === 'SENT') {
      return;
    }

    const attemptNumber = delivery.attemptCount + 1;
    const now = new Date();

    if (!delivery.channel) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: 'Delivery target was removed or invalid.',
          nextAttemptAt: null,
          lastAttemptAt: now,
          attemptCount: attemptNumber,
        },
      });
      return;
    }

    if (delivery.channel.userId !== delivery.userId) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: 'Channel ownership mismatch.',
          nextAttemptAt: null,
          lastAttemptAt: now,
          attemptCount: attemptNumber,
        },
      });
      return;
    }

    try {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'PROCESSING',
          attemptCount: attemptNumber,
          lastAttemptAt: now,
          lastError: null,
        },
      });

      const endpoint = this.notificationSecretService.decryptEndpoint(delivery.channel.endpointEncrypted);
      const payload = this.buildPayload(delivery);
      const result = await this.sendWebhook(endpoint, payload, delivery.id, delivery.eventType, delivery.channel.type, attemptNumber);

      if (result.success) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SENT',
            sentAt: now,
            lastError: null,
            lastAttemptAt: now,
            attemptCount: attemptNumber,
            nextAttemptAt: null,
          },
        });
        return;
      }

      if (result.retryable && attemptNumber < MAX_DELIVERY_ATTEMPTS) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'PENDING',
            lastError: result.errorMessage ?? 'Retry scheduled after transient webhook error.',
            nextAttemptAt: result.nextAttemptAt ?? this.computeNextAttemptTime(attemptNumber),
            lastAttemptAt: now,
            attemptCount: attemptNumber,
          },
        });
        return;
      }

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          lastError: result.errorMessage ?? 'Notification delivery failed permanently.',
          nextAttemptAt: null,
          lastAttemptAt: now,
          attemptCount: attemptNumber,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown notification failure';
      const shouldRetry = attemptNumber < MAX_DELIVERY_ATTEMPTS && !this.isPermanentDeliveryFailure(message);

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          lastError: message,
          nextAttemptAt: shouldRetry ? this.computeNextAttemptTime(attemptNumber) : null,
          lastAttemptAt: now,
          attemptCount: attemptNumber,
        },
      });
    }
  }

  async listForUser(userId: string, status: string | undefined, limit = 50) {
    const normalizedStatus = status?.toLowerCase() ?? 'all';
    const allowed = new Set(['all', 'pending', 'sent', 'failed']);
    if (!allowed.has(normalizedStatus)) {
      throw new BadRequestException('status must be one of: all, pending, sent, failed.');
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 100) : 50;
    const where: Prisma.NotificationDeliveryWhereInput = { userId };
    if (normalizedStatus !== 'all') {
      where.status = normalizedStatus.toUpperCase() as NotificationDeliveryStatus;
    }

    const deliveries = await this.prisma.notificationDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      include: {
        incident: { include: { monitor: { select: { name: true } } } },
      },
    });

    return deliveries.map((delivery) => ({
      id: delivery.id,
      eventType: delivery.eventType,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      channel: {
        id: delivery.channelId,
        name: delivery.channelName ?? 'Deleted channel',
        type: delivery.channelType ?? 'WEBHOOK',
      },
      monitor: delivery.incident
        ? { id: delivery.incident.monitorId, name: delivery.incident.monitor.name }
        : null,
      lastAttemptAt: delivery.lastAttemptAt,
      sentAt: delivery.sentAt,
      lastError: delivery.lastError,
      createdAt: delivery.createdAt,
      incident: delivery.incident
        ? {
            id: delivery.incident.id,
            startedAt: delivery.incident.startedAt,
            resolvedAt: delivery.incident.resolvedAt,
          }
        : null,
    }));
  }

  private buildPayload(delivery: DeliveryTarget) {
    if (NotificationDeliveryService.isManualEventType(delivery.eventType)) {
      if (!delivery.payloadSnapshot || typeof delivery.payloadSnapshot !== 'object') {
        throw new BadRequestException('Invalid manual incident notification snapshot.');
      }

      const snapshot = delivery.payloadSnapshot as Record<string, unknown>;
      return {
        ...snapshot,
        event: NotificationDeliveryService.eventName(delivery.eventType),
        deliveryId: delivery.id,
      } as Record<string, unknown>;
    }

    const monitor = delivery.incident?.monitor;
    const occurredAt = delivery.eventType === 'INCIDENT_OPENED'
      ? delivery.incident?.startedAt ?? delivery.occurredAt ?? delivery.createdAt
      : delivery.incident?.resolvedAt ?? delivery.occurredAt ?? delivery.createdAt;
    const durationMs = delivery.eventType === 'INCIDENT_RESOLVED'
      ? (delivery.incident?.resolvedAt && delivery.incident?.startedAt
        ? delivery.incident.resolvedAt.getTime() - delivery.incident.startedAt.getTime()
        : 0)
      : delivery.incident
        ? Math.max(0, Date.now() - delivery.incident.startedAt.getTime())
        : 0;

    return {
      event: NotificationDeliveryService.eventName(delivery.eventType),
      deliveryId: delivery.id,
      occurredAt: occurredAt.toISOString(),
      monitor: {
        id: monitor?.id ?? '',
        name: monitor?.name ?? '',
        url: monitor?.url ?? '',
        status: delivery.eventType === 'INCIDENT_OPENED' ? 'DOWN' : 'UP',
      },
      incident: {
        id: delivery.incident?.id ?? '',
        startedAt: delivery.incident?.startedAt ?? occurredAt.toISOString(),
        resolvedAt: delivery.incident?.resolvedAt ?? null,
        reason: delivery.incident?.reason ?? '',
        durationMs,
      },
    } as Record<string, unknown>;
  }

  private async sendWebhook(
    endpoint: string,
    payload: Record<string, unknown>,
    deliveryId: string,
    eventType: NotificationDeliveryEventType,
    channelType: NotificationChannel['type'],
    attemptNumber: number,
  ): Promise<DeliveryResult> {
    const parsed = new URL(endpoint);

    if (parsed.protocol !== 'https:') {
      return { success: false, retryable: false, errorMessage: 'Only HTTPS notification endpoints are allowed.' };
    }

    if (parsed.username || parsed.password) {
      return { success: false, retryable: false, errorMessage: 'Credentials are not allowed in notification URLs.' };
    }

    if (channelType === 'DISCORD') {
      const discordPayload = this.buildDiscordPayload(eventType, payload, deliveryId);
      return this.sendHttpRequest(parsed, JSON.stringify(discordPayload), {
        'X-StatusCore-Event': NotificationDeliveryService.eventName(eventType),
        'X-StatusCore-Delivery': deliveryId,
        'Content-Type': 'application/json',
      }, 'discord', attemptNumber);
    }

    const eventName = NotificationDeliveryService.eventName(eventType);
    const body = JSON.stringify(payload);

    return this.sendHttpRequest(parsed, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'StatusCore/1.0',
      'X-StatusCore-Event': eventName,
      'X-StatusCore-Delivery': deliveryId,
    }, 'generic', attemptNumber);
  }

  private buildDiscordPayload(eventType: NotificationDeliveryEventType, payload: Record<string, unknown>, deliveryId: string) {
    if (NotificationDeliveryService.isManualEventType(eventType)) {
      const incident = payload.incident as Record<string, unknown> | undefined;
      const update = payload.update as Record<string, unknown> | undefined;
      const monitors = Array.isArray(payload.monitors)
        ? payload.monitors
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || !('name' in entry)) {
                return '';
              }

              const candidate = (entry as { name: unknown }).name;
              return typeof candidate === 'string' ? candidate.trim() : '';
            })
            .filter((name) => name.length > 0)
        : [];
      const title = typeof incident?.title === 'string' ? incident.title : 'Manual incident';
      const impact = typeof incident?.impact === 'string' ? incident.impact : 'UNKNOWN';
      const status = typeof update?.status === 'string' ? update.status : typeof incident?.status === 'string' ? incident.status : 'UNKNOWN';
      const message = typeof update?.message === 'string' ? update.message : 'No update message provided.';

      const heading = eventType === 'MANUAL_INCIDENT_OPENED'
        ? `Incident opened: ${this.truncate(title, 120)}`
        : eventType === 'MANUAL_INCIDENT_RESOLVED'
          ? `Incident resolved: ${this.truncate(title, 120)}`
          : `Incident update: ${this.truncate(title, 120)}`;

      const fields = [
        { name: 'Impact', value: this.truncate(impact, 256), inline: true },
        { name: 'Status', value: this.truncate(status, 256), inline: true },
        {
          name: 'Affected services',
          value: this.truncate(monitors.length > 0 ? monitors.join(', ') : 'None', 1024),
          inline: false,
        },
        {
          name: eventType === 'MANUAL_INCIDENT_RESOLVED' ? 'Resolution' : 'Message',
          value: this.truncate(message, 1024),
          inline: false,
        },
      ];

      const startedAt = incident?.startedAt;
      const resolvedAt = incident?.resolvedAt;
      const startedDate = startedAt instanceof Date ? startedAt : typeof startedAt === 'string' ? new Date(startedAt) : null;
      const resolvedDate = resolvedAt instanceof Date ? resolvedAt : typeof resolvedAt === 'string' ? new Date(resolvedAt) : null;

      if (eventType === 'MANUAL_INCIDENT_RESOLVED' && startedDate && resolvedDate && !Number.isNaN(startedDate.getTime()) && !Number.isNaN(resolvedDate.getTime())) {
        const durationMs = Math.max(0, resolvedDate.getTime() - startedDate.getTime());
        fields.push({ name: 'Duration', value: this.truncate(String(durationMs), 64), inline: true });
      }

      return {
        username: 'StatusCore',
        avatar_url: null,
        content: null,
        allowed_mentions: { parse: [] },
        embeds: [{
          title: heading,
          description: this.truncate(NotificationDeliveryService.eventName(eventType), 256),
          color: eventType === 'MANUAL_INCIDENT_RESOLVED' ? 65280 : 16753920,
          fields,
          footer: { text: `Delivery ${this.truncate(deliveryId, 64)}` },
        }],
      };
    }

    const incident = payload.incident as Record<string, unknown> | undefined;
    const monitor = payload.monitor as Record<string, unknown> | undefined;
    const monitorName = typeof monitor?.name === 'string' ? monitor.name : 'Service';
    const monitorUrl = typeof monitor?.url === 'string' ? monitor.url : '';
    const reason = typeof incident?.reason === 'string' ? incident.reason : 'No reason provided';
    const startedAtValue = incident?.startedAt;
    const resolvedAtValue = incident?.resolvedAt;
    const startedAt = startedAtValue instanceof Date ? startedAtValue.toISOString() : typeof startedAtValue === 'string' ? new Date(startedAtValue).toISOString() : '';
    const resolvedAt = resolvedAtValue instanceof Date ? resolvedAtValue.toISOString() : typeof resolvedAtValue === 'string' ? new Date(resolvedAtValue).toISOString() : '';
    const durationMs = Number(incident?.durationMs ?? 0);

    const title = eventType === 'INCIDENT_OPENED'
      ? `Incident opened: ${this.truncate(monitorName, 80)}`
      : `Incident resolved: ${this.truncate(monitorName, 80)}`;

    const description = eventType === 'INCIDENT_OPENED'
      ? `Monitor was marked DOWN.`
      : `Monitor recovered to UP.`;

    const fields = [
      { name: 'Monitor', value: this.truncate(monitorUrl || monitorName, 512), inline: false },
      { name: 'Status', value: eventType === 'INCIDENT_OPENED' ? 'DOWN' : 'UP', inline: true },
      { name: 'Reason', value: this.truncate(reason, 512), inline: false },
      { name: 'Started', value: this.truncate(startedAt || 'Unknown', 256), inline: true },
    ];

    if (eventType === 'INCIDENT_RESOLVED') {
      fields.push(
        { name: 'Resolved', value: this.truncate(resolvedAt || 'Unknown', 256), inline: true },
        { name: 'Duration', value: this.truncate(String(Math.max(0, durationMs)), 64), inline: true },
      );
    }

    return {
      username: 'StatusCore',
      avatar_url: null,
      content: null,
      allowed_mentions: { parse: [] },
      embeds: [{
        title,
        description,
        color: eventType === 'INCIDENT_OPENED' ? 16711680 : 65280,
        fields,
        footer: { text: `Delivery ${this.truncate(deliveryId, 64)}` },
      }],
    };
  }

  private async sendHttpRequest(
    parsed: URL,
    body: string,
    extraHeaders: Record<string, string>,
    type: 'generic' | 'discord',
    attemptNumber: number,
  ): Promise<DeliveryResult> {
    const resolvedAddress = await this.resolvePinnedAddress(parsed.hostname);
    const requestHeaders = {
      ...extraHeaders,
      'Host': parsed.host,
      'User-Agent': 'StatusCore/1.0',
      'Content-Length': String(Buffer.byteLength(body)),
    };

    return new Promise<DeliveryResult>((resolve) => {
      const req = httpsRequest(
        {
          protocol: parsed.protocol,
          hostname: resolvedAddress,
          port: parsed.port ? Number(parsed.port) : 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          timeout: 10000,
          headers: requestHeaders,
          lookup: (_hostname, _options, callback) => {
            const family = ipaddr.parse(resolvedAddress).kind() === 'ipv6' ? 6 : 4;
            callback(null, resolvedAddress, family);
          },
          rejectUnauthorized: true,
          servername: parsed.hostname,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const retryAfterValue = response.headers['retry-after'];
          const retryAfterMs = this.parseRetryAfterToMs(retryAfterValue);
          const nextAttemptAt = retryAfterMs ? new Date(Date.now() + retryAfterMs) : undefined;

          response.resume();
          response.destroy();

          if (statusCode >= 200 && statusCode < 300) {
            resolve({ success: true, retryable: false, errorMessage: null });
            return;
          }

          if (statusCode === 429 || statusCode >= 500) {
            resolve({
              success: false,
              retryable: true,
              errorMessage: `Webhook returned ${statusCode}.`,
              nextAttemptAt: nextAttemptAt ?? this.computeNextAttemptTime(attemptNumber),
            });
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
        const code = typeof error === 'object' && error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined;
        const retryable = this.isTransientWebhookError(message, code);
        resolve({
          success: false,
          retryable,
          errorMessage: retryable ? 'Webhook delivery failed transiently.' : message,
          nextAttemptAt: retryable ? this.computeNextAttemptTime(attemptNumber) : undefined,
        });
      });

      req.write(body);
      req.end();
    });
  }

  private parseRetryAfterToMs(value: string | string[] | undefined): number | null {
    if (!value) {
      return null;
    }

    const candidate = Array.isArray(value) ? value[0] : value;
    if (!candidate) {
      return null;
    }

    const seconds = Number(candidate);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const capped = Math.min(Math.max(seconds, 0), 60 * 60);
      return capped * 1000;
    }

    return null;
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

  private truncate(value: string | null | undefined, maxLength: number): string {
    const normalized = String(value ?? '').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  private isTransientWebhookError(message: string, code?: string): boolean {
    const upper = `${message} ${code ?? ''}`.toUpperCase();
    return upper.includes('TIMEOUT') || upper.includes('ENOTFOUND') || upper.includes('EAI_AGAIN') || upper.includes('ECONNRESET') || upper.includes('ECONNREFUSED') || upper.includes('CERT') || upper.includes('TLS') || upper.includes('ECONNABORTED');
  }

  private isPermanentDeliveryFailure(message: string): boolean {
    const upper = message.toUpperCase();
    return upper.includes('MALFORMED') || upper.includes('INVALID') || upper.includes('UNUSABLE') || upper.includes('OWNERSHIP') || upper.includes('PASSWORD') || upper.includes('URL');
  }

  private computeNextAttemptTime(attemptNumber: number): Date {
    const schedule = {
      1: 30_000,
      2: 60_000,
      3: 300_000,
      4: 900_000,
    } as const;
    const delayMs = schedule[attemptNumber as keyof typeof schedule] ?? 900_000;
    return new Date(Date.now() + delayMs);
  }
}
