import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

@Injectable()
export class TargetUrlValidationService {
  constructor(private readonly dnsLookup: typeof lookup = lookup) {}

  async validateAndNormalize(rawUrl: string): Promise<string> {
    const trimmedUrl = rawUrl.trim();

    let url: URL;
    try {
      url = new URL(trimmedUrl);
    } catch {
      throw new BadRequestException('Target URL must be a valid http or https URL.');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only http and https URLs are allowed.');
    }

    if (!url.hostname || url.hostname.length === 0) {
      throw new BadRequestException('Target URL hostname is required.');
    }

    if (url.username || url.password) {
      throw new BadRequestException('Credentials are not allowed in target URLs.');
    }

    if (this.isLocalhostReference(url.hostname)) {
      throw new BadRequestException('Localhost and internal network targets are not allowed.');
    }

    const lookups = await this.dnsLookup(url.hostname, { all: true, verbatim: true }).catch(
      () => [] as Array<{ address: string }>,
    );

    for (const entry of lookups) {
      if (this.isBlockedAddress(entry.address)) {
        throw new BadRequestException('Target URL resolves to a blocked internal or local address.');
      }
    }

    return url.toString();
  }

  private isLocalhostReference(hostname: string): boolean {
    const normalized = hostname.toLowerCase();

    return (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === '127.0.0.1' ||
      normalized === '[::1]' ||
      normalized === '::1'
    );
  }

  private isBlockedAddress(address: string): boolean {
    const normalized = address.trim().toLowerCase();

    if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    if (normalized.startsWith('fe80:')) {
      return true;
    }

    if (normalized.startsWith('::ffff:')) {
      return this.isBlockedAddress(normalized.replace('::ffff:', ''));
    }

    if (!isIP(normalized)) {
      return false;
    }

    if (normalized.startsWith('127.')) return true;
    if (normalized.startsWith('10.')) return true;
    if (normalized.startsWith('192.168.')) return true;
    if (normalized.startsWith('169.254.')) return true;
    if (normalized.startsWith('100.64.')) return true;
    if (normalized.startsWith('172.')) {
      const [, secondPart = ''] = normalized.split('.');
      const second = Number(secondPart);
      if (second >= 16 && second <= 31) return true;
    }
    if (normalized.startsWith('0.')) return true;
    if (normalized.startsWith('255.')) return true;

    return false;
  }
}
