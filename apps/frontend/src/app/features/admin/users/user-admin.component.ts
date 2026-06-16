import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  UserAdminService,
  AdminUser,
  CreateUserDto,
  UserRole,
  TenantOption,
} from './user-admin.service';

interface SelectOption<T> {
  label: string;
  value: T;
}

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super amministratore',
  ADMIN: 'Amministratore',
  OPERATOR: 'Operatore',
  VIEWER: 'Visualizzatore',
};

const ROLE_SEVERITY: Record<UserRole, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
  SUPER_ADMIN: 'danger',
  ADMIN: 'warning',
  OPERATOR: 'info',
  VIEWER: 'secondary',
};

/** Regex CF persona fisica (16 alfanumerici); validazione di forma, non di checksum. */
const CF_REGEX = /^[A-Za-z0-9]{16}$/;

@Component({
  selector: 'app-user-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    PasswordModule,
    ConfirmDialogModule,
    TooltipModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Gestione Utenti</h1>
          <p class="page-subtitle">Crea e gestisci gli utenti, i ruoli e gli accessi</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo utente"
            icon="pi pi-plus"
            (onClick)="openCreateDialog()"
            ariaLabel="Crea un nuovo utente"
          />
        </div>
      </header>

      <!-- Selettore tenant (solo SUPER_ADMIN) -->
      <section *ngIf="isSuperAdmin()" class="surface-card mb-4" aria-label="Filtro per tenant">
        <div class="grid formgrid" style="align-items: end;">
          <div class="field col-12 md:col-5">
            <label for="tenant-filter" class="block mb-2">Tenant</label>
            <p-dropdown
              inputId="tenant-filter"
              [options]="tenantOptions()"
              [(ngModel)]="tenantFilter"
              optionLabel="ragioneSociale"
              optionValue="id"
              [filter]="true"
              filterBy="ragioneSociale"
              [showClear]="true"
              placeholder="Tutti i tenant"
              styleClass="w-full"
              ariaLabel="Filtra utenti per tenant"
              (onChange)="loadUsers()"
              (onClear)="loadUsers()"
            ></p-dropdown>
          </div>
          <div class="field col-12 md:col-3 flex align-items-end">
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [outlined]="true"
              (onClick)="loadUsers()"
              ariaLabel="Aggiorna l'elenco degli utenti"
            />
          </div>
        </div>
      </section>

      <!-- Stato error -->
      <section *ngIf="error()" class="surface-card">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger" aria-hidden="true"></i>
          <span class="empty-state__title">Impossibile caricare gli utenti</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadUsers()" />
        </div>
      </section>

      <!-- Tabella -->
      <section *ngIf="!error()" class="surface-card">
        <div class="table-responsive">
          <p-table
            [value]="users()"
            [loading]="loading()"
            [paginator]="users().length > 10"
            [rows]="10"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Email</th>
                <th scope="col">Codice fiscale</th>
                <th scope="col">Ruolo</th>
                <th scope="col">Stato</th>
                <th scope="col" style="width: 140px">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-u>
              <tr>
                <td><strong>{{ u.firstName }} {{ u.lastName }}</strong></td>
                <td>{{ u.email }}</td>
                <td class="font-mono">{{ u.fiscalCode }}</td>
                <td>
                  <p-tag [value]="roleLabel(u.role)" [severity]="roleSeverity(u.role)"></p-tag>
                </td>
                <td>
                  <p-tag
                    [value]="u.enabled === false ? 'Disabilitato' : 'Abilitato'"
                    [severity]="u.enabled === false ? 'danger' : 'success'"
                  ></p-tag>
                </td>
                <td>
                  <p-button
                    icon="pi pi-user-edit"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openRoleDialog(u)"
                    pTooltip="Cambia ruolo"
                    [ariaLabel]="'Cambia ruolo di ' + u.firstName + ' ' + u.lastName"
                  />
                  <p-button
                    [icon]="u.enabled === false ? 'pi pi-lock-open' : 'pi pi-lock'"
                    [rounded]="true"
                    [text]="true"
                    [severity]="u.enabled === false ? 'success' : 'danger'"
                    (onClick)="toggleStatus(u)"
                    [pTooltip]="u.enabled === false ? 'Abilita utente' : 'Disabilita utente'"
                    [ariaLabel]="(u.enabled === false ? 'Abilita ' : 'Disabilita ') + u.firstName + ' ' + u.lastName"
                  />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <i class="pi pi-users empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">Nessun utente</span>
                    <p>Non risultano utenti. Crea il primo utente con "Nuovo utente".</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Dialog: nuovo utente -->
      <p-dialog
        [(visible)]="displayCreate"
        [modal]="true"
        [style]="{ width: '640px' }"
        [breakpoints]="{ '768px': '95vw' }"
        header="Nuovo utente"
      >
        <form [formGroup]="createForm" class="grid formgrid" (ngSubmit)="createUser()">
          <div class="field col-12 md:col-6">
            <label for="u-firstName" class="block mb-2">Nome *</label>
            <input id="u-firstName" pInputText formControlName="firstName" class="w-full" autocomplete="given-name" />
            <small *ngIf="showError('firstName')" class="block mt-1 field-error">Il nome è obbligatorio.</small>
          </div>
          <div class="field col-12 md:col-6">
            <label for="u-lastName" class="block mb-2">Cognome *</label>
            <input id="u-lastName" pInputText formControlName="lastName" class="w-full" autocomplete="family-name" />
            <small *ngIf="showError('lastName')" class="block mt-1 field-error">Il cognome è obbligatorio.</small>
          </div>

          <div class="field col-12 md:col-6">
            <label for="u-email" class="block mb-2">Email *</label>
            <input id="u-email" pInputText type="email" formControlName="email" class="w-full" autocomplete="email" />
            <small *ngIf="showError('email')" class="block mt-1 field-error">Inserisci un indirizzo email valido.</small>
          </div>
          <div class="field col-12 md:col-6">
            <label for="u-fiscalCode" class="block mb-2">Codice fiscale *</label>
            <input
              id="u-fiscalCode"
              pInputText
              formControlName="fiscalCode"
              class="w-full font-mono"
              maxlength="16"
              style="text-transform: uppercase;"
            />
            <small *ngIf="showError('fiscalCode')" class="block mt-1 field-error">Il codice fiscale deve avere 16 caratteri.</small>
          </div>

          <div class="field col-12" [class.md:col-6]="!isSuperAdmin()">
            <label for="u-role" class="block mb-2">Ruolo *</label>
            <p-dropdown
              inputId="u-role"
              [options]="roleOptions"
              formControlName="role"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona un ruolo"
              styleClass="w-full"
              appendTo="body"
              ariaLabel="Ruolo dell'utente"
            ></p-dropdown>
            <small *ngIf="showError('role')" class="block mt-1 field-error">Seleziona un ruolo.</small>
          </div>

          <div class="field col-12 md:col-6" *ngIf="isSuperAdmin()">
            <label for="u-tenant" class="block mb-2">Tenant *</label>
            <p-dropdown
              inputId="u-tenant"
              [options]="tenantOptions()"
              formControlName="tenantId"
              optionLabel="ragioneSociale"
              optionValue="id"
              [filter]="true"
              filterBy="ragioneSociale"
              placeholder="Seleziona il tenant"
              styleClass="w-full"
              appendTo="body"
              ariaLabel="Tenant dell'utente"
            ></p-dropdown>
            <small *ngIf="showError('tenantId')" class="block mt-1 field-error">Seleziona un tenant.</small>
          </div>

          <div class="field col-12">
            <label for="u-password" class="block mb-2">Password temporanea</label>
            <p-password
              inputId="u-password"
              formControlName="tempPassword"
              [feedback]="false"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"
              autocomplete="new-password"
              ariaLabel="Password temporanea"
            ></p-password>
            <small id="u-password-hint" class="block mt-1 text-tertiary">
              Minimo 8 caratteri. L'utente la cambierà al primo accesso. Lascia vuoto per generarla automaticamente.
            </small>
            <small *ngIf="showError('tempPassword')" class="block mt-1 field-error">La password deve avere almeno 8 caratteri.</small>
          </div>
        </form>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayCreate = false" />
          <p-button label="Crea utente" icon="pi pi-check" [loading]="saving()" (onClick)="createUser()" />
        </ng-template>
      </p-dialog>

      <!-- Dialog: cambia ruolo -->
      <p-dialog
        [(visible)]="displayRole"
        [modal]="true"
        [style]="{ width: '420px' }"
        [breakpoints]="{ '576px': '95vw' }"
        header="Cambia ruolo"
      >
        <div *ngIf="selectedUser() as su">
          <p class="mb-3">
            Utente <strong>{{ su.firstName }} {{ su.lastName }}</strong> — ruolo attuale:
            <p-tag [value]="roleLabel(su.role)" [severity]="roleSeverity(su.role)"></p-tag>
          </p>
          <label for="u-target-role" class="block mb-2">Nuovo ruolo</label>
          <p-dropdown
            inputId="u-target-role"
            [options]="roleOptions"
            [(ngModel)]="targetRole"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona un ruolo"
            styleClass="w-full"
            appendTo="body"
            ariaLabel="Nuovo ruolo da assegnare"
          ></p-dropdown>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayRole = false" />
          <p-button
            label="Conferma"
            icon="pi pi-check"
            [loading]="changingRole()"
            [disabled]="!targetRole || targetRole === selectedUser()?.role"
            (onClick)="confirmRoleChange()"
          />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [
    `
      .text-tertiary { color: var(--text-tertiary); }
      .field-error { color: var(--color-danger); }
      .empty-state__icon--danger { color: var(--color-danger); }
      .mb-4 { margin-bottom: var(--spacing-xl); }
      .mb-3 { margin-bottom: var(--spacing-base); }
      .mb-2 { margin-bottom: var(--spacing-sm); }
      .mt-1 { margin-top: var(--spacing-xs); }
      .field { margin-bottom: 0; }
    `,
  ],
})
export class UserAdminComponent implements OnInit {
  private readonly userService = inject(UserAdminService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly users = signal<AdminUser[]>([]);
  readonly tenantOptions = signal<TenantOption[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly saving = signal(false);
  readonly changingRole = signal(false);
  readonly selectedUser = signal<AdminUser | null>(null);

  /** True se l'utente corrente è SUPER_ADMIN (mostra selettore/campo tenant). */
  readonly isSuperAdmin = computed(() => this.auth.currentUser()?.role === 'SUPER_ADMIN');

  tenantFilter: string | null = null;

  displayCreate = false;
  displayRole = false;
  targetRole: UserRole | null = null;

  readonly roleOptions: SelectOption<UserRole>[] = (Object.keys(ROLE_LABELS) as UserRole[]).map(
    (r) => ({ label: ROLE_LABELS[r], value: r })
  );

  readonly createForm = this.fb.group({
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    fiscalCode: ['', [Validators.required, Validators.pattern(CF_REGEX)]],
    role: ['OPERATOR' as UserRole, [Validators.required]],
    tenantId: [null as string | null],
    tempPassword: ['', [Validators.minLength(8)]],
  });

  ngOnInit(): void {
    if (this.isSuperAdmin()) {
      this.loadTenants();
    }
    this.loadUsers();
  }

  loadTenants(): void {
    this.userService.listTenants().subscribe({
      next: (rows) => this.tenantOptions.set(rows ?? []),
      error: () => this.toast.error('Errore nel caricamento dei tenant'),
    });
  }

  loadUsers(): void {
    this.loading.set(true);
    this.error.set(false);
    const tenantId = this.isSuperAdmin() ? this.tenantFilter ?? undefined : undefined;
    this.userService.list(tenantId).subscribe({
      next: (rows) => {
        this.users.set(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
        this.toast.error('Errore nel caricamento degli utenti');
      },
    });
  }

  // --- Etichette ---
  roleLabel(r: UserRole): string {
    return ROLE_LABELS[r] ?? r;
  }
  roleSeverity(r: UserRole): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    return ROLE_SEVERITY[r] ?? 'info';
  }

  // --- Form helper ---
  showError(controlName: string): boolean {
    const c = this.createForm.get(controlName);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  // --- Creazione ---
  openCreateDialog(): void {
    this.createForm.reset({
      firstName: '',
      lastName: '',
      email: '',
      fiscalCode: '',
      role: 'OPERATOR',
      tenantId: null,
      tempPassword: '',
    });
    // Per SUPER_ADMIN il tenant è obbligatorio; per ADMIN lo gestisce il backend.
    const tenantCtrl = this.createForm.get('tenantId');
    if (this.isSuperAdmin()) {
      tenantCtrl?.addValidators(Validators.required);
    } else {
      tenantCtrl?.clearValidators();
    }
    tenantCtrl?.updateValueAndValidity();
    this.displayCreate = true;
  }

  createUser(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      this.toast.warn('Compila correttamente tutti i campi obbligatori');
      return;
    }
    const v = this.createForm.getRawValue();
    const dto: CreateUserDto = {
      firstName: (v.firstName ?? '').trim(),
      lastName: (v.lastName ?? '').trim(),
      email: (v.email ?? '').trim(),
      fiscalCode: (v.fiscalCode ?? '').trim().toUpperCase(),
      role: v.role as UserRole,
    };
    if (this.isSuperAdmin() && v.tenantId) {
      dto.tenantId = v.tenantId;
    }
    if (v.tempPassword) {
      dto.tempPassword = v.tempPassword;
    }

    this.saving.set(true);
    this.userService.create(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.displayCreate = false;
        this.toast.success('Utente creato');
        this.loadUsers();
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Errore nella creazione dell\'utente');
      },
    });
  }

  // --- Cambio ruolo ---
  openRoleDialog(u: AdminUser): void {
    this.selectedUser.set(u);
    this.targetRole = u.role;
    this.displayRole = true;
  }

  confirmRoleChange(): void {
    const u = this.selectedUser();
    if (!u || !this.targetRole || this.targetRole === u.role) return;
    const role = this.targetRole;
    this.changingRole.set(true);
    this.userService.updateRole(u.id, role).subscribe({
      next: () => {
        this.changingRole.set(false);
        this.displayRole = false;
        this.toast.success('Ruolo aggiornato');
        this.loadUsers();
      },
      error: () => {
        this.changingRole.set(false);
        this.toast.error('Errore nell\'aggiornamento del ruolo');
      },
    });
  }

  // --- Abilita/disabilita ---
  toggleStatus(u: AdminUser): void {
    const enable = u.enabled === false; // se disabilitato → abilita
    const azione = enable ? 'abilitare' : 'disabilitare';
    this.confirmation.confirm({
      header: enable ? 'Abilita utente' : 'Disabilita utente',
      message: `Sei sicuro di voler ${azione} ${u.firstName} ${u.lastName}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Conferma',
      rejectLabel: 'Annulla',
      accept: () => {
        this.userService.setStatus(u.id, enable).subscribe({
          next: () => {
            this.toast.success(enable ? 'Utente abilitato' : 'Utente disabilitato');
            this.loadUsers();
          },
          error: () => this.toast.error('Errore nell\'aggiornamento dello stato'),
        });
      },
    });
  }
}
