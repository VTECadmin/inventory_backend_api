import { SetMetadata } from '@nestjs/common';

export type Role = 'admin' | 'manager' | 'employee';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles.
 * Usage: @Roles('admin', 'manager')
 * Requires RolesGuard to be active on the route/controller.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
