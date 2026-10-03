import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CreateStatusPageDto, UpdateStatusPageDto } from './status-pages.dto.js';
import { StatusPagesService } from './status-pages.service.js';

const now = new Date('2026-10-03T00:00:00Z');

const createService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    monitor: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    statusPage: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    statusPageMonitor: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    incident: {
      findMany: vi.fn(),
    },
    manualIncident: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    maintenanceWindow: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    ...overrides,
  };

  const maintenanceWindowsService = {
    getActivePublicMaintenanceForMonitors: vi.fn().mockResolvedValue([]),
  };

  return {
    prisma,
    maintenanceWindowsService,
    service: new StatusPagesService(prisma as never, maintenanceWindowsService as never),
  };
};

describe('StatusPage DTOs', () => {
  const validationPipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const transformUpdateDto = async (payload: unknown) =>
    validationPipe.transform(payload, {
      type: 'body',
      metatype: UpdateStatusPageDto,
      data: '',
    });

  it('accepts the create payload shape and rejects reserved or invalid slugs', async () => {
    const validCreate = Object.assign(new CreateStatusPageDto(), {
      name: 'My Services',
      slug: 'my-services',
      description: 'Public services',
      monitorIds: ['monitor-1', 'monitor-2'],
    });

    await expect(validate(validCreate)).resolves.toHaveLength(0);

    for (const slug of ['My Services', 'foo/bar', '../admin', '-status', 'status-', 'api']) {
      const dto = Object.assign(new CreateStatusPageDto(), {
        name: 'My Services',
        slug,
        monitorIds: ['monitor-1'],
      });

      await expect(validate(dto)).resolves.not.toHaveLength(0);
    }
  });

  it('accepts the update payload shape and leaves type-agnostic page edits intact', async () => {
    const validUpdate = Object.assign(new UpdateStatusPageDto(), {
      name: 'My Services',
      slug: 'my-services-prod',
      description: 'Public services',
      enabled: false,
      monitorIds: ['monitor-1'],
    });

    await expect(validate(validUpdate)).resolves.toHaveLength(0);
  });

  it('applies update description transform/validation semantics through ValidationPipe', async () => {
    const omitted = (await transformUpdateDto({ enabled: true })) as UpdateStatusPageDto;
    expect(omitted.description).toBeUndefined();

    const nullDescription = (await transformUpdateDto({ description: null })) as UpdateStatusPageDto;
    expect(nullDescription.description).toBeNull();

    const emptyString = (await transformUpdateDto({ description: '' })) as UpdateStatusPageDto;
    expect(emptyString.description).toBeNull();

    const whitespace = (await transformUpdateDto({ description: '   ' })) as UpdateStatusPageDto;
    expect(whitespace.description).toBeNull();

    const trimmed = (await transformUpdateDto({ description: '  hello  ' })) as UpdateStatusPageDto;
    expect(trimmed.description).toBe('hello');

    await expect(
      transformUpdateDto({ description: 'x'.repeat(501) }),
    ).rejects.toThrow(BadRequestException);

    await expect(transformUpdateDto({ description: 123 })).rejects.toThrow(BadRequestException);
    await expect(transformUpdateDto({ description: { text: 'hello' } })).rejects.toThrow(BadRequestException);
  });
});

