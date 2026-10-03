import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationDeliveryQueryDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationSecretService } from './notification-secret.service.js';

describe('NotificationsService', () => {
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
