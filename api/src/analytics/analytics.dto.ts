import { BadRequestException } from '@nestjs/common';

export const ANALYTICS_RANGES = ['24h', '7d', '30d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export type AnalyticsWindowConfig = {
  range: AnalyticsRange;
  durationMs: number;
  bucketMs: number;
  bucketLabel: '15 minutes' | '1 hour' | '6 hours';
};

export const ANALYTICS_WINDOW_CONFIG: Record<AnalyticsRange, AnalyticsWindowConfig> = {
  '24h': {
    range: '24h',
    durationMs: 24 * 60 * 60 * 1000,
    bucketMs: 15 * 60 * 1000,
    bucketLabel: '15 minutes',
  },
  '7d': {
    range: '7d',
    durationMs: 7 * 24 * 60 * 60 * 1000,
    bucketMs: 60 * 60 * 1000,
    bucketLabel: '1 hour',
  },
  '30d': {
    range: '30d',
    durationMs: 30 * 24 * 60 * 60 * 1000,
    bucketMs: 6 * 60 * 60 * 1000,
    bucketLabel: '6 hours',
  },
};

export function parseAnalyticsRange(value: string | undefined): AnalyticsRange {
  if (value === undefined) {
    return '24h';
  }

  if (value === '24h' || value === '7d' || value === '30d') {
    return value;
  }

  throw new BadRequestException('range must be one of: 24h, 7d, 30d.');
}

export type AnalyticsSeriesBucket = {
  start: string;
  end: string;
  checkCount: number;
  successCount: number;
  uptimePercentage: number | null;
  averageResponseTimeMs: number | null;
};

export type MonitorAnalyticsResponse = {
  range: AnalyticsRange;
  from: string;
  to: string;
  checks: {
    total: number;
    successful: number;
    failed: number;
  };
  uptime: {
    // Check-based uptime; this is not an SLA guarantee.
    percentage: number | null;
  };
  latency: {
    averageMs: number | null;
    minMs: number | null;
    maxMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  incidents: {
    total: number;
    totalDowntimeMs: number;
    longestDowntimeMs: number;
  };
  series: AnalyticsSeriesBucket[];
};

export type AnalyticsOverviewResponse = {
  range: AnalyticsRange;
  from: string;
  to: string;
  monitorCount: number;
  operationalCount: number;
  outageCount: number;
  unknownCount: number;
  averageUptimePercentage: number | null;
  openIncidentCount: number;
};
