import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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
