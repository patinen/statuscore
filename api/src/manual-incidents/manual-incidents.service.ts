import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ManualIncidentImpact, ManualIncidentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service.js';
import {
  CreateManualIncidentDto,
  CreateManualIncidentUpdateDto,
  UpdateManualIncidentDto,
} from './manual-incidents.dto.js';

const MAX_MANUAL_INCIDENTS_PER_USER = 100;
const MAX_INCIDENT_TIMELINE = 50;

export type ManualIncidentListStatus = 'all' | 'open' | 'resolved';

type ManualIncidentRecord = {
  id: string;
  userId: string;
  title: string;
  status: ManualIncidentStatus;
  impact: ManualIncidentImpact;
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  monitorAssociations: Array<{
    monitorId: string;
    monitor: {
      id: string;
      name: string;
    };
  }>;
  updates: Array<{
    id: string;
    status: ManualIncidentStatus;
    message: string;
    createdAt: Date;
  }>;
};

@Injectable()
export class ManualIncidentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationDeliveryService) private readonly notificationDeliveryService?: NotificationDeliveryService,
  ) {}

  static validateStatus(status: string | undefined): ManualIncidentListStatus {
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

  private serializeIncident(incident: ManualIncidentRecord) {
    return {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      monitorIds: incident.monitorAssociations.map((association) => association.monitorId),
      monitors: incident.monitorAssociations.map((association) => ({
        monitorId: association.monitor.id,
        name: association.monitor.name,
      })),
      updates: [...incident.updates]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((update) => ({
          id: update.id,
          status: update.status,
          message: update.message,
          createdAt: update.createdAt,
        })),
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
    };
  }

  private async validateMonitorOwnership(userId: string, monitorIds: string[]) {
    if (monitorIds.length === 0) {
      throw new BadRequestException('At least one monitor must be selected.');
    }

    if (monitorIds.length > 25) {
      throw new BadRequestException('Maximum of 25 monitors per manual incident.');
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

  private async loadOwnedIncident(userId: string, incidentId: string, updatesTake = MAX_INCIDENT_TIMELINE) {
    const incident = await this.prisma.manualIncident.findFirst({
      where: {
        id: incidentId,
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
        updates: {
          orderBy: { createdAt: 'desc' },
          take: updatesTake,
        },
      },
    });

    if (!incident) {
      throw new NotFoundException('Manual incident not found.');
    }

    return this.serializeIncident(incident as ManualIncidentRecord);
  }

  async createForUser(userId: string, data: CreateManualIncidentDto) {
    const existingCount = await this.prisma.manualIncident.count({ where: { userId } });
    if (existingCount >= MAX_MANUAL_INCIDENTS_PER_USER) {
      throw new BadRequestException('Maximum of 100 manual incidents per user has been reached.');
    }

    const monitors = await this.validateMonitorOwnership(userId, data.monitorIds);
    const title = data.title.trim();
    const message = data.message.trim();
    const startedAt = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.manualIncident.create({
        data: {
          userId,
          title,
          status: ManualIncidentStatus.INVESTIGATING,
          impact: data.impact,
          startedAt,
          resolvedAt: null,
        },
      });

      await tx.manualIncidentMonitor.createMany({
        data: monitors.map((monitor) => ({
          manualIncidentId: incident.id,
          monitorId: monitor.id,
        })),
        skipDuplicates: true,
      });

      const initialUpdate = await tx.manualIncidentUpdate.create({
        data: {
          manualIncidentId: incident.id,
          status: ManualIncidentStatus.INVESTIGATING,
          message,
          createdAt: startedAt,
        },
      });

      if (this.notificationDeliveryService) {
        await this.notificationDeliveryService.createForManualIncidentUpdate(tx, userId, {
          manualIncidentId: incident.id,
          manualIncidentUpdateId: initialUpdate.id,
          eventType: 'MANUAL_INCIDENT_OPENED',
          title,
          impact: data.impact,
          incidentStatus: ManualIncidentStatus.INVESTIGATING,
          updateStatus: ManualIncidentStatus.INVESTIGATING,
          updateMessage: message,
          startedAt,
          resolvedAt: null,
          eventTimestamp: startedAt,
          monitorIds: monitors.map((monitor) => monitor.id),
          monitorNames: monitors.map((monitor) => monitor.name),
        });
      }

      return incident;
    });

    return this.loadOwnedIncident(userId, created.id);
  }

  async listForUser(userId: string, status: ManualIncidentListStatus = 'all', limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const where: Prisma.ManualIncidentWhereInput = { userId };
    if (status === 'open') {
      where.status = { not: ManualIncidentStatus.RESOLVED };
    } else if (status === 'resolved') {
      where.status = ManualIncidentStatus.RESOLVED;
    }

    const incidents = await this.prisma.manualIncident.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      take: safeLimit,
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
        updates: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return incidents.map((incident) => this.serializeIncident(incident as ManualIncidentRecord));
  }

  async getForUser(userId: string, incidentId: string) {
    return this.loadOwnedIncident(userId, incidentId);
  }

  async createUpdateForUser(userId: string, incidentId: string, data: CreateManualIncidentUpdateDto) {
    const message = data.message.trim();

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.manualIncident.findFirst({
        where: {
          id: incidentId,
          userId,
        },
        select: {
          id: true,
          status: true,
          title: true,
          impact: true,
          startedAt: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Manual incident not found.');
      }

      if (existing.status === ManualIncidentStatus.RESOLVED) {
        throw new BadRequestException('Resolved manual incidents cannot be updated in this phase.');
      }

      const timestamp = new Date();

      const updatedIncident = await tx.manualIncident.updateMany({
        where: {
          id: incidentId,
          userId,
          status: { not: ManualIncidentStatus.RESOLVED },
        },
        data: {
          status: data.status,
          resolvedAt: data.status === ManualIncidentStatus.RESOLVED ? timestamp : null,
        },
      });

      if (updatedIncident.count !== 1) {
        throw new BadRequestException('Resolved manual incidents cannot be reopened in this phase.');
      }

      const update = await tx.manualIncidentUpdate.create({
        data: {
          manualIncidentId: incidentId,
          status: data.status,
          message,
          createdAt: timestamp,
        },
      });

      if (this.notificationDeliveryService) {
        const monitorAssociations = await tx.manualIncidentMonitor.findMany({
          where: {
            manualIncidentId: incidentId,
          },
          include: {
            monitor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        await this.notificationDeliveryService.createForManualIncidentUpdate(tx, userId, {
          manualIncidentId: incidentId,
          manualIncidentUpdateId: update.id,
          eventType: data.status === ManualIncidentStatus.RESOLVED ? 'MANUAL_INCIDENT_RESOLVED' : 'MANUAL_INCIDENT_UPDATED',
          title: existing.title,
          impact: existing.impact,
          incidentStatus: data.status,
          updateStatus: data.status,
          updateMessage: message,
          startedAt: existing.startedAt,
          resolvedAt: data.status === ManualIncidentStatus.RESOLVED ? timestamp : null,
          eventTimestamp: timestamp,
          monitorIds: monitorAssociations.map((association) => association.monitorId),
          monitorNames: monitorAssociations.map((association) => association.monitor.name),
        });
      }
    });

    return this.loadOwnedIncident(userId, incidentId);
  }

  async updateForUser(userId: string, incidentId: string, data: UpdateManualIncidentDto) {
    const existing = await this.prisma.manualIncident.findFirst({
      where: {
        id: incidentId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Manual incident not found.');
    }

    const monitors = data.monitorIds ? await this.validateMonitorOwnership(userId, data.monitorIds) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.manualIncident.update({
        where: { id: incidentId },
        data: {
          ...(data.title !== undefined ? { title: data.title.trim() } : {}),
          ...(data.impact !== undefined ? { impact: data.impact } : {}),
        },
      });

      if (monitors) {
        await tx.manualIncidentMonitor.deleteMany({ where: { manualIncidentId: incidentId } });
        await tx.manualIncidentMonitor.createMany({
          data: monitors.map((monitor) => ({
            manualIncidentId: incidentId,
            monitorId: monitor.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.loadOwnedIncident(userId, incidentId);
  }

  async deleteForUser(userId: string, incidentId: string) {
    const existing = await this.prisma.manualIncident.findFirst({
      where: {
        id: incidentId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Manual incident not found.');
    }

    await this.prisma.manualIncident.delete({ where: { id: incidentId } });
  }
}
