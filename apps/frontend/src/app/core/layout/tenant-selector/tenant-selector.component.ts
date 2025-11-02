import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownModule } from 'primeng/dropdown';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../../environments/environment';

/**
 * Tenant Selector Component
 *
 * Allows users with access to multiple tenants to switch context.
 * Updates JWT token with new tenant context.
 *
 * Used in header for multi-tenant consultants.
 */
@Component({
  selector: 'app-tenant-selector',
  standalone: true,
  imports: [CommonModule, DropdownModule, FormsModule],
  template: `
    @if (tenants().length > 1) {
      <div class="tenant-selector" data-cy="tenant-selector">
        <p-dropdown
          [(ngModel)]="selectedTenantId"
          [options]="tenants()"
          optionLabel="name"
          optionValue="id"
          placeholder="Seleziona cliente"
          (onChange)="onTenantChange()"
          styleClass="w-full"
          [showClear]="false">
          <ng-template pTemplate="selectedItem" let-option>
            <div class="flex align-items-center gap-2">
              <i class="pi pi-building"></i>
              <span>{{ option.name }}</span>
            </div>
          </ng-template>
          <ng-template pTemplate="item" let-option>
            <div class="flex align-items-center gap-2" data-cy="tenant-option">
              <i class="pi pi-building"></i>
              <span>{{ option.name }}</span>
            </div>
          </ng-template>
        </p-dropdown>
      </div>
    }
  `,
  styles: [
    `
      .tenant-selector {
        min-width: 250px;
      }

      :host ::ng-deep .p-dropdown {
        border-radius: 6px;
      }
    `,
  ],
})
export class TenantSelectorComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  protected readonly tenants = signal<Tenant[]>([]);
  protected selectedTenantId: string = '';

  ngOnInit(): void {
    this.loadUserTenants();
  }

  private loadUserTenants(): void {
    // In a real implementation, this would fetch user's tenants from API
    // For now, get from current user
    const currentUser = this.authService.currentUser();

    if (currentUser) {
      // Mock multiple tenants for demo
      this.tenants.set([
        { id: currentUser.tenantId, name: 'Azienda Principale' },
        // Add more tenants if user has access to multiple
      ]);

      this.selectedTenantId = currentUser.tenantId;
    }
  }

  protected onTenantChange(): void {
    if (!this.selectedTenantId) return;

    // Call API to switch tenant context
    this.http
      .post<{ accessToken: string }>(
        `${environment.apiUrl}/auth/switch-tenant`,
        { tenantId: this.selectedTenantId }
      )
      .subscribe({
        next: (response) => {
          // Update token in localStorage
          localStorage.setItem('accessToken', response.accessToken);

          // Reload page to refresh data for new tenant
          window.location.reload();
        },
        error: (error) => {
          console.error('Failed to switch tenant', error);
        },
      });
  }
}

interface Tenant {
  id: string;
  name: string;
}
