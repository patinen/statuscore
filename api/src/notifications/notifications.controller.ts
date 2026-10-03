import {
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
  UsePipes,
  ValidationPipe,
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
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: 400,
    }),
  )
  listDeliveries(
    @Req() req: Request & { user: SessionUser },
    @Query() query: NotificationDeliveryQueryDto,
  ) {
    const status = query.status ?? 'all';
    const limit = query.limit ?? 50;
    return this.notificationsService.listDeliveriesForUser(req.user.id, status, limit);
  }
}
