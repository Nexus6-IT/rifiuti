import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { MenuModule } from 'primeng/menu';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { TooltipModule } from 'primeng/tooltip';
import { MenuItem } from 'primeng/api';
import { AuthService, User } from '../../core/services/auth.service';

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
    TooltipModule
  ],
  template: `
    <div class="layout-wrapper">
      <!-- Top Menubar -->
      <p-menubar [model]="menuItems" styleClass="layout-menubar">
        <ng-template pTemplate="start">
          <div class="flex align-items-center">
            <i class="pi pi-trash mr-2" style="font-size: 1.5rem"></i>
            <span class="font-bold text-xl">WasteFlow</span>
          </div>
        </ng-template>
        <ng-template pTemplate="end">
          <div class="flex align-items-center gap-2">
            <p-avatar
              [label]="getUserInitials()"
              shape="circle"
              styleClass="mr-2"
            />
            <span class="mr-3">{{ getUserFullName() }}</span>
            <p-button
              icon="pi pi-sign-out"
              [rounded]="true"
              [text]="true"
              severity="danger"
              (onClick)="onLogout()"
              pTooltip="Logout"
              tooltipPosition="bottom"
            />
          </div>
        </ng-template>
      </p-menubar>

      <!-- Sidebar Navigation -->
      <div class="layout-sidebar">
        <div class="sidebar-content">
          <nav class="nav-menu">
            <a
              routerLink="/dashboard"
              routerLinkActive="active"
              class="nav-item"
            >
              <i class="pi pi-home"></i>
              <span>Dashboard</span>
            </a>
            <a
              routerLink="/fir"
              routerLinkActive="active"
              class="nav-item"
            >
              <i class="pi pi-file"></i>
              <span>FIR</span>
            </a>
            <a
              routerLink="/cer"
              routerLinkActive="active"
              class="nav-item"
            >
              <i class="pi pi-tags"></i>
              <span>Catalogo CER</span>
            </a>

            <div class="nav-section-title">Anagrafiche</div>
            <a
              routerLink="/produttori"
              routerLinkActive="active"
              class="nav-item nav-item-indent"
            >
              <i class="pi pi-building"></i>
              <span>Produttori</span>
            </a>
            <a
              routerLink="/trasportatori"
              routerLinkActive="active"
              class="nav-item nav-item-indent"
            >
              <i class="pi pi-truck"></i>
              <span>Trasportatori</span>
            </a>
            <a
              routerLink="/destinatari"
              routerLinkActive="active"
              class="nav-item nav-item-indent"
            >
              <i class="pi pi-warehouse"></i>
              <span>Destinatari</span>
            </a>
          </nav>
        </div>
      </div>

      <!-- Main Content -->
      <div class="layout-main">
        <div class="layout-content">
          <router-outlet></router-outlet>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .layout-wrapper {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    :host ::ng-deep .layout-menubar {
      border-radius: 0;
      border: none;
      border-bottom: 1px solid #dee2e6;
    }

    .layout-sidebar {
      position: fixed;
      top: 60px;
      left: 0;
      width: 250px;
      height: calc(100vh - 60px);
      background-color: var(--surface-card);
      border-right: 1px solid #dee2e6;
      overflow-y: auto;
    }

    .sidebar-content {
      padding: 1rem 0;
    }

    .nav-menu {
      display: flex;
      flex-direction: column;
    }

    .nav-section-title {
      padding: 1rem 1.5rem 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #6c757d;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      padding: 0.75rem 1.5rem;
      color: #495057;
      text-decoration: none;
      transition: all 0.2s;
      cursor: pointer;
    }

    .nav-item:hover {
      background-color: var(--surface-hover);
      color: var(--primary-color);
    }

    .nav-item.active {
      background-color: var(--primary-color);
      color: white;
      border-left: 3px solid var(--primary-color-text);
    }

    .nav-item-indent {
      padding-left: 2.5rem;
    }

    .nav-item i {
      margin-right: 0.75rem;
      font-size: 1.1rem;
    }

    .layout-main {
      margin-left: 250px;
      margin-top: 60px;
      min-height: calc(100vh - 60px);
      background-color: var(--surface-ground);
    }

    .layout-content {
      padding: 1.5rem;
    }

    @media (max-width: 768px) {
      .layout-sidebar {
        transform: translateX(-100%);
      }

      .layout-main {
        margin-left: 0;
      }
    }
  `]
})
export class LayoutComponent implements OnInit {
  menuItems: MenuItem[] = [];
  currentUser: User | null = null;

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    this.menuItems = [
      {
        label: 'File',
        icon: 'pi pi-file',
        items: [
          {
            label: 'Nuovo FIR',
            icon: 'pi pi-plus',
            command: () => {
              // Navigate to create FIR
            }
          }
        ]
      }
    ];
  }

  getUserInitials(): string {
    if (!this.currentUser) return 'U';
    const firstName = this.currentUser.firstName || '';
    const lastName = this.currentUser.lastName || '';

    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    } else if (firstName) {
      return firstName[0].toUpperCase();
    } else if (this.currentUser.email) {
      return this.currentUser.email[0].toUpperCase();
    }
    return 'U';
  }

  getUserFullName(): string {
    if (!this.currentUser) return 'User';
    const firstName = this.currentUser.firstName || '';
    const lastName = this.currentUser.lastName || '';

    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    } else if (firstName) {
      return firstName;
    } else if (this.currentUser.email) {
      return this.currentUser.email;
    }
    return 'User';
  }

  onLogout(): void {
    this.authService.logout();
  }
}
