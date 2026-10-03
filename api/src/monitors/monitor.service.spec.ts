import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MonitorService } from './monitors.service.js';

describe('MonitorService scheduling behavior', () => {
  it('sets nextCheckAt on create when enabled', async () => {
    const prisma = {
      monitor: {
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
      },
    };

    const service = new MonitorService(prisma as never, {
      validateAndNormalize: vi.fn().mockResolvedValue('https://example.com'),
    } as never);
    vi.spyOn(service, 'getForUser').mockResolvedValue({ id: 'm1' } as never);

    await service.createForUser(
      { id: 'u1', login: 'alice', name: 'Alice', avatarUrl: null },
      {
        name: 'API',
        url: 'https://example.com',
        method: 'GET',
        expectedStatusCode: 200,
        intervalSeconds: 60,
        timeoutMs: 10000,
        failureThreshold: 3,
        enabled: true,
      },
    );

    expect(prisma.monitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          nextCheckAt: expect.any(Date),
        }),
      }),
    );
  });

  it('sets nextCheckAt to null when creating a disabled monitor', async () => {
    const prisma = {
      monitor: {
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
      },
    };

    const service = new MonitorService(prisma as never, {
      validateAndNormalize: vi.fn().mockResolvedValue('https://example.com'),
    } as never);
    vi.spyOn(service, 'getForUser').mockResolvedValue({ id: 'm1' } as never);

    await service.createForUser(
      { id: 'u1', login: 'alice', name: 'Alice', avatarUrl: null },
      {
        name: 'API',
        url: 'https://example.com',
        method: 'GET',
        expectedStatusCode: 200,
        intervalSeconds: 60,
        timeoutMs: 10000,
        failureThreshold: 3,
        enabled: false,
      },
    );

    expect(prisma.monitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: false,
          nextCheckAt: null,
        }),
      }),
    );
  });

  it('sets nextCheckAt when enabled is toggled on', async () => {
    const prisma = {
      monitor: {
        update: vi.fn().mockResolvedValue({ id: 'm1' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'm1', enabled: false, nextCheckAt: null }),
      },
    };

    const service = new MonitorService(prisma as never, {
      validateAndNormalize: vi.fn().mockResolvedValue('https://example.com'),
    } as never);
    vi.spyOn(service, 'getForUser').mockResolvedValue({ id: 'm1' } as never);

    await service.updateForUser('u1', 'm1', { enabled: true });

    expect(prisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          nextCheckAt: expect.any(Date),
        }),
      }),
    );
  });

  it('clears nextCheckAt when enabled is toggled off', async () => {
    const prisma = {
      monitor: {
        update: vi.fn().mockResolvedValue({ id: 'm1' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'm1', enabled: true, nextCheckAt: new Date() }),
      },
    };

    const service = new MonitorService(prisma as never, {
      validateAndNormalize: vi.fn().mockResolvedValue('https://example.com'),
    } as never);
    vi.spyOn(service, 'getForUser').mockResolvedValue({ id: 'm1' } as never);

    await service.updateForUser('u1', 'm1', { enabled: false });

    expect(prisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: false,
          nextCheckAt: null,
        }),
      }),
    );
  });
});

