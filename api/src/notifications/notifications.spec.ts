import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ManualIncidentImpact, ManualIncidentStatus } from '@prisma/client';
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

  it('returns manual incident delivery history from snapshots even when source incident rows are missing', async () => {
    const prisma = {
      notificationDelivery: {
        findMany: vi.fn(async () => [
          {
            id: 'delivery-1',
            eventType: 'MANUAL_INCIDENT_RESOLVED',
            status: 'SENT',
            attemptCount: 2,
            occurredAt: new Date('2026-10-04T00:20:00Z'),
            sentAt: new Date('2026-10-04T00:20:10Z'),
            lastAttemptAt: new Date('2026-10-04T00:20:10Z'),
            lastError: null,
            createdAt: new Date('2026-10-04T00:20:00Z'),
            channelId: null,
            channelName: 'Deleted channel snapshot',
            channelType: 'WEBHOOK',
            monitorNamesSnapshot: ['API', 'Website'],
            incidentTitleSnapshot: 'Login outage',
            incidentImpactSnapshot: 'PARTIAL_OUTAGE',
            incidentStatusSnapshot: 'RESOLVED',
            updateMessageSnapshot: 'Fully resolved.',
            incident: null,
          },
        ]),
      },
    } as any;

    const service = new NotificationsService(prisma, {
      encryptEndpoint: (value: string) => value,
      decryptEndpoint: (value: string) => value,
    } as never);

    const rows = await service.listDeliveriesForUser('user-1', 'all', 10);
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'delivery-1',
        eventType: 'MANUAL_INCIDENT_RESOLVED',
        channel: {
          id: null,
          name: 'Deleted channel snapshot',
          type: 'WEBHOOK',
        },
        monitor: null,
        monitors: ['API', 'Website'],
        incident: {
          type: 'manual',
          title: 'Login outage',
          impact: 'PARTIAL_OUTAGE',
          statusSnapshot: 'RESOLVED',
          messageSnapshot: 'Fully resolved.',
        },
      }),
    ]);
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

