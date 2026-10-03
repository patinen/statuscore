import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceWindowsService } from './maintenance-windows.service.js';

const now = new Date('2026-10-03T00:00:00.000Z');

const createService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    monitor: {
      findMany: vi.fn(),
    },
    maintenanceWindow: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    maintenanceWindowMonitor: {
      findFirst: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    ...overrides,
  };

  return { prisma, service: new MaintenanceWindowsService(prisma as never) };
};

describe('MaintenanceWindowsService CRUD and validation', () => {
  it('creates valid maintenance window and enforces ownership of monitor selections', async () => {
    const { service, prisma } = createService();

    vi.useFakeTimers();
    vi.setSystemTime(now);

    prisma.maintenanceWindow.count.mockResolvedValueOnce(0);
    prisma.monitor.findMany.mockResolvedValueOnce([
      { id: 'm1', name: 'API' },
      { id: 'm2', name: 'Docs' },
    ]);
    prisma.maintenanceWindow.create.mockResolvedValueOnce({ id: 'w1' });
    prisma.maintenanceWindow.findFirst.mockResolvedValueOnce({
      id: 'w1',
      userId: 'u1',
      title: 'Database maintenance',
      description: 'Upgrade',
      startsAt: new Date('2026-10-03T00:00:00.000Z'),
      endsAt: new Date('2026-10-03T02:00:00.000Z'),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [
        { monitorId: 'm1', monitor: { id: 'm1', name: 'API' } },
        { monitorId: 'm2', monitor: { id: 'm2', name: 'Docs' } },
      ],
    });

    await expect(
      service.createForUser('u1', {
        title: 'Database maintenance',
        description: 'Upgrade',
        startsAt: '2026-10-03T00:00:00.000Z',
        endsAt: '2026-10-03T02:00:00.000Z',
        monitorIds: ['m1', 'm2'],
      }),
    ).resolves.toMatchObject({
      id: 'w1',
      state: 'ACTIVE',
      monitorIds: ['m1', 'm2'],
    });

    expect(prisma.maintenanceWindowMonitor.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ maintenanceWindowId: 'w1', monitorId: 'm1' }),
          expect.objectContaining({ maintenanceWindowId: 'w1', monitorId: 'm2' }),
        ],
      }),
    );

    vi.useRealTimers();
  });

  it('rejects invalid ranges, over-30-day duration, and ended windows at creation time', async () => {
    const { service, prisma } = createService();

    vi.useFakeTimers();
    vi.setSystemTime(now);

    prisma.maintenanceWindow.count.mockResolvedValue(0);
    prisma.monitor.findMany.mockResolvedValue([{ id: 'm1', name: 'API' }]);

    await expect(
      service.createForUser('u1', {
        title: 'Invalid',
        startsAt: '2026-10-03T03:00:00.000Z',
        endsAt: '2026-10-03T02:00:00.000Z',
        monitorIds: ['m1'],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createForUser('u1', {
        title: 'Too long',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-11-02T00:00:00.000Z',
        monitorIds: ['m1'],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createForUser('u1', {
        title: 'Ended',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
        monitorIds: ['m1'],
      }),
    ).rejects.toThrow(BadRequestException);

    vi.useRealTimers();
  });

  it('enforces window count, monitor count, and foreign-monitor checks', async () => {
    const { service, prisma } = createService();

    prisma.maintenanceWindow.count.mockResolvedValueOnce(50);

    await expect(
      service.createForUser('u1', {
        title: 'Cap',
        startsAt: '2026-10-03T00:00:00.000Z',
        endsAt: '2026-10-03T01:00:00.000Z',
        monitorIds: ['m1'],
      }),
    ).rejects.toThrow(BadRequestException);

    prisma.maintenanceWindow.count.mockResolvedValue(0);

    await expect(
      service.createForUser('u1', {
        title: 'No monitors',
        startsAt: '2026-10-03T00:00:00.000Z',
        endsAt: '2026-10-03T01:00:00.000Z',
        monitorIds: [],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createForUser('u1', {
        title: 'Too many monitors',
        startsAt: '2026-10-03T00:00:00.000Z',
        endsAt: '2026-10-03T01:00:00.000Z',
        monitorIds: Array.from({ length: 26 }, (_, index) => `m-${index}`),
      }),
    ).rejects.toThrow(BadRequestException);

    prisma.monitor.findMany.mockResolvedValueOnce([]);
    await expect(
      service.createForUser('u1', {
        title: 'Foreign monitor',
        startsAt: '2099-01-01T00:00:00.000Z',
        endsAt: '2099-01-01T01:00:00.000Z',
        monitorIds: ['other-user-monitor'],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects reads, updates, and deletes for foreign windows', async () => {
    const { service, prisma } = createService();

    prisma.maintenanceWindow.findFirst.mockResolvedValue(null);

    await expect(service.getForUser('user-a', 'window-1')).rejects.toThrow(NotFoundException);
    await expect(service.updateForUser('user-a', 'window-1', { title: 'Updated' })).rejects.toThrow(NotFoundException);
    await expect(service.deleteForUser('user-a', 'window-1')).rejects.toThrow(NotFoundException);
  });

  it('replaces monitor associations atomically on update and supports description clear semantics', async () => {
    const { service, prisma } = createService();

    const callOrder: string[] = [];
    prisma.maintenanceWindow.findFirst
      .mockResolvedValueOnce({ id: 'w1', startsAt: new Date('2026-10-03T00:00:00.000Z'), endsAt: new Date('2026-10-03T02:00:00.000Z') })
      .mockResolvedValueOnce({
        id: 'w1',
        userId: 'u1',
        title: 'Updated',
        description: null,
        startsAt: new Date('2026-10-03T00:00:00.000Z'),
        endsAt: new Date('2026-10-03T02:00:00.000Z'),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [{ monitorId: 'm2', monitor: { id: 'm2', name: 'Docs' } }],
      });

    prisma.monitor.findMany.mockResolvedValueOnce([{ id: 'm2', name: 'Docs' }]);
    prisma.maintenanceWindow.update.mockImplementation(async () => {
      callOrder.push('update');
      return { id: 'w1' };
    });
    prisma.maintenanceWindowMonitor.deleteMany.mockImplementation(async () => {
      callOrder.push('delete');
      return { count: 1 };
    });
    prisma.maintenanceWindowMonitor.createMany.mockImplementation(async () => {
      callOrder.push('create');
      return { count: 1 };
    });

    await expect(
      service.updateForUser('u1', 'w1', {
        title: 'Updated',
        description: '   ',
        monitorIds: ['m2'],
      }),
    ).resolves.toMatchObject({
      description: null,
      monitorIds: ['m2'],
    });

    expect(callOrder).toEqual(['update', 'delete', 'create']);
  });

  it('derives scheduled/active/ended/disabled window states', async () => {
    const { service, prisma } = createService();

    vi.useFakeTimers();
    vi.setSystemTime(now);

    prisma.maintenanceWindow.findMany.mockResolvedValueOnce([
      {
        id: 'w-scheduled',
        userId: 'u1',
        title: 'Scheduled',
        description: null,
        startsAt: new Date('2026-10-03T03:00:00.000Z'),
        endsAt: new Date('2026-10-03T04:00:00.000Z'),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      },
      {
        id: 'w-active',
        userId: 'u1',
        title: 'Active',
        description: null,
        startsAt: new Date('2026-10-02T23:00:00.000Z'),
        endsAt: new Date('2026-10-03T02:00:00.000Z'),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      },
      {
        id: 'w-ended',
        userId: 'u1',
        title: 'Ended',
        description: null,
        startsAt: new Date('2026-10-02T20:00:00.000Z'),
        endsAt: new Date('2026-10-02T22:00:00.000Z'),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      },
      {
        id: 'w-disabled',
        userId: 'u1',
        title: 'Disabled',
        description: null,
        startsAt: new Date('2026-10-02T23:00:00.000Z'),
        endsAt: new Date('2026-10-03T02:00:00.000Z'),
        enabled: false,
        createdAt: now,
        updatedAt: now,
        monitorAssociations: [],
      },
    ]);

    const results = await service.listForUser('u1');
    expect(results.map((window) => window.state)).toEqual(['SCHEDULED', 'ACTIVE', 'ENDED', 'DISABLED']);

    vi.useRealTimers();
  });

  it('checks active-maintenance coverage by monitor and timestamp using transaction-scoped lookup', async () => {
    const { service } = createService();

    const tx = {
      maintenanceWindowMonitor: {
        findFirst: vi.fn().mockResolvedValueOnce({ maintenanceWindowId: 'mw-1' }).mockResolvedValueOnce(null),
      },
    };

    await expect(
      service.isMonitorUnderActiveMaintenanceAtTx(tx as never, 'm1', new Date('2026-10-03T00:10:00.000Z')),
    ).resolves.toBe(true);
    await expect(
      service.isMonitorUnderActiveMaintenanceAtTx(tx as never, 'm2', new Date('2026-10-03T00:10:00.000Z')),
    ).resolves.toBe(false);

    expect(tx.maintenanceWindowMonitor.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          monitorId: 'm1',
          maintenanceWindow: expect.objectContaining({
            enabled: true,
            startsAt: { lte: new Date('2026-10-03T00:10:00.000Z') },
            endsAt: { gt: new Date('2026-10-03T00:10:00.000Z') },
          }),
        }),
      }),
    );
  });
});
