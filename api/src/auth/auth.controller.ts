import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('github')
  githubLogin(@Res() res: Response) {
    const state = this.authService.generateOAuthState();
    this.authService.setOauthStateCookie(res, state);

    const clientId = this.config.get<string>('GITHUB_CLIENT_ID');
    const callbackUrl = this.config.get<string>('GITHUB_CALLBACK_URL') ?? 'http://localhost:3001/auth/github/callback';

    if (!clientId) {
      throw new Error('GITHUB_CLIENT_ID is not configured.');
    }

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'read:user user:email');

    return res.redirect(url.toString());
  }

  @Get('github/callback')
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const stateCookie = req.cookies?.sc_oauth_state;
    const stateParam = req.query.state;
    const code = req.query.code;
    const stateValue = Array.isArray(stateParam) ? stateParam[0] ?? '' : typeof stateParam === 'string' ? stateParam : '';

    if (!stateCookie || !stateValue || String(stateCookie) !== stateValue) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    if (typeof code !== 'string' || !code.trim()) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    const clientId = this.config.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.config.get<string>('GITHUB_CLIENT_SECRET');
    const callbackUrl = this.config.get<string>('GITHUB_CALLBACK_URL') ?? 'http://localhost:3001/auth/github/callback';

    if (!clientId || !clientSecret) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'StatusCore',
      },
    });

    if (!profileResponse.ok) {
      this.authService.clearOauthStateCookie(res);
      return res.redirect(`${this.config.get<string>('WEB_URL') ?? 'http://localhost:3000'}?auth=error`);
    }

    const profile = (await profileResponse.json()) as {
      id: number | string;
      login: string;
      name?: string | null;
      avatar_url?: string | null;
    };

    const user = await this.authService.findOrCreateGitHubUser(profile);
    this.authService.setSessionCookie(res, user);
    this.authService.clearOauthStateCookie(res);

    return res.redirect(this.config.get<string>('WEB_URL') ?? 'http://localhost:3000');
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@Req() req: Request) {
    const sessionCookie = req.cookies?.sc_session;

    if (!sessionCookie || typeof sessionCookie !== 'string') {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = this.authService.verifySessionToken(sessionCookie);

    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    const localUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        login: true,
        name: true,
        avatarUrl: true,
        githubId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!localUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    return localUser;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logout(@Res() res: Response) {
    this.authService.clearSessionCookie(res);
    return res.send();
  }
}
