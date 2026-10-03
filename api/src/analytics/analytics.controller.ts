import { Controller, DefaultValuePipe, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { parseAnalyticsRange, type AnalyticsRange } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

class AnalyticsRangePipe {
  transform(value: string | undefined): AnalyticsRange {
    return parseAnalyticsRange(value);
  }
}

@Controller()
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  @Get('monitors/:id/analytics')
  getMonitorAnalytics(
    @Req() req: Request & { user: SessionUser },
    @Param('id') monitorId: string,
    @Query('range', new DefaultValuePipe('24h'), AnalyticsRangePipe) range: AnalyticsRange,
  ) {
    return this.analyticsService.getMonitorAnalyticsForUser(req.user.id, monitorId, range);
  }

  @Get('analytics/overview')
  getAnalyticsOverview(
    @Req() req: Request & { user: SessionUser },
    @Query('range', new DefaultValuePipe('24h'), AnalyticsRangePipe) range: AnalyticsRange,
  ) {
    return this.analyticsService.getOverviewForUser(req.user.id, range);
  }
}
