import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class NotificationSecretService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private getKey(): Buffer {
    const rawKey = this.config.get<string>('NOTIFICATION_ENCRYPTION_KEY');

    if (!rawKey) {
      throw new Error('NOTIFICATION_ENCRYPTION_KEY is not configured.');
    }

    const key = Buffer.from(rawKey, 'base64');

    if (key.length !== 32) {
      throw new Error('NOTIFICATION_ENCRYPTION_KEY must decode to 32 bytes (AES-256-GCM).');
    }

    return key;
  }

  encryptEndpoint(value: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decryptEndpoint(value: string): string {
    const parts = value.split(':');

    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Encrypted endpoint is malformed.');
    }

    const [version, ivB64, authTagB64, ciphertextB64] = parts;
    if (!version || !ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Encrypted endpoint is invalid.');
    }

    try {
      const key = this.getKey();
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const ciphertext = Buffer.from(ciphertextB64, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      throw new Error('Encrypted endpoint could not be decrypted.');
    }
  }
}