describe('StatusPagesService ownership and CRUD', () => {
  it('stores create without description as null', async () => {
    const { service, prisma } = createService();

    prisma.statusPage.count.mockResolvedValueOnce(0);
    prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    prisma.monitor.findMany.mockResolvedValueOnce([{ id: 'monitor-1', name: 'API' }]);
    prisma.statusPage.create.mockResolvedValueOnce({ id: 'page-1' });
    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      userId: 'user-1',
      name: 'My Services',
      slug: 'my-services',
      description: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'monitor-1', displayName: 'API', position: 0, createdAt: now, monitor: { id: 'monitor-1', name: 'API' } },
      ],
    });

    await expect(
      service.createForUser('user-1', {
        name: 'My Services',
        slug: 'my-services',
        monitorIds: ['monitor-1'],
      }),
    ).resolves.toMatchObject({ description: null });

    expect(prisma.statusPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      }),
    );
  });

  it('preserves description when update omits description', async () => {
    const { service, prisma } = createService();

    prisma.statusPage.findFirst
      .mockResolvedValueOnce({ id: 'page-1', slug: 'my-services' })
      .mockResolvedValueOnce({
        id: 'page-1',
        userId: 'user-1',
        name: 'My Services',
        slug: 'my-services',
        description: 'Existing description',
        enabled: false,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      });

    await expect(service.updateForUser('user-1', 'page-1', { enabled: false })).resolves.toMatchObject({
      description: 'Existing description',
    });

    expect(prisma.statusPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ description: expect.anything() }),
      }),
    );
  });

  it('updates description when provided and clears description to null when blank', async () => {
    const { service, prisma } = createService();

    prisma.statusPage.findFirst
      .mockResolvedValueOnce({ id: 'page-1', slug: 'my-services' })
      .mockResolvedValueOnce({
        id: 'page-1',
        userId: 'user-1',
        name: 'My Services',
        slug: 'my-services',
        description: 'Updated description',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      })
      .mockResolvedValueOnce({ id: 'page-1', slug: 'my-services' })
      .mockResolvedValueOnce({
        id: 'page-1',
        userId: 'user-1',
        name: 'My Services',
        slug: 'my-services',
        description: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      });

    await expect(service.updateForUser('user-1', 'page-1', { description: 'Updated description' })).resolves.toMatchObject({
      description: 'Updated description',
    });
    expect(prisma.statusPage.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ description: 'Updated description' }),
      }),
    );

    await expect(service.updateForUser('user-1', 'page-1', { description: '' })).resolves.toMatchObject({
      description: null,
    });
    expect(prisma.statusPage.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      }),
    );
  });

  it('creates status pages with valid slugs, rejects duplicates, enforces page and monitor limits, and rejects foreign monitors', async () => {
    const { service, prisma } = createService();

    prisma.statusPage.count.mockResolvedValueOnce(0);
    prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    prisma.monitor.findMany.mockResolvedValueOnce([
      { id: 'monitor-1', name: 'API' },
      { id: 'monitor-2', name: 'Docs' },
    ]);
    prisma.statusPage.create.mockResolvedValueOnce({ id: 'page-1' });
    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      userId: 'user-1',
      name: 'My Services',
      slug: 'my-services',
      description: 'Public services',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'monitor-1', displayName: 'API', position: 0, createdAt: now, monitor: { id: 'monitor-1', name: 'API' } },
        { monitorId: 'monitor-2', displayName: 'Docs', position: 1, createdAt: now, monitor: { id: 'monitor-2', name: 'Docs' } },
      ],
    });

    await expect(
      service.createForUser('user-1', {
        name: 'My Services',
        slug: 'my-services',
        description: 'Public services',
        monitorIds: ['monitor-1', 'monitor-2'],
      }),
    ).resolves.toMatchObject({
      name: 'My Services',
      slug: 'my-services',
      description: 'Public services',
      enabled: true,
      monitorIds: ['monitor-1', 'monitor-2'],
    });

    expect(prisma.statusPageMonitor.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ statusPageId: 'page-1', monitorId: 'monitor-1', position: 0 }),
          expect.objectContaining({ statusPageId: 'page-1', monitorId: 'monitor-2', position: 1 }),
        ]),
      }),
    );

    prisma.statusPage.count.mockResolvedValueOnce(5);
    await expect(
      service.createForUser('user-1', {
        name: 'Overflow',
        slug: 'overflow',
        monitorIds: [],
      }),
    ).rejects.toThrow(BadRequestException);

    prisma.statusPage.count.mockResolvedValueOnce(0);
    prisma.statusPage.findUnique.mockResolvedValueOnce({ id: 'existing-page' });
    await expect(
      service.createForUser('user-1', {
        name: 'Duplicate',
        slug: 'my-services',
        monitorIds: [],
      }),
    ).rejects.toThrow(ConflictException);

    prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    prisma.monitor.findMany.mockResolvedValueOnce([]);
    await expect(
      service.createForUser('user-1', {
        name: 'Foreign',
        slug: 'foreign',
        monitorIds: ['other-users-monitor'],
      }),
    ).rejects.toThrow(BadRequestException);

    prisma.statusPage.count.mockResolvedValueOnce(0);
    prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    prisma.monitor.findMany.mockResolvedValueOnce([
      { id: 'monitor-1', name: 'API' },
      { id: 'monitor-2', name: 'Docs' },
      { id: 'monitor-3', name: 'Ops' },
    ]);
    await expect(
      service.createForUser('user-1', {
        name: 'Too Many',
        slug: 'too-many',
        monitorIds: Array.from({ length: 26 }, (_, index) => `monitor-${index + 1}`),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects reads, updates, and deletes for another user and replaces monitor associations atomically', async () => {
    const callOrder: string[] = [];
    const unauthorized = createService();

    unauthorized.prisma.statusPage.findFirst.mockResolvedValue(null);

    await expect(unauthorized.service.getForUser('user-a', 'page-1')).rejects.toThrow(NotFoundException);
    await expect(unauthorized.service.updateForUser('user-a', 'page-1', { enabled: false })).rejects.toThrow(NotFoundException);
    await expect(unauthorized.service.deleteForUser('user-a', 'page-1')).rejects.toThrow(NotFoundException);

    const { service, prisma } = createService();

    prisma.statusPage.findFirst.mockResolvedValueOnce({ id: 'page-1', slug: 'my-services' });
    prisma.monitor.findMany.mockResolvedValueOnce([{ id: 'monitor-2', name: 'Docs' }]);
    prisma.statusPage.update.mockImplementation(async () => {
      callOrder.push('update');
      return { id: 'page-1' };
    });
    prisma.statusPageMonitor.deleteMany.mockImplementation(async () => {
      callOrder.push('delete');
      return { count: 1 };
    });
    prisma.statusPageMonitor.createMany.mockImplementation(async () => {
      callOrder.push('create');
      return { count: 1 };
    });
    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      userId: 'user-1',
      name: 'My Services',
      slug: 'my-services',
      description: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'monitor-2', displayName: 'Docs', position: 0, createdAt: now, monitor: { id: 'monitor-2', name: 'Docs' } },
      ],
    });

    await expect(
      service.updateForUser('user-1', 'page-1', {
        name: 'My Services v2',
        enabled: false,
        monitorIds: ['monitor-2'],
      }),
    ).resolves.toMatchObject({
      name: 'My Services',
      slug: 'my-services',
      monitorIds: ['monitor-2'],
    });

    expect(callOrder).toEqual(['update', 'delete', 'create']);
  });

  it('deletes the status page cascade relationship in the migration', () => {
    const migration = readFileSync(
      new URL('../../prisma/migrations/20261003160000_add_status_pages/migration.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain('ALTER TABLE "StatusPageMonitor" ADD CONSTRAINT "StatusPageMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE');
    expect(migration).toContain('ALTER TABLE "StatusPageMonitor" ADD CONSTRAINT "StatusPageMonitor_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE');
  });

  it('maps create/update slug unique race P2002 to ConflictException', async () => {
    const createCase = createService();
    const slugConflict = new Prisma.PrismaClientKnownRequestError('slug conflict', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['slug'] },
    });

    createCase.prisma.statusPage.count.mockResolvedValueOnce(0);
    createCase.prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    createCase.prisma.monitor.findMany.mockResolvedValueOnce([]);
    createCase.prisma.$transaction.mockRejectedValueOnce(slugConflict);

    await expect(
      createCase.service.createForUser('user-1', {
        name: 'Race',
        slug: 'race-slug',
        monitorIds: [],
      }),
    ).rejects.toThrow(ConflictException);

    const updateCase = createService();
    updateCase.prisma.statusPage.findFirst.mockResolvedValueOnce({ id: 'page-1', slug: 'old-slug' });
    updateCase.prisma.statusPage.findUnique.mockResolvedValueOnce(null);
    updateCase.prisma.$transaction.mockRejectedValueOnce(slugConflict);

    await expect(
      updateCase.service.updateForUser('user-1', 'page-1', {
        slug: 'new-slug',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('StatusPagesService public status API', () => {
  it('returns a safe public response for enabled pages and maps monitor states and incidents', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      name: 'My Services',
      slug: 'my-services',
      description: 'Public services',
      enabled: true,
      updatedAt: now,
      monitorAssociations: [
        {
          monitorId: 'monitor-1',
          displayName: 'API',
          monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now },
        },
        {
          monitorId: 'monitor-2',
          displayName: 'Docs',
          monitor: { name: 'Docs', enabled: false, currentStatus: 'DOWN', lastCheckedAt: null },
        },
      ],
    });
    prisma.incident.findMany
      .mockResolvedValueOnce([
        { monitorId: 'monitor-1', startedAt: now, reason: 'API unavailable' },
        { monitorId: 'monitor-2', startedAt: now, reason: 'Docs unavailable' },
      ])
      .mockResolvedValueOnce([
        { monitorId: 'monitor-1', startedAt: new Date('2026-10-02T00:00:00Z'), resolvedAt: now, reason: 'Recovered' },
        { monitorId: 'monitor-2', startedAt: new Date('2026-10-01T00:00:00Z'), resolvedAt: now, reason: 'Recovered' },
      ]);

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors.mockResolvedValueOnce([]);

    const result = await service.getPublicBySlug('my-services');

    expect(result).toMatchObject({
      page: {
        name: 'My Services',
        slug: 'my-services',
        description: 'Public services',
      },
      overallStatus: 'UNKNOWN',
      monitors: [
        { name: 'API', status: 'OPERATIONAL', lastCheckedAt: now },
        { name: 'Docs', status: 'UNKNOWN', lastCheckedAt: null },
      ],
      activeIncidents: [
        { monitorName: 'API', reason: 'API unavailable' },
        { monitorName: 'Docs', reason: 'Docs unavailable' },
      ],
      recentIncidents: [
        { monitorName: 'API', reason: 'Recovered' },
        { monitorName: 'Docs', reason: 'Recovered' },
      ],
      activeMaintenance: [],
      manualIncidents: [],
      recentResolvedManualIncidents: [],
    });

    expect(result?.page).not.toHaveProperty('userId');
    expect(result?.monitors[0]).not.toHaveProperty('url');
    expect(result?.activeIncidents[0]).not.toHaveProperty('lastError');
    expect(result?.manualIncidents).toEqual([]);
  });

  it('returns outage when any included monitor is down and unknown when all are unknown or disabled', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst
      .mockResolvedValueOnce({
        id: 'page-1',
        name: 'Ops',
        slug: 'ops',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'monitor-1', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
          { monitorId: 'monitor-2', displayName: null, monitor: { name: 'Docs', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'page-2',
        name: 'Unknown',
        slug: 'unknown',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'monitor-3', displayName: null, monitor: { name: 'Jobs', enabled: false, currentStatus: 'DOWN', lastCheckedAt: now } },
          { monitorId: 'monitor-4', displayName: null, monitor: { name: 'Cache', enabled: true, currentStatus: 'UNKNOWN', lastCheckedAt: null } },
        ],
      })
      .mockResolvedValueOnce(null);

    prisma.incident.findMany.mockResolvedValue([]);
    maintenanceWindowsService.getActivePublicMaintenanceForMonitors.mockResolvedValue([]);

    await expect(service.getPublicBySlug('ops')).resolves.toMatchObject({ overallStatus: 'OUTAGE' });
    await expect(service.getPublicBySlug('unknown')).resolves.toMatchObject({ overallStatus: 'UNKNOWN' });
    await expect(service.getPublicBySlug('missing')).resolves.toBeNull();
  });

  it('keeps public incident history bounded, sorted, and scoped to included monitors', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      name: 'My Services',
      slug: 'my-services',
      description: null,
      enabled: true,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'monitor-1', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
        { monitorId: 'monitor-2', displayName: null, monitor: { name: 'Docs', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
      ],
    });

    const recentHistory = Array.from({ length: 25 }, (_, index) => ({
      monitorId: index % 2 === 0 ? 'monitor-1' : 'monitor-2',
      startedAt: new Date(`2026-10-${String(25 - index).padStart(2, '0')}T00:00:00Z`),
      resolvedAt: now,
      reason: `Resolved ${index}`,
    }));

    prisma.incident.findMany
      .mockResolvedValueOnce([
        { monitorId: 'monitor-1', startedAt: now, reason: 'Open API incident' },
        { monitorId: 'monitor-2', startedAt: now, reason: 'Open Docs incident' },
      ])
      .mockImplementationOnce(async (args: { take?: number }) => recentHistory.slice(0, args.take ?? recentHistory.length));

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors.mockResolvedValueOnce([]);

    const result = await service.getPublicBySlug('my-services');

    expect(prisma.incident.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          monitorId: { in: ['monitor-1', 'monitor-2'] },
          resolvedAt: null,
        }),
      }),
    );
    expect(prisma.incident.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          monitorId: { in: ['monitor-1', 'monitor-2'] },
          resolvedAt: { not: null },
        }),
        take: 20,
        orderBy: { startedAt: 'desc' },
      }),
    );

    expect(result?.activeIncidents).toHaveLength(2);
    expect(result?.recentIncidents).toHaveLength(20);
    expect(result?.recentIncidents[0].reason).toBe('Resolved 0');
    expect(result?.recentIncidents[19].reason).toBe('Resolved 19');
  });

  it('maps active maintenance to MAINTENANCE monitor state and maintenance-aware overall status', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst
      .mockResolvedValueOnce({
        id: 'page-1',
        name: 'Maintenance Window',
        slug: 'maintenance-window',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'monitor-1', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
          { monitorId: 'monitor-2', displayName: null, monitor: { name: 'Docs', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'page-2',
        name: 'Outage and Maintenance',
        slug: 'outage-and-maintenance',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'monitor-3', displayName: null, monitor: { name: 'Web', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
          { monitorId: 'monitor-4', displayName: null, monitor: { name: 'DB', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
        ],
      });

    prisma.incident.findMany.mockResolvedValue([]);

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors
      .mockResolvedValueOnce([
        {
          title: 'Database upgrade',
          description: 'Short maintenance',
          startsAt: now,
          endsAt: new Date(now.getTime() + 60_000),
          monitorIds: ['monitor-1'],
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'DB maintenance',
          description: null,
          startsAt: now,
          endsAt: new Date(now.getTime() + 60_000),
          monitorIds: ['monitor-4'],
        },
      ]);

    const maintenanceOnly = await service.getPublicBySlug('maintenance-window');
    const outageAndMaintenance = await service.getPublicBySlug('outage-and-maintenance');

    expect(maintenanceOnly).toMatchObject({
      overallStatus: 'MAINTENANCE',
      monitors: [
        { name: 'API', status: 'MAINTENANCE' },
        { name: 'Docs', status: 'OPERATIONAL' },
      ],
      activeMaintenance: [
        {
          title: 'Database upgrade',
          monitors: ['API'],
        },
      ],
    });

    expect(outageAndMaintenance).toMatchObject({
      overallStatus: 'OUTAGE',
      monitors: [
        { name: 'Web', status: 'OUTAGE' },
        { name: 'DB', status: 'MAINTENANCE' },
      ],
    });
  });

  it('exposes only relevant manual incidents and only monitor names present on the current page', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      userId: 'user-1',
      name: 'Public',
      slug: 'public',
      description: null,
      enabled: true,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'm1', displayName: 'API', monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
        { monitorId: 'm2', displayName: 'Website', monitor: { name: 'Website', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
      ],
    });

    prisma.incident.findMany.mockResolvedValue([]);
    prisma.manualIncident.findMany
      .mockResolvedValueOnce([
        {
          id: 'mi-1',
          title: 'Login issues',
          impact: 'PARTIAL_OUTAGE',
          status: 'IDENTIFIED',
          startedAt: now,
          resolvedAt: null,
          monitorAssociations: [
            { monitorId: 'm1', monitor: { name: 'API' } },
            { monitorId: 'm2', monitor: { name: 'Website' } },
          ],
          updates: [
            { status: 'INVESTIGATING', message: 'Investigating.', createdAt: new Date('2026-10-03T00:00:00Z') },
            { status: 'IDENTIFIED', message: 'Identified.', createdAt: new Date('2026-10-03T00:10:00Z') },
          ],
        },
      ])
      .mockResolvedValueOnce([]);

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors.mockResolvedValueOnce([]);

    const result = await service.getPublicBySlug('public');

    expect(result?.manualIncidents).toEqual([
      {
        title: 'Login issues',
        impact: 'PARTIAL_OUTAGE',
        status: 'IDENTIFIED',
        startedAt: now,
        resolvedAt: null,
        monitors: ['API', 'Website'],
        updates: [
          { status: 'INVESTIGATING', message: 'Investigating.', createdAt: new Date('2026-10-03T00:00:00Z') },
          { status: 'IDENTIFIED', message: 'Identified.', createdAt: new Date('2026-10-03T00:10:00Z') },
        ],
      },
    ]);

    expect(result?.manualIncidents[0]).not.toHaveProperty('userId');
    expect(result?.manualIncidents[0].monitors).not.toContain('Internal DB');
  });

  it('applies manual incident priority with outage/degraded/maintenance combinations', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst
      .mockResolvedValueOnce({
        id: 'page-major',
        userId: 'user-1',
        name: 'Major',
        slug: 'major',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'm1', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'page-partial',
        userId: 'user-1',
        name: 'Partial',
        slug: 'partial',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'm2', displayName: null, monitor: { name: 'Web', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'page-degraded-maint',
        userId: 'user-1',
        name: 'Degraded + Maint',
        slug: 'degraded-maint',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'm3', displayName: null, monitor: { name: 'Docs', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'page-outage-maint',
        userId: 'user-1',
        name: 'Outage + Maint',
        slug: 'outage-maint',
        description: null,
        enabled: true,
        updatedAt: now,
        monitorAssociations: [
          { monitorId: 'm4', displayName: null, monitor: { name: 'Jobs', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
          { monitorId: 'm5', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'DOWN', lastCheckedAt: now } },
        ],
      });

    prisma.incident.findMany.mockResolvedValue([]);

    prisma.manualIncident.findMany
      .mockResolvedValueOnce([
        {
          id: 'mi-major',
          title: 'Major issue',
          impact: 'MAJOR_OUTAGE',
          status: 'INVESTIGATING',
          startedAt: now,
          resolvedAt: null,
          monitorAssociations: [{ monitorId: 'm1', monitor: { name: 'API' } }],
          updates: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'mi-partial',
          title: 'Partial issue',
          impact: 'PARTIAL_OUTAGE',
          status: 'IDENTIFIED',
          startedAt: now,
          resolvedAt: null,
          monitorAssociations: [{ monitorId: 'm2', monitor: { name: 'Web' } }],
          updates: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'mi-degraded',
          title: 'Degraded issue',
          impact: 'DEGRADED',
          status: 'MONITORING',
          startedAt: now,
          resolvedAt: null,
          monitorAssociations: [{ monitorId: 'm3', monitor: { name: 'Docs' } }],
          updates: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          title: 'Maint',
          description: null,
          startsAt: now,
          endsAt: new Date(now.getTime() + 60_000),
          monitorIds: ['m3'],
        },
      ])
      .mockResolvedValueOnce([
        {
          title: 'Maint',
          description: null,
          startsAt: now,
          endsAt: new Date(now.getTime() + 60_000),
          monitorIds: ['m4'],
        },
      ]);

    const major = await service.getPublicBySlug('major');
    const partial = await service.getPublicBySlug('partial');
    const degradedOverMaintenance = await service.getPublicBySlug('degraded-maint');
    const outageOverMaintenance = await service.getPublicBySlug('outage-maint');

    expect(major?.overallStatus).toBe('OUTAGE');
    expect(partial?.overallStatus).toBe('DEGRADED');
    expect(degradedOverMaintenance?.overallStatus).toBe('DEGRADED');
    expect(outageOverMaintenance?.overallStatus).toBe('OUTAGE');
  });

  it('returns recent resolved manual incidents bounded and sorted by newest resolution', async () => {
    const { service, prisma, maintenanceWindowsService } = createService();

    prisma.statusPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      userId: 'user-1',
      name: 'Resolved history',
      slug: 'resolved-history',
      description: null,
      enabled: true,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'm1', displayName: null, monitor: { name: 'API', enabled: true, currentStatus: 'UP', lastCheckedAt: now } },
      ],
    });

    prisma.incident.findMany.mockResolvedValue([]);
    prisma.manualIncident.findMany
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async (args: { take?: number }) =>
        Array.from({ length: args.take ?? 20 }, (_, index) => ({
          id: `mi-resolved-${index}`,
          title: `Resolved ${index}`,
          impact: 'DEGRADED',
          status: 'RESOLVED',
          startedAt: new Date('2026-10-03T00:00:00Z'),
          resolvedAt: new Date(`2026-10-${String(30 - index).padStart(2, '0')}T00:00:00Z`),
          monitorAssociations: [{ monitorId: 'm1', monitor: { name: 'API' } }],
          updates: [{ status: 'RESOLVED', message: 'Done', createdAt: now }],
        })),
      );

    maintenanceWindowsService.getActivePublicMaintenanceForMonitors.mockResolvedValueOnce([]);

    const result = await service.getPublicBySlug('resolved-history');

    expect(result?.recentResolvedManualIncidents).toHaveLength(20);
    expect(result?.recentResolvedManualIncidents[0].title).toBe('Resolved 0');
    expect(result?.recentResolvedManualIncidents[19].title).toBe('Resolved 19');
  });
});