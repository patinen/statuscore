import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MaintenanceWindowsService } from '../maintenance-windows/maintenance-windows.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateStatusPageDto, UpdateStatusPageDto } from './status-pages.dto.js';

const maximumStatusPagesPerUser = 5;

type OwnedStatusPageMonitor = {
  monitorId: string;
  displayName: string | null;
  position: number;
  createdAt: Date;
  monitor: {
    id: string;
    name: string;
  };
};

type OwnedStatusPageRecord = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  monitorAssociations: OwnedStatusPageMonitor[];
};

type PublicStatusPageMonitor = {
  monitorId: string;
  displayName: string | null;
  monitor: {
    name: string;
    enabled: boolean;
    currentStatus: string;
    lastCheckedAt: Date | null;
  };
};

type PublicStatusPageRecord = {
  userId: string;
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  updatedAt: Date;
  monitorAssociations: PublicStatusPageMonitor[];
};

type PublicMonitorStatus = 'OPERATIONAL' | 'OUTAGE' | 'MAINTENANCE' | 'UNKNOWN';
type PublicPageStatus = 'OPERATIONAL' | 'OUTAGE' | 'DEGRADED' | 'MAINTENANCE' | 'UNKNOWN';
type ManualIncidentImpact = 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE';
type ManualIncidentStatus = 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';

type PublicManualIncidentRecord = {
  title: string;
  impact: ManualIncidentImpact;
  status: ManualIncidentStatus;
  startedAt: Date;
  resolvedAt: Date | null;
  monitorAssociations: Array<{
    monitorId: string;
    monitor: {
      name: string;
    };
  }>;
  updates: Array<{
    status: ManualIncidentStatus;
    message: string;
    createdAt: Date;
  }>;
};

