import { Injectable } from '@angular/core'
import { MessageService } from 'primeng/api'

/**
 * Toast Service
 *
 * Wrapper around PrimeNG MessageService for consistent toast notifications.
 * Provides convenient methods for success, error, warning, and info messages.
 *
 * Usage:
 * ```typescript
 * constructor(private toastService: ToastService) {}
 *
 * this.toastService.success('FIR created successfully');
 * this.toastService.error('Failed to sync to RENTRI');
 * this.toastService.warn('FIR deadline approaching');
 * this.toastService.info('New notification received');
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class ToastService {
  constructor(private messageService: MessageService) {}

  /**
   * Show success toast
   */
  success(detail: string, summary: string = 'Success', life: number = 5000): void {
    this.messageService.add({
      severity: 'success',
      summary,
      detail,
      life,
    })
  }

  /**
   * Show error toast
   */
  error(detail: string, summary: string = 'Error', life: number = 5000): void {
    this.messageService.add({
      severity: 'error',
      summary,
      detail,
      life,
    })
  }

  /**
   * Show warning toast
   */
  warn(detail: string, summary: string = 'Warning', life: number = 5000): void {
    this.messageService.add({
      severity: 'warn',
      summary,
      detail,
      life,
    })
  }

  /**
   * Show info toast
   */
  info(detail: string, summary: string = 'Info', life: number = 5000): void {
    this.messageService.add({
      severity: 'info',
      summary,
      detail,
      life,
    })
  }

  /**
   * Show custom toast with all options
   */
  show(options: {
    severity: 'success' | 'error' | 'warn' | 'info'
    summary: string
    detail: string
    life?: number
    sticky?: boolean
  }): void {
    this.messageService.add({
      severity: options.severity,
      summary: options.summary,
      detail: options.detail,
      life: options.life || 5000,
      sticky: options.sticky || false,
    })
  }

  /**
   * Clear all toasts
   */
  clear(): void {
    this.messageService.clear()
  }

  /**
   * Clear specific toast by key
   */
  clearByKey(key: string): void {
    this.messageService.clear(key)
  }
}
