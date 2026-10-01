import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';
import { CreateMonitorDto, UpdateMonitorDto } from './monitors.dto.js';

describe('CreateMonitorDto validation', () => {
  it('accepts the Phase 2 defaults and valid public URL values', async () => {
    const dto = plainToInstance(CreateMonitorDto, {
      name: ' StatusCore API ',
      url: 'https://api.github.com',
      method: 'GET',
      expectedStatusCode: 200,
      intervalSeconds: 60,
      timeoutMs: 10000,
      failureThreshold: 3,
      enabled: true,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('StatusCore API');
  });

  it('rejects unsupported HTTP methods', async () => {
    const dto = plainToInstance(CreateMonitorDto, {
      name: 'API',
      url: 'https://example.com',
      method: 'POST',
      expectedStatusCode: 200,
      intervalSeconds: 60,
      timeoutMs: 10000,
      failureThreshold: 3,
      enabled: true,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'method')).toBe(true);
  });

  it('enforces the configured min/max ranges for monitor fields', async () => {
    const dto = plainToInstance(CreateMonitorDto, {
      name: 'x'.repeat(101),
      url: 'https://example.com',
      method: 'HEAD',
      expectedStatusCode: 99,
      intervalSeconds: 30,
      timeoutMs: 500,
      failureThreshold: 11,
      enabled: true,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-http and overlength URLs', async () => {
    const invalidUrl = plainToInstance(CreateMonitorDto, {
      name: 'API',
      url: 'ftp://example.com',
      method: 'GET',
      expectedStatusCode: 200,
      intervalSeconds: 60,
      timeoutMs: 10000,
      failureThreshold: 3,
      enabled: true,
    });

    const longUrl = plainToInstance(CreateMonitorDto, {
      name: 'API',
      url: `https://example.com/${'a'.repeat(2049)}`,
      method: 'GET',
      expectedStatusCode: 200,
      intervalSeconds: 60,
      timeoutMs: 10000,
      failureThreshold: 3,
      enabled: true,
    });

    const invalidUrlErrors = await validate(invalidUrl);
    const longUrlErrors = await validate(longUrl);

    expect(invalidUrlErrors.some((error) => error.property === 'url')).toBe(true);
    expect(longUrlErrors.some((error) => error.property === 'url')).toBe(true);
  });
});

describe('UpdateMonitorDto validation', () => {
  it('accepts GET and HEAD update values', async () => {
    const dto = plainToInstance(UpdateMonitorDto, { method: 'HEAD', enabled: false });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
