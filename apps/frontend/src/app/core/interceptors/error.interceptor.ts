import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http'
import { inject } from '@angular/core'
import { throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { MessageService } from 'primeng/api'

/**
 * Error Interceptor
 *
 * Catches HTTP errors and displays user-friendly messages via PrimeNG toast.
 * Handles different error types with appropriate UI feedback.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const messageService = inject(MessageService)

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'An unexpected error occurred'
      let severity: 'error' | 'warn' = 'error'

      if (error.error instanceof ErrorEvent) {
        errorMessage = `Client Error: ${error.error.message}`
      } else {
        switch (error.status) {
          case 400:
            errorMessage = 'Invalid request. Please check your input.'
            severity = 'warn'
            if (error.error?.message) {
              errorMessage = error.error.message
            }
            break
          case 401:
            errorMessage = 'Authentication required. Please log in.'
            break
          case 403:
            errorMessage = 'You do not have permission to perform this action.'
            break
          case 404:
            errorMessage = 'The requested resource was not found.'
            severity = 'warn'
            break
          case 409:
            errorMessage = 'Conflict detected. The resource may have been modified.'
            severity = 'warn'
            break
          case 422:
            errorMessage = 'Validation failed. Please check your input.'
            severity = 'warn'
            break
          case 429:
            errorMessage = 'Too many requests. Please try again later.'
            severity = 'warn'
            break
          case 500:
            errorMessage = 'Server error. Please try again later.'
            break
          case 503:
            errorMessage = 'Service temporarily unavailable. Please try again later.'
            break
          default:
            if (error.error?.message) {
              errorMessage = error.error.message
            }
        }
      }

      messageService.add({
        severity: severity,
        summary: severity === 'error' ? 'Error' : 'Warning',
        detail: errorMessage,
        life: 5000,
      })

      return throwError(() => error)
    })
  )
}
