import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { User } from '@prisma/client';

export type SessionUser = Pick<User, 'id' | 'login' | 'name' | 'avatarUrl'>;

export interface GitHubProfile {
  id: number | string;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private getSessionSecret(): string {
    const secret = this.config.get<string>('AUTH_SESSION_SECRET');

    if (!secret) {
      throw new Error('AUTH_SESSION_SECRET is not configured.');
    }

    return secret;
  }

  generateOAuthState(): string {
    return randomBytes(32).toString('hex');
  }

  setOauthStateCookie(res: Response, state: string): void {
    res.cookie('sc_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction(),
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
  }

  clearOauthStateCookie(res: Response): void {
    res.clearCookie('sc_oauth_state', { path: '/' });
  }

  setSessionCookie(res: Response, user: SessionUser): void {
    const sessionToken = jwt.sign(
      {
        sub: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      this.getSessionSecret(),
      { expiresIn: '7d' },
    );

    res.cookie('sc_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  clearSessionCookie(res: Response): void {
    res.clearCookie('sc_session', { path: '/' });
  }

  verifySessionToken(token: string): SessionUser | null {
    try {
      const payload = jwt.verify(token, this.getSessionSecret()) as JwtPayload & {
        sub?: string;
        login?: string;
        name?: string | null;
        avatarUrl?: string | null;
      };

      if (!payload.sub || typeof payload.sub !== 'string') {
        return null;
      }

      return {
        id: payload.sub,
        login: typeof payload.login === 'string' ? payload.login : '',
        name: typeof payload.name === 'string' ? payload.name : null,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null,
      };
    } catch {
      return null;
    }
  }

  async findOrCreateGitHubUser(profile: GitHubProfile): Promise<User> {
    const githubId = String(profile.id);
    const login = profile.login;
    const name = profile.name ?? login;

    return this.prisma.user.upsert({
      where: { githubId },
      update: {
        login,
        name,
        avatarUrl: profile.avatar_url ?? null,
      },
      create: {
        githubId,
        login,
        name,
        avatarUrl: profile.avatar_url ?? null,
      },
    });
  }
}
