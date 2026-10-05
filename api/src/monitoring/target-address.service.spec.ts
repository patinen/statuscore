import { describe, expect, it } from 'vitest';
import { TargetAddressService } from './target-address.service.js';

describe('TargetAddressService', () => {
  const service = new TargetAddressService();

  it('accepts and normalizes a public IPv4 address', () => {
    expect(service.isPublicAddress('37.27.8.70')).toBe(true);
    expect(service.isBlockedAddress('37.27.8.70')).toBe(false);
    expect(service.normalizeAddress('37.27.8.70')).toBe('37.27.8.70');
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
  ])('blocks private or loopback address %s', (address) => {
    expect(service.isBlockedAddress(address)).toBe(true);
    expect(service.isPublicAddress(address)).toBe(false);
  });
});
