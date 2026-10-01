import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { AuthService } from './auth.service.js';

describe('AuthService session handling', () => {
  it('verifies valid session tokens and rejects tampered ones', () => {
    const service = new AuthService(
      {
        get: (key: string) => (key === 'NODE_ENV' ? 'development' : key === 'AUTH_SESSION_SECRET' ? 'test-secret' : undefined),
      } as never,
      {} as never,
    );

    const validToken = jwt.sign({ sub: 'user-1', login: 'alice', name: 'Alice', avatarUrl: null }, 'test-secret', {
      expiresIn: '7d',
    });

    expect(service.verifySessionToken(validToken)).toEqual({
      id: 'user-1',
      login: 'alice',
      name: 'Alice',
      avatarUrl: null,
    });
    expect(service.verifySessionToken('not-a-valid-token')).toBeNull();
  });
});
