import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { AvatarModule } from 'primeng/avatar';
import { TagModule } from 'primeng/tag';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../services/auth.service';

/**
 * Header Component
 *
 * Application header with user session display and tenant selector.
 * Shows user info, SPID level, and logout functionality.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    ToolbarModule,
    ButtonModule,
    MenuModule,
    AvatarModule,
    TagModule,
    OverlayPanelModule,
  ],
  template: `
    <p-toolbar styleClass="border-noround shadow-2">
      <ng-template pTemplate="start">
        <div class="flex align-items-center gap-3">
          <i class="pi pi-trash text-3xl text-primary"></i>
          <h2 class="m-0 text-2xl font-bold text-primary">WasteFlow</h2>
        </div>
      </ng-template>

      <ng-template pTemplate="end">
        @if (currentUser()) {
          <div class="flex align-items-center gap-3">
            <!-- SPID Level Badge -->
            @if (currentUser()!.spidLevel > 0) {
              <p-tag
                [value]="'SPID L' + currentUser()!.spidLevel"
                [severity]="getSpidLevelSeverity()"
                data-cy="spid-level-badge">
              </p-tag>
            }

            <!-- Can Sign Indicator -->
            @if (currentUser()!.canSignDocuments) {
              <i
                class="pi pi-verified text-green-500 text-xl"
                pTooltip="Autorizzato a firmare documenti"
                tooltipPosition="bottom"
                data-cy="can-sign-indicator">
              </i>
            }

            <!-- User Menu -->
            <div class="flex align-items-center gap-2 cursor-pointer" (click)="userMenu.toggle($event)" data-cy="user-menu">
              <p-avatar
                [label]="getUserInitials()"
                styleClass="bg-primary"
                shape="circle">
              </p-avatar>
              <div class="flex flex-column align-items-start">
                <span class="font-semibold">{{ currentUser()!.fullName }}</span>
                <span class="text-sm text-color-secondary" data-cy="user-fiscal-code">
                  {{ currentUser()!.fiscalCode }}
                </span>
              </div>
              <i class="pi pi-chevron-down text-sm"></i>
            </div>

            <p-overlayPanel #userMenu data-cy="user-info-panel">
              <div class="p-3" style="min-width: 300px">
                <div class="mb-3 pb-3 border-bottom-1 border-300">
                  <h3 class="mt-0 mb-2">Informazioni utente</h3>
                  <div class="text-sm">
                    <div class="mb-2">
                      <span class="font-semibold">Nome:</span>
                      {{ currentUser()!.fullName }}
                    </div>
                    <div class="mb-2">
                      <span class="font-semibold">Codice Fiscale:</span>
                      <span data-cy="user-fiscal-code">{{ currentUser()!.fiscalCode }}</span>
                    </div>
                    <div class="mb-2">
                      <span class="font-semibold">Email:</span>
                      <span data-cy="user-email">{{ currentUser()!.email }}</span>
                    </div>
                    <div class="mb-2">
                      <span class="font-semibold">Livello SPID:</span>
                      <span data-cy="spid-level">{{ currentUser()!.spidLevel || 'N/A' }}</span>
                    </div>
                    <div>
                      <span class="font-semibold">Ruoli:</span>
                      {{ currentUser()!.roles.join(', ') }}
                    </div>
                  </div>
                </div>

                <button
                  pButton
                  type="button"
                  label="Esci"
                  icon="pi pi-sign-out"
                  class="w-full p-button-danger p-button-outlined"
                  (click)="logout()"
                  data-cy="logout-button">
                </button>
              </div>
            </p-overlayPanel>
          </div>
        }
      </ng-template>
    </p-toolbar>
  `,
  styles: [
    `
      :host ::ng-deep .p-toolbar {
        padding: 1rem 2rem;
      }

      .cursor-pointer {
        cursor: pointer;
      }

      .cursor-pointer:hover {
        opacity: 0.8;
      }
    `,
  ],
})
export class HeaderComponent implements OnInit {
  private readonly authService = inject(AuthService);

  protected readonly currentUser = this.authService.currentUser;

  ngOnInit(): void {
    // Subscribe to user changes
    this.authService.getCurrentUser$().subscribe((user) => {
      if (user) {
        console.log('User logged in:', user);
      }
    });
  }

  protected getUserInitials(): string {
    const user = this.currentUser();
    if (!user) return '?';

    const firstInitial = user.firstName?.charAt(0) || '';
    const lastInitial = user.lastName?.charAt(0) || '';

    return (firstInitial + lastInitial).toUpperCase();
  }

  protected getSpidLevelSeverity(): 'success' | 'warning' | 'info' {
    const level = this.currentUser()?.spidLevel || 0;

    if (level >= 3) return 'success';
    if (level >= 2) return 'info';
    return 'warning';
  }

  protected logout(): void {
    this.authService.logout().subscribe();
  }
}
