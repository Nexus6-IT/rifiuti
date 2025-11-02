import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { PermissionStore } from '../../../core/state/permission.store';
import { RoleStore } from '../../../core/state/role.store';

/**
 * TenantSwitchService
 * Service to handle consultant tenant context switching
 * Per plan.md: Context switch must complete in <2 seconds
 *
 * Responsibilities:
 * - Call backend switch-tenant endpoint
 * - Update JWT token in storage
 * - Invalidate permission and role caches
 * - Update stores with new tenant context
 * - Navigate to appropriate page after switch
 * - Handle errors and rollback on failure
 *
 * T117: Tenant switch service with JWT refresh and state update
 */
@Injectable({
  providedIn: 'root',
})
export class TenantSwitchService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly permissionStore = inject(PermissionStore);
  private readonly roleStore = inject(RoleStore);

  // Current tenant state
  currentTenantId = signal<string | null>(null);
  isSwitching = signal(false);

  constructor() {
    this.initializeCurrentTenant();
  }

  /**
   * Initialize current tenant from JWT
   */
  private initializeCurrentTenant(): void {
    const jwt = this.getJwtToken();
    if (jwt) {
      try {
        const payload = this.parseJwt(jwt);
        this.currentTenantId.set(payload.tenantId);
      } catch (error) {
        console.error('Failed to parse JWT for tenant ID:', error);
      }
    }
  }

  /**
   * Switch to target tenant
   * Per plan.md: Must complete in <2 seconds with JWT regeneration + cache ops
   *
   * @param targetTenantId - Tenant ID to switch to
   * @returns Observable with switch result
   */
  switchTenant(targetTenantId: string): Observable<{
    newJwt: string;
    tenantId: string;
    roleId: string;
    message: string;
  }> {
    const startTime = Date.now();
    this.isSwitching.set(true);

    const sourceTenantId = this.currentTenantId();

    if (!sourceTenantId) {
      this.isSwitching.set(false);
      return throwError(() => new Error('No current tenant context'));
    }

    if (sourceTenantId === targetTenantId) {
      this.isSwitching.set(false);
      return throwError(() => new Error('Already on target tenant'));
    }

    return this.http.post<any>('/api/v1/consultant/switch-tenant', {
      targetTenantId,
    }).pipe(
      tap((response) => {
        // Step 1: Update JWT token
        this.updateJwtToken(response.newJwt);

        // Step 2: Update current tenant state
        this.currentTenantId.set(response.tenantId);

        // Step 3: Clear permission and role stores (will reload with new context)
        this.permissionStore.clearPermissions();
        this.roleStore.clearRoles();

        // Step 4: Log performance
        const duration = Date.now() - startTime;
        console.log(`Tenant switch completed in ${duration}ms`);

        if (duration > 2000) {
          console.warn(`Tenant switch exceeded 2s target: ${duration}ms`);
        }

        this.isSwitching.set(false);
      }),
      catchError((error) => {
        console.error('Tenant switch failed:', error);
        this.isSwitching.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Switch tenant and reload application
   * Use this for complete page refresh after switch
   *
   * @param targetTenantId - Tenant ID to switch to
   */
  switchTenantWithReload(targetTenantId: string): void {
    this.switchTenant(targetTenantId).subscribe({
      next: () => {
        // Reload page to refresh all data with new tenant context
        window.location.reload();
      },
      error: (error) => {
        console.error('Failed to switch tenant:', error);
        // TODO: Show error notification
      },
    });
  }

  /**
   * Switch tenant and navigate to specific route
   * Use this for in-app navigation without full reload
   *
   * @param targetTenantId - Tenant ID to switch to
   * @param navigateTo - Route to navigate to after switch
   */
  switchTenantAndNavigate(targetTenantId: string, navigateTo: string = '/dashboard'): void {
    this.switchTenant(targetTenantId).subscribe({
      next: () => {
        // Navigate to target route
        this.router.navigate([navigateTo]);

        // Reload permissions and roles for new tenant
        this.permissionStore.loadPermissions();
        this.roleStore.loadRoles();
      },
      error: (error) => {
        console.error('Failed to switch tenant:', error);
        // TODO: Show error notification
      },
    });
  }

  /**
   * Get current JWT token from storage
   */
  private getJwtToken(): string | null {
    return localStorage.getItem('jwt') || sessionStorage.getItem('jwt');
  }

  /**
   * Update JWT token in storage
   */
  private updateJwtToken(newJwt: string): void {
    const wasInLocalStorage = localStorage.getItem('jwt') !== null;

    if (wasInLocalStorage) {
      localStorage.setItem('jwt', newJwt);
    } else {
      sessionStorage.setItem('jwt', newJwt);
    }

    // Also update in memory for immediate use
    // This assumes your HTTP interceptor reads from storage
  }

  /**
   * Parse JWT payload
   */
  private parseJwt(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      throw new Error('Failed to parse JWT token');
    }
  }

  /**
   * Check if user is a consultant
   */
  isConsultant(): boolean {
    const jwt = this.getJwtToken();
    if (!jwt) return false;

    try {
      const payload = this.parseJwt(jwt);
      return payload.isConsultant === true || payload.consultantMode === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current tenant ID
   */
  getCurrentTenantId(): string | null {
    return this.currentTenantId();
  }
}