describe('NotificationDeliveryService manual incident outbox', () => {
  const createDeliveryService = () => {
    const service = new NotificationDeliveryService(
      {} as any,
      { decryptEndpoint: (value: string) => value } as any,
      { lookup: vi.fn() } as any,
      { isBlockedAddress: vi.fn(() => false), normalizeAddress: vi.fn((value) => value) } as any,
    );
    return service;
  };

  it('creates one delivery per channel even when the channel is linked to multiple affected monitors', async () => {
    const service = createDeliveryService();
    const tx = {
      notificationChannel: {
        findMany: vi.fn(async () => [
          { id: 'channel-1', userId: 'user-1', name: 'Discord Ops', type: 'DISCORD' },
        ]),
      },
      notificationDelivery: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    } as any;

    await service.createForManualIncidentUpdate(tx, 'user-1', {
      manualIncidentId: 'mi-1',
      manualIncidentUpdateId: 'upd-1',
      eventType: 'MANUAL_INCIDENT_OPENED',
      title: 'Login outage',
      impact: ManualIncidentImpact.PARTIAL_OUTAGE,
      incidentStatus: ManualIncidentStatus.INVESTIGATING,
      updateStatus: ManualIncidentStatus.INVESTIGATING,
      updateMessage: 'Investigating',
      startedAt: new Date('2026-10-04T00:00:00Z'),
      resolvedAt: null,
      eventTimestamp: new Date('2026-10-04T00:00:00Z'),
      monitorIds: ['m1', 'm2'],
      monitorNames: ['API', 'Website'],
    });

    expect(tx.notificationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          enabled: true,
        }),
      }),
    );
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            manualIncidentId: 'mi-1',
            manualIncidentUpdateId: 'upd-1',
            eventType: 'MANUAL_INCIDENT_OPENED',
            monitorNamesSnapshot: ['API', 'Website'],
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('ignores disabled channels, foreign ownership channels, and still succeeds with no eligible channels', async () => {
    const service = createDeliveryService();

    const noChannelsTx = {
      notificationChannel: { findMany: vi.fn(async () => []) },
      notificationDelivery: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as any;

    await expect(
      service.createForManualIncidentUpdate(noChannelsTx, 'user-1', {
        manualIncidentId: 'mi-1',
        manualIncidentUpdateId: 'upd-1',
        eventType: 'MANUAL_INCIDENT_UPDATED',
        title: 'Login outage',
        impact: ManualIncidentImpact.DEGRADED,
        incidentStatus: ManualIncidentStatus.IDENTIFIED,
        updateStatus: ManualIncidentStatus.IDENTIFIED,
        updateMessage: 'Identified',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        resolvedAt: null,
        eventTimestamp: new Date('2026-10-04T00:10:00Z'),
        monitorIds: ['m1'],
        monitorNames: ['API'],
      }),
    ).resolves.toBeUndefined();
    expect(noChannelsTx.notificationDelivery.createMany).not.toHaveBeenCalled();

    const foreignChannelTx = {
      notificationChannel: {
        findMany: vi.fn(async () => [{ id: 'channel-x', userId: 'user-2', name: 'Foreign', type: 'WEBHOOK' }]),
      },
      notificationDelivery: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as any;

    await service.createForManualIncidentUpdate(foreignChannelTx, 'user-1', {
      manualIncidentId: 'mi-1',
      manualIncidentUpdateId: 'upd-2',
      eventType: 'MANUAL_INCIDENT_UPDATED',
      title: 'Login outage',
      impact: ManualIncidentImpact.DEGRADED,
      incidentStatus: ManualIncidentStatus.MONITORING,
      updateStatus: ManualIncidentStatus.MONITORING,
      updateMessage: 'Monitoring',
      startedAt: new Date('2026-10-04T00:00:00Z'),
      resolvedAt: null,
      eventTimestamp: new Date('2026-10-04T00:15:00Z'),
      monitorIds: ['m1'],
      monitorNames: ['API'],
    });

    expect(foreignChannelTx.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [] }),
    );
  });

  it('uses manualIncidentUpdateId with skipDuplicates to support idempotent retries', async () => {
    const service = createDeliveryService();
    const tx = {
      notificationChannel: {
        findMany: vi.fn(async () => [{ id: 'channel-1', userId: 'user-1', name: 'Ops', type: 'WEBHOOK' }]),
      },
      notificationDelivery: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    } as any;

    const input = {
      manualIncidentId: 'mi-1',
      manualIncidentUpdateId: 'upd-immutable-1',
      eventType: 'MANUAL_INCIDENT_UPDATED' as const,
      title: 'Login outage',
      impact: ManualIncidentImpact.DEGRADED,
      incidentStatus: ManualIncidentStatus.MONITORING,
      updateStatus: ManualIncidentStatus.MONITORING,
      updateMessage: 'Monitoring recovery',
      startedAt: new Date('2026-10-04T00:00:00Z'),
      resolvedAt: null,
      eventTimestamp: new Date('2026-10-04T00:30:00Z'),
      monitorIds: ['m1'],
      monitorNames: ['API'],
    };

    await service.createForManualIncidentUpdate(tx, 'user-1', input);
    await service.createForManualIncidentUpdate(tx, 'user-1', input);

    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            manualIncidentUpdateId: 'upd-immutable-1',
            eventType: 'MANUAL_INCIDENT_UPDATED',
          }),
        ],
      }),
    );
  });

  it('builds manual generic payload with stable deliveryId, safe fields, and no monitor URL or userId leakage', async () => {
    const service = createDeliveryService();

    const payload = (service as any).buildPayload({
      id: 'delivery-1',
      userId: 'user-1',
      eventType: 'MANUAL_INCIDENT_UPDATED',
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: null,
      createdAt: new Date('2026-10-04T00:00:00Z'),
      occurredAt: new Date('2026-10-04T00:10:00Z'),
      incidentTitleSnapshot: 'Login outage',
      incidentImpactSnapshot: ManualIncidentImpact.PARTIAL_OUTAGE,
      incidentStatusSnapshot: ManualIncidentStatus.IDENTIFIED,
      updateMessageSnapshot: 'Investigating elevated authentication errors.',
      monitorNamesSnapshot: ['API', 'Website'],
      payloadSnapshot: {
        event: 'manual_incident.updated',
        incident: {
          type: 'manual',
          title: 'Login outage',
          impact: 'PARTIAL_OUTAGE',
          status: 'IDENTIFIED',
          startedAt: '2026-10-04T00:00:00.000Z',
          resolvedAt: null,
        },
        update: {
          status: 'IDENTIFIED',
          message: 'Investigating elevated authentication errors.',
          createdAt: '2026-10-04T00:10:00.000Z',
        },
        monitors: [{ name: 'API' }, { name: 'Website' }],
      },
      channel: { id: 'ch-1', userId: 'user-1', name: 'Ops', type: 'WEBHOOK', endpointEncrypted: 'x', enabled: true, createdAt: new Date(), updatedAt: new Date() },
      incident: null,
    });

    expect(payload.deliveryId).toBe('delivery-1');
    expect(payload.event).toBe('manual_incident.updated');
    expect(payload).not.toHaveProperty('userId');
    expect((payload as any).monitor?.url).toBeUndefined();
    expect((payload as any).incident.type).toBe('manual');
  });

  it('builds Discord manual incident payloads with safe mention behavior and bounded user text', async () => {
    const service = createDeliveryService();
    const longMessage = 'x'.repeat(5000);
    const payload = {
      event: 'manual_incident.resolved',
      incident: {
        type: 'manual',
        title: 'Login incident',
        impact: 'PARTIAL_OUTAGE',
        status: 'RESOLVED',
        startedAt: '2026-10-04T00:00:00.000Z',
        resolvedAt: '2026-10-04T00:20:00.000Z',
      },
      update: {
        status: 'RESOLVED',
        message: longMessage,
        createdAt: '2026-10-04T00:20:00.000Z',
      },
      monitors: [{ name: 'API' }, { name: 'Website' }],
    };

    const opened = (service as any).buildDiscordPayload('MANUAL_INCIDENT_OPENED', payload, 'delivery-opened');
    const updated = (service as any).buildDiscordPayload('MANUAL_INCIDENT_UPDATED', payload, 'delivery-updated');
    const resolved = (service as any).buildDiscordPayload('MANUAL_INCIDENT_RESOLVED', payload, 'delivery-resolved');

    expect(opened.embeds[0].title).toContain('Incident opened:');
    expect(updated.embeds[0].title).toContain('Incident update:');
    expect(resolved.embeds[0].title).toContain('Incident resolved:');
    expect(resolved.allowed_mentions.parse).toEqual([]);

    const messageField = resolved.embeds[0].fields.find((field: { name: string }) => field.name === 'Resolution');
    expect(String(messageField?.value).length).toBeLessThanOrEqual(1024);
  });

  it('keeps automatic event payload compatibility and event names from the real createForIncidentTransition path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T00:30:00Z'));

    const service = createDeliveryService();

    const openedTx = {
      incident: {
        findUnique: vi.fn(async () => ({
          id: 'inc-opened',
          monitor: {
            id: 'm1',
            userId: 'user-1',
            name: 'API',
            url: 'https://api.example.com',
          },
          startedAt: new Date('2026-10-04T00:00:00Z'),
          resolvedAt: null,
          reason: 'Gateway timeout',
        })),
      },
      notificationChannel: {
        findMany: vi.fn(async () => [
          { id: 'ch-1', userId: 'user-1', name: 'Ops hook', type: 'WEBHOOK' },
        ]),
      },
      notificationDelivery: {
        createMany: vi.fn(async ({ data }: any) => ({ count: data.length })),
      },
    } as any;

    await service.createForIncidentTransition(openedTx, 'inc-opened', 'INCIDENT_OPENED', ['ch-1'], new Date('2026-10-04T00:30:00Z'));
    const openedRow = openedTx.notificationDelivery.createMany.mock.calls[0][0].data[0];

    expect(openedRow).not.toHaveProperty('payloadSnapshot');

    const openedPayload = (service as any).buildPayload({
      ...openedRow,
      id: 'delivery-opened',
      createdAt: new Date('2026-10-04T00:30:00Z'),
      occurredAt: null,
      payloadSnapshot: null,
      incident: {
        id: 'inc-opened',
        monitorId: 'm1',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        resolvedAt: null,
        reason: 'Gateway timeout',
        lastError: null,
        monitor: {
          id: 'm1',
          name: 'API',
          url: 'https://api.example.com',
          userId: 'user-1',
          method: 'GET',
          expectedStatusCode: 200,
          intervalSeconds: 60,
          timeoutMs: 10000,
          failureThreshold: 3,
          enabled: true,
          currentStatus: 'DOWN',
          consecutiveFailures: 3,
          lastCheckedAt: null,
          nextCheckAt: null,
          createdAt: new Date('2026-10-04T00:00:00Z'),
          updatedAt: new Date('2026-10-04T00:00:00Z'),
          user: {
            id: 'user-1',
            githubId: 'gh-1',
            login: 'ops',
            name: null,
            avatarUrl: null,
            createdAt: new Date('2026-10-04T00:00:00Z'),
            updatedAt: new Date('2026-10-04T00:00:00Z'),
          },
        },
      },
    });

    expect(openedPayload).toMatchObject({
      event: 'incident.opened',
      deliveryId: 'delivery-opened',
      occurredAt: '2026-10-04T00:00:00.000Z',
      monitor: {
        id: 'm1',
        name: 'API',
        url: 'https://api.example.com',
        status: 'DOWN',
      },
      incident: {
        id: 'inc-opened',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        resolvedAt: null,
        reason: 'Gateway timeout',
        durationMs: 1800000,
      },
    });

    const resolvedTx = {
      incident: {
        findUnique: vi.fn(async () => ({
          id: 'inc-resolved',
          monitor: {
            id: 'm1',
            userId: 'user-1',
            name: 'API',
            url: 'https://api.example.com',
          },
          startedAt: new Date('2026-10-04T00:00:00Z'),
          resolvedAt: new Date('2026-10-04T00:12:00Z'),
          reason: 'Recovered',
        })),
      },
      notificationChannel: {
        findMany: vi.fn(async () => [
          { id: 'ch-1', userId: 'user-1', name: 'Ops hook', type: 'DISCORD' },
        ]),
      },
      notificationDelivery: {
        createMany: vi.fn(async ({ data }: any) => ({ count: data.length })),
      },
    } as any;

    await service.createForIncidentTransition(resolvedTx, 'inc-resolved', 'INCIDENT_RESOLVED', ['ch-1'], new Date('2026-10-04T00:30:00Z'));
    const resolvedRow = resolvedTx.notificationDelivery.createMany.mock.calls[0][0].data[0];
    const resolvedPayload = (service as any).buildPayload({
      ...resolvedRow,
      id: 'delivery-resolved',
      createdAt: new Date('2026-10-04T00:30:00Z'),
      occurredAt: null,
      payloadSnapshot: null,
      incident: {
        id: 'inc-resolved',
        monitorId: 'm1',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        resolvedAt: new Date('2026-10-04T00:12:00Z'),
        reason: 'Recovered',
        lastError: null,
        monitor: {
          id: 'm1',
          name: 'API',
          url: 'https://api.example.com',
          userId: 'user-1',
          method: 'GET',
          expectedStatusCode: 200,
          intervalSeconds: 60,
          timeoutMs: 10000,
          failureThreshold: 3,
          enabled: true,
          currentStatus: 'UP',
          consecutiveFailures: 0,
          lastCheckedAt: null,
          nextCheckAt: null,
          createdAt: new Date('2026-10-04T00:00:00Z'),
          updatedAt: new Date('2026-10-04T00:12:00Z'),
          user: {
            id: 'user-1',
            githubId: 'gh-1',
            login: 'ops',
            name: null,
            avatarUrl: null,
            createdAt: new Date('2026-10-04T00:00:00Z'),
            updatedAt: new Date('2026-10-04T00:00:00Z'),
          },
        },
      },
    });

    expect(resolvedPayload).toMatchObject({
      event: 'incident.resolved',
      deliveryId: 'delivery-resolved',
      occurredAt: '2026-10-04T00:12:00.000Z',
      monitor: {
        id: 'm1',
        name: 'API',
        url: 'https://api.example.com',
        status: 'UP',
      },
      incident: {
        id: 'inc-resolved',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        resolvedAt: new Date('2026-10-04T00:12:00Z'),
        reason: 'Recovered',
        durationMs: 720000,
      },
    });

    const resolvedDiscord = (service as any).buildDiscordPayload('INCIDENT_RESOLVED', resolvedPayload, 'delivery-resolved');
    expect(resolvedDiscord.embeds[0].fields.find((field: { name: string }) => field.name === 'Duration')?.value).toBe('720000');
    expect(resolvedDiscord.allowed_mentions.parse).toEqual([]);

    vi.useRealTimers();
  });
});
