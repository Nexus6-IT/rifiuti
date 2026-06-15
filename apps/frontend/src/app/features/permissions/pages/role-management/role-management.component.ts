import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoleStore, Role, UserRoleAssignment } from '../../../../core/state/role.store';
import { RoleApiService } from '../../services/role-api.service';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { InputTextModule } from 'primeng/inputtext';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService, MessageService } from 'primeng/api';

/**
 * RoleManagementComponent
 * Full-featured page component for managing roles and role assignments
 * Per plan.md User Story 1: Admin assigns roles to team members
 *
 * Features:
 * - PrimeNG DataTable with expandable rows for role permissions
 * - Role assignment dialog with user selection and expiration
 * - View active role assignments by user
 * - Revoke role assignments with confirmation
 * - Visual distinction between system and custom roles
 *
 * T085: Full PrimeNG implementation with CRUD operations
 */
@Component({
  selector: 'app-role-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    CardModule,
    TagModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    InputTextModule,
    CalendarModule,
    CheckboxModule,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Gestione ruoli</h1>
          <p class="page-subtitle">Assegna ruoli agli utenti e gestisci i permessi</p>
        </div>
      </header>

      <!-- Tabella ruoli -->
      <section class="surface-card mb-section" aria-label="Ruoli disponibili">
        <div class="card-toolbar">
          <h2 class="card-title">Ruoli disponibili</h2>
          <div class="card-toolbar__actions">
            <span class="p-input-icon-left search-box">
              <i class="pi pi-search" aria-hidden="true"></i>
              <label for="role-search" class="sr-only">Cerca ruoli</label>
              <input
                id="role-search"
                pInputText
                type="text"
                #searchInput
                (input)="dt.filterGlobal($any($event.target).value, 'contains')"
                placeholder="Cerca ruoli..." />
            </span>
            <button
              pButton
              icon="pi pi-refresh"
              class="p-button-outlined"
              (click)="refreshRoles()"
              label="Aggiorna"></button>
          </div>
        </div>

        <div class="table-responsive">
          <p-table
            #dt
            [value]="roleStore.roles()"
            [loading]="roleStore.isLoading()"
            [paginator]="true"
            [rows]="10"
            [rowsPerPageOptions]="[10, 25, 50]"
            [globalFilterFields]="['name', 'description']"
            dataKey="id"
            styleClass="p-datatable-sm">

            <ng-template pTemplate="header">
              <tr>
                <th style="width: 3rem"><span class="sr-only">Espandi</span></th>
                <th pSortableColumn="name">
                  Nome ruolo <p-sortIcon field="name"></p-sortIcon>
                </th>
                <th>Descrizione</th>
                <th style="width: 8rem">Tipo</th>
                <th style="width: 8rem">Utenti</th>
                <th style="width: 12rem">Azioni</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-role let-expanded="expanded">
              <tr>
                <td>
                  <button
                    type="button"
                    pButton
                    pRipple
                    [pRowToggler]="role"
                    class="p-button-text p-button-rounded p-button-plain"
                    [icon]="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                    [attr.aria-label]="(expanded ? 'Comprimi' : 'Espandi') + ' i permessi del ruolo ' + role.name"></button>
                </td>
                <td>
                  <strong>{{ role.name }}</strong>
                </td>
                <td>{{ role.description || 'Nessuna descrizione' }}</td>
                <td>
                  <p-tag
                    [value]="role.isSystemRole ? 'Sistema' : 'Personalizzato'"
                    [severity]="role.isSystemRole ? 'info' : 'success'"></p-tag>
                </td>
                <td>
                  <span class="user-count" [attr.aria-label]="getUserCount(role.id) + ' utenti assegnati'">{{ getUserCount(role.id) }}</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      pButton
                      icon="pi pi-user-plus"
                      class="p-button-sm p-button-success"
                      (click)="openAssignDialog(role)"
                      label="Assegna"
                      pTooltip="Assegna questo ruolo a un utente"></button>
                    <button
                      pButton
                      icon="pi pi-users"
                      class="p-button-sm p-button-outlined"
                      (click)="viewUserAssignments(role)"
                      pTooltip="Vedi gli utenti con questo ruolo"
                      aria-label="Vedi gli utenti con questo ruolo"></button>

                    <!-- T179: Delete custom role with validation -->
                    @if (!role.isSystemRole) {
                      <button
                        pButton
                        icon="pi pi-trash"
                        class="p-button-sm p-button-danger p-button-outlined"
                        (click)="confirmDeleteRole(role)"
                        [disabled]="getUserCount(role.id) > 0"
                        [pTooltip]="getUserCount(role.id) > 0 ? 'Impossibile eliminare: ' + getUserCount(role.id) + ' utente/i assegnato/i' : 'Elimina ruolo personalizzato'"
                        [attr.aria-label]="'Elimina il ruolo ' + role.name"></button>
                    }
                  </div>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="rowexpansion" let-role>
              <tr>
                <td colspan="6">
                  <div class="expansion">
                    <h3 class="expansion__title">Permessi di {{ role.name }}</h3>
                    <div class="permissions-grid">
                      <p-tag
                        *ngFor="let permission of role.permissions"
                        [value]="permission"
                        severity="secondary"></p-tag>
                    </div>
                    <div *ngIf="role.permissions.length === 0" class="text-tertiary">
                      Nessun permesso assegnato a questo ruolo
                    </div>
                  </div>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun ruolo trovato</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Assegnazioni attive -->
      <section class="surface-card mb-section" *ngIf="selectedRole()" aria-label="Assegnazioni di ruolo attive">
        <h2 class="card-title">Assegnazioni attive</h2>
        <div class="table-responsive">
          <p-table
            [value]="currentUserAssignments()"
            [loading]="isLoadingAssignments()"
            styleClass="p-datatable-sm">

            <ng-template pTemplate="header">
              <tr>
                <th>ID utente</th>
                <th>Ruolo</th>
                <th>Assegnato da</th>
                <th>Assegnato il</th>
                <th>Scadenza</th>
                <th>Limitato a impianti</th>
                <th style="width: 8rem">Azioni</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-assignment>
              <tr>
                <td>{{ assignment.userId }}</td>
                <td>
                  <p-tag [value]="assignment.roleName" severity="info"></p-tag>
                </td>
                <td>{{ assignment.assignedBy }}</td>
                <td>{{ assignment.assignedAt | date: 'short' }}</td>
                <td>
                  <span *ngIf="assignment.expiresAt">
                    {{ assignment.expiresAt | date: 'short' }}
                  </span>
                  <span *ngIf="!assignment.expiresAt" class="text-tertiary">
                    Mai
                  </span>
                </td>
                <td>
                  <p-tag
                    [value]="assignment.facilityIds ? 'Impianti specifici' : 'Tutti gli impianti'"
                    [severity]="assignment.facilityIds ? 'warning' : 'info'"></p-tag>
                </td>
                <td>
                  <button
                    pButton
                    icon="pi pi-trash"
                    class="p-button-sm p-button-danger p-button-outlined"
                    (click)="confirmRevokeRole(assignment)"
                    label="Revoca"></button>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <i class="pi pi-users empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessuna assegnazione attiva per questo ruolo</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Dialog assegnazione ruolo -->
      <p-dialog
        [(visible)]="showAssignDialog"
        [header]="'Assegna ruolo: ' + selectedRoleForAssignment()?.name"
        [modal]="true"
        [style]="{ width: '600px' }"
        [breakpoints]="{ '640px': '95vw' }"
        [draggable]="false">

        <div class="field">
          <label for="userId">ID utente *</label>
          <input
            id="userId"
            type="text"
            pInputText
            [(ngModel)]="assignmentForm.userId"
            class="w-full"
            placeholder="Inserisci l'ID utente" />
        </div>

        <div class="field">
          <label for="expiresAt">Data di scadenza (facoltativa)</label>
          <p-calendar
            id="expiresAt"
            [(ngModel)]="assignmentForm.expiresAt"
            [showTime]="true"
            [showIcon]="true"
            dateFormat="yy-mm-dd"
            class="w-full"
            placeholder="Nessuna scadenza"></p-calendar>
        </div>

        <div class="field">
          <label for="facilityIds">ID impianti (facoltativi, separati da virgola)</label>
          <input
            id="facilityIds"
            type="text"
            pInputText
            [(ngModel)]="assignmentForm.facilityIdsInput"
            class="w-full"
            placeholder="es. fac-1, fac-2"
            aria-describedby="facilityIds-help" />
          <small id="facilityIds-help" class="text-tertiary">
            Lascia vuoto per concedere l'accesso a tutti gli impianti
          </small>
        </div>

        <div class="field-checkbox">
          <p-checkbox
            [(ngModel)]="assignmentForm.replaceExisting"
            [binary]="true"
            inputId="replaceExisting"></p-checkbox>
          <label for="replaceExisting">
            Sostituisci le assegnazioni di ruolo esistenti dell'utente
          </label>
        </div>

        <ng-template pTemplate="footer">
          <button
            pButton
            label="Annulla"
            icon="pi pi-times"
            class="p-button-text"
            (click)="showAssignDialog = false"></button>
          <button
            pButton
            label="Assegna ruolo"
            icon="pi pi-check"
            class="p-button-success"
            (click)="assignRole()"
            [loading]="isAssigning()"></button>
        </ng-template>
      </p-dialog>

      <!-- Toast -->
      <p-toast></p-toast>

      <!-- Dialog di conferma -->
      <p-confirmDialog></p-confirmDialog>
    </div>
  `,
  styles: [`
    .mb-section { margin-bottom: var(--spacing-lg); }

    .card-title {
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      margin: 0 0 var(--spacing-base);
    }

    .card-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-base);
      margin-bottom: var(--spacing-base);
    }
    .card-toolbar .card-title { margin: 0; }
    .card-toolbar__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      align-items: center;
    }
    .search-box input { min-width: 220px; }

    .row-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); }

    .expansion { padding: var(--spacing-base); }
    .expansion__title {
      font-family: var(--font-display);
      font-size: var(--font-size-lg);
      margin: 0 0 var(--spacing-md);
    }

    .permissions-grid {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-top: var(--spacing-sm);
    }

    .user-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      height: 2rem;
      padding: 0 var(--spacing-sm);
      background: var(--brand-primary-50);
      color: var(--brand-primary-dark);
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
    }

    .field { margin-bottom: var(--spacing-lg); }
    .field label { display: block; margin-bottom: var(--spacing-sm); }
    .field .w-full { width: 100%; }
    :host ::ng-deep .field .p-calendar { width: 100%; }

    .field-checkbox {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-base);
    }

    @media (max-width: 640px) {
      .card-toolbar__actions { width: 100%; }
      .search-box, .search-box input { width: 100%; }
    }
  `]
})
export class RoleManagementComponent implements OnInit {
  protected readonly roleStore = inject(RoleStore);
  private readonly roleApiService = inject(RoleApiService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Dialog state
  showAssignDialog = false;
  selectedRole = signal<Role | null>(null);
  selectedRoleForAssignment = signal<Role | null>(null);
  currentUserAssignments = signal<UserRoleAssignment[]>([]);
  isLoadingAssignments = signal(false);
  isAssigning = signal(false);

  // Assignment form
  assignmentForm = {
    userId: '',
    expiresAt: null as Date | null,
    facilityIdsInput: '',
    replaceExisting: false,
  };

  ngOnInit(): void {
    // Load roles on component init
    this.roleStore.loadRoles();
  }

  /**
   * Refresh roles from backend
   */
  refreshRoles(): void {
    this.roleStore.loadRoles();
    this.messageService.add({
      severity: 'info',
      summary: 'Aggiornamento',
      detail: 'Caricamento dei ruoli più recenti...',
    });
  }

  /**
   * Get count of users assigned to a role
   */
  getUserCount(roleId: string): number {
    return this.roleStore
      .userRoles()
      .filter((ur) => ur.roleId === roleId).length;
  }

  /**
   * Open assignment dialog for a role
   */
  openAssignDialog(role: Role): void {
    this.selectedRoleForAssignment.set(role);
    this.resetAssignmentForm();
    this.showAssignDialog = true;
  }

  /**
   * View users with this role
   */
  viewUserAssignments(role: Role): void {
    this.selectedRole.set(role);
    this.isLoadingAssignments.set(true);

    // Filter current role assignments
    const assignments = this.roleStore
      .userRoles()
      .filter((ur) => ur.roleId === role.id);

    this.currentUserAssignments.set(assignments);
    this.isLoadingAssignments.set(false);

    this.messageService.add({
      severity: 'info',
      summary: 'Assegnazioni',
      detail: `Trovati ${assignments.length} utente/i con il ruolo ${role.name}`,
    });
  }

  /**
   * Assign role to user
   */
  assignRole(): void {
    if (!this.assignmentForm.userId.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Errore di validazione',
        detail: "L'ID utente è obbligatorio",
      });
      return;
    }

    const role = this.selectedRoleForAssignment();
    if (!role) return;

    this.isAssigning.set(true);

    // Parse facility IDs
    const facilityIds = this.assignmentForm.facilityIdsInput
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const payload = {
      userId: this.assignmentForm.userId,
      roleId: role.id,
      expiresAt: this.assignmentForm.expiresAt?.toISOString() || undefined,
      facilityIds: facilityIds.length > 0 ? facilityIds : undefined,
      replaceExisting: this.assignmentForm.replaceExisting,
    };

    this.roleApiService.assignRole(payload).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Ruolo assegnato',
          detail: `Ruolo ${role.name} assegnato con successo all'utente ${this.assignmentForm.userId}`,
        });

        // Optimistically add to store - enrich with roleName
        const enrichedAssignment: UserRoleAssignment = {
          ...response,
          roleName: role.name,
        };
        this.roleStore.addUserRole(enrichedAssignment);

        this.showAssignDialog = false;
        this.isAssigning.set(false);
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Assegnazione non riuscita',
          detail: error.error?.message || 'Impossibile assegnare il ruolo',
        });
        this.isAssigning.set(false);
      },
    });
  }

  /**
   * Confirm revoke role with user
   */
  confirmRevokeRole(assignment: UserRoleAssignment): void {
    this.confirmationService.confirm({
      message: `Vuoi davvero revocare il ruolo ${assignment.roleName} all'utente ${assignment.userId}?`,
      header: 'Conferma revoca',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Revoca',
      rejectLabel: 'Annulla',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.revokeRole(assignment);
      },
    });
  }

  /**
   * Revoke role assignment
   */
  revokeRole(assignment: UserRoleAssignment): void {
    this.roleApiService.revokeRole(assignment.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Ruolo revocato',
          detail: `Ruolo ${assignment.roleName} revocato con successo all'utente ${assignment.userId}`,
        });

        // Optimistically remove from store
        this.roleStore.removeUserRole(assignment.id);

        // Refresh assignments view
        const currentRole = this.selectedRole();
        if (currentRole) {
          this.viewUserAssignments(currentRole);
        }
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Revoca non riuscita',
          detail: error.error?.message || 'Impossibile revocare il ruolo',
        });
      },
    });
  }

  /**
   * Reset assignment form
   */
  private resetAssignmentForm(): void {
    this.assignmentForm = {
      userId: '',
      expiresAt: null,
      facilityIdsInput: '',
      replaceExisting: false,
    };
  }

  /**
   * T179: Confirm delete custom role with validation
   * Per spec.md FR-011 acceptance scenario 5:
   * "Attempts to delete role assigned to users, prevented with error message"
   */
  confirmDeleteRole(role: Role): void {
    // Check if role has users assigned
    const userCount = this.getUserCount(role.id);

    if (userCount > 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Impossibile eliminare il ruolo',
        detail: `Impossibile eliminare il ruolo "${role.name}" perché è assegnato a ${userCount} utente/i. Rimuovi tutte le assegnazioni prima di eliminarlo.`,
        life: 5000,
      });
      return;
    }

    // Prevent deleting system roles
    if (role.isSystemRole) {
      this.messageService.add({
        severity: 'error',
        summary: 'Impossibile eliminare il ruolo',
        detail: 'I ruoli di sistema non possono essere eliminati.',
        life: 3000,
      });
      return;
    }

    // Confirm deletion
    this.confirmationService.confirm({
      message: `Vuoi davvero eliminare il ruolo personalizzato "${role.name}"? L'azione non può essere annullata.`,
      header: 'Conferma eliminazione',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Elimina',
      rejectLabel: 'Annulla',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.deleteRole(role);
      },
    });
  }

  /**
   * Delete custom role
   */
  private deleteRole(role: Role): void {
    this.roleApiService.deleteRole(role.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Ruolo eliminato',
          detail: `Ruolo "${role.name}" eliminato con successo`,
        });

        // Refresh roles list
        this.roleStore.loadRoles();
      },
      error: (error) => {
        // Backend might return error if role has users (additional safety check)
        const errorMessage = error.error?.message || error.message || 'Impossibile eliminare il ruolo';

        if (errorMessage.includes('assigned to') || errorMessage.includes('user')) {
          this.messageService.add({
            severity: 'error',
            summary: 'Impossibile eliminare il ruolo',
            detail: errorMessage,
            life: 5000,
          });
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Eliminazione non riuscita',
            detail: errorMessage,
          });
        }
      },
    });
  }
}
