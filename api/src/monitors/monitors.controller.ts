import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DefaultValuePipe } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { CreateMonitorDto, UpdateMonitorDto } from './monitors.dto.js';
import { MonitorService } from './monitors.service.js';

class MonitorChecksLimitPipe {
  transform(value: string | undefined) {
    const raw = value ?? '50';
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }

    return parsed;
  }
}

@Controller('monitors')
@UseGuards(AuthGuard)
export class MonitorsController {
  constructor(private readonly monitorsService: MonitorService) {}

  @Get()
  listMonitors(@Req() req: Request & { user: SessionUser }) {
    return this.monitorsService.listForUser(req.user.id);
  }

  @Get(':id')
  getMonitor(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.monitorsService.getForUser(req.user.id, id);
  }

  @Get(':id/checks')
  getMonitorChecks(
    @Req() req: Request & { user: SessionUser },
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe('50'), MonitorChecksLimitPipe) limit: number,
  ) {
    return this.monitorsService.getChecksForUser(req.user.id, id, limit);
  }

  @Post()
  createMonitor(@Req() req: Request & { user: SessionUser }, @Body() dto: CreateMonitorDto) {
    return this.monitorsService.createForUser(req.user, dto);
  }

  @Patch(':id')
  updateMonitor(
    @Req() req: Request & { user: SessionUser },
    @Param('id') id: string,
    @Body() dto: UpdateMonitorDto,
  ) {
    return this.monitorsService.updateForUser(req.user.id, id, dto);
  }

  @Delete(':id')
  deleteMonitor(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.monitorsService.deleteForUser(req.user.id, id);
  }
}
