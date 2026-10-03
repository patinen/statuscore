import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManualIncidentImpact, ManualIncidentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ManualIncidentsService } from './manual-incidents.service.js';

const now = new Date('2026-10-03T00:00:00.000Z');

const createService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    monitor: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    incident: {
      create: vi.fn(),
      update: vi.fn(),
    },
    manualIncident: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    manualIncidentMonitor: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    manualIncidentUpdate: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    ...overrides,
  };

  return { prisma, service: new ManualIncidentsService(prisma as never) };
};

describe('ManualIncidentsService CRUD and ownership', () => {
  it('creates a manual incident atomically with initial update and monitor associations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { service, prisma } = createService();

    prisma.manualIncident.count.mockResolvedValueOnce(0);
    prisma.monitor.findMany.mockResolvedValueOnce([
      { id: 'm1', name: 'API' },
      { id: 'm2', name: 'Web' },
    ]);
    prisma.manualIncident.create.mockResolvedValueOnce({ id: 'mi-1' });
    prisma.manualIncident.findFirst.mockResolvedValueOnce({
      id: 'mi-1',
      userId: 'u1',
      title: 'Login issues',
      status: ManualIncidentStatus.INVESTIGATING,
      impact: ManualIncidentImpact.PARTIAL_OUTAGE,
      startedAt: now,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'm1', monitor: { id: 'm1', name: 'API' } },
        { monitorId: 'm2', monitor: { id: 'm2', name: 'Web' } },
      ],
      updates: [
        {
          id: 'u-1',
          status: ManualIncidentStatus.INVESTIGATING,
          message: 'Investigating elevated errors.',
          createdAt: now,
        },
      ],
    });

    await expect(
      service.createForUser('u1', {
        title: 'Login issues',
        impact: ManualIncidentImpact.PARTIAL_OUTAGE,
        monitorIds: ['m1', 'm2'],
        message: 'Investigating elevated errors.',
      }),
    ).resolves.toMatchObject({
      id: 'mi-1',
      status: ManualIncidentStatus.INVESTIGATING,
      impact: ManualIncidentImpact.PARTIAL_OUTAGE,
      monitorIds: ['m1', 'm2'],
      updates: [
        {
          status: ManualIncidentStatus.INVESTIGATING,
          message: 'Investigating elevated errors.',
          createdAt: now,
        },
      ],
    });

    expect(prisma.manualIncidentMonitor.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.manualIncidentUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ManualIncidentStatus.INVESTIGATING,
          message: 'Investigating elevated errors.',
          createdAt: now,
        }),
      }),
    );

    vi.useRealTimers();
  });

  it('enforces monitor count and ownership rules', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.count.mockResolvedValue(0);

    await expect(
      service.createForUser('u1', {
        title: 'No monitors',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: [],
        message: 'Testing',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createForUser('u1', {
        title: 'Too many',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: Array.from({ length: 26 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
        message: 'Testing',
      }),
    ).rejects.toThrow(BadRequestException);

    prisma.monitor.findMany.mockResolvedValueOnce([]);
    await expect(
      service.createForUser('u1', {
        title: 'Foreign monitor',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: ['11111111-1111-4111-8111-111111111111'],
        message: 'Testing',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists and retrieves incidents with owner scoping and rejects foreign access', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.findMany.mockResolvedValueOnce([
      {
        id: 'mi-1',
        userId: 'u1',
        title: 'Login issues',
        status: ManualIncidentStatus.IDENTIFIED,
        impact: ManualIncidentImpact.PARTIAL_OUTAGE,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [{ monitorId: 'm1', monitor: { id: 'm1', name: 'API' } }],
        updates: [],
      },
    ]);

    await expect(service.listForUser('u1', 'open', 50)).resolves.toHaveLength(1);

    prisma.manualIncident.findFirst.mockResolvedValueOnce(null);
    await expect(service.getForUser('u1', 'foreign-id')).rejects.toThrow(NotFoundException);
  });

  it('replaces monitor associations atomically on metadata patch', async () => {
    const { service, prisma } = createService();
    const callOrder: string[] = [];

    prisma.manualIncident.findFirst
      .mockResolvedValueOnce({ id: 'mi-1' })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Updated title',
        status: ManualIncidentStatus.MONITORING,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [{ monitorId: 'm2', monitor: { id: 'm2', name: 'Web' } }],
        updates: [],
      });

    prisma.monitor.findMany.mockResolvedValueOnce([{ id: 'm2', name: 'Web' }]);
    prisma.manualIncident.update.mockImplementation(async () => {
      callOrder.push('update');
      return { id: 'mi-1' };
    });
    prisma.manualIncidentMonitor.deleteMany.mockImplementation(async () => {
      callOrder.push('delete');
      return { count: 1 };
    });
    prisma.manualIncidentMonitor.createMany.mockImplementation(async () => {
      callOrder.push('create');
      return { count: 1 };
    });

    await expect(
      service.updateForUser('u1', 'mi-1', {
        title: 'Updated title',
        impact: ManualIncidentImpact.DEGRADED,
        monitorIds: ['m2'],
      }),
    ).resolves.toMatchObject({ title: 'Updated title', impact: ManualIncidentImpact.DEGRADED });

    expect(callOrder).toEqual(['update', 'delete', 'create']);
  });

  it('rejects foreign update/edit/delete attempts', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.findFirst.mockResolvedValue(null);

    await expect(
      service.createUpdateForUser('u1', 'foreign', {
        status: ManualIncidentStatus.IDENTIFIED,
        message: 'No access',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(service.updateForUser('u1', 'foreign', { title: 'No access' })).rejects.toThrow(NotFoundException);
    await expect(service.deleteForUser('u1', 'foreign')).rejects.toThrow(NotFoundException);
  });
});

describe('ManualIncidentsService updates and lifecycle semantics', () => {
  it('supports INVESTIGATING, IDENTIFIED, MONITORING, and RESOLVED updates', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.findFirst
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.INVESTIGATING, resolvedAt: null })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Incident',
        status: ManualIncidentStatus.IDENTIFIED,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
        updates: [
          {
            id: 'upd-1',
            status: ManualIncidentStatus.IDENTIFIED,
            message: 'Identified root cause.',
            createdAt: now,
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.IDENTIFIED, resolvedAt: null })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Incident',
        status: ManualIncidentStatus.MONITORING,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
        updates: [
          {
            id: 'upd-2',
            status: ManualIncidentStatus.MONITORING,
            message: 'Monitoring recovery.',
            createdAt: now,
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.MONITORING, resolvedAt: null })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Incident',
        status: ManualIncidentStatus.RESOLVED,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
        updates: [
          {
            id: 'upd-3',
            status: ManualIncidentStatus.RESOLVED,
            message: 'Resolved.',
            createdAt: now,
          },
        ],
      });

    await expect(
      service.createUpdateForUser('u1', 'mi-1', {
        status: ManualIncidentStatus.IDENTIFIED,
        message: 'Identified root cause.',
      }),
    ).resolves.toMatchObject({ status: ManualIncidentStatus.IDENTIFIED });

    await expect(
      service.createUpdateForUser('u1', 'mi-1', {
        status: ManualIncidentStatus.MONITORING,
        message: 'Monitoring recovery.',
      }),
    ).resolves.toMatchObject({ status: ManualIncidentStatus.MONITORING });

    await expect(
      service.createUpdateForUser('u1', 'mi-1', {
        status: ManualIncidentStatus.RESOLVED,
        message: 'Resolved.',
      }),
    ).resolves.toMatchObject({ status: ManualIncidentStatus.RESOLVED });
  });

  it('sets resolvedAt to the same timestamp as the resolving update and blocks reopening', async () => {
    vi.useFakeTimers();
    const resolveAt = new Date('2026-10-03T01:23:45.000Z');
    vi.setSystemTime(resolveAt);

    const { service, prisma } = createService();

    prisma.manualIncident.findFirst
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.MONITORING, resolvedAt: null })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Resolved incident',
        status: ManualIncidentStatus.RESOLVED,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: resolveAt,
        createdAt: now,
        updatedAt: resolveAt,
        monitorAssociations: [],
        updates: [
          {
            id: 'upd-resolve',
            status: ManualIncidentStatus.RESOLVED,
            message: 'Resolved now.',
            createdAt: resolveAt,
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.RESOLVED, resolvedAt: resolveAt });

    await service.createUpdateForUser('u1', 'mi-1', {
      status: ManualIncidentStatus.RESOLVED,
      message: 'Resolved now.',
    });

    expect(prisma.manualIncidentUpdate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdAt: resolveAt,
        }),
      }),
    );
    expect(prisma.manualIncident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolvedAt: resolveAt,
        }),
      }),
    );

    await expect(
      service.createUpdateForUser('u1', 'mi-1', {
        status: ManualIncidentStatus.IDENTIFIED,
        message: 'Reopening attempt',
      }),
    ).rejects.toThrow(BadRequestException);

    vi.useRealTimers();
  });

  it('keeps historical updates immutable and status changes only through update endpoint', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.findFirst
      .mockResolvedValueOnce({ id: 'mi-1', status: ManualIncidentStatus.INVESTIGATING, resolvedAt: null })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Incident',
        status: ManualIncidentStatus.IDENTIFIED,
        impact: ManualIncidentImpact.DEGRADED,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
        updates: [
          {
            id: 'old',
            status: ManualIncidentStatus.INVESTIGATING,
            message: 'Original message',
            createdAt: new Date('2026-10-03T00:00:00.000Z'),
          },
          {
            id: 'new',
            status: ManualIncidentStatus.IDENTIFIED,
            message: 'New message',
            createdAt: new Date('2026-10-03T00:05:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'mi-1' })
      .mockResolvedValueOnce({
        id: 'mi-1',
        userId: 'u1',
        title: 'Metadata updated',
        status: ManualIncidentStatus.IDENTIFIED,
        impact: ManualIncidentImpact.MAJOR_OUTAGE,
        startedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
        updates: [
          {
            id: 'old',
            status: ManualIncidentStatus.INVESTIGATING,
            message: 'Original message',
            createdAt: new Date('2026-10-03T00:00:00.000Z'),
          },
          {
            id: 'new',
            status: ManualIncidentStatus.IDENTIFIED,
            message: 'New message',
            createdAt: new Date('2026-10-03T00:05:00.000Z'),
          },
        ],
      });

    const updated = await service.createUpdateForUser('u1', 'mi-1', {
      status: ManualIncidentStatus.IDENTIFIED,
      message: 'New message',
    });

    expect(updated.updates[0].message).toBe('Original message');
    expect(prisma.manualIncidentUpdate.update).not.toHaveBeenCalled();

    const patched = await service.updateForUser('u1', 'mi-1', {
      title: 'Metadata updated',
      impact: ManualIncidentImpact.MAJOR_OUTAGE,
    });

    expect(patched.status).toBe(ManualIncidentStatus.IDENTIFIED);
    expect(prisma.manualIncident.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });
});

describe('Manual incidents regression safety', () => {
  it('does not modify monitor status fields or automatic incidents', async () => {
    const { service, prisma } = createService();

    prisma.manualIncident.count.mockResolvedValueOnce(0);
    prisma.monitor.findMany.mockResolvedValueOnce([{ id: 'm1', name: 'API' }]);
    prisma.manualIncident.create.mockResolvedValueOnce({ id: 'mi-1' });
    prisma.manualIncident.findFirst.mockResolvedValueOnce({
      id: 'mi-1',
      userId: 'u1',
      title: 'Manual event',
      status: ManualIncidentStatus.INVESTIGATING,
      impact: ManualIncidentImpact.DEGRADED,
      startedAt: now,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [{ monitorId: 'm1', monitor: { id: 'm1', name: 'API' } }],
      updates: [
        {
          id: 'upd-1',
          status: ManualIncidentStatus.INVESTIGATING,
          message: 'Investigating',
          createdAt: now,
        },
      ],
    });

    await service.createForUser('u1', {
      title: 'Manual event',
      impact: ManualIncidentImpact.DEGRADED,
      monitorIds: ['m1'],
      message: 'Investigating',
    });

    expect(prisma.monitor.update).not.toHaveBeenCalled();
    expect(prisma.incident.create).not.toHaveBeenCalled();
    expect(prisma.incident.update).not.toHaveBeenCalled();
  });
});
