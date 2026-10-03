import { Body, Controller, Delete, Get, Header, Inject, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { CreateStatusPageDto, UpdateStatusPageDto } from './status-pages.dto.js';
import { StatusPagesService } from './status-pages.service.js';

@Controller('status-pages')
@UseGuards(AuthGuard)
export class StatusPagesController {
  constructor(@Inject(StatusPagesService) private readonly statusPagesService: StatusPagesService) {}

  @Get()
  listStatusPages(@Req() req: Request & { user: SessionUser }) {
    return this.statusPagesService.listForUser(req.user.id);
  }

  @Get(':id')
  getStatusPage(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.statusPagesService.getForUser(req.user.id, id);
  }

  @Post()
  createStatusPage(@Req() req: Request & { user: SessionUser }, @Body() dto: CreateStatusPageDto) {
    return this.statusPagesService.createForUser(req.user.id, dto);
  }

  @Patch(':id')
  updateStatusPage(@Req() req: Request & { user: SessionUser }, @Param('id') id: string, @Body() dto: UpdateStatusPageDto) {
    return this.statusPagesService.updateForUser(req.user.id, id, dto);
  }

  @Delete(':id')
  deleteStatusPage(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.statusPagesService.deleteForUser(req.user.id, id);
  }
}

@Controller('public/status-pages')
export class PublicStatusPagesController {
  constructor(@Inject(StatusPagesService) private readonly statusPagesService: StatusPagesService) {}

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
  async getPublicStatusPage(@Param('slug') slug: string) {
    const page = await this.statusPagesService.getPublicBySlug(slug);
    if (!page) {
      throw new NotFoundException('Status page not found.');
    }

    return page;
  }
}