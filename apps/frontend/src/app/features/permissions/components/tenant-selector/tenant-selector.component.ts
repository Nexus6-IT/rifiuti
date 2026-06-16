import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DropdownModule } from 'primeng/dropdown';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';

/**
 * TenantSelectorComponent
 * Dropdown component for consultants to switch between client tenants
 * Per spec.md: Consultant can manage 50+ client tenants with seamless context switching
 *
 * Features:
 * - Dropdown showing all accessible tenants
 * - Current tenant badge/indicator
 * - Role badge for each tenant
 * - Expiration warning for tenants with <30 days access
 * - Quick switch with confirmation
 * - Search/filter for large tenant lists (50+)
 *
 * T116: Tenant selector dropdown component for header
 */
@Component({
  selector: 'app-tenant-selector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DropdownModule,
    ButtonModule,
    BadgeModule,
    TooltipModule,
  ],
  template: `
    <div class="tenant-selector" *ngIf="isConsultant()">
      <div class="current-tenant-badge">
        <i class="pi pi-building"></i>
        <span class="tenant-label">Current Client:</span>
        <span class="tenant-name">{{ currentTenantName() }}</span>
      </div>

      <p-dropdown
        [options]="availableTenants()"
        [(ngModel)]="selectedTenantId"
        (onChange)="onTenantChange($event)"
        [filter]="availableTenants().length > 10"
        filterBy="label"
        [showClear]="false"
        placeholder="Switch to another client..."
        optionLabel="label"
        optionValue="value"
        [style]="{ minWidth: '300px' }"
        appendTo="body">

        <ng-template pTemplate="selectedItem" let-tenant>
          <div class="selected-tenant" *ngIf="tenant">
            <i class="pi pi-building"></i>
            <span>{{ tenant.label }}</span>
          </div>
        </ng-template>

        <ng-template pTemplate="item" let-tenant>
          <div class="tenant-option">
            <div class="tenant-info">
              <span class="tenant-name">{{ tenant.label }}</span>
              <span class="tenant-id">{{ tenant.tenantId }}</span>
            </div>
            <div class="tenant-badges">
              <span
                class="role-badge"
                [class.admin]="getRoleCssClass(tenant.role) === 'admin'"
                [class.consultant]="getRoleCssClass(tenant.role) === 'consultant'"
                [class.operator]="getRoleCssClass(tenant.role) === 'operator'"
                [class.viewer]="getRoleCssClass(tenant.role) === 'viewer'">
                {{ tenant.role }}
              </span>
              <span
                *ngIf="tenant.isExpiringSoon"
                class="expiry-badge warning"
                [pTooltip]="'Access expires in ' + tenant.daysRemaining + ' days'">
                <i class="pi pi-clock"></i>
                {{ tenant.daysRemaining }}d
              </span>
            </div>
          </div>
        </ng-template>
      </p-dropdown>

      <button
        pButton
        icon="pi pi-refresh"
        class="p-button-text p-button-rounded"
        (click)="refreshTenants()"
        pTooltip="Refresh tenant list"
        aria-label="Aggiorna elenco clienti"
        [loading]="isLoading()"></button>
    </div>

    <div class="not-consultant" *ngIf="!isConsultant()">
      <!-- Regular users see their single tenant -->
      <div class="single-tenant-badge">
        <i class="pi pi-building"></i>
        <span>{{ currentTenantName() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .tenant-selector {
      display: flex;
      align-items: center;
      gap: var(--spacing-base);
      padding: var(--spacing-sm);
      flex-wrap: wrap;
    }

    .current-tenant-badge {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md) var(--spacing-lg);
      background: var(--brand-primary);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      box-shadow: var(--shadow-sm);
      color: var(--text-inverse);
      transition: box-shadow var(--transition-base);
    }

    .current-tenant-badge:hover {
      box-shadow: var(--shadow-base);
    }

    .current-tenant-badge i {
      color: var(--text-inverse);
      font-size: var(--font-size-lg);
    }

    .tenant-label {
      color: var(--text-inverse);
      opacity: 0.9;
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tenant-name {
      font-weight: var(--font-weight-bold);
      color: var(--text-inverse);
      font-size: var(--font-size-base);
    }

    .selected-tenant {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    .tenant-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-sm) 0;
      width: 100%;
      gap: var(--spacing-sm);
    }

    .tenant-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }

    .tenant-info .tenant-name {
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
      font-size: var(--font-size-sm);
    }

    .tenant-info .tenant-id {
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
      font-family: var(--font-family-mono);
    }

    .tenant-badges {
      display: flex;
      gap: var(--spacing-sm);
      align-items: center;
      flex-shrink: 0;
    }

    .role-badge {
      padding: 0.25rem 0.625rem;
      background: var(--color-gray-100);
      color: var(--color-gray-700);
      border: 1px solid var(--surface-border-strong);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Role badge variants by role type (semantic, AA-contrast) */
    .role-badge.admin {
      background: var(--color-danger-bg);
      color: var(--color-danger);
      border-color: var(--color-danger);
    }

    .role-badge.consultant {
      background: var(--brand-primary-50);
      color: var(--brand-primary-dark);
      border-color: var(--brand-primary);
    }

    .role-badge.operator {
      background: var(--color-success-bg);
      color: var(--color-success);
      border-color: var(--color-success);
    }

    .role-badge.viewer {
      background: var(--color-info-bg);
      color: var(--color-info);
      border-color: var(--color-info);
    }

    .expiry-badge {
      padding: 0.25rem 0.5rem;
      background: var(--color-warning-bg);
      color: var(--color-warning);
      border: 1px solid var(--color-warning);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .expiry-badge.warning {
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .expiry-badge.warning {
        animation: none;
      }
    }

    .not-consultant {
      padding: var(--spacing-sm);
    }

    .single-tenant-badge {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-base);
      background: var(--color-gray-100);
      border-radius: var(--radius-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
    }

    .single-tenant-badge i {
      color: var(--text-tertiary);
    }

    :host ::ng-deep .p-dropdown {
      min-width: 300px;
      border-radius: var(--radius-base);
    }

    :host ::ng-deep .p-dropdown-panel {
      border-radius: var(--radius-base);
      box-shadow: var(--shadow-md);
      margin-top: 0.5rem;
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item {
      padding: var(--spacing-md) var(--spacing-base);
      transition: background var(--transition-fast);
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item:hover {
      background: var(--surface-hover);
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item.p-highlight {
      background: var(--brand-primary-50);
      color: var(--brand-primary-dark);
      font-weight: var(--font-weight-semibold);
    }

    /* Accessibility: Focus styles */
    :host ::ng-deep .p-dropdown:focus-visible {
      outline: var(--focus-ring-width) solid var(--focus-ring-color);
      outline-offset: var(--focus-ring-offset);
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item:focus-visible {
      outline: var(--focus-ring-width) solid var(--focus-ring-color);
      outline-offset: -2px;
    }

    @media (max-width: 768px) {
      :host ::ng-deep .p-dropdown {
        min-width: 0;
        width: 100%;
      }
    }
  `]
})
export class TenantSelectorComponent implements OnInit {
  private readonly http = inject(HttpClient);

