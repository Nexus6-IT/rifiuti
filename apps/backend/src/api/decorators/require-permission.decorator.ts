import { SetMetadata } from '@nestjs/common'

/**
 * @RequirePermission Decorator
 * Marks endpoint as requiring specific permission
 * Format: resource:action:scope (e.g., "fir:create:facility")
 *
 * Usage:
 * @RequirePermission('fir:create:all')
 * @Post()
 * async createFIR() { ... }
 */
export const PERMISSION_KEY = 'requiredPermission'
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission)
