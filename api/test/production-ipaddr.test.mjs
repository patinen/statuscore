// Run after npm run build. Native Node ESM must execute dist, without Vitest/tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TargetAddressService } from '../dist/monitoring/target-address.service.js';
import { SafeHttpClientService } from '../dist/monitoring/safe-http-client.service.js';
import { TargetUrlValidationService } from '../dist/monitors/ssrf-validation.service.js';
import { NotificationDeliveryService } from '../dist/notifications/notification-delivery.service.js';

const service = new TargetAddressService();

await test('compiled production modules load under native Node ESM', () => {
  for (const constructor of [SafeHttpClientService, TargetUrlValidationService, NotificationDeliveryService]) {
    assert.equal(typeof constructor, 'function');
  }
});

await test('compiled address service accepts and normalizes public IPv4', () => {
  assert.equal(service.isBlockedAddress('37.27.8.70'), false);
  assert.equal(service.isPublicAddress('37.27.8.70'), true);
  assert.equal(service.normalizeAddress('37.27.8.70'), '37.27.8.70');
});

for (const address of [
  '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1',
  '169.254.169.254', '100.64.0.1',
  '192.0.2.1', '198.51.100.1', '203.0.113.1',
  '::1', 'fc00::1', 'fe80::1', '2001:db8::1',
  '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:192.168.1.1',
]) {
  await test(`compiled address service blocks ${address}`, () => {
    assert.equal(service.isBlockedAddress(address), true);
    assert.equal(service.isPublicAddress(address), false);
  });
}

await test('compiled address service normalizes mapped public IPv4', () => {
  assert.equal(service.normalizeAddress('::ffff:37.27.8.70'), '37.27.8.70');
  assert.equal(service.isBlockedAddress('::ffff:37.27.8.70'), false);
});
