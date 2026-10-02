import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('MonitoringWorker');

  logger.log('Monitoring worker application context is running.');

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down monitoring worker.`);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    await app.close();
    logger.log('Monitoring worker shutdown complete.');
    process.exit(0);
  };

  const onSigint = () => {
    void shutdown('SIGINT');
  };

  const onSigterm = () => {
    void shutdown('SIGTERM');
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
}

void bootstrap();
