import {
  CanActivate,
  Inject,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = request.cookies?.sc_session;

    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = this.authService.verifySessionToken(token);

    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.user = user;
    return true;
  }
}
