import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { AccordionModule } from 'primeng/accordion';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { PermissionStore } from '../../../../core/state/permission.store';
import { RoleStore } from '../../../../core/state/role.store';
import { PermissionFormatPipe } from '../../pipes/permission-format.pipe';
import { RoleDescriptionPipe } from '../../pipes/role-description.pipe';

/**
 * PermissionDiscoveryComponent
 * Mobile-first "My Permissions" page for User Story 3
 * Per spec.md: Help field operators discover permission boundaries on mobile
 *
 * Features:
 * - Mobile: Accordion layout (collapsible categories)
 * - Desktop: Grid layout (cards)
 * - Visual indicators: ✓ allowed (green), ○ view-only (blue), ✗ denied (gray)
 * - 56px touch targets per plan.md mobile-first requirements
 * - Permission grouping by module (FIR, User, Role, Analytics, etc.)
 * - Human-readable descriptions using PermissionFormatPipe
 * - Role badge showing current user role
 *
 * T127: Enhanced permission discovery with mobile-responsive layout
 */
@Component({
  selector: 'app-permission-discovery',
  standalone: true,
  imports: [
    CommonModule,
    AccordionModule,
    TagModule,
    TooltipModule,
    ButtonModule,
    PermissionFormatPipe,
    RoleDescriptionPipe,
  ],
  template: `
    <div class="page permission-discovery-page">
      <!-- Intestazione con badge ruolo -->
      <header class="page-header discovery-header">
        <div class="page-header__titles">
          <h1 class="page-title">I miei permessi</h1>
          <p class="page-subtitle">{{ currentRole() | roleDescription:'short' }}</p>
        </div>
        <div class="page-actions">
          <p-tag
            [value]="currentRole() | roleDescription:'name'"
            severity="info"
            styleClass="role-badge"
            data-testid="role-badge"></p-tag>
        </div>
      </header>

      <!-- Legenda accessibile -->
      <div
        *ngIf="!permissionStore.isLoading() && !permissionStore.error()"
        class="legend"
        aria-label="Legenda degli stati dei permessi">
        <span class="legend-item"><span class="permission-icon allowed" aria-hidden="true">✓</span> Consentito</span>
        <span class="legend-item"><span class="permission-icon view-only" aria-hidden="true">○</span> Sola lettura</span>
        <span class="legend-item"><span class="permission-icon denied" aria-hidden="true">✗</span> Negato</span>
      </div>

      <!-- Stato di caricamento -->
      <div *ngIf="permissionStore.isLoading()" class="surface-card">
        <div class="empty-state" role="status" aria-live="polite">
          <i class="pi pi-spin pi-spinner empty-state__icon" aria-hidden="true"></i>
          <p class="empty-state__title">Caricamento dei permessi...</p>
        </div>
      </div>

      <!-- Stato di errore -->
      <div *ngIf="permissionStore.error()" class="surface-card error-state" role="alert">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <p>{{ permissionStore.error() }}</p>
        <button pButton label="Riprova" icon="pi pi-refresh" (click)="retryLoad()"></button>
      </div>

      <!-- Layout mobile: accordion -->
      <div
        *ngIf="isMobile() && !permissionStore.isLoading() && !permissionStore.error()"
        class="mobile-layout"
        data-testid="permission-accordion">
        <p-accordion [multiple]="true" [activeIndex]="[0]">
          <p-accordionTab
            *ngFor="let category of permissionCategories()"
            [header]="category.name"
            data-testid="category-header">
            <div class="category-content" [attr.data-testid]="'category-content-' + category.key">
              <div
                *ngFor="let permission of category.permissions"
                class="permission-row"
                [attr.data-testid]="'permission-item-' + permission.raw">
                <div class="permission-icon" [class]="getPermissionState(permission.raw)" data-testid="permission-icon" aria-hidden="true">
                  {{ getPermissionIcon(permission.raw) }}
                </div>
                <div class="permission-details">
                  <span class="permission-name" data-testid="permission-status">
                    {{ permission.raw | permissionFormat }}
                    <span class="sr-only">— {{ getPermissionStateLabel(permission.raw) }}</span>
                  </span>
                  <span class="permission-scope">{{ permission.scope }}</span>
                </div>
                <button
                  pButton
                  icon="pi pi-question-circle"
                  class="p-button-text p-button-rounded help-button"
                  [pTooltip]="getPermissionHelp(permission.raw)"
                  tooltipPosition="left"
                  data-testid="help-icon"
                  [attr.aria-label]="'Aiuto su ' + (permission.raw | permissionFormat)"></button>
              </div>
            </div>
          </p-accordionTab>
        </p-accordion>
      </div>

      <!-- Layout desktop: griglia -->
      <div
        *ngIf="!isMobile() && !permissionStore.isLoading() && !permissionStore.error()"
        class="desktop-layout"
        data-testid="permission-grid">
        <section
          *ngFor="let category of permissionCategories()"
          class="surface-card category-card"
          [attr.aria-label]="category.name">
          <h2 class="category-title">{{ category.name }}</h2>
          <div class="permissions-grid">
            <div
              *ngFor="let permission of category.permissions"
              class="permission-card"
              [attr.data-testid]="'permission-item-' + permission.raw">
              <div class="permission-icon" [class]="getPermissionState(permission.raw)" aria-hidden="true">
                {{ getPermissionIcon(permission.raw) }}
              </div>
              <div class="permission-info">
                <span class="permission-name">
                  {{ permission.raw | permissionFormat }}
                  <span class="sr-only">— {{ getPermissionStateLabel(permission.raw) }}</span>
                </span>
                <span class="permission-scope">{{ permission.scope }}</span>
              </div>
              <i
                class="pi pi-question-circle help-icon"
                [pTooltip]="getPermissionHelp(permission.raw)"
                tooltipPosition="top"
                role="img"
                [attr.aria-label]="'Aiuto su ' + (permission.raw | permissionFormat)"></i>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .discovery-header { align-items: center; }

    :host ::ng-deep .role-badge {
      font-size: var(--font-size-sm);
      padding: 0.4rem 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-lg);
      margin-bottom: var(--spacing-lg);
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
    }
    .legend-item { display: inline-flex; align-items: center; gap: var(--spacing-sm); }
    .legend-item .permission-icon { width: 24px; height: 24px; font-size: 0.95rem; }

    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-2xl);
      text-align: center;
      gap: var(--spacing-base);
      color: var(--text-secondary);
      border-left: 4px solid var(--color-danger);
      background: var(--color-danger-bg);
    }
    .error-state i { font-size: 2.5rem; color: var(--color-danger); }

    .mobile-layout { margin-top: var(--spacing-sm); }

    :host ::ng-deep .p-accordion .p-accordion-header .p-accordion-header-link {
      min-height: var(--touch-target-min);
      padding: var(--spacing-base);
      font-weight: var(--font-weight-semibold);
    }
    :host ::ng-deep .p-accordion .p-accordion-content { padding: 0; }

    .category-content { display: flex; flex-direction: column; }

    .permission-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-base);
      padding: var(--spacing-base);
      min-height: var(--touch-target-min);
      border-bottom: 1px solid var(--surface-border);
      transition: background var(--transition-fast);
    }
    .permission-row:hover { background: var(--surface-hover); }
    .permission-row:last-child { border-bottom: none; }

    .permission-icon {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      font-weight: var(--font-weight-bold);
      flex-shrink: 0;
    }
    .permission-icon.allowed { background: var(--color-success-bg); color: var(--color-success); }
    .permission-icon.view-only { background: var(--color-info-bg); color: var(--color-info); }
    .permission-icon.denied { background: var(--color-gray-200); color: var(--text-tertiary); }

    .permission-details, .permission-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
    }

    .permission-name {
      font-weight: var(--font-weight-medium);
      color: var(--text-primary);
      font-size: var(--font-size-sm);
    }
    .permission-scope {
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .help-button { flex-shrink: 0; }

    .desktop-layout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: var(--spacing-lg);
    }

    .category-card { transition: box-shadow var(--transition-base); }
    .category-card:hover { box-shadow: var(--shadow-md); }
    .category-title {
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      margin: 0 0 var(--spacing-base);
    }

    .permissions-grid { display: flex; flex-direction: column; gap: var(--spacing-sm); }

    .permission-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md);
      background: var(--color-gray-50);
      border-radius: var(--radius-base);
      transition: background var(--transition-fast);
    }
    .permission-card:hover { background: var(--surface-hover); }

    .help-icon {
      color: var(--text-tertiary);
      cursor: pointer;
      font-size: 1.1rem;
    }
    .help-icon:hover { color: var(--brand-primary-dark); }
  `]
})
export class PermissionDiscoveryComponent implements OnInit {
  protected readonly permissionStore = inject(PermissionStore);
  protected readonly roleStore = inject(RoleStore);
  private readonly breakpointObserver = inject(BreakpointObserver);

