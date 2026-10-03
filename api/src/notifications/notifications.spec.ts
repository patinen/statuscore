import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { CreateNotificationChannelDto, NotificationDeliveryQueryDto, UpdateNotificationChannelDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationSecretService } from './notification-secret.service.js';

const createValidationPipe = () =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('NotificationsService', () => {
  it('accepts the create notification channel DTO shape and rejects unsupported create fields', async () => {
    const validCreateDto = Object.assign(new CreateNotificationChannelDto(), {
      name: 'Ops hook',
      type: 'WEBHOOK',
      url: 'https://hooks.example.com/webhook',
      monitorIds: ['monitor-1'],
    });

    await expect(validate(validCreateDto)).resolves.toHaveLength(0);

    await expect(
      createValidationPipe().transform(
        {
          name: 'Ops hook',
          type: 'WEBHOOK',
          url: 'https://hooks.example.com/webhook',
          monitorIds: ['monitor-1'],
          enabled: true,
        },
        { type: 'body', metatype: CreateNotificationChannelDto, data: '' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts the update notification channel DTO shape and rejects type on update', async () => {
    const validUpdateDto = Object.assign(new UpdateNotificationChannelDto(), {
      name: 'Ops hook',
      enabled: false,
      monitorIds: ['monitor-1'],
      url: 'https://hooks.example.com/webhook',
    });

    await expect(validate(validUpdateDto)).resolves.toHaveLength(0);

    const updateWithoutUrl = Object.assign(new UpdateNotificationChannelDto(), {
      name: 'Ops hook',
      enabled: true,
      monitorIds: ['monitor-1'],
    });

    await expect(validate(updateWithoutUrl)).resolves.toHaveLength(0);

    await expect(
      createValidationPipe().transform(
        {
          name: 'Ops hook',
          enabled: false,
          monitorIds: ['monitor-1'],
          type: 'DISCORD',
        },
        { type: 'body', metatype: UpdateNotificationChannelDto, data: '' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unsupported delivery status values and applies the default delivery limit', async () => {
    const prisma = {
      notificationDelivery: {
        findMany: vi.fn(async () => []),
      },
    } as any;

    const service = new NotificationsService(prisma, {
      encryptEndpoint: (value: string) => value,
      decryptEndpoint: (value: string) => value,
    } as never);

    await expect(service.listDeliveriesForUser('user-1', 'invalid', 50)).rejects.toThrow(BadRequestException);
    await expect(service.listDeliveriesForUser('user-1', undefined, undefined as never)).resolves.toEqual([]);
    expect(prisma.notificationDelivery.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        take: 50,
      }),
    );
  });

  it('accepts valid delivery statuses and rejects invalid DTO values', async () => {
    const validStatuses = ['all', 'pending', 'sent', 'failed'] as const;
    for (const status of validStatuses) {
      const dto = Object.assign(new NotificationDeliveryQueryDto(), { status, limit: 10 });
      await expect(validate(dto)).resolves.toHaveLength(0);
    }

    const invalid = Object.assign(new NotificationDeliveryQueryDto(), { status: 'garbage', limit: 10 });
    const errors = await validate(invalid);
    expect(errors.some((error) => error.property === 'status')).toBe(true);

    const zeroLimit = Object.assign(new NotificationDeliveryQueryDto(), { status: 'all', limit: 0 });
    const zeroErrors = await validate(zeroLimit);
    expect(zeroErrors.some((error) => error.property === 'limit')).toBe(true);

    const highLimit = Object.assign(new NotificationDeliveryQueryDto(), { status: 'all', limit: 101 });
    const highErrors = await validate(highLimit);
    expect(highErrors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('creates notification delivery rows with channel metadata for enabled incident channels', async () => {
    const tx = {
      incident: {
        findUnique: vi.fn(async () => ({
          id: 'incident-1',
          monitor: { userId: 'user-1' },
        })),
      },
      notificationChannel: {
        findMany: vi.fn(async () => [
          { id: 'channel-1', userId: 'user-1', name: 'Ops Hook', type: 'WEBHOOK' },
          { id: 'channel-2', userId: 'user-1', name: 'Discord', type: 'DISCORD' },
        ]),
      },
      notificationDelivery: {
        createMany: vi.fn(async () => ({ count: 2 })),
      },
    } as any;

    const service = new NotificationDeliveryService(
      {} as any,
      { decryptEndpoint: (value: string) => value } as any,
      { lookup: vi.fn() } as any,
      { isBlockedAddress: vi.fn(() => false), normalizeAddress: vi.fn((value) => value) } as any,
    );

    await service.createForIncidentTransition(tx, 'incident-1', 'INCIDENT_OPENED', ['channel-1', 'channel-2'], new Date('2026-01-01T00:00:00Z'));

    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-1',
            channelId: 'channel-1',
            channelName: 'Ops Hook',
            channelType: 'WEBHOOK',
            incidentId: 'incident-1',
            status: 'PENDING',
          }),
        ]),
      }),
    );
  });

  it('creates notification channels with a safe serialized response', async () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const prisma = {
      notificationChannel: {
        count: vi.fn(async () => 0),
      },
      monitor: {
        findMany: vi.fn(async () => [{ id: 'monitor-1' }]),
      },
      $transaction: vi.fn(async (callback: any) =>
        callback({
          notificationChannel: {
            create: vi.fn(async ({ data }: any) => ({
              id: 'channel-1',
              createdAt: now,
              updatedAt: now,
              monitorAssociations: [],
              ...data,
            })),
          },
          monitorNotificationChannel: {
            createMany: vi.fn(async () => ({ count: 1 })),
          },
        }),
      ),
    } as any;

    const service = new NotificationsService(
      prisma,
      {
        encryptEndpoint: (value: string) => `enc:${value}`,
        decryptEndpoint: (value: string) => value.replace(/^enc:/, ''),
      } as never,
    );

    const result = await service.createForUser('user-1', {
      name: 'Ops hook',
      type: 'WEBHOOK',
      url: 'https://hooks.example.com/webhook',
      monitorIds: ['monitor-1'],
    });

    expect(result).toMatchObject({
      id: 'channel-1',
      name: 'Ops hook',
      type: 'WEBHOOK',
      enabled: true,
      endpointHost: 'hooks.example.com',
      monitorIds: ['monitor-1'],
    });
    expect(result).not.toHaveProperty('endpointEncrypted');
    expect(result).not.toHaveProperty('url');
  });

  it('keeps the existing endpoint when updating without a replacement URL and replaces it when provided', async () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const existingChannel = {
      id: 'channel-1',
      userId: 'user-1',
      name: 'Ops hook',
      type: 'WEBHOOK',
      endpointEncrypted: 'enc:https://hooks.example.com/original',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      monitorAssociations: [{ monitorId: 'monitor-1' }],
    };

    const update = vi.fn(async ({ data }: any) => ({
      ...existingChannel,
      ...data,
      monitorAssociations: existingChannel.monitorAssociations,
      updatedAt: now,
    }));

    const prisma = {
      notificationChannel: {
        findFirst: vi.fn(async () => existingChannel),
        update,
      },
      monitor: {
        findMany: vi.fn(async () => [{ id: 'monitor-1' }]),
      },
      monitorNotificationChannel: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(async (callback: any) =>
        callback({
          notificationChannel: {
            update,
          },
          monitorNotificationChannel: {
            deleteMany: vi.fn(async () => ({ count: 1 })),
            createMany: vi.fn(async () => ({ count: 1 })),
          },
        }),
      ),
    } as any;

    const service = new NotificationsService(
      prisma,
      {
        encryptEndpoint: (value: string) => `enc:${value}`,
        decryptEndpoint: (value: string) => value.replace(/^enc:/, ''),
      } as never,
    );

    const unchanged = await service.updateForUser('user-1', 'channel-1', {
      name: 'Renamed hook',
      enabled: false,
      monitorIds: ['monitor-1'],
    });

    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'channel-1' },
        data: expect.objectContaining({
          name: 'Renamed hook',
          enabled: false,
        }),
      }),
    );
    expect(update.mock.calls[0][0].data).not.toHaveProperty('endpointEncrypted');
    expect(unchanged).toMatchObject({
      name: 'Renamed hook',
      enabled: false,
      endpointHost: 'hooks.example.com',
      monitorIds: ['monitor-1'],
    });

    update.mockClear();

    const replaced = await service.updateForUser('user-1', 'channel-1', {
      enabled: true,
      url: 'https://hooks.example.com/replaced',
      monitorIds: ['monitor-1'],
    });

    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'channel-1' },
        data: expect.objectContaining({
          endpointEncrypted: 'enc:https://hooks.example.com/replaced',
        }),
      }),
    );
    expect(replaced).toMatchObject({
      enabled: true,
      endpointHost: 'hooks.example.com',
      monitorIds: ['monitor-1'],
    });
  });
});

