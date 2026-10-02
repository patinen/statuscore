import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import * as ipaddr from 'ipaddr.js';
import { DnsResolverService } from '../monitors/dns-resolver.service.js';
import { TargetUrlValidationService } from '../monitors/ssrf-validation.service.js';
import { TargetAddressService } from './target-address.service.js';

class DnsResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DnsResolutionError';
  }
}

export type HttpMethod = 'GET' | 'HEAD';

export interface HttpMonitorCheckRequest {
  url: string;
  method: HttpMethod;
  expectedStatusCode: number;
  timeoutMs: number;
}

export interface HttpMonitorCheckResult {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  errorType: string | null;
  errorMessage: string | null;
}

@Injectable()
export class SafeHttpClientService {
  constructor(
    @Inject(TargetUrlValidationService) private readonly targetUrlValidationService: TargetUrlValidationService,
    @Inject(DnsResolverService) private readonly dnsResolver: DnsResolverService,
    @Inject(TargetAddressService) private readonly targetAddressService: TargetAddressService,
  ) {}

  async executeCheck(request: HttpMonitorCheckRequest): Promise<HttpMonitorCheckResult> {
    try {
      const normalizedUrl = await this.targetUrlValidationService.validateAndNormalize(request.url);
      return this.checkResolvedUrl(new URL(normalizedUrl), request.method, request.expectedStatusCode, request.timeoutMs, 0);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return {
          success: false,
          statusCode: null,
          responseTimeMs: 0,
          errorType: 'INVALID_TARGET',
          errorMessage: error.message,
        };
      }

      if (error instanceof DnsResolutionError) {
        return {
          success: false,
          statusCode: null,
          responseTimeMs: 0,
          errorType: 'DNS_ERROR',
          errorMessage: error.message,
        };
      }

      throw error;
    }
  }

  private async checkResolvedUrl(
    parsedUrl: URL,
    method: HttpMethod,
    expectedStatusCode: number,
    timeoutMs: number,
    redirectDepth: number,
  ): Promise<HttpMonitorCheckResult> {
    const selectedAddress = await this.getValidatedAddress(parsedUrl.hostname);
    const requestFactory = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const startedAt = performance.now();

    return new Promise((resolve) => {
      const req = requestFactory(
        {
          protocol: parsedUrl.protocol,
          hostname: selectedAddress,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method,
          timeout: timeoutMs,
          headers: {
            Accept: '*/*',
            'User-Agent': 'StatusCore/1.0',
            Host: parsedUrl.host,
          },
          lookup: (_hostname, _options, callback) => {
            const family = ipaddr.parse(selectedAddress).kind() === 'ipv6' ? 6 : 4;
            callback(null, selectedAddress, family);
          },
          rejectUnauthorized: true,
          servername: parsedUrl.hostname,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const responseTimeMs = Math.max(0, Math.round(performance.now() - startedAt));

          if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
            response.resume();
            response.destroy();

            if (redirectDepth >= 5) {
              resolve({
                success: false,
                statusCode,
                responseTimeMs,
                errorType: 'TOO_MANY_REDIRECTS',
                errorMessage: 'Too many redirects encountered.',
              });
              return;
            }

            const redirectTarget = new URL(String(response.headers.location), parsedUrl).toString();
            void this.executeCheck({
              url: redirectTarget,
              method,
              expectedStatusCode,
              timeoutMs,
            })
              .then((next) => resolve(next))
              .catch(() => {
                resolve({
                  success: false,
                  statusCode,
                  responseTimeMs,
                  errorType: 'INVALID_TARGET',
                  errorMessage: 'Redirect target is invalid or blocked.',
                });
              });
            return;
          }

          response.resume();
          response.destroy();

          const success = statusCode === expectedStatusCode;
          resolve({
            success,
            statusCode,
            responseTimeMs,
            errorType: success ? null : 'UNEXPECTED_STATUS',
            errorMessage: success ? null : `Unexpected status code ${statusCode}.`,
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('TIMEOUT'));
      });

      req.on('error', (error) => {
        const responseTimeMs = Math.max(0, Math.round(performance.now() - startedAt));
        const message = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = error && typeof error === 'object' && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined;
        const errorType = this.classifyError(message, error instanceof Error ? error.name : 'Error', errorCode);

        resolve({
          success: false,
          statusCode: null,
          responseTimeMs,
          errorType,
          errorMessage: this.getSafeErrorMessage(errorType, message),
        });
      });

      req.end();
    });
  }

  private async getValidatedAddress(hostname: string): Promise<string> {
    const normalizedHostname = hostname.replace(/^\[|\]$/g, '');

    if (isIP(normalizedHostname)) {
      if (this.targetAddressService.isBlockedAddress(normalizedHostname)) {
        throw new BadRequestException('Literal IP addresses must be public and routable.');
      }

      return this.targetAddressService.normalizeAddress(normalizedHostname);
    }

    const results = await this.dnsResolver.lookup(normalizedHostname, { all: true, verbatim: true }).catch(() => [] as Array<{ address: string }>);

    if (results.length === 0) {
      throw new DnsResolutionError('DNS lookup failed.');
    }

    const blocked = results.some((entry) => this.targetAddressService.isBlockedAddress(entry.address));

    if (blocked) {
      throw new BadRequestException('Target hostname resolves to a blocked internal or local address.');
    }

    return this.targetAddressService.normalizeAddress(results[0].address);
  }

  private classifyError(message: string, name: string, code?: string): string {
    const safeMessage = message.toUpperCase();

    if (safeMessage.includes('TIMEOUT') || code === 'ETIMEDOUT' || name === 'AbortError') {
      return 'TIMEOUT';
    }

    if (safeMessage.includes('ENOTFOUND') || safeMessage.includes('EAI_AGAIN') || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return 'DNS_ERROR';
    }

    if (safeMessage.includes('CERT') || safeMessage.includes('TLS') || safeMessage.includes('SELF_SIGNED')) {
      return 'TLS_ERROR';
    }

    if (safeMessage.includes('ECONNREFUSED') || safeMessage.includes('ECONNABORTED') || safeMessage.includes('ECONNRESET') || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ECONNABORTED') {
      return 'CONNECTION_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }

  private getSafeErrorMessage(errorType: string, rawMessage: string): string {
    if (errorType === 'TIMEOUT') {
      return 'Request timed out.';
    }

    if (errorType === 'DNS_ERROR') {
      return 'DNS lookup failed.';
    }

    if (errorType === 'TLS_ERROR') {
      return 'TLS verification failed.';
    }

    if (errorType === 'CONNECTION_ERROR') {
      return 'Connection failed.';
    }

    return rawMessage.length > 160 ? `${rawMessage.slice(0, 157)}...` : rawMessage;
  }
}
