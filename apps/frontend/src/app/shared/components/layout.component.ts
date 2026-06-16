import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { SidebarModule } from 'primeng/sidebar';
import { DropdownModule } from 'primeng/dropdown';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service';
import { NotificationBellComponent } from '../../core/layout/notification-bell/notification-bell.component';
import { environment } from '../../../environments/environment';

interface AdminTenant {
  id: string;
  ragioneSociale: string;
}

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FormsModule,
    AvatarModule,
    TooltipModule,
    SidebarModule,
    DropdownModule,
    NotificationBellComponent
  ],
  template: `
    <!-- Link salta-contenuto per accessibilità (WCAG 2.4.1) -->
    <a href="#main-content" class="skip-to-main">Vai al contenuto principale</a>

    <div class="app-shell">
      <!-- ===== Sidebar desktop (fissa ≥992px) ===== -->
      <aside class="sidebar" aria-hidden="false">
        <!-- Brand -->
        <a routerLink="/dashboard" class="sidebar__brand" aria-label="WasteFlow — vai alla dashboard">
          <span class="sidebar__brand-mark" aria-hidden="true">
            <i class="pi pi-trash"></i>
          </span>
          <span class="sidebar__brand-text">
            <span class="sidebar__brand-name">WasteFlow</span>
            <span class="sidebar__brand-tagline">Gestione Rifiuti Digitale</span>
          </span>
        </a>

        <!-- Selettore Azienda / Unità locale -->
        <ng-container *ngTemplateOutlet="orgSwitcher"></ng-container>

        <!-- Navigazione -->
        <nav class="sidebar__nav" aria-label="Navigazione principale">
          <ng-container *ngTemplateOutlet="navContent; context: { mobile: false }"></ng-container>
        </nav>

        <!-- Area utente + logout -->
        <div class="sidebar__footer">
          <div class="user-card">
            <p-avatar
              [label]="userInitials()"
              shape="circle"
              styleClass="user-card__avatar"
              [attr.aria-hidden]="true"
            />
            <span class="user-card__info">
              <span class="user-card__name">{{ userFullName() }}</span>
              <span class="user-card__email">{{ authService.currentUser()?.email }}</span>
            </span>
            <button
              type="button"
              class="user-card__logout"
              (click)="onLogout()"
              pTooltip="Esci"
              tooltipPosition="top"
              aria-label="Esci dall'applicazione"
            >
              <i class="pi pi-sign-out" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </aside>

      <!-- ===== Colonna contenuto (topbar + main) ===== -->
      <div class="content">
        <!-- Topbar -->
        <header class="topbar" role="banner">
          <div class="topbar__start">
            <button
              type="button"
              class="topbar__hamburger"
              (click)="toggleMobileSidebar()"
              aria-label="Apri il menu di navigazione"
              [attr.aria-expanded]="mobileSidebarVisible()"
              aria-controls="mobile-drawer"
            >
              <i class="pi pi-bars" aria-hidden="true"></i>
            </button>

            <!-- Brand compatto solo mobile -->
            <span class="topbar__brand">
              <i class="pi pi-trash" aria-hidden="true"></i>
              <span>WasteFlow</span>
            </span>

            <h1 class="topbar__title">{{ currentTitle() }}</h1>
          </div>

          <div class="topbar__end">
            <app-notification-bell />

            <span class="topbar__avatar" [attr.aria-label]="'Profilo utente ' + userFullName()" role="img">
              <p-avatar [label]="userInitials()" shape="circle" styleClass="user-card__avatar" />
            </span>
          </div>
        </header>

        <!-- Drawer mobile (< 992px) -->
        <p-sidebar
          [(visible)]="mobileSidebarVisibleProxy"
          position="left"
          [modal]="true"
          [showCloseIcon]="true"
          [style]="{ width: '17rem' }"
          styleClass="mobile-drawer"
          ariaCloseLabel="Chiudi il menu di navigazione"
        >
          <ng-template pTemplate="header">
            <a routerLink="/dashboard" class="sidebar__brand sidebar__brand--drawer" (click)="closeMobileSidebar()" aria-label="WasteFlow — vai alla dashboard">
              <span class="sidebar__brand-mark" aria-hidden="true"><i class="pi pi-trash"></i></span>
              <span class="sidebar__brand-text">
                <span class="sidebar__brand-name">WasteFlow</span>
              </span>
            </a>
          </ng-template>

          <ng-container *ngTemplateOutlet="orgSwitcher"></ng-container>

          <nav class="sidebar__nav" id="mobile-drawer" aria-label="Navigazione mobile">
            <ng-container *ngTemplateOutlet="navContent; context: { mobile: true }"></ng-container>
          </nav>

          <ng-template pTemplate="footer">
            <button type="button" class="drawer__logout" (click)="onLogout()">
              <i class="pi pi-sign-out" aria-hidden="true"></i>
              <span>Esci</span>
            </button>
          </ng-template>
        </p-sidebar>

        <!-- Contenuto principale -->
        <main class="main" id="main-content" role="main" tabindex="-1">
          <div class="main__inner">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>

    <!-- ===== Template condiviso voci di navigazione ===== -->
    <ng-template #navContent let-mobile="mobile">
      <ul class="nav-group" role="list">
        <li *ngFor="let item of navMain">
          <a
            [routerLink]="item.route"
            routerLinkActive="nav-item--active"
            class="nav-item"
            [attr.aria-current]="isActiveRoute(item.route) ? 'page' : null"
            (click)="mobile ? closeMobileSidebar() : null"
          >
            <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
            <span class="nav-item__label">{{ item.label }}</span>
          </a>
        </li>
      </ul>

      <p class="nav-group__title" id="nav-anagrafiche">Anagrafiche</p>
      <ul class="nav-group" role="list" aria-labelledby="nav-anagrafiche">
        <li *ngFor="let item of navAnagrafiche">
          <a
            [routerLink]="item.route"
            routerLinkActive="nav-item--active"
            class="nav-item"
            [attr.aria-current]="isActiveRoute(item.route) ? 'page' : null"
            (click)="mobile ? closeMobileSidebar() : null"
          >
            <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
            <span class="nav-item__label">{{ item.label }}</span>
          </a>
        </li>
      </ul>

      <p class="nav-group__title" id="nav-impostazioni">Impostazioni</p>
      <ul class="nav-group" role="list" aria-labelledby="nav-impostazioni">
        <li *ngFor="let item of navImpostazioni">
          <a
            [routerLink]="item.route"
            routerLinkActive="nav-item--active"
            class="nav-item"
            [attr.aria-current]="isActiveRoute(item.route) ? 'page' : null"
            (click)="mobile ? closeMobileSidebar() : null"
          >
            <i class="nav-item__icon" [ngClass]="item.icon" aria-hidden="true"></i>
            <span class="nav-item__label">{{ item.label }}</span>
          </a>
        </li>
      </ul>

      <!-- ===== Amministrazione (gated per ruolo) ===== -->
      @if (canSeeAdminSection()) {
        <p class="nav-group__title" id="nav-amministrazione">Amministrazione</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-amministrazione">
          @if (isSuperAdmin()) {
            <li>
              <a
                routerLink="/admin/tenants"
                routerLinkActive="nav-item--active"
                class="nav-item"
                [attr.aria-current]="isActiveRoute('/admin/tenants') ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon pi pi-building" aria-hidden="true"></i>
                <span class="nav-item__label">Tenant</span>
              </a>
            </li>
          }
          <li>
            <a
              routerLink="/admin/utenti"
              routerLinkActive="nav-item--active"
              class="nav-item"
              [attr.aria-current]="isActiveRoute('/admin/utenti') ? 'page' : null"
              (click)="mobile ? closeMobileSidebar() : null"
            >
              <i class="nav-item__icon pi pi-users" aria-hidden="true"></i>
              <span class="nav-item__label">Utenti</span>
            </a>
          </li>
        </ul>
      }
    </ng-template>

    <!-- ===== Selettore Azienda / Unità locale ===== -->
    <ng-template #orgSwitcher>
      @if (isSuperAdmin()) {
        <!-- Tenant switcher reale per SUPER_ADMIN -->
        <div class="tenant-switcher" role="group" aria-label="Selettore tenant (super amministratore)">
          <label class="tenant-switcher__label" for="tenant-switcher-dropdown">Tenant attivo</label>
          <p-dropdown
            inputId="tenant-switcher-dropdown"
            [options]="adminTenants()"
            [ngModel]="selectedTenantId()"
            (onChange)="onTenantChange($event.value)"
            optionLabel="ragioneSociale"
            optionValue="id"
            [filter]="true"
            filterBy="ragioneSociale"
            placeholder="Seleziona tenant…"
            [showClear]="hasTenantSelection()"
            appendTo="body"
            styleClass="tenant-switcher__dropdown"
            [ariaLabel]="'Cambia tenant corrente'"
            (onClear)="onTenantClear()"
          ></p-dropdown>
        </div>
      } @else {
        <!-- Placeholder azienda / unità locale per utenti standard -->
        <button
          type="button"
          class="org-switcher"
          aria-label="Cambia azienda o unità locale"
          aria-haspopup="menu"
        >
          <span class="org-switcher__avatar" aria-hidden="true">EC</span>
          <span class="org-switcher__text">
            <span class="org-switcher__company">Ecotecnica S.r.l.</span>
            <span class="org-switcher__unit">UL Sesto &middot; MI</span>
          </span>
          <i class="org-switcher__chevron pi pi-chevron-down" aria-hidden="true"></i>
        </button>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }

    /* ============================================================
       Struttura: sidebar fissa a sinistra + colonna contenuto.
       Mobile-first: di default singola colonna, la sidebar è il
       drawer p-sidebar; da ≥992px la sidebar diventa fissa.
       ============================================================ */
    .app-shell {
      min-height: 100vh;
      background: var(--surface-ground);
    }

    /* ===== Sidebar desktop (nascosta < 992px) ===== */
    .sidebar { display: none; }

    @media (min-width: 992px) {
      .app-shell {
        display: grid;
        grid-template-columns: 17rem 1fr;
      }
      .sidebar {
        display: flex;
        flex-direction: column;
        position: sticky;
        top: 0;
        height: 100vh;
        background: var(--sidebar-bg);
        border-right: 1px solid var(--sidebar-border);
      }
    }

    /* ===== Brand ===== */
    .sidebar__brand {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-lg) var(--spacing-base);
      text-decoration: none;
      border-bottom: 1px solid var(--sidebar-border);
      transition: background var(--transition-fast);
    }
    .sidebar__brand:hover { background: var(--sidebar-bg-2); text-decoration: none; }
    .sidebar__brand--drawer { border-bottom: none; padding: 0; }

    .sidebar__brand-mark {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      flex-shrink: 0;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light));
      color: var(--text-inverse);
      box-shadow: var(--shadow-sm);
    }
    .sidebar__brand-mark i { font-size: 1.35rem; }

    .sidebar__brand-text { display: flex; flex-direction: column; line-height: 1.1; min-width: 0; }
    .sidebar__brand-name {
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: #f8fafc;
      letter-spacing: -0.01em;
    }
    .sidebar__brand-tagline {
      font-size: var(--font-size-xs);
      color: var(--sidebar-ink-muted);
      margin-top: 2px;
    }

    /* ===== Selettore Azienda / Unità locale ===== */
    .org-switcher {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      width: calc(100% - (var(--spacing-md) * 2));
      margin: var(--spacing-md) var(--spacing-md) 0;
      padding: var(--spacing-sm) var(--spacing-md);
      border: 1px solid var(--sidebar-border);
      border-radius: var(--radius-md);
      background: var(--sidebar-bg-2);
      color: var(--sidebar-ink);
      text-align: left;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .org-switcher:hover { background: #273449; border-color: #334155; }
    .org-switcher__avatar {
      display: grid; place-items: center;
      width: 2rem; height: 2rem;
      flex-shrink: 0;
      border-radius: var(--radius-md);
      background: var(--sidebar-active-bg);
      color: var(--sidebar-active);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      font-family: var(--font-display);
      letter-spacing: 0.02em;
    }
    .org-switcher__text { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
    .org-switcher__company {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: #f8fafc;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .org-switcher__unit {
      font-size: var(--font-size-xs);
      color: var(--sidebar-ink-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .org-switcher__chevron { font-size: 0.75rem; color: var(--sidebar-ink-muted); flex-shrink: 0; }

    /* ===== Tenant switcher (SUPER_ADMIN) — coerente con sidebar scura ===== */
    .tenant-switcher {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
      margin: var(--spacing-md) var(--spacing-md) 0;
    }
    .tenant-switcher__label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--sidebar-ink-muted);
    }
    /* Override PrimeNG dropdown per renderlo leggibile sul fondo scuro */
    :host ::ng-deep .tenant-switcher__dropdown.p-dropdown {
      width: 100%;
      background: var(--sidebar-bg-2);
      border: 1px solid var(--sidebar-border);
      border-radius: var(--radius-md);
    }
    :host ::ng-deep .tenant-switcher__dropdown.p-dropdown:not(.p-disabled):hover {
      border-color: #334155;
      background: #273449;
    }
    :host ::ng-deep .tenant-switcher__dropdown.p-dropdown:not(.p-disabled).p-focus {
      border-color: var(--sidebar-active);
      box-shadow: none;
    }
    :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-label {
      color: #f8fafc;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
    }
    :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-label.p-placeholder {
      color: var(--sidebar-ink-muted);
      font-weight: var(--font-weight-medium);
    }
    :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-trigger,
    :host ::ng-deep .tenant-switcher__dropdown .p-dropdown-clear-icon {
      color: var(--sidebar-ink-muted);
    }

    /* ===== Navigazione ===== */
    .sidebar__nav {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-base) var(--spacing-md);
    }

    .nav-group { list-style: none; display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; }

    .nav-group__title {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--sidebar-ink-muted);
      margin: var(--spacing-lg) var(--spacing-md) var(--spacing-xs);
    }

    .nav-item {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: 0.625rem var(--spacing-md);
      min-height: var(--touch-target-min);
      border-radius: var(--radius-md);
      color: var(--sidebar-ink);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-sm);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .nav-item:hover { background: var(--sidebar-bg-2); color: #f8fafc; text-decoration: none; }

    .nav-item__icon { font-size: 1.15rem; width: 1.35rem; text-align: center; flex-shrink: 0; color: var(--sidebar-ink-muted); transition: color var(--transition-fast); }
    .nav-item:hover .nav-item__icon { color: var(--sidebar-active); }
    .nav-item__label { flex: 1; min-width: 0; }

    /* Stato attivo: superficie teal tenue + barra teal + testo/icona teal */
    .nav-item--active {
      background: var(--sidebar-active-bg);
      color: var(--sidebar-active);
      font-weight: var(--font-weight-semibold);
    }
    .nav-item--active:hover { background: var(--sidebar-active-bg); color: var(--sidebar-active); }
    .nav-item--active .nav-item__icon,
    .nav-item--active:hover .nav-item__icon { color: var(--sidebar-active); }
    .nav-item--active::before {
      content: '';
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 1.4rem;
      border-radius: var(--radius-full);
      background: var(--sidebar-active);
    }

    /* ===== Footer sidebar: utente + logout ===== */
    .sidebar__footer {
      padding: var(--spacing-md);
      border-top: 1px solid var(--sidebar-border);
    }
    .user-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm);
      border-radius: var(--radius-md);
      background: var(--sidebar-bg-2);
    }
    .user-card__info { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
    .user-card__name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: #f8fafc;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-card__email {
      font-size: var(--font-size-xs);
      color: var(--sidebar-ink-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-card__logout {
      display: grid; place-items: center;
      width: var(--touch-target-min); height: var(--touch-target-min);
      flex-shrink: 0;
      border: none; background: transparent; cursor: pointer;
      border-radius: var(--radius-md);
      color: var(--sidebar-ink-muted);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .user-card__logout i { font-size: 1.15rem; }
    .user-card__logout:hover { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }

    /* L'avatar usa il brand (override styleClass PrimeNG) */
    :host ::ng-deep .user-card__avatar {
      background: var(--brand-primary) !important;
      color: var(--text-inverse) !important;
      font-weight: var(--font-weight-semibold);
      font-family: var(--font-display);
    }

    /* ============================================================
       Colonna contenuto
       ============================================================ */
    .content { display: flex; flex-direction: column; min-height: 100vh; min-width: 0; }

    /* ===== Topbar ===== */
    .topbar {
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-base);
      height: 4rem;
      padding: 0 clamp(1rem, 2vw, var(--spacing-xl));
      background: var(--surface-card);
      border-bottom: 1px solid var(--surface-border);
    }
    .topbar__start { display: flex; align-items: center; gap: var(--spacing-md); min-width: 0; }
    .topbar__end { display: flex; align-items: center; gap: var(--spacing-sm); }

    .topbar__hamburger {
      display: grid; place-items: center;
      width: var(--touch-target-min); height: var(--touch-target-min);
      border: none; background: transparent; cursor: pointer;
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .topbar__hamburger i { font-size: 1.35rem; }
    .topbar__hamburger:hover { background: var(--surface-hover); color: var(--text-primary); }

    .topbar__brand {
      display: flex; align-items: center; gap: var(--spacing-sm);
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--text-primary);
    }
    .topbar__brand i { color: var(--brand-primary); font-size: 1.35rem; }

    .topbar__title {
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
      margin: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      display: none;
    }

    .topbar__avatar { display: none; }

    /* Da ≥992px: niente hamburger/brand-mobile, mostra titolo contesto */
    @media (min-width: 992px) {
      .topbar__hamburger,
      .topbar__brand { display: none; }
      .topbar__title { display: block; }
    }
    /* Su mobile l'avatar nella topbar dà accesso al contesto utente */
    @media (max-width: 991.98px) {
      .topbar__avatar { display: inline-flex; }
    }

    /* ===== Main ===== */
    .main { flex: 1; overflow-x: hidden; }
    .main:focus { outline: none; }
    .main__inner {
      max-width: 1600px;
      margin: 0 auto;
      padding: clamp(1rem, 2.5vw, var(--spacing-xl));
    }

    /* ===== Drawer mobile (p-sidebar) — scuro ===== */
    :host ::ng-deep .mobile-drawer { background: var(--sidebar-bg); color: var(--sidebar-ink); }
    :host ::ng-deep .mobile-drawer .p-sidebar-header { padding: var(--spacing-base) var(--spacing-base) var(--spacing-sm); }
    :host ::ng-deep .mobile-drawer .p-sidebar-content { padding: 0 var(--spacing-sm) var(--spacing-base); }
    :host ::ng-deep .mobile-drawer .p-sidebar-footer { padding: var(--spacing-sm) var(--spacing-base) var(--spacing-base); border-top: 1px solid var(--sidebar-border); }
    :host ::ng-deep .mobile-drawer .sidebar__nav { padding: var(--spacing-sm) var(--spacing-xs); overflow: visible; }
    /* Pulsante di chiusura del drawer leggibile su sfondo scuro */
    :host ::ng-deep .mobile-drawer .p-sidebar-close { color: var(--sidebar-ink); }
    :host ::ng-deep .mobile-drawer .p-sidebar-close:hover { background: var(--sidebar-bg-2); color: #f8fafc; }
    /* Il selettore org nel drawer non ha margini laterali doppi */
    :host ::ng-deep .mobile-drawer .org-switcher { width: calc(100% - (var(--spacing-md) * 2)); margin-top: 0; }
    :host ::ng-deep .mobile-drawer .tenant-switcher { margin-top: 0; }

    .drawer__logout {
      display: flex; align-items: center; justify-content: center;
      gap: var(--spacing-sm);
      width: 100%;
      min-height: var(--touch-target-min);
      border: 1px solid var(--sidebar-border);
      background: transparent;
      border-radius: var(--radius-md);
      color: #fca5a5;
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .drawer__logout:hover { background: rgba(239, 68, 68, 0.18); color: #fecaca; }
  `]
})
export class LayoutComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly tenantContext = inject(AdminTenantContextService);

  menuItems: MenuItem[] = [];

  // Mobile sidebar visibility signal
  mobileSidebarVisible = signal(false);

  /** Tenant disponibili (caricati da GET /admin/tenants per il super admin). */
  readonly adminTenants = signal<AdminTenant[]>([]);

  /** Tenant attualmente selezionato dal super admin. */
  readonly selectedTenantId = this.tenantContext.selectedTenantId;
  readonly hasTenantSelection = this.tenantContext.hasSelection;

  /** True se l'utente loggato è SUPER_ADMIN. */
  readonly isSuperAdmin = computed(() => this.authService.currentUser()?.role === 'SUPER_ADMIN');

  /** La sezione Amministrazione è visibile a SUPER_ADMIN e ADMIN (voce Utenti). */
  readonly canSeeAdminSection = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'SUPER_ADMIN' || role === 'ADMIN';
  });

  /** Proxy per il two-way binding di p-sidebar (che richiede una proprietà, non una signal). */
  get mobileSidebarVisibleProxy(): boolean {
    return this.mobileSidebarVisible();
  }
  set mobileSidebarVisibleProxy(value: boolean) {
    this.mobileSidebarVisible.set(value);
  }

  /** Voci di navigazione (un'unica fonte per sidebar desktop e drawer mobile). */
  readonly navMain = [
    { label: 'Dashboard', route: '/dashboard', icon: 'pi pi-home' },
    { label: 'FIR', route: '/fir', icon: 'pi pi-file' },
    { label: 'Catalogo CER', route: '/cer', icon: 'pi pi-tags' },
    { label: 'MUD', route: '/mud', icon: 'pi pi-file-export' },
    { label: 'Giacenze', route: '/giacenze', icon: 'pi pi-box' },
    { label: 'Contratti', route: '/contratti', icon: 'pi pi-briefcase' },
    { label: 'ESG / CO2', route: '/esg', icon: 'pi pi-chart-line' },
    { label: 'Anomalie', route: '/anomalie', icon: 'pi pi-exclamation-triangle' }
  ];
  readonly navAnagrafiche = [
    { label: 'Produttori', route: '/produttori', icon: 'pi pi-building' },
    { label: 'Trasportatori', route: '/trasportatori', icon: 'pi pi-truck' },
    { label: 'Destinatari', route: '/destinatari', icon: 'pi pi-inbox' }
  ];
  readonly navImpostazioni = [
    { label: 'Certificato RENTRI', route: '/rentri/certificato', icon: 'pi pi-key' },
    { label: 'Dati di riferimento', route: '/reference-data', icon: 'pi pi-database' }
  ];

  /** Titolo di contesto mostrato in topbar (desktop), derivato dalla rotta attiva. */
  readonly currentTitle = signal<string>('Dashboard');

  // Computed signals for reactive user display
  readonly userInitials = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return 'U';
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';

    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    } else if (firstName) {
      return firstName[0].toUpperCase();
    } else if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  });

  readonly userFullName = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return 'User';
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';

    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    } else if (firstName) {
      return firstName;
    } else if (user.email) {
      return user.email.split('@')[0];
    }
    return 'User';
  });

  constructor(readonly authService: AuthService, private readonly router: Router) {}

  ngOnInit(): void {
    this.updateTitle();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.updateTitle());

    // Solo il super admin può vedere/scegliere i tenant: carico la lista.
    if (this.isSuperAdmin()) {
      this.loadAdminTenants();
    }
  }

  /** Carica l'elenco dei tenant (endpoint riservato al SUPER_ADMIN). */
  private loadAdminTenants(): void {
    this.http.get<AdminTenant[]>(`${environment.apiUrl}/admin/tenants`).subscribe({
      next: (tenants) => this.adminTenants.set(tenants ?? []),
      error: () => this.adminTenants.set([]),
    });
  }

  /**
   * Selezione di un tenant da parte del super admin: persiste il contesto e
   * ricarica l'app così che tutte le richieste partano con il nuovo
   * `X-Tenant-ID`. Il reload è una scelta volutamente semplice.
   */
  onTenantChange(tenantId: string | null): void {
    if (!tenantId) {
      this.onTenantClear();
      return;
    }
    const tenant = this.adminTenants().find((t) => t.id === tenantId);
    this.tenantContext.set(tenantId, tenant?.ragioneSociale ?? tenantId);
    window.location.reload();
  }

  /** Azzeramento del contesto tenant (ritorno al contesto globale). */
  onTenantClear(): void {
    this.tenantContext.clear();
    window.location.reload();
  }

  /** Aggiorna il titolo di contesto in base alla voce di menu corrispondente alla rotta. */
  private updateTitle(): void {
    const navAmministrazione = [
      { label: 'Tenant', route: '/admin/tenants' },
      { label: 'Utenti', route: '/admin/utenti' },
    ];
    const all = [...this.navMain, ...this.navAnagrafiche, ...this.navImpostazioni, ...navAmministrazione];
    const match = all.find(item => this.isActiveRoute(item.route));
    this.currentTitle.set(match?.label ?? 'WasteFlow');
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarVisible.update(v => !v);
  }

  closeMobileSidebar(): void {
    this.mobileSidebarVisible.set(false);
  }

  isActiveRoute(route: string): boolean {
    return window.location.pathname.startsWith(route);
  }

  onLogout(): void {
    this.authService.logout().subscribe();
  }
}
