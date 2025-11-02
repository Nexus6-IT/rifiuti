import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantSelectorComponent } from '../../../features/permissions/components/tenant-selector/tenant-selector.component';
import { TenantSwitchService } from '../../../features/permissions/services/tenant-switch.service';

/**
 * HeaderComponent Integration Example
 * Shows how to integrate tenant selector into app header
 * T119: Add tenant-selector to app header (visible only for consultants)
 *
 * Integration Points:
 * 1. Import TenantSelectorComponent
 * 2. Add to header template
 * 3. Use TenantSwitchService to detect consultant mode
 * 4. Show/hide based on user role
 *
 * Usage:
 * Copy the template section to your existing header component
 */
@Component({
  selector: 'app-header-example',
  standalone: true,
  imports: [CommonModule, TenantSelectorComponent],
  template: `
    <header class="app-header">
      <!-- Left side: Logo and branding -->
      <div class="header-left">
        <img src="/assets/logo.png" alt="WasteFlow" class="logo" />
        <span class="app-title">WasteFlow</span>
      </div>

      <!-- Center: Tenant Selector (only for consultants) -->
      <div class="header-center" *ngIf="tenantSwitchService.isConsultant()">
        <app-tenant-selector></app-tenant-selector>
      </div>

      <!-- Right side: User menu, notifications, etc. -->
      <div class="header-right">
        <button class="notification-button">
          <i class="pi pi-bell"></i>
          <span class="notification-badge">3</span>
        </button>

        <div class="user-menu">
          <img src="/assets/avatar-placeholder.png" alt="User" class="avatar" />
          <span class="user-name">{{ userName }}</span>
          <i class="pi pi-chevron-down"></i>
        </div>
      </div>
    </header>
  `,
  styles: [`
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      background: white;
      border-bottom: 1px solid #e9ecef;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
      height: 64px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo {
      height: 40px;
      width: auto;
    }

    .app-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1976d2;
    }

    .header-center {
      flex: 1;
      display: flex;
      justify-content: center;
      padding: 0 2rem;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .notification-button {
      position: relative;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0.5rem;
      color: #6c757d;
      transition: color 0.2s;
    }

    .notification-button:hover {
      color: #1976d2;
    }

    .notification-badge {
      position: absolute;
      top: 0;
      right: 0;
      background: #dc3545;
      color: white;
      border-radius: 50%;
      padding: 0.125rem 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .user-menu {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .user-menu:hover {
      background: #f8f9fa;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid #e9ecef;
    }

    .user-name {
      font-weight: 500;
      color: #2c3e50;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      .app-header {
        padding: 0.75rem 1rem;
      }

      .header-center {
        display: none; /* Hide tenant selector on mobile, use sidebar instead */
      }

      .app-title {
        font-size: 1.125rem;
      }
    }
  `]
})
export class HeaderComponentExample {
  protected readonly tenantSwitchService = inject(TenantSwitchService);
  userName = 'Dr. Maria Rossi';
}

/**
 * Alternative: Sidebar Integration for Mobile
 *
 * For mobile devices, consider placing the tenant selector in a sidebar or menu
 * instead of the header for better UX:
 *
 * <p-sidebar [(visible)]="sidebarVisible" [style]="{ width: '300px' }">
 *   <h3>Switch Client</h3>
 *   <app-tenant-selector></app-tenant-selector>
 *
 *   <!-- Other sidebar content -->
 *   <ul class="sidebar-menu">
 *     <li><a routerLink="/dashboard">Dashboard</a></li>
 *     <li><a routerLink="/firs">FIRs</a></li>
 *     <li><a routerLink="/analytics">Analytics</a></li>
 *   </ul>
 * </p-sidebar>
 */
