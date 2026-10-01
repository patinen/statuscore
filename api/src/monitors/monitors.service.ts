import { Injectable, NotFoundException } from '@nestjs/common';
import type { Monitor, User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { SessionUser } from '../auth/auth.service.js';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

export type MonitorRecord = Monitor;

@Injectable()
export class MonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetUrlValidationService: TargetUrlValidationService,
  ) {}

  async listForUser(userId: string): Promise<Monitor[]> {
    return this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(userId: string, monitorId: string): Promise<Monitor> {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, userId },
    });

    if (!monitor) {
      throw new NotFoundException('Monitor not found.');
    }

    return monitor;
  }

  async createForUser(user: SessionUser, data: { name: string; url: string; method: string; expectedStatusCode: number; intervalSeconds: number; timeoutMs: number; failureThreshold: number; enabled?: boolean }): Promise<Monitor> {
    const normalizedUrl = await this.targetUrlValidationService.validateAndNormalize(data.url);

    return this.prisma.monitor.create({
      data: {
        userId: user.id,
        name: data.name.trim(),
        url: normalizedUrl,
        method: data.method.toUpperCase(),
        expectedStatusCode: data.expectedStatusCode,
        intervalSeconds: data.intervalSeconds,
        timeoutMs: data.timeoutMs,
        failureThreshold: data.failureThreshold,
        enabled: data.enabled ?? true,
        currentStatus: 'UNKNOWN',
        consecutiveFailures: 0,
      },
    });
  }

  async updateForUser(userId: string, monitorId: string, data: Partial<{ name: string; url: string; method: string; expectedStatusCode: number; intervalSeconds: number; timeoutMs: number; failureThreshold: number; enabled: boolean }>): Promise<Monitor> {
    await this.getForUser(userId, monitorId);

    const nextUrl = data.url ? await this.targetUrlValidationService.validateAndNormalize(data.url) : undefined;

    return this.prisma.monitor.update({
      where: { id: monitorId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(nextUrl !== undefined ? { url: nextUrl } : {}),
        ...(data.method !== undefined ? { method: data.method.toUpperCase() } : {}),
        ...(data.expectedStatusCode !== undefined ? { expectedStatusCode: data.expectedStatusCode } : {}),
        ...(data.intervalSeconds !== undefined ? { intervalSeconds: data.intervalSeconds } : {}),
        ...(data.timeoutMs !== undefined ? { timeoutMs: data.timeoutMs } : {}),
        ...(data.failureThreshold !== undefined ? { failureThreshold: data.failureThreshold } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
  }

  async deleteForUser(userId: string, monitorId: string): Promise<void> {
    await this.getForUser(userId, monitorId);
    await this.prisma.monitor.delete({ where: { id: monitorId } });
  }
}
