/**
 * CurrentUser Decorator
 * Extracts authenticated user from request
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface CurrentUserPayload {
  id: string
  email: string
  fiscalCode?: string
  tenantId: string
  role: string
  permissions: string[]
  /** Presente solo se la sessione e' un'impersonificazione (id del SUPER_ADMIN). */
  impersonatorId?: string
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest()
    return request.user
  }
)
