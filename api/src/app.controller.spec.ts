import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('should expose the health endpoint payload', async () => {
    const appController = new AppController();
    const prisma = {
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    appController['prisma'] = prisma as never;

    await expect(appController.getHealth()).resolves.toEqual({
      status: 'ok',
      service: 'statuscore-api',
      database: 'connected',
    });
  });
});
