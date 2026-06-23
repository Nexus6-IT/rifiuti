import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
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
  ImpersonateResult,
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
    InputNumberModule,
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
                @if (isSuperAdmin()) {
                  <th scope="col">Quota aziende</th>
                }
                <th scope="col">Stato</th>
                <th scope="col" style="width: 230px">Azioni</th>
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
                @if (isSuperAdmin()) {
                  <td>
                    <!-- Quota significativa solo per gli ADMIN -->
                    <span *ngIf="u.role === 'ADMIN'; else noQuota">
                      {{ u.companyLimit ?? 1 }}
                    </span>
                    <ng-template #noQuota><span class="text-tertiary" aria-hidden="true">—</span></ng-template>
                  </td>
                }
                <td>
                  <p-tag
                    [value]="u.enabled === false ? 'Disabilitato' : 'Abilitato'"
                    [severity]="u.enabled === false ? 'danger' : 'success'"
                  ></p-tag>
                </td>
                <td>
                  <!-- Impersona: solo SUPER_ADMIN, mai sugli altri super-admin -->
                  @if (isSuperAdmin() && u.role !== 'SUPER_ADMIN') {
                    <p-button
                      icon="pi pi-eye"
                      [rounded]="true"
                      [text]="true"
                      severity="help"
                      (onClick)="openImpersonateDialog(u)"
                      pTooltip="Impersona"
                      [ariaLabel]="'Impersona ' + u.firstName + ' ' + u.lastName"
                    />
                  }
                  <p-button
                    icon="pi pi-user-edit"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openRoleDialog(u)"
                    pTooltip="Cambia ruolo"
                    [ariaLabel]="'Cambia ruolo di ' + u.firstName + ' ' + u.lastName"
                  />
                  <!-- Imposta quota aziende: solo SUPER_ADMIN, solo per gli ADMIN -->
                  @if (isSuperAdmin() && u.role === 'ADMIN') {
                    <p-button
                      icon="pi pi-building"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="openCompanyLimitDialog(u)"
                      pTooltip="Imposta quota aziende"
                      [ariaLabel]="'Imposta quota aziende di ' + u.firstName + ' ' + u.lastName"
                    />
                  }
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
                <td [attr.colspan]="isSuperAdmin() ? 7 : 6">
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
            <div class="flex gap-2">
              <input
                id="u-fiscalCode"
                pInputText
                formControlName="fiscalCode"
                class="w-full font-mono"
                maxlength="16"
                style="text-transform: uppercase;"
                aria-describedby="u-cf-hint"
              />
              <p-button
                type="button"
                icon="pi pi-sync"
                [outlined]="true"
                pTooltip="Genera un codice fiscale di test valido"
                ariaLabel="Genera un codice fiscale di test valido"
                (onClick)="generaCfTest()"
              ></p-button>
            </div>
            <small id="u-cf-hint" class="block mt-1 text-tertiary">16 caratteri. Per i test usa "Genera".</small>
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

          <!-- Quota aziende: solo SUPER_ADMIN + ruolo ADMIN selezionato -->
          <div class="field col-12 md:col-6" *ngIf="isSuperAdmin() && selectedRoleIsAdmin()">
            <label for="u-company-limit" class="block mb-2">Quota aziende *</label>
            <p-inputNumber
              inputId="u-company-limit"
              formControlName="companyLimit"
              [min]="1"
              [showButtons]="true"
              styleClass="w-full"
              inputStyleClass="w-full"
              ariaLabel="Numero massimo di aziende creabili dall'amministratore"
              aria-describedby="u-company-limit-hint"
            ></p-inputNumber>
            <small id="u-company-limit-hint" class="block mt-1 text-tertiary">
              Numero massimo di aziende che questo amministratore potrà creare in autonomia.
            </small>
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
              Minimo 10 caratteri. L'utente la cambierà al primo accesso.
            </small>
            <small *ngIf="showError('tempPassword')" class="block mt-1 field-error">La password deve avere almeno 10 caratteri.</small>
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

      <!-- Dialog: imposta quota aziende (SUPER_ADMIN) -->
      <p-dialog
        [(visible)]="displayCompanyLimit"
        [modal]="true"
        [style]="{ width: '420px' }"
        [breakpoints]="{ '576px': '95vw' }"
        header="Quota aziende"
      >
        <div *ngIf="selectedUser() as su">
          <p class="mb-3">
            Amministratore <strong>{{ su.firstName }} {{ su.lastName }}</strong>.
            Imposta il numero massimo di aziende che può creare.
          </p>
          <label for="u-company-limit-edit" class="block mb-2">Quota aziende</label>
          <p-inputNumber
            inputId="u-company-limit-edit"
            [(ngModel)]="targetCompanyLimit"
            [min]="1"
            [showButtons]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            ariaLabel="Nuova quota aziende"
          ></p-inputNumber>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayCompanyLimit = false" />
          <p-button
            label="Salva quota"
            icon="pi pi-check"
            [loading]="savingLimit()"
            [disabled]="targetCompanyLimit === null || targetCompanyLimit < 1"
            (onClick)="confirmCompanyLimit()"
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
    tempPassword: ['', [Validators.minLength(10)]],
    /** Quota aziende: valorizzata solo dal SUPER_ADMIN per i nuovi ADMIN. */
    companyLimit: [1 as number | null],
  });

  /** Valore corrente del controllo "role" come signal (per il template). */
  private readonly roleValue = signal<UserRole | null>(
    this.createForm.controls.role.value,
  );

  /** True se il ruolo selezionato nel form di creazione è ADMIN. */
  readonly selectedRoleIsAdmin = computed(() => this.roleValue() === 'ADMIN');

  // Dialog quota aziende
  displayCompanyLimit = false;
  targetCompanyLimit: number | null = 1;
  readonly savingLimit = signal(false);

  // Impersonificazione
  readonly impersonating = signal(false);

  /** Chiavi localStorage usate durante l'impersonificazione (lette dal banner globale). */
  private static readonly IMPERSONATOR_TOKEN_KEY = 'wf_impersonator_token';
  private static readonly IMPERSONATOR_REFRESH_KEY = 'wf_impersonator_refresh';
  private static readonly IMPERSONATING_NAME_KEY = 'wf_impersonating_name';

  ngOnInit(): void {
    if (this.isSuperAdmin()) {
      this.loadTenants();
    }
    this.loadUsers();

    // Tiene allineato il signal del ruolo (guida la visibilità del campo quota)
    // e gestisce i validatori della quota quando il ruolo passa da/ad ADMIN.
    this.createForm.controls.role.valueChanges.subscribe((role) => {
      this.roleValue.set(role);
      this.syncCompanyLimitValidators();
    });
  }

  /**
   * La quota aziende è obbligatoria (>=1) solo quando il chiamante è SUPER_ADMIN
   * e il ruolo scelto è ADMIN; altrimenti il campo non è validato.
   */
  private syncCompanyLimitValidators(): void {
    const ctrl = this.createForm.controls.companyLimit;
    if (this.isSuperAdmin() && this.selectedRoleIsAdmin()) {
      ctrl.setValidators([Validators.required, Validators.min(1)]);
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
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

  /**
   * Genera un codice fiscale di test formalmente valido (formato corretto:
   * 6 lettere + 2 cifre anno + lettera mese + giorno 01-31 + lettera+3 cifre
   * comune + lettera controllo). NON e' un CF reale, solo per i test.
   */
  generaCfTest(): void {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const rl = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');
    const rd = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
    const mesi = 'ABCDEHLMPRST';
    const giorno = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    const cf = rl(6) + rd(2) + mesi[Math.floor(Math.random() * mesi.length)] + giorno + rl(1) + rd(3) + rl(1);
    this.createForm.get('fiscalCode')?.setValue(cf);
    this.createForm.get('fiscalCode')?.markAsDirty();
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
      companyLimit: 1,
    });
    this.roleValue.set('OPERATOR');
    // Per SUPER_ADMIN il tenant è obbligatorio; per ADMIN lo gestisce il backend.
    const tenantCtrl = this.createForm.get('tenantId');
    if (this.isSuperAdmin()) {
      tenantCtrl?.addValidators(Validators.required);
    } else {
      tenantCtrl?.clearValidators();
    }
    tenantCtrl?.updateValueAndValidity();
    this.syncCompanyLimitValidators();
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
    // Quota aziende: inviata solo dal SUPER_ADMIN per i nuovi ADMIN.
    if (this.isSuperAdmin() && dto.role === 'ADMIN' && v.companyLimit != null) {
      dto.companyLimit = v.companyLimit;
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

  // --- Quota aziende ---
  openCompanyLimitDialog(u: AdminUser): void {
    this.selectedUser.set(u);
    this.targetCompanyLimit = u.companyLimit ?? 1;
    this.displayCompanyLimit = true;
  }

  confirmCompanyLimit(): void {
    const u = this.selectedUser();
    const limit = this.targetCompanyLimit;
    if (!u || limit === null || limit < 1) return;
    this.savingLimit.set(true);
    this.userService.setCompanyLimit(u.id, limit).subscribe({
      next: () => {
        this.savingLimit.set(false);
        this.displayCompanyLimit = false;
        this.toast.success('Quota aziende aggiornata');
        this.loadUsers();
      },
      error: () => {
        this.savingLimit.set(false);
        this.toast.error('Errore nell\'aggiornamento della quota aziende');
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

  // --- Impersonificazione (solo SUPER_ADMIN) ---
  openImpersonateDialog(u: AdminUser): void {
    // Difesa in profondità: l'azione è già nascosta, ma blocchiamo comunque
    // l'impersonificazione di sé stessi o di altri super-admin.
    if (!this.isSuperAdmin() || u.role === 'SUPER_ADMIN') return;
    const fullName = `${u.firstName} ${u.lastName}`;
    this.confirmation.confirm({
      header: 'Impersona utente',
      message: `Vuoi impersonare ${fullName}? Agirai come questo utente finché non torni al tuo account.`,
      icon: 'pi pi-eye',
      acceptLabel: 'Impersona',
      rejectLabel: 'Annulla',
      accept: () => this.doImpersonate(u),
    });
  }

  private doImpersonate(u: AdminUser): void {
    this.impersonating.set(true);
    this.userService.impersonate(u.id).subscribe({
      next: (res: ImpersonateResult) => {
        try {
          // 1. Salva i token correnti del super admin per poter tornare indietro.
          const currentAccess = localStorage.getItem('accessToken');
          const currentRefresh = localStorage.getItem('refreshToken');
          if (currentAccess) {
            localStorage.setItem(
              UserAdminComponent.IMPERSONATOR_TOKEN_KEY,
              currentAccess,
            );
          }
          if (currentRefresh) {
            localStorage.setItem(
              UserAdminComponent.IMPERSONATOR_REFRESH_KEY,
              currentRefresh,
            );
          }
          localStorage.setItem(
            UserAdminComponent.IMPERSONATING_NAME_KEY,
            `${u.firstName} ${u.lastName}`,
          );

          // 2. Sostituisce i token con quelli dell'utente impersonato.
          localStorage.setItem('accessToken', res.accessToken);
          if (res.refreshToken) {
            localStorage.setItem('refreshToken', res.refreshToken);
          }

          // 3. Reload completo: guard/feature/menu ripartono nel contesto target.
          window.location.href = '/dashboard';
        } catch {
          this.impersonating.set(false);
          this.toast.error('Impossibile avviare l\'impersonificazione');
        }
      },
      error: () => {
        this.impersonating.set(false);
        this.toast.error('Errore durante l\'impersonificazione dell\'utente');
      },
    });
  }
}
