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
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { CreateNotificationChannelDto, NotificationDeliveryQueryDto, UpdateNotificationChannelDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notification-channels')
  listChannels(@Req() req: Request & { user: SessionUser }) {
    return this.notificationsService.listForUser(req.user.id);
  }

  @Post('notification-channels')
  createChannel(@Req() req: Request & { user: SessionUser }, @Body() dto: CreateNotificationChannelDto) {
    return this.notificationsService.createForUser(req.user.id, dto);
  }

  @Patch('notification-channels/:id')
  updateChannel(@Req() req: Request & { user: SessionUser }, @Param('id') id: string, @Body() dto: UpdateNotificationChannelDto) {
    return this.notificationsService.updateForUser(req.user.id, id, dto);
  }

  @Delete('notification-channels/:id')
  deleteChannel(@Req() req: Request & { user: SessionUser }, @Param('id') id: string) {
    return this.notificationsService.deleteForUser(req.user.id, id);
  }

  @Get('notification-deliveries')
  listDeliveries(
    @Req() req: Request & { user: SessionUser },
    @Query('status') status: string | undefined,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 50;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('limit must be an integer between 1 and 100.');
    }
    return this.notificationsService.listDeliveriesForUser(req.user.id, status, parsedLimit);
  }
}
