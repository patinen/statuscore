import { describe, expect, it } from 'vitest';
import { DnsResolverService } from './dns-resolver.service.js';
import { TargetUrlValidationService } from './ssrf-validation.service.js';

describe('TargetUrlValidationService', () => {
  const createService = (addresses: string[]) =>
    new TargetUrlValidationService({
      lookup: async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    } as DnsResolverService);

  it.each(['https://example.com', 'https://api.github.com'])('allows %s', async (url) => {
    const service = createService(['93.184.216.34']);
    await expect(service.validateAndNormalize(url)).resolves.toBe(new URL(url).toString());
  });

  it.each([
    'http://localhost',
    'http://foo.localhost',
    'http://127.0.0.1',
    'http://127.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'ftp://example.com',
    'http://user:password@example.com',
  ])('rejects %s', async (url) => {
    const service = createService(['93.184.216.34']);
    await expect(service.validateAndNormalize(url)).rejects.toThrow();
  });

  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '239.255.255.250',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('rejects blocked non-public address range %s', async (address) => {
    const service = createService([address]);
    const url = address.includes(':') ? `http://[${address}]` : `http://${address}`;
    await expect(service.validateAndNormalize(url)).rejects.toThrow();
  });
});
