import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Role } from './roles.decorator';
import { AuthUser } from './current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read the roles required by @Roles() on the handler or the controller.
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() → no restriction, let it through.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user: AuthUser = context.switchToHttp().getRequest().user;
    if (user && requiredRoles.includes(user.role)) return true;

    throw new ForbiddenException('You do not have access to this resource');
  }
}