@Injectable()
export class StatusPagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MaintenanceWindowsService) private readonly maintenanceWindowsService: MaintenanceWindowsService,
  ) {}

  private static normalizePageDescription(description: string | null | undefined): string | null {
    if (description === null) {
      return null;
    }

    return description?.trim() ? description.trim() : null;
  }

  private static isSlugUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('slug');
    }

    return typeof target === 'string' && target.includes('slug');
  }

  private static monitorStatusForPublic(monitor: { enabled: boolean; currentStatus: string }, isUnderMaintenance: boolean): PublicMonitorStatus {
    if (isUnderMaintenance) {
      return 'MAINTENANCE';
    }

    if (!monitor.enabled) {
      return 'UNKNOWN';
    }

    if (monitor.currentStatus === 'DOWN') {
      return 'OUTAGE';
    }

    if (monitor.currentStatus === 'UP') {
      return 'OPERATIONAL';
    }

    return 'UNKNOWN';
  }

  private static overallStatusForPublic(
    monitorStatuses: PublicMonitorStatus[],
    activeManualImpacts: ManualIncidentImpact[],
  ): PublicPageStatus {
    const hasMajorOutageManual = activeManualImpacts.some((impact) => impact === 'MAJOR_OUTAGE');
    const hasPartialOutageManual = activeManualImpacts.some((impact) => impact === 'PARTIAL_OUTAGE');
    const hasDegradedManual = activeManualImpacts.some((impact) => impact === 'DEGRADED');

    if (hasMajorOutageManual || monitorStatuses.some((status) => status === 'OUTAGE')) {
      return 'OUTAGE';
    }

    if (hasPartialOutageManual || hasDegradedManual) {
      return 'DEGRADED';
    }

    if (monitorStatuses.some((status) => status === 'MAINTENANCE')) {
      return 'MAINTENANCE';
    }

    if (monitorStatuses.length > 0 && monitorStatuses.every((status) => status === 'OPERATIONAL')) {
      return 'OPERATIONAL';
    }

    return 'UNKNOWN';
  }

  private mapOwnedPage(page: OwnedStatusPageRecord) {
    return {
      id: page.id,
      name: page.name,
      slug: page.slug,
      description: page.description,
      enabled: page.enabled,
      monitorIds: page.monitorAssociations.map((association) => association.monitorId),
      monitors: page.monitorAssociations.map((association) => ({
        monitorId: association.monitorId,
        name: association.monitor.name,
        displayName: association.displayName,
        position: association.position,
      })),
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };
  }

  private async validateMonitorOwnership(userId: string, monitorIds: string[]) {
    if (monitorIds.length > 25) {
      throw new BadRequestException('Maximum of 25 monitors per status page.');
    }

    const uniqueMonitorIds = [...new Set(monitorIds)];
    const monitors = await this.prisma.monitor.findMany({
      where: {
        id: { in: uniqueMonitorIds },
        userId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (monitors.length !== uniqueMonitorIds.length) {
      throw new BadRequestException('One or more selected monitors do not belong to the current user.');
    }

    const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]));

    return uniqueMonitorIds.map((monitorId) => {
      const monitor = monitorById.get(monitorId);
      if (!monitor) {
        throw new BadRequestException('One or more selected monitors do not belong to the current user.');
      }

      return monitor;
    });
  }

  private async ensureSlugIsAvailable(slug: string, statusPageId?: string) {
    const existingPage = await this.prisma.statusPage.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingPage && existingPage.id !== statusPageId) {
      throw new ConflictException('Status page slug is already in use.');
    }
  }

  private async loadOwnedStatusPage(userId: string, statusPageId: string) {
    const page = await this.prisma.statusPage.findFirst({
      where: { id: statusPageId, userId },
      include: {
        monitorAssociations: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
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

    if (!page) {
      throw new NotFoundException('Status page not found.');
    }

    return this.mapOwnedPage(page as OwnedStatusPageRecord);
  }

  async listForUser(userId: string) {
    const pages = await this.prisma.statusPage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        monitorAssociations: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
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

    return pages.map((page) => this.mapOwnedPage(page as OwnedStatusPageRecord));
  }

  async getForUser(userId: string, statusPageId: string) {
    return this.loadOwnedStatusPage(userId, statusPageId);
  }

  async createForUser(userId: string, data: CreateStatusPageDto) {
    const pageCount = await this.prisma.statusPage.count({ where: { userId } });
    if (pageCount >= maximumStatusPagesPerUser) {
      throw new BadRequestException('Maximum of 5 status pages per user has been reached.');
    }

    await this.ensureSlugIsAvailable(data.slug);
    const validatedMonitors = await this.validateMonitorOwnership(userId, data.monitorIds);

    let createdPage: { id: string };

    try {
      createdPage = await this.prisma.$transaction(async (tx) => {
        const page = await tx.statusPage.create({
          data: {
            userId,
            name: data.name.trim(),
            slug: data.slug,
            description: StatusPagesService.normalizePageDescription(data.description),
            enabled: true,
          },
        });

        if (data.monitorIds.length > 0) {
          await tx.statusPageMonitor.createMany({
            data: data.monitorIds.map((monitorId, index) => ({
              statusPageId: page.id,
              monitorId,
              displayName: validatedMonitors.find((monitor) => monitor.id === monitorId)?.name ?? null,
              position: index,
            })),
            skipDuplicates: true,
          });
        }

        return page;
      });
    } catch (error) {
      if (StatusPagesService.isSlugUniqueConflict(error)) {
        throw new ConflictException('Status page slug is already in use.');
      }

      throw error;
    }

    return this.loadOwnedStatusPage(userId, createdPage.id);
  }

  async updateForUser(userId: string, statusPageId: string, data: UpdateStatusPageDto) {
    const existingPage = await this.prisma.statusPage.findFirst({
      where: { id: statusPageId, userId },
      select: { id: true, slug: true },
    });

    if (!existingPage) {
      throw new NotFoundException('Status page not found.');
    }

    if (data.slug && data.slug !== existingPage.slug) {
      await this.ensureSlugIsAvailable(data.slug, statusPageId);
    }

    const monitorIds = data.monitorIds ?? [];
    const validatedMonitors = data.monitorIds ? await this.validateMonitorOwnership(userId, data.monitorIds) : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.statusPage.update({
          where: { id: statusPageId },
          data: {
            ...(data.name !== undefined ? { name: data.name.trim() } : {}),
            ...(data.slug !== undefined ? { slug: data.slug } : {}),
            ...(Object.prototype.hasOwnProperty.call(data, 'description')
              ? { description: StatusPagesService.normalizePageDescription(data.description) }
              : {}),
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          },
        });

        if (validatedMonitors) {
          await tx.statusPageMonitor.deleteMany({ where: { statusPageId } });

          if (monitorIds.length > 0) {
            await tx.statusPageMonitor.createMany({
              data: monitorIds.map((monitorId, index) => ({
                statusPageId,
                monitorId,
                displayName: validatedMonitors.find((monitor) => monitor.id === monitorId)?.name ?? null,
                position: index,
              })),
              skipDuplicates: true,
            });
          }
        }
      });
    } catch (error) {
      if (StatusPagesService.isSlugUniqueConflict(error)) {
        throw new ConflictException('Status page slug is already in use.');
      }

      throw error;
    }

    return this.loadOwnedStatusPage(userId, statusPageId);
  }

  async deleteForUser(userId: string, statusPageId: string): Promise<void> {
    await this.loadOwnedStatusPage(userId, statusPageId);
    await this.prisma.statusPage.delete({ where: { id: statusPageId } });
  }

  async getPublicBySlug(slug: string) {
    const page = await this.prisma.statusPage.findFirst({
      where: { slug, enabled: true },
      include: {
        monitorAssociations: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            monitor: {
              select: {
                name: true,
                enabled: true,
                currentStatus: true,
                lastCheckedAt: true,
              },
            },
          },
        },
      },
    });

    if (!page) {
      return null;
    }

    const currentPage = page as PublicStatusPageRecord;
    const monitorLabelById = new Map(
      currentPage.monitorAssociations.map((association) => [association.monitorId, association.displayName ?? association.monitor.name]),
    );
    const monitoredIds = currentPage.monitorAssociations.map((association) => association.monitorId);

    const now = new Date();

    const [activeIncidents, recentIncidents, activeMaintenanceWindows] = await Promise.all([
      monitoredIds.length > 0
        ? this.prisma.incident.findMany({
            where: {
              monitorId: { in: monitoredIds },
              resolvedAt: null,
            },
            orderBy: { startedAt: 'desc' },
            take: 50,
            select: {
              monitorId: true,
              startedAt: true,
              reason: true,
            },
          })
        : Promise.resolve([]),
      monitoredIds.length > 0
        ? this.prisma.incident.findMany({
            where: {
              monitorId: { in: monitoredIds },
              resolvedAt: { not: null },
            },
            orderBy: { startedAt: 'desc' },
            take: 20,
            select: {
              monitorId: true,
              startedAt: true,
              resolvedAt: true,
              reason: true,
            },
          })
        : Promise.resolve([]),
      this.maintenanceWindowsService.getActivePublicMaintenanceForMonitors(monitoredIds, now),
    ]);

    const [activeManualIncidents, recentResolvedManualIncidents] = await Promise.all([
      monitoredIds.length > 0
        ? this.prisma.manualIncident.findMany({
            where: {
              userId: currentPage.userId,
              status: { not: 'RESOLVED' },
              monitorAssociations: {
                some: {
                  monitorId: { in: monitoredIds },
                },
              },
            },
            orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
            take: 50,
            include: {
              monitorAssociations: {
                where: {
                  monitorId: { in: monitoredIds },
                },
                include: {
                  monitor: {
                    select: {
                      name: true,
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
              updates: {
                orderBy: { createdAt: 'asc' },
                take: 50,
              },
            },
          })
        : Promise.resolve([]),
      monitoredIds.length > 0
        ? this.prisma.manualIncident.findMany({
            where: {
              userId: currentPage.userId,
              status: 'RESOLVED',
              resolvedAt: { not: null },
              monitorAssociations: {
                some: {
                  monitorId: { in: monitoredIds },
                },
              },
            },
            orderBy: [{ resolvedAt: 'desc' }, { updatedAt: 'desc' }],
            take: 20,
            include: {
              monitorAssociations: {
                where: {
                  monitorId: { in: monitoredIds },
                },
                include: {
                  monitor: {
                    select: {
                      name: true,
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
              updates: {
                orderBy: { createdAt: 'asc' },
                take: 50,
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const monitorIdsUnderMaintenance = new Set(
      activeMaintenanceWindows.flatMap((window) => window.monitorIds),
    );

    const publicMonitors = currentPage.monitorAssociations.map((association) => {
      const status = StatusPagesService.monitorStatusForPublic(
        association.monitor,
        monitorIdsUnderMaintenance.has(association.monitorId),
      );

      return {
        monitorId: association.monitorId,
        name: monitorLabelById.get(association.monitorId) ?? association.monitor.name,
        status,
        lastCheckedAt: association.monitor.lastCheckedAt,
      };
    });

    const overallStatus = StatusPagesService.overallStatusForPublic(
      publicMonitors.map((monitor) => monitor.status),
      activeManualIncidents.map((incident) => incident.impact as ManualIncidentImpact),
    );

    const mapManualIncident = (incident: PublicManualIncidentRecord) => ({
      title: incident.title,
      impact: incident.impact,
      status: incident.status,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      monitors: incident.monitorAssociations
        .map((association) => monitorLabelById.get(association.monitorId) ?? association.monitor.name)
        .filter((name, index, array) => array.indexOf(name) === index),
      updates: incident.updates.map((update) => ({
        status: update.status,
        message: update.message,
        createdAt: update.createdAt,
      })),
    });

    return {
      page: {
        name: currentPage.name,
        slug: currentPage.slug,
        description: currentPage.description,
        updatedAt: currentPage.updatedAt,
      },
      overallStatus,
      monitors: publicMonitors.map(({ monitorId: _monitorId, ...monitor }) => monitor),
      manualIncidents: activeManualIncidents.map((incident) => mapManualIncident(incident as PublicManualIncidentRecord)),
      recentResolvedManualIncidents: recentResolvedManualIncidents.map((incident) =>
        mapManualIncident(incident as PublicManualIncidentRecord),
      ),
      activeMaintenance: activeMaintenanceWindows.map((window) => ({
        title: window.title,
        description: window.description,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        monitors: window.monitorIds
          .map((monitorId) => monitorLabelById.get(monitorId))
          .filter((name): name is string => Boolean(name)),
      })),
      activeIncidents: activeIncidents.map((incident) => ({
        monitorName: monitorLabelById.get(incident.monitorId) ?? 'Monitoring service',
        startedAt: incident.startedAt,
        reason: incident.reason,
      })),
      recentIncidents: recentIncidents.map((incident) => ({
        monitorName: monitorLabelById.get(incident.monitorId) ?? 'Monitoring service',
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        reason: incident.reason,
        durationMs: incident.resolvedAt ? incident.resolvedAt.getTime() - incident.startedAt.getTime() : 0,
      })),
    };
  }
}