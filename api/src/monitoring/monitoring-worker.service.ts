import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { MONITOR_CHECK_QUEUE, type MonitorCheckJobData } from './monitoring-queue.service.js';
import { MonitorExecutionService } from './monitoring-execution.service.js';

@Injectable()
export class MonitoringWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringWorkerService.name);
  private worker: Worker<MonitorCheckJobData> | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MonitorExecutionService) private readonly monitorExecutionService: MonitorExecutionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const concurrency = Number(this.config.get<string>('MONITOR_WORKER_CONCURRENCY', '10') ?? 10);

    this.worker = new Worker<MonitorCheckJobData>(
      MONITOR_CHECK_QUEUE,
      async (job) => {
        await this.monitorExecutionService.processMonitorCheck(job.data.monitorId);
      },
      {
        connection: { url: redisUrl },
        concurrency,
      },
    );

    this.logger.log(`Monitoring worker started with concurrency ${concurrency}.`);
    this.worker.on('error', (error) => {
      this.logger.error(`Monitoring worker error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Monitoring worker closed.');
    }
  }
}
