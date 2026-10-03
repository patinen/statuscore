import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type NotificationDeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationSecretService } from './notification-secret.service.js';
import type { CreateNotificationChannelDto, UpdateNotificationChannelDto } from './notifications.dto.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationSecretService) private readonly secretService: NotificationSecretService,
  ) {}

  private static async validateMonitorIds(prisma: PrismaService, userId: string, monitorIds: string[]): Promise<void> {
    if (monitorIds.length === 0) {
      throw new BadRequestException('At least one monitor must be selected.');
    }

    if (monitorIds.length > 50) {
      throw new BadRequestException('Maximum of 50 monitors per notification channel.');
    }

    const monitors = await prisma.monitor.findMany({
      where: {
        id: { in: monitorIds },
        userId,
      },
      select: { id: true },
    });

    if (monitors.length !== monitorIds.length) {
      throw new BadRequestException('One or more selected monitors do not belong to the current user.');
    }
  }

  private static isDiscordHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return lower === 'discord.com' || lower === 'discordapp.com' || lower.endsWith('.discord.com') || lower.endsWith('.discordapp.com');
  }

  private static validateWebhookUrl(type: 'DISCORD' | 'WEBHOOK', url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Notification URL is invalid.');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Notification URLs must use HTTPS.');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('Notification URLs cannot contain credentials.');
    }

    if (type === 'DISCORD') {
      const hostname = parsed.hostname.toLowerCase();
      if (!NotificationsService.isDiscordHostname(hostname)) {
        throw new BadRequestException('Only official Discord webhook hosts are allowed.');
      }

      const match = /^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(`${parsed.pathname}${parsed.search}`);
      if (!match) {
        throw new BadRequestException('Discord webhook URL must match /api/webhooks/<id>/<token>.');
      }
    }
  }

  async listForUser(userId: string) {
    const channels = await this.prisma.notificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { monitorAssociations: { select: { monitorId: true } } },
    });

    return channels.map((channel) => this.serializeChannel(channel, channel.monitorAssociations.map((entry) => entry.monitorId)));
  }

  async createForUser(userId: string, data: CreateNotificationChannelDto) {
    const channelCount = await this.prisma.notificationChannel.count({ where: { userId } });
    if (channelCount >= 10) {
      throw new BadRequestException('Maximum of 10 notification channels per user has been reached.');
    }

    NotificationsService.validateWebhookUrl(data.type, data.url);
    await NotificationsService.validateMonitorIds(this.prisma, userId, data.monitorIds);

    return this.prisma.$transaction(async (tx) => {
      const endpointEncrypted = this.secretService.encryptEndpoint(data.url.trim());
      const channel = await tx.notificationChannel.create({
        data: {
          userId,
          name: data.name.trim(),
          type: data.type,
          endpointEncrypted,
          enabled: true,
        },
      });

      await tx.monitorNotificationChannel.createMany({
        data: data.monitorIds.map((monitorId) => ({ monitorId, channelId: channel.id })),
        skipDuplicates: true,
      });

      return this.serializeChannel(channel, data.monitorIds);
    });
  }

  async updateForUser(userId: string, channelId: string, data: UpdateNotificationChannelDto) {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, userId },
      include: { monitorAssociations: { select: { monitorId: true } } },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found.');
    }

    if (data.url) {
      NotificationsService.validateWebhookUrl(channel.type, data.url);
    }

    if (data.monitorIds) {
      await NotificationsService.validateMonitorIds(this.prisma, userId, data.monitorIds);
    }

    return this.prisma.$transaction(async (tx) => {
      let nextUrl = channel.endpointEncrypted;
      if (data.url) {
        nextUrl = this.secretService.encryptEndpoint(data.url.trim());
      }

      const updated = await tx.notificationChannel.update({
        where: { id: channelId },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.url !== undefined ? { endpointEncrypted: nextUrl } : {}),
        },
        include: { monitorAssociations: { select: { monitorId: true } } },
      });

      if (data.monitorIds) {
        await tx.monitorNotificationChannel.deleteMany({ where: { channelId } });
        await tx.monitorNotificationChannel.createMany({
          data: data.monitorIds.map((monitorId) => ({ monitorId, channelId })),
          skipDuplicates: true,
        });
      }

      return this.serializeChannel(updated, (data.monitorIds ?? updated.monitorAssociations.map((row) => row.monitorId)));
    });
  }

  async deleteForUser(userId: string, channelId: string): Promise<void> {
    const target = await this.prisma.notificationChannel.findFirst({ where: { id: channelId, userId } });
    if (!target) {
      throw new NotFoundException('Notification channel not found.');
    }

    await this.prisma.notificationChannel.delete({ where: { id: channelId } });
  }

  async listDeliveriesForUser(userId: string, status: string | undefined, limit = 50) {
    const normalizedStatus = status?.toLowerCase() ?? 'all';
    const allowedStatuses = new Set(['all', 'pending', 'sent', 'failed']);

    if (!allowedStatuses.has(normalizedStatus)) {
      throw new BadRequestException('status must be one of: all, pending, sent, failed.');
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 100) : 50;
    const where: Prisma.NotificationDeliveryWhereInput = { userId };
    if (normalizedStatus !== 'all') {
      where.status = normalizedStatus.toUpperCase() as NotificationDeliveryStatus;
    }

    const rows = await this.prisma.notificationDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      include: {
        incident: { include: { monitor: { select: { id: true, name: true } } } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      status: row.status,
      attemptCount: row.attemptCount,
      occurredAt: row.occurredAt,
      sentAt: row.sentAt,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      channel: row.channelName ? { id: row.channelId, name: row.channelName, type: row.channelType ?? 'WEBHOOK' } : null,
      monitor: row.incident ? { id: row.incident.monitor.id, name: row.incident.monitor.name } : null,
      monitors: Array.isArray(row.monitorNamesSnapshot)
        ? row.monitorNamesSnapshot.filter((value): value is string => typeof value === 'string')
        : row.incident
          ? [row.incident.monitor.name]
          : [],
      incident: {
        type: row.eventType.startsWith('MANUAL_INCIDENT_') ? 'manual' : 'automatic',
        title: row.incidentTitleSnapshot,
        impact: row.incidentImpactSnapshot,
        statusSnapshot: row.incidentStatusSnapshot,
        messageSnapshot: row.updateMessageSnapshot,
      },
    }));
  }

  private getEndpointHost(endpointEncrypted: string): string {
    try {
      return new URL(this.secretService.decryptEndpoint(endpointEncrypted)).hostname;
    } catch {
      return 'configured';
    }
  }

  private serializeChannel(
    channel: {
      id: string;
      name: string;
      type: string;
      endpointEncrypted: string;
      enabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      monitorAssociations?: { monitorId: string }[];
    },
    monitorIds: string[],
  ) {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      endpointHost: this.getEndpointHost(channel.endpointEncrypted),
      monitorIds,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }
}