  // Responsive state
  isMobile = signal(false);

  // Current user role
  currentRole = computed(() => {
    const roles = this.roleStore.roles();
    return roles.length > 0 ? roles[0].name : 'UNKNOWN';
  });

  // Permission categories
  permissionCategories = computed(() => {
    const permissions = this.permissionStore.permissions();
    return this.groupPermissionsByCategory(permissions);
  });

  ngOnInit(): void {
    // Ensure permissions and roles are loaded
    this.permissionStore.ensurePermissionsLoaded();
    this.roleStore.loadRoles();

    // Observe breakpoint changes
    this.breakpointObserver
      .observe([Breakpoints.Handset, Breakpoints.Tablet])
      .subscribe((result) => {
        this.isMobile.set(result.matches);
      });
  }

  /**
   * Group permissions by category (resource type)
   */
  private groupPermissionsByCategory(permissions: string[]): Array<{
    key: string;
    name: string;
    permissions: Array<{ raw: string; scope: string }>;
  }> {
    const categoryMap = new Map<string, Array<{ raw: string; scope: string }>>();

    permissions.forEach((permission) => {
      const parts = permission.split(':');
      if (parts.length !== 3) return;

      const [resource, , scope] = parts;

      if (!categoryMap.has(resource)) {
        categoryMap.set(resource, []);
      }

      categoryMap.get(resource)!.push({
        raw: permission,
        scope: scope.toUpperCase(),
      });
    });

    // Convert to array and sort
    return Array.from(categoryMap.entries())
      .map(([key, perms]) => ({
        key,
        name: this.getCategoryName(key),
        permissions: perms,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get category display name
   */
  private getCategoryName(resource: string): string {
    const categoryNames: Record<string, string> = {
      fir: 'Gestione FIR',
      user: 'Gestione utenti',
      role: 'Gestione ruoli',
      permission: 'Gestione permessi',
      tenant: 'Gestione tenant',
      analytics: 'Analisi e report',
      mud: 'Dichiarazione MUD',
      backup: 'Backup di sistema',
    };

    return categoryNames[resource] || `Gestione ${resource}`;
  }

  /**
   * Get permission state for styling
   */
  getPermissionState(permission: string): 'allowed' | 'view-only' | 'denied' {
    const hasPermission = this.permissionStore.hasPermission()(permission);

    if (!hasPermission) {
      return 'denied';
    }

    // Check if it's a read-only permission
    if (permission.includes(':read:')) {
      return 'view-only';
    }

    return 'allowed';
  }

  /**
   * Get permission icon
   */
  getPermissionIcon(permission: string): string {
    const state = this.getPermissionState(permission);

    switch (state) {
      case 'allowed':
        return '✓';
      case 'view-only':
        return '○';
      case 'denied':
        return '✗';
    }
  }

  /**
   * Etichetta testuale dello stato (per screen reader / WCAG: non solo colore)
   */
  getPermissionStateLabel(permission: string): string {
    switch (this.getPermissionState(permission)) {
      case 'allowed':
        return 'Consentito';
      case 'view-only':
        return 'Sola lettura';
      case 'denied':
        return 'Negato';
    }
  }

  /**
   * Get contextual help for permission
   */
  getPermissionHelp(permission: string): string {
    const hasPermission = this.permissionStore.hasPermission()(permission);

    if (hasPermission) {
      return `Hai questo permesso. ${this.getPermissionDescription(permission)}`;
    }

    return `Non hai questo permesso. Contatta l'amministratore per richiedere l'accesso.`;
  }

  /**
   * Get detailed permission description
   */
  private getPermissionDescription(permission: string): string {
    const parts = permission.split(':');
    if (parts.length !== 3) return '';

    const [resource, action] = parts;

    const descriptions: Record<string, Record<string, string>> = {
      fir: {
        create: 'Puoi creare nuovi FIR per la gestione dei rifiuti.',
        read: 'Puoi visualizzare i FIR esistenti.',
        update: 'Puoi modificare i FIR esistenti.',
        delete: 'Puoi eliminare i FIR.',
      },
      user: {
        create: 'Puoi creare nuovi account utente.',
        read: 'Puoi visualizzare le informazioni degli utenti.',
        update: 'Puoi modificare i profili utente.',
        delete: 'Puoi disattivare gli account utente.',
      },
    };

    return descriptions[resource]?.[action] || '';
  }

  /**
   * Retry loading permissions
   */
  retryLoad(): void {
    this.permissionStore.refreshPermissions();
    this.roleStore.loadRoles();
  }
}
