import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { MenuModule } from 'primeng/menu';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { SidebarModule } from 'primeng/sidebar';
import { MenuItem } from 'primeng/api';
import { AuthService, User } from '../../core/services/auth.service';
import { NotificationBellComponent } from '../../core/layout/notification-bell/notification-bell.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToolbarModule,
    MenuModule,
    ButtonModule,
    AvatarModule,
    TooltipModule,
    SidebarModule,
    NotificationBellComponent
  ],
  template: `
    <!-- Skip to main content for accessibility -->
    <a href="#main-content" class="skip-to-main">Vai al contenuto principale</a>

    <div class="app-layout">
      <!-- Top Toolbar -->
      <header class="app-header" role="banner">
        <p-toolbar styleClass="app-toolbar">
          <div class="p-toolbar-group-start">
            <!-- Mobile Menu Toggle -->
            <p-button
              icon="pi pi-bars"
              [text]="true"
              [rounded]="true"
              (onClick)="toggleMobileSidebar()"
              class="mobile-menu-toggle lg:hidden"
              aria-label="Apri menu navigazione"
            />

            <!-- Logo and Brand -->
            <div class="brand-container">
              <i class="pi pi-trash brand-icon" aria-hidden="true"></i>
              <div class="brand-text">
                <div class="brand-name">WasteFlow</div>
                <div class="brand-tagline hidden md:block">Gestione Rifiuti Digitale</div>
              </div>
            </div>
          </div>

          <div class="p-toolbar-group-end">
            <div class="toolbar-actions">
              <!-- Notifications -->
              <app-notification-bell />

              <!-- User Profile -->
              <div class="user-profile">
                <p-avatar
                  [label]="userInitials()"
                  shape="circle"
                  styleClass="user-avatar"
                  [attr.aria-label]="'Profilo utente ' + userFullName()"
                />
                <div class="user-info hidden lg:block">
                  <div class="user-name">{{ userFullName() }}</div>
                  <div class="user-email">{{ authService.currentUser()?.email }}</div>
                </div>
              </div>

              <!-- Logout Button -->
              <p-button
                icon="pi pi-sign-out"
                [text]="true"
                [rounded]="true"
                severity="danger"
                (onClick)="onLogout()"
                pTooltip="Esci"
                tooltipPosition="bottom"
                aria-label="Esci dall'applicazione"
                class="logout-btn"
              />
            </div>
          </div>
        </p-toolbar>
      </header>

      <div class="app-body">
        <!-- Desktop Sidebar Navigation -->
        <aside class="app-sidebar hidden lg:block" role="navigation" aria-label="Menu principale">
          <nav class="sidebar-nav">
            <div class="nav-section">
              <h2 class="sr-only">Menu Principale</h2>

              <!-- Dashboard -->
              <a
                routerLink="/dashboard"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/dashboard') ? 'page' : null"
              >
                <i class="pi pi-home nav-icon" aria-hidden="true"></i>
                <span class="nav-label">Dashboard</span>
              </a>

              <!-- FIR -->
              <a
                routerLink="/fir"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/fir') ? 'page' : null"
              >
                <i class="pi pi-file nav-icon" aria-hidden="true"></i>
                <span class="nav-label">FIR</span>
              </a>

              <!-- Catalogo CER -->
              <a
                routerLink="/cer"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/cer') ? 'page' : null"
              >
                <i class="pi pi-tags nav-icon" aria-hidden="true"></i>
                <span class="nav-label">Catalogo CER</span>
              </a>
            </div>

            <!-- Divider -->
            <div class="nav-divider" role="separator"></div>

            <div class="nav-section">
              <div class="nav-section-title">Anagrafiche</div>

              <!-- Produttori -->
              <a
                routerLink="/produttori"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/produttori') ? 'page' : null"
              >
                <i class="pi pi-building nav-icon" aria-hidden="true"></i>
                <span class="nav-label">Produttori</span>
              </a>

              <!-- Trasportatori -->
              <a
                routerLink="/trasportatori"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/trasportatori') ? 'page' : null"
              >
                <i class="pi pi-truck nav-icon" aria-hidden="true"></i>
                <span class="nav-label">Trasportatori</span>
              </a>

              <!-- Destinatari -->
              <a
                routerLink="/destinatari"
                routerLinkActive="nav-link-active"
                class="nav-link"
                [attr.aria-current]="isActiveRoute('/destinatari') ? 'page' : null"
              >
                <i class="pi pi-warehouse nav-icon" aria-hidden="true"></i>
                <span class="nav-label">Destinatari</span>
              </a>
            </div>
          </nav>
        </aside>

        <!-- Mobile Sidebar -->
        <p-sidebar
          [(visible)]="mobileSidebarVisible"
          position="left"
          [modal]="true"
          [showCloseIcon]="true"
          styleClass="mobile-sidebar"
        >
          <ng-template pTemplate="header">
            <div class="mobile-sidebar-header">
              <i class="pi pi-trash text-primary text-3xl" aria-hidden="true"></i>
              <span class="font-bold text-xl">WasteFlow</span>
            </div>
          </ng-template>

          <nav class="mobile-nav" role="navigation" aria-label="Menu mobile">
            <a
              routerLink="/dashboard"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-home" aria-hidden="true"></i>
              <span>Dashboard</span>
            </a>

            <a
              routerLink="/fir"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-file" aria-hidden="true"></i>
              <span>FIR</span>
            </a>

            <a
              routerLink="/cer"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-tags" aria-hidden="true"></i>
              <span>Catalogo CER</span>
            </a>

            <div class="mobile-nav-divider"></div>
            <div class="mobile-nav-section-title">Anagrafiche</div>

            <a
              routerLink="/produttori"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-building" aria-hidden="true"></i>
              <span>Produttori</span>
            </a>

            <a
              routerLink="/trasportatori"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-truck" aria-hidden="true"></i>
              <span>Trasportatori</span>
            </a>

            <a
              routerLink="/destinatari"
              routerLinkActive="nav-link-active"
              class="mobile-nav-link"
              (click)="closeMobileSidebar()"
            >
              <i class="pi pi-warehouse" aria-hidden="true"></i>
              <span>Destinatari</span>
            </a>
          </nav>
        </p-sidebar>

        <!-- Main Content -->
        <main class="app-main" id="main-content" role="main">
          <div class="main-content">
            <router-outlet></router-outlet>
          </div>
        </main>
      </div>
    </div>
  `,
  styles: [`
    /* ===== Layout Structure ===== */
    .app-layout {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      background-color: var(--surface-ground);
    }

    .app-header {
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
      background: var(--surface-card);
      box-shadow: var(--shadow-sm);
    }

    .app-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .app-sidebar {
      width: 280px;
      background: var(--surface-card);
      border-right: 1px solid var(--surface-border);
      overflow-y: auto;
      flex-shrink: 0;
    }

    .app-main {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .main-content {
      padding: var(--spacing-lg);
      max-width: 1600px;
      margin: 0 auto;
    }

    /* ===== Toolbar Styling ===== */
    .brand-container {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }

    .brand-icon {
      font-size: 2rem;
      color: var(--brand-primary);
    }

    .brand-name {
      font-size: 1.5rem;
      font-weight: var(--font-weight-bold);
      color: var(--brand-primary);
      line-height: 1;
    }

    .brand-tagline {
      font-size: var(--font-size-xs);
      color: var(--text-secondary);
      margin-top: 2px;
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }

    .user-profile {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding-left: var(--spacing-md);
      border-left: 1px solid var(--surface-border);
    }

    .user-avatar {
      background: var(--brand-primary) !important;
      color: var(--text-inverse) !important;
      font-weight: var(--font-weight-semibold);
    }

    .user-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .user-name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
      line-height: 1.2;
    }

    .user-email {
      font-size: var(--font-size-xs);
      color: var(--text-secondary);
      line-height: 1.2;
    }

    /* ===== Navigation Styling ===== */
    .sidebar-nav {
      padding: var(--spacing-lg) var(--spacing-md);
    }

    .nav-section {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: var(--spacing-base);
    }

    .nav-section-title {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-tertiary);
      padding: var(--spacing-sm) var(--spacing-md);
      margin-top: var(--spacing-sm);
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md) var(--spacing-base);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-base);
      transition: all var(--transition-fast);
      min-height: var(--touch-target-min);
    }

    .nav-link:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    .nav-link-active {
      background: var(--brand-primary) !important;
      color: var(--text-inverse) !important;
      font-weight: var(--font-weight-semibold);
    }

    .nav-link-active:hover {
      background: var(--brand-primary-dark) !important;
    }

    .nav-icon {
      font-size: 1.25rem;
      flex-shrink: 0;
    }

    .nav-label {
      flex: 1;
    }

    .nav-divider {
      height: 1px;
      background: var(--surface-border);
      margin: var(--spacing-base) 0;
    }

    /* ===== Mobile Navigation ===== */
    .mobile-menu-toggle {
      margin-right: var(--spacing-sm);
    }

    .mobile-sidebar-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }

    .mobile-nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: var(--spacing-base);
    }

    .mobile-nav-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md) var(--spacing-base);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-lg);
      transition: all var(--transition-fast);
      min-height: 52px;
    }

    .mobile-nav-link:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    .mobile-nav-link.nav-link-active {
      background: var(--brand-primary) !important;
      color: var(--text-inverse) !important;
    }

    .mobile-nav-link i {
      font-size: 1.5rem;
    }

    .mobile-nav-divider {
      height: 1px;
      background: var(--surface-border);
      margin: var(--spacing-base) 0;
    }

    .mobile-nav-section-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-tertiary);
      padding: var(--spacing-sm) var(--spacing-base);
      margin-top: var(--spacing-sm);
    }

    /* ===== Responsive Design ===== */
    @media (max-width: 1024px) {
      .main-content {
        padding: var(--spacing-base);
      }
    }

    @media (max-width: 768px) {
      .brand-name {
        font-size: 1.25rem;
      }

      .toolbar-actions {
        gap: var(--spacing-sm);
      }

      .main-content {
        padding: var(--spacing-md);
      }
    }

    @media (max-width: 576px) {
      .brand-icon {
        font-size: 1.5rem;
      }

      .brand-name {
        font-size: 1.125rem;
      }

      .logout-btn {
        display: none;
      }

      .main-content {
        padding: var(--spacing-sm);
      }
    }
  `]
})
export class LayoutComponent implements OnInit {
  menuItems: MenuItem[] = [];

  // Mobile sidebar visibility signal
  mobileSidebarVisible = signal(false);

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

  constructor(readonly authService: AuthService) {}

  ngOnInit(): void {
    // Component initialization
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
