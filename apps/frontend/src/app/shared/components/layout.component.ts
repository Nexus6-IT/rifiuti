import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { HttpClient } from '@angular/common/http'
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { filter } from 'rxjs/operators'
import { AvatarModule } from 'primeng/avatar'
import { TooltipModule } from 'primeng/tooltip'
import { SidebarModule } from 'primeng/sidebar'
import { DropdownModule } from 'primeng/dropdown'
import { MenuItem } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { TenantSwitchService } from '../../features/permissions/services/tenant-switch.service'
import { NotificationBellComponent } from '../../core/layout/notification-bell/notification-bell.component'
import { environment } from '../../../environments/environment'

interface AdminTenant {
  id: string
  ragioneSociale: string
}

/** Tenant accessibile da un utente standard multi-azienda (da GET /consultant/tenants). */
interface UserTenant {
  id: string
  name: string
  role?: string
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
    NotificationBellComponent,
  ],
  template: `
    <!-- Link salta-contenuto per accessibilità (WCAG 2.4.1) -->
    <a href="#main-content" class="skip-to-main">Vai al contenuto principale</a>

    <!-- ===== Banner globale di impersonificazione (full-width, sopra tutto) ===== -->
    @if (isImpersonating()) {
      <div class="impersonation-banner" role="status" aria-live="polite">
        <span class="impersonation-banner__message">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>
            Stai impersonando
            <strong class="impersonation-banner__name">{{ impersonatingName() }}</strong>
          </span>
        </span>
        <button
          type="button"
          class="impersonation-banner__exit"
          (click)="exitImpersonation()"
          [attr.aria-label]="
            'Torna al tuo account di amministratore, termina l\\'impersonificazione di ' +
            impersonatingName()
          "
        >
          <i class="pi pi-sign-out" aria-hidden="true"></i>
          <span>Torna al tuo account</span>
        </button>
      </div>
    }

    <div class="app-shell">
      <!-- ===== Sidebar desktop (fissa ≥992px) ===== -->
      <aside class="sidebar" aria-hidden="false">
        <!-- Brand -->
        <a
          routerLink="/dashboard"
          class="sidebar__brand"
          aria-label="WasteFlow — vai alla dashboard"
        >
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

            <span
              class="topbar__avatar"
              [attr.aria-label]="'Profilo utente ' + userFullName()"
              role="img"
            >
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
            <a
              routerLink="/dashboard"
              class="sidebar__brand sidebar__brand--drawer"
              (click)="closeMobileSidebar()"
              aria-label="WasteFlow — vai alla dashboard"
            >
              <span class="sidebar__brand-mark" aria-hidden="true"
                ><i class="pi pi-trash"></i
              ></span>
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
        @for (item of navMain; track item.route) {
          <!-- La Dashboard è sempre visibile; le altre voci dipendono dalla feature. -->
          @if (!item.feature || ff.has(item.feature)) {
            <li>
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
          }
        }
      </ul>

      <!-- L'intera sezione Anagrafiche è gated dalla feature 'anagrafiche'. -->
      @if (ff.has('anagrafiche')) {
        <p class="nav-group__title" id="nav-anagrafiche">Anagrafiche</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-anagrafiche">
          @for (item of navAnagrafiche; track item.route) {
            <li>
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
          }
        </ul>
      }

      <!-- La sezione Impostazioni appare solo se almeno una voce è abilitata. -->
      @if (visibleImpostazioni().length > 0) {
        <p class="nav-group__title" id="nav-impostazioni">Impostazioni</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-impostazioni">
          @for (item of visibleImpostazioni(); track item.route) {
            <li>
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
          }
        </ul>
      }

      <!-- ===== Abbonamento (sempre visibile) ===== -->
      <p class="nav-group__title" id="nav-account">Account</p>
      <ul class="nav-group" role="list" aria-labelledby="nav-account">
        <li>
          <a
            routerLink="/abbonamento"
            routerLinkActive="nav-item--active"
            class="nav-item"
            [attr.aria-current]="isActiveRoute('/abbonamento') ? 'page' : null"
            (click)="mobile ? closeMobileSidebar() : null"
          >
            <i class="nav-item__icon pi pi-credit-card" aria-hidden="true"></i>
            <span class="nav-item__label">Abbonamento</span>
          </a>
        </li>
      </ul>

      <!-- ===== Amministrazione (gated per ruolo) ===== -->
      @if (canSeeAdminSection()) {
        <p class="nav-group__title" id="nav-amministrazione">Amministrazione</p>
        <ul class="nav-group" role="list" aria-labelledby="nav-amministrazione">
          @if (canSeeTenants()) {
            <li>
              <a
                routerLink="/admin/tenants"
                routerLinkActive="nav-item--active"
                class="nav-item"
                [attr.aria-current]="isActiveRoute('/admin/tenants') ? 'page' : null"
                (click)="mobile ? closeMobileSidebar() : null"
              >
                <i class="nav-item__icon pi pi-building" aria-hidden="true"></i>
                <span class="nav-item__label">{{ tenantsMenuLabel() }}</span>
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
        <div
          class="tenant-switcher"
          role="group"
          aria-label="Selettore tenant (super amministratore)"
        >
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
      } @else if (userTenants().length >= 2) {
        <!-- Tenant switcher generico per utenti standard multi-azienda -->
        <div class="tenant-switcher" role="group" aria-label="Selettore azienda">
          <label class="tenant-switcher__label" for="user-tenant-switcher">Azienda attiva</label>
          <p-dropdown
            inputId="user-tenant-switcher"
            [options]="userTenants()"
            [ngModel]="currentUserTenantId()"
            (onChange)="onUserTenantChange($event.value)"
            optionLabel="name"
            optionValue="id"
            [filter]="userTenants().length > 6"
            filterBy="name"
            placeholder="Seleziona azienda…"
            appendTo="body"
            styleClass="tenant-switcher__dropdown"
            [ariaLabel]="'Cambia azienda corrente'"
          ></p-dropdown>
        </div>
      } @else {
        <!-- Utente con una sola azienda: mostro il nome (nessuno switch). -->
        <button type="button" class="org-switcher" aria-label="Azienda corrente" [disabled]="true">
          <span class="org-switcher__avatar" aria-hidden="true">{{ singleTenantInitials() }}</span>
          <span class="org-switcher__text">
            <span class="org-switcher__company">{{ singleTenantName() }}</span>
          </span>
        </button>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* ============================================================
       Banner globale di impersonificazione
       Full-width, in cima a tutto (sopra topbar/sidebar/drawer).
       Sfondo ambra + testo scuro slate-900 → contrasto AA abbondante.
       ============================================================ */
      .impersonation-banner {
        position: relative;
        z-index: calc(var(--z-sticky) + 10);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm) var(--spacing-base);
        padding: var(--spacing-sm) clamp(1rem, 2vw, var(--spacing-xl));
        background: var(--color-warning-bg);
        color: var(--color-gray-900);
        border-bottom: 2px solid var(--color-warning);
        font-size: var(--font-size-sm);
        line-height: 1.3;
      }
      .impersonation-banner__message {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-weight: var(--font-weight-medium);
        text-align: center;
      }
      .impersonation-banner__message i {
        color: var(--color-warning);
        font-size: 1.15rem;
        flex-shrink: 0;
      }
      .impersonation-banner__name {
        font-weight: var(--font-weight-bold);
      }

      .impersonation-banner__exit {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-height: var(--touch-target-min);
        padding: 0.375rem var(--spacing-md);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        background: var(--color-warning);
        color: var(--text-inverse);
        font-family: inherit;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition:
          background var(--transition-fast),
          color var(--transition-fast),
          box-shadow var(--transition-fast);
      }
      .impersonation-banner__exit:hover {
        background: var(--brand-secondary-dark, #92400e);
        border-color: var(--brand-secondary-dark, #92400e);
      }
      .impersonation-banner__exit:focus-visible {
        outline: 3px solid var(--color-gray-900);
        outline-offset: 2px;
      }

      /* Mobile: messaggio + bottone vanno a capo restando centrati */
      @media (max-width: 575.98px) {
        .impersonation-banner {
          flex-direction: column;
        }
        .impersonation-banner__exit {
          width: 100%;
          justify-content: center;
        }
      }

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
      .sidebar {
        display: none;
      }

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
      .sidebar__brand:hover {
        background: var(--sidebar-bg-2);
        text-decoration: none;
      }
      .sidebar__brand--drawer {
        border-bottom: none;
        padding: 0;
      }

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
      .sidebar__brand-mark i {
        font-size: 1.35rem;
      }

      .sidebar__brand-text {
        display: flex;
        flex-direction: column;
        line-height: 1.1;
        min-width: 0;
      }
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
        transition:
          background var(--transition-fast),
          border-color var(--transition-fast);
      }
      .org-switcher:hover {
        background: #273449;
        border-color: #334155;
      }
      .org-switcher__avatar {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
        border-radius: var(--radius-md);
        background: var(--sidebar-active-bg);
        color: var(--sidebar-active);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        font-family: var(--font-display);
        letter-spacing: 0.02em;
      }
      .org-switcher__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.2;
      }
      .org-switcher__company {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .org-switcher__unit {
        font-size: var(--font-size-xs);
        color: var(--sidebar-ink-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .org-switcher__chevron {
        font-size: 0.75rem;
        color: var(--sidebar-ink-muted);
        flex-shrink: 0;
      }

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

      .nav-group {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
      }

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
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .nav-item:hover {
        background: var(--sidebar-bg-2);
        color: #f8fafc;
        text-decoration: none;
      }

      .nav-item__icon {
        font-size: 1.15rem;
        width: 1.35rem;
        text-align: center;
        flex-shrink: 0;
        color: var(--sidebar-ink-muted);
        transition: color var(--transition-fast);
      }
      .nav-item:hover .nav-item__icon {
        color: var(--sidebar-active);
      }
      .nav-item__label {
        flex: 1;
        min-width: 0;
      }

      /* Stato attivo: superficie teal tenue + barra teal + testo/icona teal */
      .nav-item--active {
        background: var(--sidebar-active-bg);
        color: var(--sidebar-active);
        font-weight: var(--font-weight-semibold);
      }
      .nav-item--active:hover {
        background: var(--sidebar-active-bg);
        color: var(--sidebar-active);
      }
      .nav-item--active .nav-item__icon,
      .nav-item--active:hover .nav-item__icon {
        color: var(--sidebar-active);
      }
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
      .user-card__info {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.2;
      }
      .user-card__name {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .user-card__email {
        font-size: var(--font-size-xs);
        color: var(--sidebar-ink-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .user-card__logout {
        display: grid;
        place-items: center;
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        flex-shrink: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: var(--radius-md);
        color: var(--sidebar-ink-muted);
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .user-card__logout i {
        font-size: 1.15rem;
      }
      .user-card__logout:hover {
        background: rgba(239, 68, 68, 0.18);
        color: #fca5a5;
      }

      /* L'avatar usa il brand (override styleClass PrimeNG); teal-700 per 5.47:1 con le iniziali bianche (AA). */
      :host ::ng-deep .user-card__avatar {
        background: var(--brand-primary-dark) !important;
        color: var(--text-inverse) !important;
        font-weight: var(--font-weight-semibold);
        font-family: var(--font-display);
      }

      /* ============================================================
       Colonna contenuto
       ============================================================ */
      .content {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-width: 0;
      }

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
      .topbar__start {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        min-width: 0;
      }
      .topbar__end {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .topbar__hamburger {
        display: grid;
        place-items: center;
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .topbar__hamburger i {
        font-size: 1.35rem;
      }
      .topbar__hamburger:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }

      .topbar__brand {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
      }
      .topbar__brand i {
        color: var(--brand-primary);
        font-size: 1.35rem;
      }

      .topbar__title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: none;
      }

      .topbar__avatar {
        display: none;
      }

      /* Da ≥992px: niente hamburger/brand-mobile, mostra titolo contesto */
      @media (min-width: 992px) {
        .topbar__hamburger,
        .topbar__brand {
          display: none;
        }
        .topbar__title {
          display: block;
        }
      }
      /* Su mobile l'avatar nella topbar dà accesso al contesto utente */
      @media (max-width: 991.98px) {
        .topbar__avatar {
          display: inline-flex;
        }
      }

      /* ===== Main ===== */
      .main {
        flex: 1;
        overflow-x: hidden;
      }
      .main:focus {
        outline: none;
      }
      .main__inner {
        max-width: 1600px;
        margin: 0 auto;
        padding: clamp(1rem, 2.5vw, var(--spacing-xl));
      }

      /* ===== Drawer mobile (p-sidebar) — scuro ===== */
      :host ::ng-deep .mobile-drawer {
        background: var(--sidebar-bg);
        color: var(--sidebar-ink);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-header {
        padding: var(--spacing-base) var(--spacing-base) var(--spacing-sm);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-content {
        padding: 0 var(--spacing-sm) var(--spacing-base);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-footer {
        padding: var(--spacing-sm) var(--spacing-base) var(--spacing-base);
        border-top: 1px solid var(--sidebar-border);
      }
      :host ::ng-deep .mobile-drawer .sidebar__nav {
        padding: var(--spacing-sm) var(--spacing-xs);
        overflow: visible;
      }
      /* Pulsante di chiusura del drawer leggibile su sfondo scuro */
      :host ::ng-deep .mobile-drawer .p-sidebar-close {
        color: var(--sidebar-ink);
      }
      :host ::ng-deep .mobile-drawer .p-sidebar-close:hover {
        background: var(--sidebar-bg-2);
        color: #f8fafc;
      }
      /* Il selettore org nel drawer non ha margini laterali doppi */
      :host ::ng-deep .mobile-drawer .org-switcher {
        width: calc(100% - (var(--spacing-md) * 2));
        margin-top: 0;
      }
      :host ::ng-deep .mobile-drawer .tenant-switcher {
        margin-top: 0;
      }

      .drawer__logout {
        display: flex;
        align-items: center;
        justify-content: center;
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
        transition:
          background var(--transition-fast),
          color var(--transition-fast);
      }
      .drawer__logout:hover {
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
      }
    `,
  ],
})
export class LayoutComponent implements OnInit {
  private readonly http = inject(HttpClient)
  private readonly tenantContext = inject(AdminTenantContextService)
  private readonly tenantSwitchService = inject(TenantSwitchService)

