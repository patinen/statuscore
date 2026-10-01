import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { CreateMonitorDto, UpdateMonitorDto } from './monitors.dto.js';
import { MonitorService } from './monitors.service.js';

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
