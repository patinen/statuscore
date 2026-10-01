import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';

export const MONITOR_CHECK_QUEUE = 'monitor-check';

export interface MonitorCheckJobData {
  monitorId: string;
  scheduledFor: string;
}

@Injectable()
export class MonitoringQueueService {
  private readonly logger = new Logger(MonitoringQueueService.name);
  private readonly queue: Queue<MonitorCheckJobData>;

  constructor(@Inject(ConfigService) private readonly config?: ConfigService) {
    const runtimeConfig = this.config ?? new ConfigService();
    const redisUrl = runtimeConfig.get<string>('REDIS_URL', 'redis://localhost:6379');

    this.queue = new Queue<MonitorCheckJobData>(MONITOR_CHECK_QUEUE, {
      connection: { url: redisUrl },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    });
  }

  async enqueueMonitorCheck(monitorId: string, scheduledFor: Date): Promise<void> {
    const scheduledTimestamp = scheduledFor.getTime();
    const jobId = `monitor-check-${monitorId}-${scheduledTimestamp}`;
    const jobOptions: JobsOptions = {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    };

    await this.queue.add('check', { monitorId, scheduledFor: scheduledFor.toISOString() }, jobOptions);
    this.logger.debug(`Queued monitor check for monitor ${monitorId} at ${scheduledFor.toISOString()}`);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
