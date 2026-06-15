import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { SidebarModule } from 'primeng/sidebar';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { NotificationBellComponent } from '../../core/layout/notification-bell/notification-bell.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AvatarModule,
    TooltipModule,
    SidebarModule,
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
        background: var(--surface-card);
        border-right: 1px solid var(--surface-border);
      }
    }

    /* ===== Brand ===== */
    .sidebar__brand {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-lg) var(--spacing-base);
      text-decoration: none;
      border-bottom: 1px solid var(--surface-border);
      transition: background var(--transition-fast);
    }
    .sidebar__brand:hover { background: var(--surface-hover); text-decoration: none; }
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
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .sidebar__brand-tagline {
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
      margin-top: 2px;
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
      color: var(--text-tertiary);
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
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-sm);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .nav-item:hover { background: var(--surface-hover); color: var(--text-primary); text-decoration: none; }

    .nav-item__icon { font-size: 1.15rem; width: 1.35rem; text-align: center; flex-shrink: 0; color: var(--text-tertiary); transition: color var(--transition-fast); }
    .nav-item:hover .nav-item__icon { color: var(--brand-primary); }
    .nav-item__label { flex: 1; min-width: 0; }

    /* Stato attivo: superficie tenue + barra brand + testo brand */
    .nav-item--active {
      background: var(--brand-primary-50);
      color: var(--brand-primary-dark);
      font-weight: var(--font-weight-semibold);
    }
    .nav-item--active:hover { background: var(--brand-primary-50); color: var(--brand-primary-dark); }
    .nav-item--active .nav-item__icon { color: var(--brand-primary-dark); }
    .nav-item--active::before {
      content: '';
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 1.4rem;
      border-radius: var(--radius-full);
      background: var(--brand-primary);
    }

    /* ===== Footer sidebar: utente + logout ===== */
    .sidebar__footer {
      padding: var(--spacing-md);
      border-top: 1px solid var(--surface-border);
    }
    .user-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm);
      border-radius: var(--radius-md);
      background: var(--surface-hover);
    }
    .user-card__info { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
    .user-card__name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-card__email {
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-card__logout {
      display: grid; place-items: center;
      width: var(--touch-target-min); height: var(--touch-target-min);
      flex-shrink: 0;
      border: none; background: transparent; cursor: pointer;
      border-radius: var(--radius-md);
      color: var(--text-tertiary);
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .user-card__logout i { font-size: 1.15rem; }
    .user-card__logout:hover { background: var(--color-danger-bg); color: var(--color-danger); }

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

    /* ===== Drawer mobile (p-sidebar) ===== */
    :host ::ng-deep .mobile-drawer .p-sidebar-header { padding: var(--spacing-base) var(--spacing-base) var(--spacing-sm); }
    :host ::ng-deep .mobile-drawer .p-sidebar-content { padding: 0 var(--spacing-sm) var(--spacing-base); }
    :host ::ng-deep .mobile-drawer .p-sidebar-footer { padding: var(--spacing-sm) var(--spacing-base) var(--spacing-base); border-top: 1px solid var(--surface-border); }
    :host ::ng-deep .mobile-drawer .sidebar__nav { padding: var(--spacing-sm) var(--spacing-xs); overflow: visible; }

    .drawer__logout {
      display: flex; align-items: center; justify-content: center;
      gap: var(--spacing-sm);
      width: 100%;
      min-height: var(--touch-target-min);
      border: 1px solid var(--surface-border-strong);
      background: transparent;
      border-radius: var(--radius-md);
      color: var(--color-danger);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .drawer__logout:hover { background: var(--color-danger-bg); }
  `]
})
export class LayoutComponent implements OnInit {
  menuItems: MenuItem[] = [];

  // Mobile sidebar visibility signal
  mobileSidebarVisible = signal(false);

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
    { label: 'Destinatari', route: '/destinatari', icon: 'pi pi-warehouse' }
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
  }

  /** Aggiorna il titolo di contesto in base alla voce di menu corrispondente alla rotta. */
  private updateTitle(): void {
    const all = [...this.navMain, ...this.navAnagrafiche, ...this.navImpostazioni];
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
