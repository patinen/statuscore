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
