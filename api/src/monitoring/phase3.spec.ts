import { BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { MonitorExecutionService } from './monitoring-execution.service.js';
import { MonitoringSchedulerService } from './monitoring-scheduler.service.js';
import { SafeHttpClientService } from './safe-http-client.service.js';
import { TargetAddressService } from './target-address.service.js';

const { httpRequestMock, httpsRequestMock } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  httpsRequestMock: vi.fn(),
}));

vi.mock('node:http', () => ({ request: httpRequestMock }));
vi.mock('node:https', () => ({ request: httpsRequestMock }));

function makeResponse(statusCode: number, headers: Record<string, string> = {}) {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number | undefined;
    headers: Record<string, string>;
    resume: () => void;
    destroy: () => void;
  };

  response.statusCode = statusCode;
  response.headers = headers;
  response.resume = vi.fn();
  response.destroy = vi.fn();

  return response;
}

function createRequestHarness(options: { statusCode?: number; headers?: Record<string, string>; error?: Error; timeout?: boolean }) {
  return (_requestOptions: unknown, callback: (response: EventEmitter) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
    };

    req.end = vi.fn(() => {
      if (options.timeout) {
        queueMicrotask(() => req.emit('timeout'));
        return;
      }

      if (options.error) {
        queueMicrotask(() => req.emit('error', options.error));
        return;
      }

      queueMicrotask(() => callback(makeResponse(options.statusCode ?? 200, options.headers ?? {})));
    });

    req.destroy = vi.fn((destroyError?: Error) => {
      req.emit('error', destroyError ?? new Error('Unexpected connection error'));
    });

    return req;
  };
}