  /** Servizio feature-flag: pubblico così il template può usare `ff.has(...)`. */
  readonly ff = inject(FeatureFlagsService)

  menuItems: MenuItem[] = []

  // Mobile sidebar visibility signal
  mobileSidebarVisible = signal(false)

  /**
   * Stato di impersonificazione: vero quando un SUPER_ADMIN sta operando come
   * un altro utente. Le chiavi sono impostate da un altro componente all'avvio
   * dell'impersonificazione (NON gestito qui):
   *  - wf_impersonator_token   = access token del super admin (da ripristinare)
   *  - wf_impersonator_refresh = refresh token del super admin (opzionale)
   *  - wf_impersonating_name   = nome dell'utente impersonato
   * In aggiunta, il JWT corrente (localStorage.accessToken) porta il claim
   * `impersonatorId` quando è una sessione di impersonificazione.
   */
  readonly isImpersonating = signal(false)

  /** Nome leggibile dell'utente attualmente impersonato (per il banner). */
  readonly impersonatingName = signal<string>('')

  /** Tenant disponibili (caricati da GET /admin/tenants per il super admin). */
  readonly adminTenants = signal<AdminTenant[]>([])

  /** Tenant attualmente selezionato dal super admin. */
  readonly selectedTenantId = this.tenantContext.selectedTenantId
  readonly hasTenantSelection = this.tenantContext.hasSelection

