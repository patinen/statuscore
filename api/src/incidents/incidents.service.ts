import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type IncidentStatusFilter = 'all' | 'open' | 'resolved';

export type IncidentListItem = {
  id: string;
  monitorId: string;
  monitorName: string;
  startedAt: Date;
  resolvedAt: Date | null;
  reason: string | null;
  lastError: string | null;
  durationMs: number;
};

@Injectable()
export class IncidentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private serializeIncident(item: {
    id: string;
    monitorId: string;
    monitor: { name: string };
    startedAt: Date;
    resolvedAt: Date | null;
    reason: string | null;
    lastError: string | null;
  }): IncidentListItem {
    const durationMs = item.resolvedAt
      ? item.resolvedAt.getTime() - item.startedAt.getTime()
      : Date.now() - item.startedAt.getTime();

    return {
      id: item.id,
      monitorId: item.monitorId,
      monitorName: item.monitor.name,
      startedAt: item.startedAt,
      resolvedAt: item.resolvedAt,
      reason: item.reason,
      lastError: item.lastError,
      durationMs,
    };
  }

  async listForUser(userId: string, status: IncidentStatusFilter = 'all', limit = 50): Promise<IncidentListItem[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const where: Prisma.IncidentWhereInput = {
      monitor: { userId },
    };

    if (status === 'open') {
      where.resolvedAt = null;
    } else if (status === 'resolved') {
      where.resolvedAt = { not: null };
    }

    const incidents = await this.prisma.incident.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: safeLimit,
      include: {
        monitor: {
          select: { name: true },
        },
      },
    });

    return incidents.map((incident) => this.serializeIncident(incident));
  }

  async getForUser(userId: string, monitorId: string, limit = 20): Promise<IncidentListItem[]> {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, userId },
      select: { id: true },
    });

    if (!monitor) {
      throw new NotFoundException('Monitor not found.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const incidents = await this.prisma.incident.findMany({
      where: { monitorId },
      orderBy: { startedAt: 'desc' },
      take: safeLimit,
      include: {
        monitor: {
          select: { name: true },
        },
      },
    });

    return incidents.map((incident) => this.serializeIncident(incident));
  }

  static validateStatus(status: string | undefined): IncidentStatusFilter {
    if (status === undefined) {
      return 'all';
    }

    if (status === 'all' || status === 'open' || status === 'resolved') {
      return status;
    }

    throw new BadRequestException('status must be one of: all, open, resolved.');
  }

  static validateLimit(value: string | number | undefined, fallback: number): number {
    const raw = value ?? fallback;
    const normalized = typeof raw === 'number' ? String(raw) : raw;

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }

    const parsed = Number(normalized);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }

    return parsed;
  }
}
