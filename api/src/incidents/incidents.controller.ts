import {
  Controller,
  DefaultValuePipe,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { IncidentsService } from './incidents.service.js';

class IncidentStatusPipe {
  transform(value: string | undefined) {
    return value === undefined ? 'all' : value;
  }
}

class IncidentLimitPipe {
  transform(value: string | undefined) {
    return IncidentsService.validateLimit(value ?? '50', 50);
  }
}

@Controller('incidents')
@UseGuards(AuthGuard)
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  listIncidents(
    @Req() req: Request & { user: SessionUser },
    @Query('status', new DefaultValuePipe('all'), IncidentStatusPipe) status: string,
    @Query('limit', new DefaultValuePipe('50'), IncidentLimitPipe) limit: number,
  ) {
    return this.incidentsService.listForUser(req.user.id, IncidentsService.validateStatus(status), limit);
  }
}
