import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';
import { isIP } from 'node:net';
import { DnsResolverService } from './dns-resolver.service.js';
import { TargetAddressService } from '../monitoring/target-address.service.js';

@Injectable()
export class TargetUrlValidationService {
  constructor(
    @Inject(DnsResolverService) private readonly dnsResolver: DnsResolverService,
    @Inject(TargetAddressService) private readonly targetAddressService: TargetAddressService = new TargetAddressService(),
  ) {}

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

    if (this.isLocalhostReference(hostname)) {
      throw new BadRequestException('Localhost and internal network targets are not allowed.');
    }

    if (isIP(hostname)) {
      if (this.targetAddressService.isBlockedAddress(hostname)) {
        throw new BadRequestException('Only public routable IP addresses are allowed as targets.');
      }

      return url.toString();
    }

    const resolver = this.dnsResolver ?? ({ lookup: async () => [] as Array<{ address: string }> } as DnsResolverService);
    const lookups = await resolver.lookup(url.hostname, { all: true, verbatim: true }).catch(() => [] as Array<{ address: string }>);

    if (lookups.length === 0) {
      throw new BadRequestException('Target hostname could not be resolved to a usable public IP address.');
    }

    for (const entry of lookups) {
      if (this.targetAddressService.isBlockedAddress(entry.address)) {
        throw new BadRequestException('Target hostname resolves to a blocked internal or local address.');
      }
    }

    return url.toString();
  }

  private isLocalhostReference(hostname: string): boolean {
    const normalized = hostname.toLowerCase();

    if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
      return true;
    }

    if (normalized === '::1' || normalized === '[::1]') {
      return true;
    }

    if (isIP(normalized)) {
      try {
        const parsed = ipaddr.parse(normalized);

        if (parsed.kind() === 'ipv4') {
          const ipv4 = parsed as ipaddr.IPv4;
          return Boolean(ipv4.match(ipaddr.parseCIDR('127.0.0.0/8')));
        }

        if (parsed.kind() === 'ipv6') {
          const ipv6 = parsed as ipaddr.IPv6;
          return Boolean(ipv6.match(ipaddr.parseCIDR('::1/128')));
        }
      } catch {
        return false;
      }
    }

    return false;
  }
}