  // Signals for reactive state
  availableTenants = signal<any[]>([]);
  selectedTenantId = '';
  currentTenantName = signal('Loading...');
  isConsultant = signal(false);
  isLoading = signal(false);

  ngOnInit(): void {
    this.loadTenants();
    this.detectConsultantMode();
  }

  /**
   * Load available tenants for consultant
   */
  private loadTenants(): void {
    this.isLoading.set(true);

    this.http.get<any>('/api/v1/consultant/tenants').subscribe({
      next: (response) => {
        const tenants = response.tenants.map((tenant: any) => ({
          label: this.getTenantDisplayName(tenant.tenantId),
          value: tenant.tenantId,
          tenantId: tenant.tenantId,
          role: this.getRoleDisplayName(tenant.roleId),
          isExpiringSoon: tenant.isExpiringSoon,
          daysRemaining: tenant.daysUntilExpiration,
        }));

        this.availableTenants.set(tenants);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load tenants:', error);
        this.isLoading.set(false);
        // Not a consultant or error - fall back to single tenant mode
        this.isConsultant.set(false);
      },
    });
  }

  /**
   * Handle tenant selection change
   */
  onTenantChange(event: any): void {
    const targetTenantId = event.value;

    if (!targetTenantId) {
      return;
    }

    // Trigger tenant switch via service (will be implemented in T117)
    console.log('Switching to tenant:', targetTenantId);

    // This will call the tenant switch service
    this.switchTenant(targetTenantId);
  }

  /**
   * Switch to selected tenant
   * This will be connected to TenantSwitchService in T117
   */
  private switchTenant(targetTenantId: string): void {
    this.isLoading.set(true);

    this.http.post<any>('/api/v1/consultant/switch-tenant', {
      targetTenantId,
    }).subscribe({
      next: (response) => {
        // Store new JWT
        localStorage.setItem('jwt', response.newJwt);

        // Update current tenant name
        this.currentTenantName.set(this.getTenantDisplayName(targetTenantId));

        // Reload page to refresh all data with new tenant context
        window.location.reload();
      },
      error: (error) => {
        console.error('Failed to switch tenant:', error);
        this.isLoading.set(false);
        // TODO: Show error toast
      },
    });
  }

  /**
   * Refresh tenant list
   */
  refreshTenants(): void {
    this.loadTenants();
  }

  /**
   * Detect if current user is a consultant
   */
  private detectConsultantMode(): void {
    // Check JWT or user profile for consultant flag
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
      try {
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        this.isConsultant.set(payload.isConsultant === true || payload.consultantMode === true);
      } catch (error) {
        console.error('Failed to parse JWT:', error);
      }
    }
  }

  /**
   * Get display name for tenant ID
   * TODO: Fetch from tenant metadata API
   */
  private getTenantDisplayName(tenantId: string): string {
    // In production, this would fetch from API or cache
    return `Client ${tenantId.substring(0, 8)}`;
  }

  /**
   * Get display name for role ID
   * TODO: Fetch from role metadata API
   */
  private getRoleDisplayName(roleId: string): string {
    // In production, this would map to role names
    return 'Consultant';
  }

  /**
   * Get CSS class for role badge styling
   * Maps role names to CSS class variants
   */
  getRoleCssClass(roleName: string): string {
    const normalizedRole = roleName.toLowerCase();

    if (normalizedRole.includes('admin')) return 'admin';
    if (normalizedRole.includes('consultant')) return 'consultant';
    if (normalizedRole.includes('operator')) return 'operator';
    if (normalizedRole.includes('viewer') || normalizedRole.includes('read')) return 'viewer';

    return 'consultant'; // Default fallback
  }
}