describe('MonitorService authorization', () => {
  it('rejects reads for monitors owned by a different user', async () => {
    const prisma = {
      monitor: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const service = new MonitorService(prisma as never, {
      validateAndNormalize: vi.fn(),
    } as never);

    await expect(service.getForUser('user-a', 'user-b-monitor')).rejects.toThrow(NotFoundException);
  });

  it('rejects patches for monitors owned by a different user', async () => {
    const service = new MonitorService({ monitor: { findFirst: vi.fn().mockResolvedValue(null) } } as never, {
      validateAndNormalize: vi.fn(),
    } as never);

    await expect(service.updateForUser('user-a', 'user-b-monitor', { enabled: true })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects deletes for monitors owned by a different user', async () => {
    const service = new MonitorService({ monitor: { findFirst: vi.fn().mockResolvedValue(null) } } as never, {
      validateAndNormalize: vi.fn(),
    } as never);

    await expect(service.deleteForUser('user-a', 'user-b-monitor')).rejects.toThrow(NotFoundException);
  });
});

describe('MonitorService response serialization', () => {
  it('create returns serialized monitor shape without userId/nextCheckAt and can include activeMaintenance', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const prisma = {
      monitor: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'm1',
          userId: 'u1',
          name: 'API',
          url: 'https://example.com',
          method: 'GET',
          expectedStatusCode: 200,
          intervalSeconds: 60,
          timeoutMs: 10000,
          failureThreshold: 3,
          enabled: true,
          currentStatus: 'UP',
          consecutiveFailures: 0,
          lastCheckedAt: now,
          nextCheckAt: now,
          createdAt: now,
          updatedAt: now,
          checkResults: [
            {
              id: 'c1',
              statusCode: 200,
              responseTimeMs: 37,
              success: true,
            },
          ],
          incidents: [],
        }),
      },
    };

    const maintenanceService = {
      getActiveMaintenanceForUserMonitors: vi.fn().mockResolvedValue(
        new Map([
          [
            'm1',
            {
              id: 'mw1',
              title: 'DB upgrade',
              startsAt: new Date('2026-10-03T11:00:00.000Z'),
              endsAt: new Date('2026-10-03T13:00:00.000Z'),
            },
          ],
        ]),
      ),
    };

    const service = new MonitorService(
      prisma as never,
      { validateAndNormalize: vi.fn().mockResolvedValue('https://example.com') } as never,
      maintenanceService as never,
    );

    const response = await service.createForUser(
      { id: 'u1', login: 'alice', name: 'Alice', avatarUrl: null },
      {
        name: 'API',
        url: 'https://example.com',
        method: 'GET',
        expectedStatusCode: 200,
        intervalSeconds: 60,
        timeoutMs: 10000,
        failureThreshold: 3,
        enabled: true,
      },
    );

    expect(response).toMatchObject({
      id: 'm1',
      latestStatusCode: 200,
      latestResponseTimeMs: 37,
      latestSuccess: true,
      activeMaintenance: expect.objectContaining({ id: 'mw1', title: 'DB upgrade' }),
    });
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('nextCheckAt');
  });

  it('update returns serialized monitor shape without userId/nextCheckAt and can include activeMaintenance', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const prisma = {
      monitor: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ enabled: true, nextCheckAt: now })
          .mockResolvedValueOnce({
            id: 'm1',
            userId: 'u1',
            name: 'API (updated)',
            url: 'https://example.com',
            method: 'GET',
            expectedStatusCode: 200,
            intervalSeconds: 60,
            timeoutMs: 10000,
            failureThreshold: 3,
            enabled: true,
            currentStatus: 'UP',
            consecutiveFailures: 0,
            lastCheckedAt: now,
            nextCheckAt: now,
            createdAt: now,
            updatedAt: now,
            checkResults: [
              {
                id: 'c1',
                statusCode: 200,
                responseTimeMs: 33,
                success: true,
              },
            ],
            incidents: [],
          }),
        update: vi.fn().mockResolvedValue({ id: 'm1' }),
      },
    };

    const maintenanceService = {
      getActiveMaintenanceForUserMonitors: vi.fn().mockResolvedValue(
        new Map([
          [
            'm1',
            {
              id: 'mw1',
              title: 'DB upgrade',
              startsAt: new Date('2026-10-03T11:00:00.000Z'),
              endsAt: new Date('2026-10-03T13:00:00.000Z'),
            },
          ],
        ]),
      ),
    };

    const service = new MonitorService(
      prisma as never,
      { validateAndNormalize: vi.fn().mockResolvedValue('https://example.com') } as never,
      maintenanceService as never,
    );

    const response = await service.updateForUser('u1', 'm1', { name: 'API (updated)' });

    expect(response).toMatchObject({
      id: 'm1',
      name: 'API (updated)',
      latestStatusCode: 200,
      latestResponseTimeMs: 33,
      latestSuccess: true,
      activeMaintenance: expect.objectContaining({ id: 'mw1', title: 'DB upgrade' }),
    });
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('nextCheckAt');
  });

  it('get returns activeMaintenance when applicable', async () => {
    const now = new Date('2026-10-03T12:00:00.000Z');
    const prisma = {
      monitor: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'm1',
          userId: 'u1',
          name: 'API',
          url: 'https://example.com',
          method: 'GET',
          expectedStatusCode: 200,
          intervalSeconds: 60,
          timeoutMs: 10000,
          failureThreshold: 3,
          enabled: true,
          currentStatus: 'UP',
          consecutiveFailures: 0,
          lastCheckedAt: now,
          nextCheckAt: now,
          createdAt: now,
          updatedAt: now,
          checkResults: [],
          incidents: [],
        }),
      },
    };

    const maintenanceService = {
      getActiveMaintenanceForUserMonitors: vi.fn().mockResolvedValue(
        new Map([
          [
            'm1',
            {
              id: 'mw1',
              title: 'DB upgrade',
              startsAt: new Date('2026-10-03T11:00:00.000Z'),
              endsAt: new Date('2026-10-03T13:00:00.000Z'),
            },
          ],
        ]),
      ),
    };

    const service = new MonitorService(
      prisma as never,
      { validateAndNormalize: vi.fn() } as never,
      maintenanceService as never,
    );

    const response = await service.getForUser('u1', 'm1');
    expect(response.activeMaintenance).toMatchObject({ id: 'mw1', title: 'DB upgrade' });
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('nextCheckAt');
  });
});
