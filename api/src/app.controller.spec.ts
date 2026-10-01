import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  it('should expose the health endpoint payload', async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealth: vi.fn().mockResolvedValue({
              status: 'ok',
              service: 'statuscore-api',
              database: 'connected',
            }),
          },
        },
      ],
    }).compile();

    const controller = app.get(AppController);

    await expect(controller.getHealth()).resolves.toEqual({
      status: 'ok',
      service: 'statuscore-api',
      database: 'connected',
    });
  });
});
