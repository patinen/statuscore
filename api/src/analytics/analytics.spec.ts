import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_WINDOW_CONFIG, parseAnalyticsRange } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

const now = new Date('2026-10-03T12:00:00.000Z');

describe('analytics range parsing', () => {
  it('defaults to 24h when omitted', () => {
    expect(parseAnalyticsRange(undefined)).toBe('24h');
  });

  it('accepts 24h, 7d, and 30d', () => {
    expect(parseAnalyticsRange('24h')).toBe('24h');
    expect(parseAnalyticsRange('7d')).toBe('7d');
    expect(parseAnalyticsRange('30d')).toBe('30d');
  });

  it('rejects invalid range values', () => {
    expect(() => parseAnalyticsRange('90d')).toThrow(BadRequestException);
  });

  it('uses fixed bounded bucket resolutions', () => {
    expect(ANALYTICS_WINDOW_CONFIG['24h'].bucketMs).toBe(15 * 60 * 1000);
    expect(ANALYTICS_WINDOW_CONFIG['7d'].bucketMs).toBe(60 * 60 * 1000);
    expect(ANALYTICS_WINDOW_CONFIG['30d'].bucketMs).toBe(6 * 60 * 60 * 1000);

    expect(ANALYTICS_WINDOW_CONFIG['24h'].durationMs / ANALYTICS_WINDOW_CONFIG['24h'].bucketMs).toBe(96);
    expect(ANALYTICS_WINDOW_CONFIG['7d'].durationMs / ANALYTICS_WINDOW_CONFIG['7d'].bucketMs).toBe(168);
    expect(ANALYTICS_WINDOW_CONFIG['30d'].durationMs / ANALYTICS_WINDOW_CONFIG['30d'].bucketMs).toBe(120);
  });
});

const createService = () => {
  const prisma = {
    monitor: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    incident: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };

  const service = new AnalyticsService(prisma as never);
  vi.useFakeTimers();
  vi.setSystemTime(now);

  return { service, prisma };
};

describe('AnalyticsService monitor analytics', () => {
  it('returns owner-scoped analytics summary with check, latency, incident, and series data', async () => {
    const { service, prisma } = createService();

    prisma.monitor.findFirst.mockResolvedValueOnce({ id: 'monitor-1' });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          totalChecks: 100,
          successfulChecks: 95,
          failedChecks: 5,
          uptimePercentage: 95,
          averageMs: 120.5,
          minMs: 80,
          maxMs: 300,
          p50Ms: 110,
          p95Ms: 220,
          p99Ms: 290,
        },
      ])
      .mockResolvedValueOnce([
        {
          totalIncidents: 2,
          totalDowntimeMs: 320000,
          longestDowntimeMs: 240000,
        },
      ])
      .mockResolvedValueOnce([
        {
          start: new Date('2026-10-03T11:00:00.000Z'),
          end: new Date('2026-10-03T11:15:00.000Z'),
          checkCount: 15,
          successCount: 14,
          uptimePercentage: 93.333333,
          averageResponseTimeMs: 118.5,
        },
        {
          start: new Date('2026-10-03T11:15:00.000Z'),
          end: new Date('2026-10-03T11:30:00.000Z'),
          checkCount: 0,
          successCount: 0,
          uptimePercentage: null,
          averageResponseTimeMs: null,
        },
      ]);

    const result = await service.getMonitorAnalyticsForUser('user-1', 'monitor-1', '24h');

    expect(result.range).toBe('24h');
    expect(result.to).toBe(now.toISOString());
    expect(result.checks).toEqual({ total: 100, successful: 95, failed: 5 });
    expect(result.uptime.percentage).toBe(95);
    expect(result.latency).toEqual({
      averageMs: 120.5,
      minMs: 80,
      maxMs: 300,
      p50Ms: 110,
      p95Ms: 220,
      p99Ms: 290,
    });
    expect(result.incidents).toEqual({
      total: 2,
      totalDowntimeMs: 320000,
      longestDowntimeMs: 240000,
    });
    expect(result.series).toHaveLength(2);
    expect(result.series[0]).toMatchObject({
      checkCount: 15,
      successCount: 14,
      uptimePercentage: 93.333333,
      averageResponseTimeMs: 118.5,
    });
    expect(result.series[1]).toMatchObject({
      checkCount: 0,
      successCount: 0,
      uptimePercentage: null,
      averageResponseTimeMs: null,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('returns null uptime and null latency metrics when no checks or eligible latency samples exist', async () => {
    const { service, prisma } = createService();

    prisma.monitor.findFirst.mockResolvedValueOnce({ id: 'monitor-1' });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          totalChecks: 0,
          successfulChecks: 0,
          failedChecks: 0,
          uptimePercentage: null,
          averageMs: null,
          minMs: null,
          maxMs: null,
          p50Ms: null,
          p95Ms: null,
          p99Ms: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          totalIncidents: 0,
          totalDowntimeMs: 0,
          longestDowntimeMs: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getMonitorAnalyticsForUser('user-1', 'monitor-1', '7d');

    expect(result.uptime.percentage).toBeNull();
    expect(result.latency).toEqual({
      averageMs: null,
      minMs: null,
      maxMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    });
    expect(result.incidents.total).toBe(0);

    vi.useRealTimers();
  });

  it('throws 404 for unknown or foreign monitor ids', async () => {
    const { service, prisma } = createService();

    prisma.monitor.findFirst.mockResolvedValueOnce(null);

    await expect(service.getMonitorAnalyticsForUser('user-1', 'missing-monitor', '30d')).rejects.toThrow(NotFoundException);

    vi.useRealTimers();
  });
});

describe('AnalyticsService overview', () => {
  it('returns monitor state counts, open incident count, and average uptime excluding monitors with no checks', async () => {
    const { service, prisma } = createService();

    prisma.monitor.findMany.mockResolvedValueOnce([
      { id: 'm1', currentStatus: 'UP' },
      { id: 'm2', currentStatus: 'DOWN' },
      { id: 'm3', currentStatus: 'UNKNOWN' },
    ]);
    prisma.incident.count.mockResolvedValueOnce(2);
    prisma.$queryRaw.mockResolvedValueOnce([{ averageUptimePercentage: 97.5 }]);

    const result = await service.getOverviewForUser('user-1', '24h');

    expect(result).toMatchObject({
      range: '24h',
      monitorCount: 3,
      operationalCount: 1,
      outageCount: 1,
      unknownCount: 1,
      openIncidentCount: 2,
      averageUptimePercentage: 97.5,
    });
    expect(prisma.monitor.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { id: true, currentStatus: true },
    });
    expect(prisma.incident.count).toHaveBeenCalledWith({
      where: {
        resolvedAt: null,
        monitor: {
          userId: 'user-1',
        },
      },
    });

    vi.useRealTimers();
  });

  it('returns null average uptime when no monitors have check samples in range', async () => {
    const { service, prisma } = createService();

    prisma.monitor.findMany.mockResolvedValueOnce([]);
    prisma.incident.count.mockResolvedValueOnce(0);
    prisma.$queryRaw.mockResolvedValueOnce([{ averageUptimePercentage: null }]);

    const result = await service.getOverviewForUser('user-1', '7d');

    expect(result.averageUptimePercentage).toBeNull();

    vi.useRealTimers();
  });
});