  /** True se l'utente loggato è SUPER_ADMIN. */
  readonly isSuperAdmin = computed(() => this.authService.currentUser()?.role === 'SUPER_ADMIN')

  /** La sezione Amministrazione è visibile a SUPER_ADMIN e ADMIN (voce Utenti). */
  readonly canSeeAdminSection = computed(() => {
    const role = this.authService.currentUser()?.role
    return role === 'SUPER_ADMIN' || role === 'ADMIN'
  })

  /**
   * La voce "aziende/tenant" è visibile sia al SUPER_ADMIN (gestione tenant
   * della piattaforma) sia all'ADMIN (gestione self-service delle proprie
   * aziende entro la quota assegnata).
   */
  readonly canSeeTenants = computed(() => {
    const role = this.authService.currentUser()?.role
    return role === 'SUPER_ADMIN' || role === 'ADMIN'
  })

  /** Etichetta dinamica della voce: "Tenant" per il super admin, "Le mie aziende" per l'admin. */
  readonly tenantsMenuLabel = computed(() => (this.isSuperAdmin() ? 'Tenant' : 'Le mie aziende'))

  /** Proxy per il two-way binding di p-sidebar (che richiede una proprietà, non una signal). */
  get mobileSidebarVisibleProxy(): boolean {
    return this.mobileSidebarVisible()
  }
  set mobileSidebarVisibleProxy(value: boolean) {
    this.mobileSidebarVisible.set(value)
  }

