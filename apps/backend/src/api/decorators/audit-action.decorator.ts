import { SetMetadata } from '@nestjs/common';

/**
 * @AuditAction Decorator
 * Marks action for audit logging
 *
 * Usage:
 * @AuditAction('delete_fir')
 * @Delete(':id')
 * async deleteFIR() { ... }
 */
export const AUDIT_ACTION_KEY = 'auditAction';
export const AuditAction = (action: string) =>
  SetMetadata(AUDIT_ACTION_KEY, action);
