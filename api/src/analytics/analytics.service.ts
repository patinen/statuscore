import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  ANALYTICS_WINDOW_CONFIG,
  type AnalyticsOverviewResponse,
  type AnalyticsRange,
  type AnalyticsSeriesBucket,
  type MonitorAnalyticsResponse,
} from './analytics.dto.js';

type AnalyticsWindow = {
  range: AnalyticsRange;
  from: Date;
  to: Date;
  bucketMs: number;
};

type ChecksAndLatencyRow = {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  uptimePercentage: number | null;
  averageMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

type DowntimeRow = {
  totalIncidents: number;
  totalDowntimeMs: number;
  longestDowntimeMs: number;
};

type SeriesRow = {
  start: Date;
  end: Date;
  checkCount: number;
  successCount: number;
  uptimePercentage: number | null;
  averageResponseTimeMs: number | null;
};

type AverageUptimeRow = {
  averageUptimePercentage: number | null;
};

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private getWindow(range: AnalyticsRange, now: Date): AnalyticsWindow {
    const config = ANALYTICS_WINDOW_CONFIG[range];
    const to = new Date(now.getTime());
    const from = new Date(to.getTime() - config.durationMs);

    return {
      range,
      from,
      to,
      bucketMs: config.bucketMs,
    };
  }

  private getBucketIntervalSql(range: AnalyticsRange): Prisma.Sql {
    if (range === '24h') {
      return Prisma.sql`interval '15 minutes'`;
    }

    if (range === '7d') {
      return Prisma.sql`interval '1 hour'`;
    }

    return Prisma.sql`interval '6 hours'`;
  }

  private toNumber(value: number | bigint | null | undefined): number {
    if (value === null || value === undefined) {
      return 0;
    }

    return Number(value);
  }

  private toNullableNumber(value: number | bigint | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    return Number(value);
  }

  private mapSeries(rows: SeriesRow[]): AnalyticsSeriesBucket[] {
    return rows.map((row) => ({
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      checkCount: this.toNumber(row.checkCount),
      successCount: this.toNumber(row.successCount),
      uptimePercentage: this.toNullableNumber(row.uptimePercentage),
      averageResponseTimeMs: this.toNullableNumber(row.averageResponseTimeMs),
    }));
  }

  async getMonitorAnalyticsForUser(userId: string, monitorId: string, range: AnalyticsRange): Promise<MonitorAnalyticsResponse> {
    const now = new Date();
    const window = this.getWindow(range, now);

    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, userId },
      select: { id: true },
    });

    if (!monitor) {
      throw new NotFoundException('Monitor not found.');
    }

    const checksAndLatencyRows = await this.prisma.$queryRaw<ChecksAndLatencyRow[]>`
      SELECT
        COUNT(*)::int AS "totalChecks",
        COUNT(*) FILTER (WHERE "success")::int AS "successfulChecks",
        COUNT(*) FILTER (WHERE NOT "success")::int AS "failedChecks",
        CASE
          WHEN COUNT(*) = 0 THEN NULL
          ELSE (COUNT(*) FILTER (WHERE "success")::double precision / COUNT(*)::double precision) * 100.0
        END AS "uptimePercentage",
        AVG("responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "averageMs",
        MIN("responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "minMs",
        MAX("responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "maxMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "p50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "p95Ms",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "responseTimeMs") FILTER (WHERE "success" AND "responseTimeMs" IS NOT NULL)::double precision AS "p99Ms"
      FROM "CheckResult"
      WHERE "monitorId" = ${monitorId}::uuid
        AND "checkedAt" >= ${window.from}
        AND "checkedAt" < ${window.to}
    `;

    const incidentRows = await this.prisma.$queryRaw<DowntimeRow[]>`
      WITH overlapping AS (
        SELECT
          GREATEST("startedAt", ${window.from}) AS "effectiveStart",
          LEAST(COALESCE("resolvedAt", ${window.to}), ${window.to}) AS "effectiveEnd"
        FROM "Incident"
        WHERE "monitorId" = ${monitorId}::uuid
          AND "startedAt" < ${window.to}
          AND COALESCE("resolvedAt", ${window.to}) > ${window.from}
      ),
      clamped AS (
        SELECT
          "effectiveStart",
          "effectiveEnd"
        FROM overlapping
        WHERE "effectiveEnd" > "effectiveStart"
      ),
      ordered AS (
        SELECT
          "effectiveStart",
          "effectiveEnd",
          MAX("effectiveEnd") OVER (
            ORDER BY "effectiveStart", "effectiveEnd"
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS "prevMaxEnd"
        FROM clamped
      ),
      grouped AS (
        SELECT
          "effectiveStart",
          "effectiveEnd",
          SUM(
            CASE
              WHEN "prevMaxEnd" IS NULL OR "effectiveStart" > "prevMaxEnd" THEN 1
              ELSE 0
            END
          ) OVER (ORDER BY "effectiveStart", "effectiveEnd") AS "groupId"
        FROM ordered
      ),
      merged AS (
        SELECT
          MIN("effectiveStart") AS "mergedStart",
          MAX("effectiveEnd") AS "mergedEnd"
        FROM grouped
        GROUP BY "groupId"
      )
      SELECT
        (SELECT COUNT(*)::int FROM clamped) AS "totalIncidents",
        COALESCE(SUM(EXTRACT(EPOCH FROM ("mergedEnd" - "mergedStart")) * 1000.0), 0)::double precision AS "totalDowntimeMs",
        COALESCE((
          SELECT MAX(EXTRACT(EPOCH FROM (c."effectiveEnd" - c."effectiveStart")) * 1000.0)
          FROM clamped c
        ), 0)::double precision AS "longestDowntimeMs"
      FROM merged
    `;

    const bucketIntervalSql = this.getBucketIntervalSql(range);
    const seriesEndStart = new Date(window.to.getTime() - window.bucketMs);

    const seriesRows = await this.prisma.$queryRaw<SeriesRow[]>`
      WITH buckets AS (
        SELECT generate_series(
          ${window.from}::timestamptz,
          ${seriesEndStart}::timestamptz,
          ${bucketIntervalSql}
        ) AS "bucketStart"
      )
      SELECT
        b."bucketStart" AS "start",
        b."bucketStart" + ${bucketIntervalSql} AS "end",
        COUNT(c.id)::int AS "checkCount",
        COUNT(*) FILTER (WHERE c."success")::int AS "successCount",
        CASE
          WHEN COUNT(c.id) = 0 THEN NULL
          ELSE (COUNT(*) FILTER (WHERE c."success")::double precision / COUNT(c.id)::double precision) * 100.0
        END AS "uptimePercentage",
        AVG(c."responseTimeMs") FILTER (WHERE c."success" AND c."responseTimeMs" IS NOT NULL)::double precision AS "averageResponseTimeMs"
      FROM buckets b
      LEFT JOIN "CheckResult" c
        ON c."monitorId" = ${monitorId}::uuid
       AND c."checkedAt" >= b."bucketStart"
       AND c."checkedAt" < (b."bucketStart" + ${bucketIntervalSql})
      GROUP BY b."bucketStart"
      ORDER BY b."bucketStart" ASC
    `;

    const checks = checksAndLatencyRows[0] ?? {
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
    };

    const incidents = incidentRows[0] ?? {
      totalIncidents: 0,
      totalDowntimeMs: 0,
      longestDowntimeMs: 0,
    };

    return {
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      checks: {
        total: this.toNumber(checks.totalChecks),
        successful: this.toNumber(checks.successfulChecks),
        failed: this.toNumber(checks.failedChecks),
      },
      uptime: {
        percentage: this.toNullableNumber(checks.uptimePercentage),
      },
      latency: {
        averageMs: this.toNullableNumber(checks.averageMs),
        minMs: this.toNullableNumber(checks.minMs),
        maxMs: this.toNullableNumber(checks.maxMs),
        p50Ms: this.toNullableNumber(checks.p50Ms),
        p95Ms: this.toNullableNumber(checks.p95Ms),
        p99Ms: this.toNullableNumber(checks.p99Ms),
      },
      incidents: {
        total: this.toNumber(incidents.totalIncidents),
        totalDowntimeMs: this.toNumber(incidents.totalDowntimeMs),
        longestDowntimeMs: this.toNumber(incidents.longestDowntimeMs),
      },
      series: this.mapSeries(seriesRows),
    };
  }

  async getOverviewForUser(userId: string, range: AnalyticsRange): Promise<AnalyticsOverviewResponse> {
    const now = new Date();
    const window = this.getWindow(range, now);

    const monitors = await this.prisma.monitor.findMany({
      where: { userId },
      select: { id: true, enabled: true, currentStatus: true },
    });

    const openIncidentCount = await this.prisma.incident.count({
      where: {
        resolvedAt: null,
        monitor: {
          userId,
        },
      },
    });

    const uptimeRows = await this.prisma.$queryRaw<AverageUptimeRow[]>`
      WITH monitor_checks AS (
        SELECT
          c."monitorId" AS "monitorId",
          COUNT(*)::int AS "totalChecks",
          COUNT(*) FILTER (WHERE c."success")::int AS "successfulChecks"
        FROM "CheckResult" c
        INNER JOIN "Monitor" m ON m.id = c."monitorId"
        WHERE m."userId" = ${userId}::uuid
          AND c."checkedAt" >= ${window.from}
          AND c."checkedAt" < ${window.to}
        GROUP BY c."monitorId"
      )
      SELECT
        AVG(("successfulChecks"::double precision / "totalChecks"::double precision) * 100.0)::double precision AS "averageUptimePercentage"
      FROM monitor_checks
    `;

    const operationalCount = monitors.filter((monitor) => monitor.enabled && monitor.currentStatus === 'UP').length;
    const outageCount = monitors.filter((monitor) => monitor.enabled && monitor.currentStatus === 'DOWN').length;
    const unknownCount = monitors.length - operationalCount - outageCount;

    return {
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      monitorCount: monitors.length,
      operationalCount,
      outageCount,
      unknownCount,
      averageUptimePercentage: this.toNullableNumber(uptimeRows[0]?.averageUptimePercentage ?? null),
      openIncidentCount,
    };
  }
}