  /**
   * Voci di navigazione (un'unica fonte per sidebar desktop e drawer mobile).
   * `feature` = chiave feature-flag richiesta per mostrare la voce; se assente
   * (es. Dashboard) la voce è sempre visibile.
   */
  readonly navMain: { label: string; route: string; icon: string; feature?: string }[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'pi pi-home' },
    { label: 'FIR', route: '/fir', icon: 'pi pi-file', feature: 'fir' },
    { label: 'Registro C/S', route: '/registro', icon: 'pi pi-clipboard', feature: 'registro' },
    { label: 'Catalogo CER', route: '/cer', icon: 'pi pi-tags', feature: 'cer' },
    { label: 'MUD', route: '/mud', icon: 'pi pi-file-export', feature: 'mud' },
    { label: 'Giacenze', route: '/giacenze', icon: 'pi pi-box', feature: 'giacenze' },
    { label: 'Contratti', route: '/contratti', icon: 'pi pi-briefcase', feature: 'contratti' },
    { label: 'ESG / CO2', route: '/esg', icon: 'pi pi-chart-line', feature: 'esg' },
    {
      label: 'Anomalie',
      route: '/anomalie',
      icon: 'pi pi-exclamation-triangle',
      feature: 'anomalie',
    },
  ]
  /** Intera sezione gated dalla feature 'anagrafiche' (vedi template). */
  readonly navAnagrafiche = [
    { label: 'Produttori', route: '/produttori', icon: 'pi pi-building' },
    { label: 'Trasportatori', route: '/trasportatori', icon: 'pi pi-truck' },
    { label: 'Destinatari', route: '/destinatari', icon: 'pi pi-inbox' },
  ]
  readonly navImpostazioni: { label: string; route: string; icon: string; feature: string }[] = [
    {
      label: 'Certificato RENTRI',
      route: '/rentri/certificato',
      icon: 'pi pi-key',
      feature: 'rentri',
    },
    {
      label: 'Dati di riferimento',
      route: '/reference-data',
      icon: 'pi pi-database',
      feature: 'reference_data',
    },
  ]

  /** Voci Impostazioni effettivamente visibili in base alle feature attive. */
  readonly visibleImpostazioni = computed(() =>
    this.navImpostazioni.filter(item => this.ff.has(item.feature))
  )

  /** Tenant accessibili dall'utente standard (GET /consultant/tenants). */
  readonly userTenants = signal<UserTenant[]>([])

  /** Id del tenant attivo per l'utente standard (da GET /me/tenants). */
  readonly currentUserTenantId = signal<string | null>(null)

  /** Nome del tenant quando l'utente ne ha uno solo (placeholder org-switcher). */
  readonly singleTenantName = computed(() => this.userTenants()[0]?.name ?? 'Azienda')
  readonly singleTenantInitials = computed(() => {
    const name = this.singleTenantName()
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return (name.slice(0, 2) || 'AZ').toUpperCase()
  })

  /** Titolo di contesto mostrato in topbar (desktop), derivato dalla rotta attiva. */
  readonly currentTitle = signal<string>('Dashboard')

  // Computed signals for reactive user display
  readonly userInitials = computed(() => {
    const user = this.authService.currentUser()
    if (!user) return 'U'
    const firstName = user.firstName || ''
    const lastName = user.lastName || ''

    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase()
    } else if (firstName) {
      return firstName[0].toUpperCase()
    } else if (user.email) {
      return user.email[0].toUpperCase()
    }
    return 'U'
  })

  readonly userFullName = computed(() => {
    const user = this.authService.currentUser()
    if (!user) return 'User'
    const firstName = user.firstName || ''
    const lastName = user.lastName || ''

    if (firstName && lastName) {
      return `${firstName} ${lastName}`
    } else if (firstName) {
      return firstName
    } else if (user.email) {
      return user.email.split('@')[0]
    }
    return 'User'
  })

  constructor(
    readonly authService: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.detectImpersonation()
    this.updateTitle()
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.updateTitle())

    // Feature-flag del tenant corrente: guida la visibilità delle voci di menu.
    this.ff.load().subscribe()

    if (this.isSuperAdmin()) {
      // Super admin: tenant switcher basato su X-Tenant-ID (comportamento esistente).
      this.loadAdminTenants()
    } else {
      // Utente standard: se è associato a più aziende mostro un tenant switcher
      // generico (stesso endpoint usato dai consulenti, non richiede ruolo).
      this.loadUserTenants()
    }
  }

  /** Carica l'elenco dei tenant (endpoint riservato al SUPER_ADMIN). */
  private loadAdminTenants(): void {
    this.http.get<AdminTenant[]>(`${environment.apiUrl}/admin/tenants`).subscribe({
      next: tenants => this.adminTenants.set(tenants ?? []),
      error: () => this.adminTenants.set([]),
    })
  }

  /**
   * Carica i tenant accessibili dall'utente standard tramite
   * GET /consultant/tenants (l'endpoint richiede solo il login, non il ruolo
   * CONSULTANT). Mappa in modo difensivo: il backend ritorna `tenantId`/`roleId`
   * ma normalizziamo verso `{ id, name, role }` accettando anche eventuali
   * `name`/`ragioneSociale`/`tenantName`. Se ne restituisce <2, il template
   * mostra il semplice placeholder col nome dell'azienda.
   */
  private loadUserTenants(): void {
    this.http
      .get<{ tenants?: any[]; currentTenantId?: string | null }>(`${environment.apiUrl}/me/tenants`)
      .subscribe({
        next: res => {
          const list = Array.isArray(res?.tenants) ? res.tenants : []
          const mapped: UserTenant[] = list.map(t => {
            const id = t.id ?? t.tenantId
            return { id, name: t.ragioneSociale ?? t.name ?? t.tenantName ?? id }
          })
          this.userTenants.set(mapped)
          this.currentUserTenantId.set(res?.currentTenantId ?? null)
        },
        error: () => this.userTenants.set([]),
      })
  }

  /**
   * Cambio azienda per l'utente multi-azienda: chiama /me/switch-tenant che
   * ri-emette il JWT col nuovo tenant; salva i token e ricarica l'app (così
   * feature-flag e dati ripartono nel nuovo contesto).
   */
  onUserTenantChange(tenantId: string | null): void {
    if (!tenantId || tenantId === this.currentUserTenantId()) {
      return
    }
    this.http
      .post<{
        accessToken: string
        refreshToken?: string
      }>(`${environment.apiUrl}/me/switch-tenant`, { tenantId })
      .subscribe({
        next: res => {
          if (res?.accessToken) localStorage.setItem('accessToken', res.accessToken)
          if (res?.refreshToken) localStorage.setItem('refreshToken', res.refreshToken)
          window.location.reload()
        },
        error: () => console.error('Cambio azienda non riuscito'),
      })
  }

  /**
   * Selezione di un tenant da parte del super admin: persiste il contesto e
   * ricarica l'app così che tutte le richieste partano con il nuovo
   * `X-Tenant-ID`. Il reload è una scelta volutamente semplice.
   */
  onTenantChange(tenantId: string | null): void {
    if (!tenantId) {
      this.onTenantClear()
      return
    }
    const tenant = this.adminTenants().find(t => t.id === tenantId)
    this.tenantContext.set(tenantId, tenant?.ragioneSociale ?? tenantId)
    window.location.reload()
  }

  /** Azzeramento del contesto tenant (ritorno al contesto globale). */
  onTenantClear(): void {
    this.tenantContext.clear()
    window.location.reload()
  }

  /** Aggiorna il titolo di contesto in base alla voce di menu corrispondente alla rotta. */
  private updateTitle(): void {
    const navAmministrazione = [
      { label: this.tenantsMenuLabel(), route: '/admin/tenants' },
      { label: 'Utenti', route: '/admin/utenti' },
    ]
    const navAccount = [{ label: 'Abbonamento', route: '/abbonamento' }]
    const all = [
      ...this.navMain,
      ...this.navAnagrafiche,
      ...this.navImpostazioni,
      ...navAmministrazione,
      ...navAccount,
    ]
    const match = all.find(item => this.isActiveRoute(item.route))
    this.currentTitle.set(match?.label ?? 'WasteFlow')
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarVisible.update(v => !v)
  }

  closeMobileSidebar(): void {
    this.mobileSidebarVisible.set(false)
  }

  isActiveRoute(route: string): boolean {
    return window.location.pathname.startsWith(route)
  }

  /**
   * Rileva una sessione di impersonificazione attiva e popola le signal usate
   * dal banner. Considera impersonificazione se è presente
   * `wf_impersonator_token` in localStorage OPPURE se il JWT corrente contiene
   * il claim `impersonatorId`. Il nome mostrato proviene da
   * `wf_impersonating_name` con fallback generico.
   */
  private detectImpersonation(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }
    const hasImpersonatorToken = !!localStorage.getItem('wf_impersonator_token')
    const jwtHasClaim = this.currentTokenHasImpersonatorClaim()
    const active = hasImpersonatorToken || jwtHasClaim
    this.isImpersonating.set(active)
    if (active) {
      this.impersonatingName.set(
        localStorage.getItem('wf_impersonating_name')?.trim() || 'questo utente'
      )
    }
  }

  /**
   * Decodifica (best-effort) il payload base64url del JWT in
   * `localStorage.accessToken` e verifica la presenza del claim
   * `impersonatorId`. Qualsiasi errore di parsing è trattato come "assente".
   */
  private currentTokenHasImpersonatorClaim(): boolean {
    try {
      const token = localStorage.getItem('accessToken')
      const payload = token?.split('.')[1]
      if (!payload) return false
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
      const decoded = JSON.parse(atob(normalized))
      return decoded != null && decoded.impersonatorId != null
    } catch {
      return false
    }
  }

  /**
   * Termina l'impersonificazione: ripristina i token del super admin, ripulisce
   * le chiavi temporanee e ricarica completamente l'app sulla dashboard così da
   * tornare al contesto originale (feature-flag, dati e ruolo ricalcolati).
   */
  exitImpersonation(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }
    const impersonatorToken = localStorage.getItem('wf_impersonator_token')
    const impersonatorRefresh = localStorage.getItem('wf_impersonator_refresh')

    if (impersonatorToken) {
      localStorage.setItem('accessToken', impersonatorToken)
    }
    if (impersonatorRefresh) {
      localStorage.setItem('refreshToken', impersonatorRefresh)
    }

    localStorage.removeItem('wf_impersonator_token')
    localStorage.removeItem('wf_impersonator_refresh')
    localStorage.removeItem('wf_impersonating_name')

    // Reload completo → si torna ad operare come super amministratore.
    window.location.href = '/dashboard'
  }

  onLogout(): void {
    this.authService.logout().subscribe()
  }
}
