import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CheckResult, Incident, Monitor } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { MaintenanceWindowsService, type ActiveMaintenanceSummary } from '../maintenance-windows/maintenance-windows.service.js';
import type { SessionUser } from '../auth/auth.service.js';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

export type MonitorRecord = Monitor;

type MonitorWithLatestCheck = Monitor & {
  checkResults: CheckResult[];
  incidents: Incident[];
};

@Injectable()
export class MonitorService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TargetUrlValidationService) private readonly targetUrlValidationService: TargetUrlValidationService,
    @Inject(MaintenanceWindowsService) private readonly maintenanceWindowsService?: MaintenanceWindowsService,
  ) {}

  private nextCheckAtFor(enabled: boolean): Date | null {
    return enabled ? new Date() : null;
  }

  private serializeMonitor(monitor: MonitorWithLatestCheck, activeMaintenance: ActiveMaintenanceSummary | null) {
    const latestCheck = Array.isArray(monitor.checkResults) ? (monitor.checkResults[0] ?? null) : null;
    const activeIncident = Array.isArray(monitor.incidents) ? (monitor.incidents[0] ?? null) : null;

    return {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      method: monitor.method,
      expectedStatusCode: monitor.expectedStatusCode,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      failureThreshold: monitor.failureThreshold,
      enabled: monitor.enabled,
      currentStatus: monitor.currentStatus,
      consecutiveFailures: monitor.consecutiveFailures,
      lastCheckedAt: monitor.lastCheckedAt,
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
      latestStatusCode: latestCheck?.statusCode ?? null,
      latestResponseTimeMs: latestCheck?.responseTimeMs ?? null,
      latestSuccess: latestCheck?.success ?? null,
      activeMaintenance: activeMaintenance
        ? {
            id: activeMaintenance.id,
            title: activeMaintenance.title,
            startsAt: activeMaintenance.startsAt,
            endsAt: activeMaintenance.endsAt,
          }
        : null,
      activeIncident: activeIncident
        ? {
            id: activeIncident.id,
            startedAt: activeIncident.startedAt,
            reason: activeIncident.reason,
            lastError: activeIncident.lastError,
          }
        : null,
    };
  }

  async listForUser(userId: string) {
    const now = new Date();
    const monitors = await this.prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        checkResults: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
        incidents: {
          where: { resolvedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    const activeMaintenanceByMonitorId = this.maintenanceWindowsService
      ? await this.maintenanceWindowsService.getActiveMaintenanceForUserMonitors(
          userId,
          monitors.map((monitor) => monitor.id),
          now,
        )
      : new Map<string, ActiveMaintenanceSummary>();

    return monitors.map((monitor) =>
      this.serializeMonitor(
        monitor as MonitorWithLatestCheck,
        activeMaintenanceByMonitorId.get(monitor.id) ?? null,
      ),
    );
  }

  async getForUser(userId: string, monitorId: string) {
    const now = new Date();
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, userId },
      include: {
        checkResults: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
        incidents: {
          where: { resolvedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!monitor) {
      throw new NotFoundException('Monitor not found.');
    }

    const activeMaintenanceByMonitorId = this.maintenanceWindowsService
      ? await this.maintenanceWindowsService.getActiveMaintenanceForUserMonitors(userId, [monitor.id], now)
      : new Map<string, ActiveMaintenanceSummary>();

    return this.serializeMonitor(
      monitor as MonitorWithLatestCheck,
      activeMaintenanceByMonitorId.get(monitor.id) ?? null,
    );
  }

  async getChecksForUser(userId: string, monitorId: string, limit = 50) {
    await this.getForUser(userId, monitorId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    return this.prisma.checkResult.findMany({
      where: { monitorId },
      orderBy: { checkedAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        success: true,
        statusCode: true,
        responseTimeMs: true,
        errorType: true,
        errorMessage: true,
        checkedAt: true,
      },
    });
  }

  async getIncidentsForUser(userId: string, monitorId: string, limit = 20) {
    await this.getForUser(userId, monitorId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const incidents = await this.prisma.incident.findMany({
      where: { monitorId },
      orderBy: { startedAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        monitorId: true,
        startedAt: true,
        resolvedAt: true,
        reason: true,
        lastError: true,
      },
    });

    return incidents.map((incident) => ({
      ...incident,
      durationMs: incident.resolvedAt
        ? incident.resolvedAt.getTime() - incident.startedAt.getTime()
        : Date.now() - incident.startedAt.getTime(),
    }));
  }

  async createForUser(
    user: SessionUser,
    data: {
      name: string;
      url: string;
      method: string;
      expectedStatusCode: number;
      intervalSeconds: number;
      timeoutMs: number;
      failureThreshold: number;
      enabled?: boolean;
    },
  ) {
    const existingCount = await this.prisma.monitor.count?.({ where: { userId: user.id } }) ?? 0;

    if (existingCount >= 50) {
      throw new BadRequestException('Maximum of 50 monitors per user has been reached.');
    }

    const normalizedUrl = await this.targetUrlValidationService.validateAndNormalize(data.url);
    const enabled = data.enabled ?? true;

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
        enabled,
        currentStatus: 'UNKNOWN',
        consecutiveFailures: 0,
        nextCheckAt: this.nextCheckAtFor(enabled),
      },
    });
  }

  async updateForUser(
    userId: string,
    monitorId: string,
    data: Partial<{
      name: string;
      url: string;
      method: string;
      expectedStatusCode: number;
      intervalSeconds: number;
      timeoutMs: number;
      failureThreshold: number;
      enabled: boolean;
    }>,
  ) {
    const existingMonitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, userId },
      select: {
        enabled: true,
        nextCheckAt: true,
      },
    });

    if (!existingMonitor) {
      throw new NotFoundException('Monitor not found.');
    }

    const nextUrl = data.url ? await this.targetUrlValidationService.validateAndNormalize(data.url) : undefined;

    const shouldEnable = data.enabled ?? existingMonitor.enabled;
    const nextCheckAt = data.enabled === undefined ? existingMonitor.nextCheckAt : this.nextCheckAtFor(shouldEnable);

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
        ...(data.enabled !== undefined ? { nextCheckAt } : {}),
      },
    });
  }

  async deleteForUser(userId: string, monitorId: string): Promise<void> {
    await this.getForUser(userId, monitorId);
    await this.prisma.monitor.delete({ where: { id: monitorId } });
  }
}
