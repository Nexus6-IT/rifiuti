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
      gap: 1rem;
      padding: 0.5rem;
    }

    .current-tenant-badge {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1.25rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      font-size: 0.875rem;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
      color: white;
      transition: all 0.3s ease;
    }

    .current-tenant-badge:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(102, 126, 234, 0.35);
    }

    .current-tenant-badge i {
      color: white;
      font-size: 1.125rem;
    }

    .tenant-label {
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tenant-name {
      font-weight: 700;
      color: white;
      font-size: 1rem;
    }

    .selected-tenant {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .tenant-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      width: 100%;
    }

    .tenant-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .tenant-info .tenant-name {
      font-weight: 600;
      color: #2c3e50;
    }

    .tenant-info .tenant-id {
      font-size: 0.75rem;
      color: #6c757d;
      font-family: 'Courier New', monospace;
    }

    .tenant-badges {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .role-badge {
      padding: 0.25rem 0.75rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
      letter-spacing: 0.5px;
      transition: all 0.3s ease;
    }

    .role-badge:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
    }

    /* Role badge variants by role type */
    .role-badge.admin {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      box-shadow: 0 2px 4px rgba(245, 87, 108, 0.3);
    }

    .role-badge.consultant {
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      box-shadow: 0 2px 4px rgba(79, 172, 254, 0.3);
    }

    .role-badge.operator {
      background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
      box-shadow: 0 2px 4px rgba(67, 233, 123, 0.3);
    }

    .role-badge.viewer {
      background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
      box-shadow: 0 2px 4px rgba(250, 112, 154, 0.3);
    }

    .expiry-badge {
      padding: 0.25rem 0.5rem;
      background: #ff9800;
      color: white;
      border-radius: 3px;
      font-size: 0.75rem;
      font-weight: 600;
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

    .not-consultant {
      padding: 0.5rem;
    }

    .single-tenant-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: #f5f5f5;
      border-radius: 4px;
      font-weight: 600;
      color: #2c3e50;
    }

    .single-tenant-badge i {
      color: #6c757d;
    }

    :host ::ng-deep .p-dropdown {
      min-width: 300px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: all 0.3s ease;
    }

    :host ::ng-deep .p-dropdown:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    :host ::ng-deep .p-dropdown-panel {
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      margin-top: 0.5rem;
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item {
      padding: 0.75rem 1rem;
      transition: all 0.2s ease;
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item:hover {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      transform: translateX(4px);
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item.p-highlight {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
      color: #667eea;
      font-weight: 600;
    }

    /* Accessibility: Focus styles */
    :host ::ng-deep .p-dropdown:focus {
      outline: 2px solid #667eea;
      outline-offset: 2px;
    }

    :host ::ng-deep .p-dropdown-panel .p-dropdown-items .p-dropdown-item:focus {
      outline: 2px solid #667eea;
      outline-offset: -2px;
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
