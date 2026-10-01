import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

@Controller()
export class AppController {
  private readonly prisma: PrismaService;

  constructor() {
    this.prisma = new PrismaService();
  }

  @Get('health')
  async getHealth() {
    const isDatabaseConnected = await this.prisma.healthCheck();

    if (!isDatabaseConnected) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'statuscore-api',
        database: 'disconnected',
      });
    }

    return {
      status: 'ok',
      service: 'statuscore-api',
      database: 'connected',
    };
  }
}
