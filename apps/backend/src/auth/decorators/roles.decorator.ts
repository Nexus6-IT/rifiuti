/**
 * Roles Decorator
 * Marks a route as requiring specific roles
 */

import { SetMetadata } from '@nestjs/common'

export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)
