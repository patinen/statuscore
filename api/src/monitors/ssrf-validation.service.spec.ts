import { describe, expect, it, vi } from 'vitest';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

describe('TargetUrlValidationService', () => {
  it('rejects localhost targets', async () => {
    const service = new TargetUrlValidationService();

    await expect(service.validateAndNormalize('http://localhost:3000')).rejects.toThrow(
      'Localhost and internal network targets are not allowed.',
    );
  });

  it('rejects private resolved addresses', async () => {
    const service = new TargetUrlValidationService(
      vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]),
    );

    await expect(service.validateAndNormalize('https://example.com')).rejects.toThrow(
      'Target URL resolves to a blocked internal or local address.',
    );
  });

  it('accepts public target URLs', async () => {
    const service = new TargetUrlValidationService(
      vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
    );

    await expect(service.validateAndNormalize('https://example.com/health?ok=1')).resolves.toBe(
      'https://example.com/health?ok=1',
    );
  });
});
