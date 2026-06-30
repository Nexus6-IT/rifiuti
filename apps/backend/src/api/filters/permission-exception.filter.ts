import { ExceptionFilter, Catch, ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common'
import { Response } from 'express'

/**
 * PermissionExceptionFilter
 * Custom exception filter for permission-related errors
 * Per spec.md FR-009: Contextual error messages for permission denials
 *
 * Provides user-friendly error messages with:
 * - Current role
 * - Required permission
 * - Suggested actions (contact admin)
 */
@Catch(ForbiddenException)
export class PermissionExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PermissionExceptionFilter.name)

  catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    // Check if this is a structured permission error
    const isStructuredError =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'requiredPermission' in exceptionResponse

    if (isStructuredError) {
      // Structured permission denial with context
      const errorDetails = exceptionResponse as any

      this.logger.warn(
        `Permission denied: user=${request.user?.userId}, ` +
          `permission=${errorDetails.requiredPermission}, ` +
          `currentRole=${errorDetails.currentRole}, ` +
          `path=${request.url}`
      )

      response.status(status).json({
        statusCode: status,
        error: 'Forbidden',
        message: errorDetails.message || 'Insufficient permissions',
        details: {
          requiredPermission: errorDetails.requiredPermission,
          currentRole: errorDetails.currentRole,
          resource: this.extractResourceFromPermission(errorDetails.requiredPermission),
          action: this.extractActionFromPermission(errorDetails.requiredPermission),
          scope: this.extractScopeFromPermission(errorDetails.requiredPermission),
        },
        userGuidance: {
          message: errorDetails.contactAdmin || 'Contact your administrator to request access',
          supportEmail: 'support@wasteflow.it',
          learnMoreUrl: '/docs/permissions',
        },
        timestamp: new Date().toISOString(),
        path: request.url,
      })
    } else {
      // Generic forbidden error
      this.logger.warn(`Generic forbidden error: user=${request.user?.userId}, path=${request.url}`)

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || 'Forbidden'

      response.status(status).json({
        statusCode: status,
        error: 'Forbidden',
        message,
        userGuidance: {
          message: 'You do not have permission to perform this action',
          supportEmail: 'support@wasteflow.it',
        },
        timestamp: new Date().toISOString(),
        path: request.url,
      })
    }
  }

  /**
   * Extract resource from permission string
   * Example: "fir:create:facility" -> "fir"
   */
  private extractResourceFromPermission(permission: string): string {
    const parts = permission.split(':')
    return parts[0] || 'unknown'
  }

  /**
   * Extract action from permission string
   * Example: "fir:create:facility" -> "create"
   */
  private extractActionFromPermission(permission: string): string {
    const parts = permission.split(':')
    return parts[1] || 'unknown'
  }

  /**
   * Extract scope from permission string
   * Example: "fir:create:facility" -> "facility"
   */
  private extractScopeFromPermission(permission: string): string {
    const parts = permission.split(':')
    return parts[2] || 'unknown'
  }
}