describe('NotificationSecretService', () => {
  it('encrypts/decrypts round trip with a new IV and verifies authentication', async () => {
    const service = new NotificationSecretService({
      get: (key: string) => {
        if (key === 'NOTIFICATION_ENCRYPTION_KEY') {
          return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        }
        return undefined;
      },
    } as never);

    const original = 'https://discord.com/api/webhooks/123/secret-token';
    const encrypted = service.encryptEndpoint(original);
    const decrypted = service.decryptEndpoint(encrypted);

    expect(decrypted).toBe(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).not.toBe(service.encryptEndpoint(original));
  });

  it('rejects malformed or wrong-key ciphertext', () => {
    const service = new NotificationSecretService({
      get: (key: string) => {
        if (key === 'NOTIFICATION_ENCRYPTION_KEY') {
          return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        }
        return undefined;
      },
    } as never);

    expect(() => service.decryptEndpoint('v1:broken')).toThrow();

    const wrongKeyService = new NotificationSecretService({
      get: (key: string) => {
        if (key === 'NOTIFICATION_ENCRYPTION_KEY') {
          return Buffer.alloc(32, 1).toString('base64');
        }
        return undefined;
      },
    } as never);

    const encrypted = service.encryptEndpoint('https://hooks.example.com/webhook');
    expect(() => wrongKeyService.decryptEndpoint(encrypted)).toThrow();
  });
});
