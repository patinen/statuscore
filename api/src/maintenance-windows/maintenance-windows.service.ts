import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type MaintenanceWindow } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateMaintenanceWindowDto, UpdateMaintenanceWindowDto } from './maintenance-windows.dto.js';

const MAX_WINDOWS_PER_USER = 50;
const MAX_WINDOW_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type MaintenanceWindowState = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'DISABLED';

export type ActiveMaintenanceSummary = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

type OwnedMaintenanceWindowRecord = MaintenanceWindow & {
  monitorAssociations: Array<{
    monitorId: string;
    monitor: {
      id: string;
      name: string;
    };
  }>;
};

@Injectable()
export class MaintenanceWindowsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private static parseTimestamp(value: string, fieldName: 'startsAt' | 'endsAt'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO timestamp.`);
    }

    return parsed;
  }

  private static normalizeDescription(description: string | null | undefined): string | null {
    if (description === null || description === undefined) {
      return null;
    }

    const trimmed = description.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private static deriveState(window: { enabled: boolean; startsAt: Date; endsAt: Date }, now: Date): MaintenanceWindowState {
    if (!window.enabled) {
      return 'DISABLED';
    }

    if (now < window.startsAt) {
      return 'SCHEDULED';
    }

    if (now >= window.endsAt) {
      return 'ENDED';
    }

    return 'ACTIVE';
  }

  private static validateWindowRange(startsAt: Date, endsAt: Date, now: Date, enforceFutureEnd: boolean): void {
    if (startsAt >= endsAt) {
      throw new BadRequestException('startsAt must be earlier than endsAt.');
    }

    if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_DURATION_MS) {
      throw new BadRequestException('Maintenance window duration cannot exceed 30 days.');
    }

    if (enforceFutureEnd && endsAt <= now) {
      throw new BadRequestException('endsAt must be in the future.');
    }
  }

  private mapWindow(window: OwnedMaintenanceWindowRecord, now: Date) {
    return {
      id: window.id,
      title: window.title,
      description: window.description,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      enabled: window.enabled,
      state: MaintenanceWindowsService.deriveState(window, now),
      monitorIds: window.monitorAssociations.map((association) => association.monitorId),
      monitors: window.monitorAssociations.map((association) => ({
        monitorId: association.monitor.id,
        name: association.monitor.name,
      })),
      createdAt: window.createdAt,
      updatedAt: window.updatedAt,
    };
  }

  private async validateMonitorOwnership(userId: string, monitorIds: string[]): Promise<Array<{ id: string; name: string }>> {
    if (monitorIds.length === 0) {
      throw new BadRequestException('At least one monitor must be selected.');
    }

    if (monitorIds.length > 25) {
      throw new BadRequestException('Maximum of 25 monitors per maintenance window.');
    }

    const uniqueMonitorIds = [...new Set(monitorIds)];

    const monitors = await this.prisma.monitor.findMany({
      where: {
        userId,
        id: { in: uniqueMonitorIds },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (monitors.length !== uniqueMonitorIds.length) {
      throw new NotFoundException('One or more selected monitors were not found.');
    }

    const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]));
    return uniqueMonitorIds.map((monitorId) => {
      const monitor = monitorById.get(monitorId);
      if (!monitor) {
        throw new NotFoundException('One or more selected monitors were not found.');
      }
      return monitor;
    });
  }

  private async loadOwnedWindow(userId: string, windowId: string, now: Date) {
    const window = await this.prisma.maintenanceWindow.findFirst({
      where: {
        id: windowId,
        userId,
      },
      include: {
        monitorAssociations: {
          orderBy: { createdAt: 'asc' },
          include: {
            monitor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!window) {
      throw new NotFoundException('Maintenance window not found.');
    }

    return this.mapWindow(window as OwnedMaintenanceWindowRecord, now);
  }

  async listForUser(userId: string): Promise<Array<ReturnType<MaintenanceWindowsService['mapWindow']>>> {
    const now = new Date();

    const windows = await this.prisma.maintenanceWindow.findMany({
      where: { userId },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        monitorAssociations: {
          orderBy: { createdAt: 'asc' },
          include: {
            monitor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return windows.map((window) => this.mapWindow(window as OwnedMaintenanceWindowRecord, now));
  }

  async getForUser(userId: string, windowId: string): Promise<ReturnType<MaintenanceWindowsService['mapWindow']>> {
    return this.loadOwnedWindow(userId, windowId, new Date());
  }

  async createForUser(userId: string, data: CreateMaintenanceWindowDto): Promise<ReturnType<MaintenanceWindowsService['mapWindow']>> {
    const now = new Date();

    const existingCount = await this.prisma.maintenanceWindow.count({ where: { userId } });
    if (existingCount >= MAX_WINDOWS_PER_USER) {
      throw new BadRequestException('Maximum of 50 maintenance windows per user has been reached.');
    }

    const startsAt = MaintenanceWindowsService.parseTimestamp(data.startsAt, 'startsAt');
    const endsAt = MaintenanceWindowsService.parseTimestamp(data.endsAt, 'endsAt');
    MaintenanceWindowsService.validateWindowRange(startsAt, endsAt, now, true);

    const monitors = await this.validateMonitorOwnership(userId, data.monitorIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const window = await tx.maintenanceWindow.create({
        data: {
          userId,
          title: data.title.trim(),
          description: MaintenanceWindowsService.normalizeDescription(data.description),
          startsAt,
          endsAt,
          enabled: true,
        },
      });

      await tx.maintenanceWindowMonitor.createMany({
        data: monitors.map((monitor) => ({
          maintenanceWindowId: window.id,
          monitorId: monitor.id,
        })),
        skipDuplicates: true,
      });

      return window;
    });

    return this.loadOwnedWindow(userId, created.id, now);
  }

  async updateForUser(userId: string, windowId: string, data: UpdateMaintenanceWindowDto): Promise<ReturnType<MaintenanceWindowsService['mapWindow']>> {
    const now = new Date();

    const existing = await this.prisma.maintenanceWindow.findFirst({
      where: { id: windowId, userId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Maintenance window not found.');
    }

    const startsAt = data.startsAt ? MaintenanceWindowsService.parseTimestamp(data.startsAt, 'startsAt') : existing.startsAt;
    const endsAt = data.endsAt ? MaintenanceWindowsService.parseTimestamp(data.endsAt, 'endsAt') : existing.endsAt;
    MaintenanceWindowsService.validateWindowRange(startsAt, endsAt, now, false);

    const monitors = data.monitorIds ? await this.validateMonitorOwnership(userId, data.monitorIds) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.maintenanceWindow.update({
        where: { id: windowId },
        data: {
          ...(data.title !== undefined ? { title: data.title.trim() } : {}),
          ...(Object.prototype.hasOwnProperty.call(data, 'description')
            ? { description: MaintenanceWindowsService.normalizeDescription(data.description) }
            : {}),
          ...(data.startsAt !== undefined ? { startsAt } : {}),
          ...(data.endsAt !== undefined ? { endsAt } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        },
      });

      if (monitors) {
        await tx.maintenanceWindowMonitor.deleteMany({ where: { maintenanceWindowId: windowId } });
        await tx.maintenanceWindowMonitor.createMany({
          data: monitors.map((monitor) => ({
            maintenanceWindowId: windowId,
            monitorId: monitor.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.loadOwnedWindow(userId, windowId, now);
  }

  async deleteForUser(userId: string, windowId: string): Promise<void> {
    await this.loadOwnedWindow(userId, windowId, new Date());
    await this.prisma.maintenanceWindow.delete({ where: { id: windowId } });
  }

  async isMonitorUnderActiveMaintenanceAtTx(
    tx: Prisma.TransactionClient,
    monitorId: string,
    timestamp: Date,
  ): Promise<boolean> {
    const active = await tx.maintenanceWindowMonitor.findFirst({
      where: {
        monitorId,
        maintenanceWindow: {
          enabled: true,
          startsAt: { lte: timestamp },
          endsAt: { gt: timestamp },
        },
      },
      select: {
        maintenanceWindowId: true,
      },
    });

    return Boolean(active);
  }

  async getActiveMaintenanceForUserMonitors(
    userId: string,
    monitorIds: string[],
    timestamp: Date,
  ): Promise<Map<string, ActiveMaintenanceSummary>> {
    if (monitorIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.maintenanceWindowMonitor.findMany({
      where: {
        monitorId: { in: monitorIds },
        maintenanceWindow: {
          userId,
          enabled: true,
          startsAt: { lte: timestamp },
          endsAt: { gt: timestamp },
        },
      },
      orderBy: [{ maintenanceWindow: { startsAt: 'asc' } }, { maintenanceWindow: { endsAt: 'asc' } }],
      select: {
        monitorId: true,
        maintenanceWindow: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    const map = new Map<string, ActiveMaintenanceSummary>();

    for (const row of rows) {
      if (map.has(row.monitorId)) {
        continue;
      }

      map.set(row.monitorId, {
        id: row.maintenanceWindow.id,
        title: row.maintenanceWindow.title,
        startsAt: row.maintenanceWindow.startsAt,
        endsAt: row.maintenanceWindow.endsAt,
      });
    }

    return map;
  }

  async getActivePublicMaintenanceForMonitors(
    monitorIds: string[],
    timestamp: Date,
  ): Promise<
    Array<{
      title: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      monitorIds: string[];
    }>
  > {
    if (monitorIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.maintenanceWindow.findMany({
      where: {
        enabled: true,
        startsAt: { lte: timestamp },
        endsAt: { gt: timestamp },
        monitorAssociations: {
          some: {
            monitorId: { in: monitorIds },
          },
        },
      },
      orderBy: [{ startsAt: 'asc' }, { endsAt: 'asc' }],
      include: {
        monitorAssociations: {
          where: {
            monitorId: { in: monitorIds },
          },
          select: {
            monitorId: true,
          },
        },
      },
    });

    return rows.map((window) => ({
      title: window.title,
      description: window.description,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      monitorIds: window.monitorAssociations.map((association) => association.monitorId),
    }));
  }
}
