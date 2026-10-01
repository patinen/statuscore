import { Injectable } from '@nestjs/common';
import * as ipaddr from 'ipaddr.js';

@Injectable()
export class TargetAddressService {
  isBlockedAddress(address: string): boolean {
    const normalized = address.trim();

    if (!normalized) {
      return true;
    }

    try {
      const parsed = ipaddr.parse(normalized);
      return !this.isPublicAddressParsed(parsed);
    } catch {
      return true;
    }
  }

  isPublicAddress(address: string): boolean {
    return !this.isBlockedAddress(address);
  }

  normalizeAddress(address: string): string {
    const parsed = ipaddr.parse(address);

    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        return ipv6.toIPv4Address().toString();
      }
    }

    return parsed.toString();
  }

  private isPublicAddressParsed(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
    if (address.kind() === 'ipv4') {
      return !this.matchesAny(address, [
        '0.0.0.0/8',
        '10.0.0.0/8',
        '100.64.0.0/10',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.0.0.0/24',
        '192.0.2.0/24',
        '192.168.0.0/16',
        '198.18.0.0/15',
        '198.51.100.0/24',
        '203.0.113.0/24',
        '224.0.0.0/4',
        '240.0.0.0/4',
      ]);
    }

    if (address.kind() === 'ipv6') {
      const ipv6 = address as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        const mapped = ipv6.toIPv4Address();
        return this.isPublicAddressParsed(mapped);
      }
    }

    return !this.matchesAny(address, [
      '::/128',
      '::1/128',
      'fc00::/7',
      'fe80::/10',
      'ff00::/8',
      '2001:db8::/32',
    ]);
  }

  private matchesAny(address: ipaddr.IPv4 | ipaddr.IPv6, ranges: string[]): boolean {
    return ranges.some((range) => {
      try {
        return Boolean(address.match(ipaddr.parseCIDR(range)));
      } catch {
        return false;
      }
    });
  }
}