describe('SafeHttpClientService redirects and networking', () => {
  let service: SafeHttpClientService;
  let dnsResolver: Pick<DnsResolverService, 'lookup'>;
  let targetAddressService: Pick<TargetAddressService, 'isBlockedAddress' | 'normalizeAddress'>;

  beforeEach(() => {
    httpRequestMock.mockReset();
    httpsRequestMock.mockReset();

    dnsResolver = {
      lookup: vi.fn(async (hostname: string) => {
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
          return [{ address: '127.0.0.1' }];
        }
        return [{ address: '93.184.216.34' }];
      }),
    };

    targetAddressService = {
      isBlockedAddress: vi.fn((address: string) => address.startsWith('127.') || address.startsWith('10.')),
      normalizeAddress: vi.fn((address: string) => address),
    };

    service = new SafeHttpClientService(
      { validateAndNormalize: vi.fn(async (url: string) => url) } as never,
      dnsResolver as never,
      targetAddressService as never,
    );
  });

  it('redirect depth terminates after 5 redirects', async () => {
    const validate = vi.fn(async (url: string) => url);
    service = new SafeHttpClientService({ validateAndNormalize: validate } as never, dnsResolver as never, targetAddressService as never);

    httpsRequestMock.mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-2' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-3' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-4' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-5' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-6' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/redirect-7' } }));

    const result = await service.executeCheck({
      url: 'https://example.com/redirect-1',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('TOO_MANY_REDIRECTS');
    expect(httpsRequestMock).toHaveBeenCalledTimes(6);
  });

  it('redirect loop terminates', async () => {
    const validate = vi.fn(async (url: string) => url);
    service = new SafeHttpClientService({ validateAndNormalize: validate } as never, dnsResolver as never, targetAddressService as never);

    httpsRequestMock.mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/loop-a' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/loop-b' } }))
      .mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://example.com/loop-a' } }));

    const result = await service.executeCheck({
      url: 'https://example.com/start',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('TOO_MANY_REDIRECTS');
  });

  it('redirect to private address is blocked', async () => {
    const validate = vi.fn(async (url: string) => {
      if (url.includes('private')) {
        throw new BadRequestException('Target hostname resolves to a blocked internal or local address.');
      }
      return url;
    });

    service = new SafeHttpClientService({ validateAndNormalize: validate } as never, dnsResolver as never, targetAddressService as never);
    httpsRequestMock.mockImplementationOnce(createRequestHarness({ statusCode: 301, headers: { location: 'https://private.example.com/blocked' } }));

    const result = await service.executeCheck({
      url: 'https://example.com/start',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('INVALID_TARGET');
  });

  it('DNS failure returns DNS_ERROR', async () => {
    dnsResolver.lookup = vi.fn(async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    });

    service = new SafeHttpClientService(
      { validateAndNormalize: vi.fn(async (url: string) => url) } as never,
      dnsResolver as never,
      targetAddressService as never,
    );

    const result = await service.executeCheck({
      url: 'https://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('DNS_ERROR');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('ECONNRESET returns CONNECTION_ERROR', async () => {
    httpsRequestMock.mockImplementationOnce(createRequestHarness({ error: Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }) }));

    const result = await service.executeCheck({
      url: 'https://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('CONNECTION_ERROR');
  });

  it('timeout returns TIMEOUT', async () => {
    httpsRequestMock.mockImplementationOnce(createRequestHarness({ timeout: true }));

    const result = await service.executeCheck({
      url: 'https://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 100,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('TIMEOUT');
  });

  it('unexpected HTTP status returns UNEXPECTED_STATUS', async () => {
    httpsRequestMock.mockImplementationOnce(createRequestHarness({ statusCode: 500 }));

    const result = await service.executeCheck({
      url: 'https://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('UNEXPECTED_STATUS');
  });

  it('successful check returns success', async () => {
    httpsRequestMock.mockImplementationOnce(createRequestHarness({ statusCode: 200 }));

    const result = await service.executeCheck({
      url: 'https://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      timeoutMs: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.errorType).toBeNull();
  });
});

describe('MonitorExecutionService state transitions', () => {
  it('failure threshold transitions monitor to DOWN', async () => {
    const tx = {
      checkResult: { create: vi.fn().mockResolvedValue(undefined) },
      monitor: { update: vi.fn().mockResolvedValue(undefined) },
    };

    const prisma = {
      monitor: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm1',
          enabled: true,
          currentStatus: 'UP',
          consecutiveFailures: 2,
          failureThreshold: 3,
          url: 'https://example.com',
          method: 'GET',
          expectedStatusCode: 200,
          timeoutMs: 1000,
        }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const service = new MonitorExecutionService(prisma as never, {
      executeCheck: vi.fn().mockResolvedValue({
        success: false,
        statusCode: 500,
        responseTimeMs: 10,
        errorType: 'UNEXPECTED_STATUS',
        errorMessage: 'Unexpected status code 500.',
      }),
    } as never);

    await service.processMonitorCheck('m1');

    expect(tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentStatus: 'DOWN',
          consecutiveFailures: 3,
        }),
      }),
    );
  });

  it('success resets consecutiveFailures', async () => {
    const tx = {
      checkResult: { create: vi.fn().mockResolvedValue(undefined) },
      monitor: { update: vi.fn().mockResolvedValue(undefined) },
    };

    const prisma = {
      monitor: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'm1',
          enabled: true,
          currentStatus: 'UP',
          consecutiveFailures: 4,
          failureThreshold: 3,
          url: 'https://example.com',
          method: 'GET',
          expectedStatusCode: 200,
          timeoutMs: 1000,
        }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const service = new MonitorExecutionService(prisma as never, {
      executeCheck: vi.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        responseTimeMs: 10,
        errorType: null,
        errorMessage: null,
      }),
    } as never);

    await service.processMonitorCheck('m1');

    expect(tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentStatus: 'UP',
          consecutiveFailures: 0,
        }),
      }),
    );
  });
});

describe('MonitoringSchedulerService', () => {
  it('scheduler does not claim the same due execution twice', async () => {
    const monitor = {
      id: 'm1',
      enabled: true,
      intervalSeconds: 60,
      nextCheckAt: new Date(Date.now() - 1000),
    };

    const prisma = {
      monitor: {
        findMany: vi.fn().mockResolvedValue([monitor]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };

    const service = new MonitoringSchedulerService(prisma as never, {
      enqueueMonitorCheck: vi.fn().mockResolvedValue(undefined),
    } as never);

    await service.runDueChecks();

    expect(prisma.monitor.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.monitor.update).not.toHaveBeenCalled();
  });
});
