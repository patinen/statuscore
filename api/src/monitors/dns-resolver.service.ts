import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';

export interface DnsLookupEntry {
  address: string;
  family?: number;
}

@Injectable()
export class DnsResolverService {
  async lookup(hostname: string, options?: { all?: boolean; verbatim?: boolean }): Promise<DnsLookupEntry[]> {
    return lookup(hostname, options ?? { all: true, verbatim: true }) as Promise<DnsLookupEntry[]>;
  }
}
