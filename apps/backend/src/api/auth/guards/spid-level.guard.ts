import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const SPID_LEVEL_KEY = 'spidLevel';

@Injectable()
export class SpidLevelGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredLevel = this.reflector.get<number>(SPID_LEVEL_KEY, context.getHandler());
    if (!requiredLevel) {
      return true; // No SPID level required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.spidLevel) {
      throw new ForbiddenException('SPID authentication required');
    }

    if (user.spidLevel < requiredLevel) {
      throw new ForbiddenException(`SPID level ${requiredLevel} required, current level: ${user.spidLevel}`);
    }

    return true;
  }
}
