import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { CreateMaintenanceWindowDto, UpdateMaintenanceWindowDto } from './maintenance-windows.dto.js';
import { MaintenanceWindowsService } from './maintenance-windows.service.js';

@Controller('maintenance-windows')
@UseGuards(AuthGuard)
export class MaintenanceWindowsController {
  constructor(@Inject(MaintenanceWindowsService) private readonly maintenanceWindowsService: MaintenanceWindowsService) {}

  @Get()
  listWindows(@Req() req: Request & { user: SessionUser }) {
    return this.maintenanceWindowsService.listForUser(req.user.id);
  }

  @Get(':id')
  getWindow(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.maintenanceWindowsService.getForUser(req.user.id, id);
  }

  @Post()
  createWindow(@Req() req: Request & { user: SessionUser }, @Body() dto: CreateMaintenanceWindowDto) {
    return this.maintenanceWindowsService.createForUser(req.user.id, dto);
  }

  @Patch(':id')
  updateWindow(
    @Req() req: Request & { user: SessionUser },
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceWindowDto,
  ) {
    return this.maintenanceWindowsService.updateForUser(req.user.id, id, dto);
  }

  @Delete(':id')
  deleteWindow(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.maintenanceWindowsService.deleteForUser(req.user.id, id);
  }
}
