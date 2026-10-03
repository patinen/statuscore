import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import {
  CreateManualIncidentDto,
  CreateManualIncidentUpdateDto,
  UpdateManualIncidentDto,
} from './manual-incidents.dto.js';
import { ManualIncidentsService } from './manual-incidents.service.js';

class ManualIncidentStatusPipe {
  transform(value: string | undefined) {
    return value === undefined ? 'all' : value;
  }
}

class ManualIncidentLimitPipe {
  transform(value: string | undefined) {
    return ManualIncidentsService.validateLimit(value ?? '50', 50);
  }
}

@Controller('manual-incidents')
@UseGuards(AuthGuard)
export class ManualIncidentsController {
  constructor(@Inject(ManualIncidentsService) private readonly manualIncidentsService: ManualIncidentsService) {}

  @Get()
  listIncidents(
    @Req() req: Request & { user: SessionUser },
    @Query('status', new DefaultValuePipe('all'), ManualIncidentStatusPipe) status: string,
    @Query('limit', new DefaultValuePipe('50'), ManualIncidentLimitPipe) limit: number,
  ) {
    return this.manualIncidentsService.listForUser(req.user.id, ManualIncidentsService.validateStatus(status), limit);
  }

  @Get(':id')
  getIncident(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.manualIncidentsService.getForUser(req.user.id, id);
  }

  @Post()
  createIncident(@Req() req: Request & { user: SessionUser }, @Body() dto: CreateManualIncidentDto) {
    return this.manualIncidentsService.createForUser(req.user.id, dto);
  }

  @Post(':id/updates')
  createIncidentUpdate(
    @Req() req: Request & { user: SessionUser },
    @Param('id') id: string,
    @Body() dto: CreateManualIncidentUpdateDto,
  ) {
    return this.manualIncidentsService.createUpdateForUser(req.user.id, id, dto);
  }

  @Patch(':id')
  updateIncident(
    @Req() req: Request & { user: SessionUser },
    @Param('id') id: string,
    @Body() dto: UpdateManualIncidentDto,
  ) {
    return this.manualIncidentsService.updateForUser(req.user.id, id, dto);
  }

  @Delete(':id')
  deleteIncident(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.manualIncidentsService.deleteForUser(req.user.id, id);
  }
}
