import { BadRequestException, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { DnsResolverService } from './dns-resolver.service.js';

@Injectable()
export class TargetUrlValidationService {
  constructor(private readonly dnsResolver: DnsResolverService) {}

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

    const hostname = url.hostname.replace(/^\[|\]$/g, '');

    if (this.isBlockedAddress(hostname) || this.isLocalhostReference(hostname)) {
      throw new BadRequestException('Localhost and internal network targets are not allowed.');
    }

    // Future monitoring workers must re-resolve and revalidate the target immediately before
    // every outbound request and every redirect to defend against DNS rebinding attacks.
    const lookups = await this.dnsResolver.lookup(url.hostname, { all: true, verbatim: true }).catch(
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

    if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
      return true;
    }

    if (normalized === '::1' || normalized === '[::1]' || normalized === '127.0.0.1') {
      return true;
    }

    if (/^127(?:\.\d{1,3}){0,3}$/.test(normalized)) {
      return true;
    }

    return false;
  }

  private isBlockedAddress(address: string): boolean {
    const normalized = address.trim().toLowerCase();

    if (normalized === '::1' || normalized === '::') {
      return true;
    }

    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    if (normalized.startsWith('fe80:')) {
      return true;
    }

    if (normalized.startsWith('ff')) {
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
    if (normalized.startsWith('0.')) return true;
    if (normalized.startsWith('255.')) return true;
    if (normalized.startsWith('224.')) return true;
    if (normalized.startsWith('239.')) return true;
    if (normalized.startsWith('198.18.') || normalized.startsWith('198.19.')) return true;
    if (normalized.startsWith('203.0.113.')) return true;
    if (normalized.startsWith('172.')) {
      const [, secondPart = ''] = normalized.split('.');
      const second = Number(secondPart);
      if (second >= 16 && second <= 31) return true;
    }

    return false;
  }
}
