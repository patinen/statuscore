import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

@Injectable()
export class AppService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getHealth(): Promise<{ status: string; service: string; database: string }> {
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
