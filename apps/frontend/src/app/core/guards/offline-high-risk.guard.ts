import { Injectable } from '@angular/core'
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ConnectionMonitorService } from '../services/connection-monitor.service'
import { MessageService } from 'primeng/api'

/**
 * Offline High-Risk Operation Guard
 *
 * Implements spec.md FR-041: Block high-risk operations when offline
 * - Blocks sensitive actions (delete FIR, approve user, digital signature) when offline
 * - Shows clear "Requires internet connection" message
 * - Allows read-only operations offline
 *
 * Usage in routes:
 * {
 *   path: 'fir/:id/delete',
 *   component: DeleteFIRComponent,
 *   canActivate: [OfflineHighRiskGuard]
 * }
 */

@Injectable({
  providedIn: 'root',
})
export class OfflineHighRiskGuard implements CanActivate {
  // List of high-risk operations that require online connection
  // per spec.md FR-041
  private readonly HIGH_RISK_OPERATIONS = [
    'delete',
    'approve',
    'signature',
    'sign',
    'remove',
    'revoke',
    'grant-admin',
  ]

  constructor(
    private connectionMonitor: ConnectionMonitorService,
    private messageService: MessageService
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    return this.connectionMonitor.isOnline$.pipe(
      map(isOnline => {
        // If online, allow all operations
        if (isOnline) {
          return true
        }

        // If offline, check if this is a high-risk operation
        const isHighRisk = this.isHighRiskOperation(state.url, route.data)

        if (isHighRisk) {
          // Block high-risk operation and show message
          this.showOfflineBlockedMessage(route.data['operationName'] || 'Questa operazione')
          return false
        }

        // Allow low-risk operations (read-only) offline
        return true
      })
    )
  }

  /**
   * Determine if the requested operation is high-risk
   * based on URL or route data
   */
  private isHighRiskOperation(url: string, routeData: any): boolean {
    // Check route data for explicit high-risk flag
    if (routeData['requiresOnline'] === true) {
      return true
    }

    // Check URL for high-risk operation keywords
    const urlLower = url.toLowerCase()
    return this.HIGH_RISK_OPERATIONS.some(operation => urlLower.includes(operation))
  }

  /**
   * Show user-friendly message per spec.md FR-041
   */
  private showOfflineBlockedMessage(operationName: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Connessione richiesta',
      detail: `${operationName} richiede una connessione internet attiva. Riprova quando sei online.`,
      sticky: true,
      closable: true,
    })
  }
}

/**
 * Implementation note for T132.5:
 *
 * This guard should be added to routes that perform high-risk operations:
 *
 * Example route configuration:
 * {
 *   path: 'fir/:id/delete',
 *   component: DeleteFIRComponent,
 *   canActivate: [AuthGuard, OfflineHighRiskGuard],
 *   data: { requiresOnline: true, operationName: 'Eliminazione FIR' }
 * }
 *
 * Additionally, update the existing PermissionGuard to integrate offline checks:
 * - Check ConnectionMonitorService.isOnline$
 * - If offline && high-risk operation → block with message
 * - If offline && low-risk operation → allow with cached permissions
 */
