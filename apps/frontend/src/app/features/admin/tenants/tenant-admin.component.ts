import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { ToastService } from '../../../core/services/toast.service';
import {
  TenantAdminService,
  Tenant,
  CreateTenantDto,
  UpdateTenantDto,
  SubscriptionStatus,
  SubscriptionTier,
} from './tenant-admin.service';

interface SelectOption<T> {
  label: string;
  value: T;
}

/** Etichette in italiano per gli stati abbonamento noti. */
const STATUS_LABELS: Record<string, string> = {
  TRIAL: 'In prova',
  ACTIVE: 'Attivo',
  SUSPENDED: 'Sospeso',
  CANCELLED: 'Annullato',
  EXPIRED: 'Scaduto',
};

/** Severità del p-tag per stato (con testo, mai solo colore). */
const STATUS_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
  TRIAL: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CANCELLED: 'secondary',
  EXPIRED: 'danger',
};

/** Etichette in italiano per i piani di abbonamento noti. */
const TIER_LABELS: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

/** Modello del form crea/modifica tenant. */
interface TenantFormData {
  partitaIva: string;
  ragioneSociale: string;
  codiceFiscale: string;
  pec: string;
  telefono: string;
  atecoCode: string;
  address: string;
  civico: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  firLimitPerMonth: number | null;
  userLimitTotal: number | null;
}

@Component({
  selector: 'app-tenant-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    TooltipModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Gestione Tenant</h1>
          <p class="page-subtitle">Amministrazione delle organizzazioni clienti della piattaforma</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo tenant"
            icon="pi pi-plus"
            (onClick)="openCreateDialog()"
            ariaLabel="Crea un nuovo tenant"
          />
        </div>
      </header>

      <!-- Stato errore -->
      <section *ngIf="error()" class="surface-card" aria-live="polite">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger" aria-hidden="true"></i>
          <span class="empty-state__title">Impossibile caricare i tenant</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadTenants()" />
        </div>
      </section>

      <!-- Tabella -->
      <section *ngIf="!error()" class="surface-card tenant-panel" aria-label="Elenco tenant">
        <div class="table-responsive">
          <p-table
            [value]="tenants()"
            [loading]="loading()"
            [paginator]="tenants().length > 10"
            [rows]="10"
            [rowsPerPageOptions]="[10, 25, 50]"
            currentPageReportTemplate="{first}-{last} di {totalRecords}"
            [showCurrentPageReport]="tenants().length > 10"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Ragione sociale</th>
                <th scope="col">Partita IVA</th>
                <th scope="col">Città / Prov.</th>
                <th scope="col">Piano</th>
                <th scope="col">Stato</th>
                <th scope="col" style="width: 7rem">Utenti</th>
                <th scope="col" style="width: 8rem">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-t>
              <tr>
                <td>
                  <span class="cell-label">Ragione sociale</span>
                  <span class="font-semibold">{{ t.ragioneSociale }}</span>
                </td>
                <td>
                  <span class="cell-label">Partita IVA</span>
                  <span class="mono">{{ t.partitaIva }}</span>
                </td>
                <td>
                  <span class="cell-label">Città / Prov.</span>
                  {{ t.city }} ({{ t.province }})
                </td>
                <td>
                  <span class="cell-label">Piano</span>
                  {{ tierLabel(t.subscriptionTier) }}
                </td>
                <td>
                  <span class="cell-label">Stato</span>
                  <p-tag [value]="statusLabel(t.subscriptionStatus)" [severity]="statusSeverity(t.subscriptionStatus)"></p-tag>
                </td>
                <td>
                  <span class="cell-label">Utenti</span>
                  {{ t._count?.users ?? 0 }}
                </td>
                <td>
                  <span class="cell-label">Azioni</span>
                  <div class="row-actions">
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="openEditDialog(t)"
                      pTooltip="Modifica"
                      tooltipPosition="top"
                      [ariaLabel]="'Modifica ' + t.ragioneSociale"
                    />
                    <p-button
                      *ngIf="t.subscriptionStatus !== 'SUSPENDED'"
                      icon="pi pi-ban"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmSetStatus(t, 'SUSPENDED')"
                      pTooltip="Sospendi"
                      tooltipPosition="top"
                      [ariaLabel]="'Sospendi ' + t.ragioneSociale"
                    />
                    <p-button
                      *ngIf="t.subscriptionStatus === 'SUSPENDED'"
                      icon="pi pi-check-circle"
                      [rounded]="true"
                      [text]="true"
                      severity="success"
                      (onClick)="confirmSetStatus(t, 'ACTIVE')"
                      pTooltip="Riattiva"
                      tooltipPosition="top"
                      [ariaLabel]="'Riattiva ' + t.ragioneSociale"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <i class="pi pi-building empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">Nessun tenant</span>
                    <p>Crea il primo tenant per iniziare a gestire le organizzazioni clienti.</p>
                    <p-button label="Nuovo tenant" icon="pi pi-plus" (onClick)="openCreateDialog()" ariaLabel="Crea un nuovo tenant" />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="loadingbody">
              <tr>
                <td colspan="7">
                  <div class="loading-row">
                    <p-progressSpinner styleClass="loading-spinner" strokeWidth="4" aria-label="Caricamento in corso" />
                    <span>Caricamento tenant…</span>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Dialog crea/modifica -->
      <p-dialog
        [(visible)]="displayDialog"
        [modal]="true"
        [draggable]="false"
        [style]="{ width: '56rem' }"
        [breakpoints]="{ '768px': '95vw' }"
        [header]="editMode() ? 'Modifica tenant' : 'Nuovo tenant'"
        [dismissableMask]="true"
      >
        <form class="dialog-form" (ngSubmit)="save()">
          <fieldset class="form-fieldset">
            <legend class="form-legend">Dati anagrafici</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-6">
                <label for="t-ragione">Ragione sociale <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-ragione" name="ragioneSociale" [(ngModel)]="form.ragioneSociale"
                       placeholder="es. Azienda S.r.l." required autocomplete="organization" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-piva">Partita IVA <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-piva" name="partitaIva" [(ngModel)]="form.partitaIva"
                       placeholder="11 cifre" maxlength="11" inputmode="numeric"
                       [disabled]="editMode()" required
                       [attr.aria-describedby]="editMode() ? 't-piva-help' : null" />
                <small *ngIf="editMode()" id="t-piva-help" class="block mt-1 text-tertiary">
                  La partita IVA non è modificabile.
                </small>
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-cf">Codice fiscale</label>
                <input pInputText id="t-cf" name="codiceFiscale" [(ngModel)]="form.codiceFiscale"
                       placeholder="opzionale" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-ateco">Codice ATECO</label>
                <input pInputText id="t-ateco" name="atecoCode" [(ngModel)]="form.atecoCode"
                       placeholder="es. 38.11.00" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-pec">PEC</label>
                <input pInputText id="t-pec" name="pec" type="email" [(ngModel)]="form.pec"
                       placeholder="pec@esempio.it" autocomplete="email" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-tel">Telefono</label>
                <input pInputText id="t-tel" name="telefono" [(ngModel)]="form.telefono"
                       placeholder="opzionale" autocomplete="tel" />
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Sede</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-8">
                <label for="t-address">Indirizzo <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-address" name="address" [(ngModel)]="form.address"
                       placeholder="es. Via Roma" required autocomplete="address-line1" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="t-civico">Civico</label>
                <input pInputText id="t-civico" name="civico" [(ngModel)]="form.civico"
                       placeholder="es. 12" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-city">Città <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-city" name="city" [(ngModel)]="form.city"
                       placeholder="es. Milano" required autocomplete="address-level2" />
              </div>
              <div class="field col-12 md:col-3">
                <label for="t-province">Provincia <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-province" name="province" [(ngModel)]="form.province"
                       placeholder="es. MI" maxlength="2" style="text-transform: uppercase" required />
              </div>
              <div class="field col-12 md:col-3">
                <label for="t-cap">CAP <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="t-cap" name="postalCode" [(ngModel)]="form.postalCode"
                       placeholder="5 cifre" maxlength="5" inputmode="numeric" required autocomplete="postal-code" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-country">Nazione</label>
                <input pInputText id="t-country" name="country" [(ngModel)]="form.country"
                       placeholder="es. IT" />
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Abbonamento</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-6">
                <label for="t-tier">Piano</label>
                <p-dropdown
                  inputId="t-tier"
                  [options]="tierOptions"
                  [(ngModel)]="form.subscriptionTier"
                  name="subscriptionTier"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Seleziona"
                  styleClass="w-full"
                  appendTo="body"
                ></p-dropdown>
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-status">Stato</label>
                <p-dropdown
                  inputId="t-status"
                  [options]="statusOptions"
                  [(ngModel)]="form.subscriptionStatus"
                  name="subscriptionStatus"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Seleziona"
                  styleClass="w-full"
                  appendTo="body"
                ></p-dropdown>
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-fir-limit">Limite FIR / mese</label>
                <p-inputNumber inputId="t-fir-limit" [(ngModel)]="form.firLimitPerMonth" name="firLimitPerMonth"
                               [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-user-limit">Limite utenti totale</label>
                <p-inputNumber inputId="t-user-limit" [(ngModel)]="form.userLimitTotal" name="userLimitTotal"
                               [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
              </div>
            </div>
          </fieldset>
        </form>

        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" icon="pi pi-times" (onClick)="displayDialog = false" />
          <p-button
            [label]="editMode() ? 'Salva modifiche' : 'Crea tenant'"
            icon="pi pi-check"
            [loading]="saving()"
            (onClick)="save()"
          />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [`
    .tenant-panel { padding: 0; overflow: hidden; }
    .table-responsive { border-radius: 0; }
    :host ::ng-deep .p-datatable { border: none; border-radius: 0; }

    .mono { font-family: var(--font-family-mono); font-size: var(--font-size-sm); }
    .row-actions { display: flex; gap: var(--spacing-xs); justify-content: flex-end; }

    .empty-state__icon { font-size: 2.75rem; }
    .empty-state__icon--danger { color: var(--color-danger); }

    /* Etichette riga per la vista impilata su mobile (nascoste su desktop) */
    .cell-label {
      display: none; font-weight: var(--font-weight-semibold); color: var(--text-tertiary);
      font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.15rem;
    }

    .loading-row {
      display: flex; align-items: center; justify-content: center; gap: var(--spacing-md);
      padding: var(--spacing-2xl); color: var(--text-tertiary);
    }
    :host ::ng-deep .loading-spinner { width: 2.25rem; height: 2.25rem; }

    .text-tertiary { color: var(--text-tertiary); }
    .mt-1 { margin-top: var(--spacing-xs); }

    /* Form dialog */
    .dialog-form { display: flex; flex-direction: column; gap: var(--spacing-lg); }
    .form-fieldset { border: none; padding: 0; margin: 0; }
    .form-legend {
      font-family: var(--font-display); font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-base); color: var(--text-primary);
      padding: 0 0 var(--spacing-sm); margin-bottom: var(--spacing-sm);
      border-bottom: 1px solid var(--surface-border); width: 100%;
    }
    .field { margin-bottom: var(--spacing-base); }
    .field label { display: block; margin-bottom: var(--spacing-xs); }
    .req { color: var(--color-danger); margin-left: 0.15rem; }

    /* Vista a card impilata su mobile */
    @media (max-width: 768px) {
      :host ::ng-deep .p-datatable .p-datatable-thead { display: none; }
      :host ::ng-deep .p-datatable .p-datatable-tbody > tr {
        display: block; padding: var(--spacing-sm) 0; border-bottom: 1px solid var(--surface-border);
      }
      :host ::ng-deep .p-datatable .p-datatable-tbody > tr > td {
        display: block; border: none; padding: 0.35rem var(--spacing-base);
      }
      .cell-label { display: block; }
      .row-actions { justify-content: flex-start; padding-top: var(--spacing-xs); }
    }
  `],
})
export class TenantAdminComponent implements OnInit {
  private readonly tenantService = inject(TenantAdminService);
  private readonly toast = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly tenants = signal<Tenant[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly saving = signal(false);
  readonly editMode = signal(false);

  displayDialog = false;
  selectedTenant: Tenant | null = null;
  form: TenantFormData = this.emptyForm();

  readonly statusOptions: SelectOption<SubscriptionStatus>[] = (
    Object.keys(STATUS_LABELS) as SubscriptionStatus[]
  ).map((s) => ({ label: STATUS_LABELS[s], value: s }));

  readonly tierOptions: SelectOption<SubscriptionTier>[] = (
    Object.keys(TIER_LABELS) as SubscriptionTier[]
  ).map((t) => ({ label: TIER_LABELS[t], value: t }));

  ngOnInit(): void {
    this.loadTenants();
  }

  loadTenants(): void {
    this.loading.set(true);
    this.error.set(false);
    this.tenantService.list().subscribe({
      next: (rows) => {
        this.tenants.set(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
        this.toast.error('Errore nel caricamento dei tenant');
      },
    });
  }

  // --- Etichette / formattazione ---
  statusLabel(s: string): string {
    return STATUS_LABELS[s] ?? s;
  }
  statusSeverity(s: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    return STATUS_SEVERITY[s] ?? 'info';
  }
  tierLabel(t: string): string {
    return TIER_LABELS[t] ?? t;
  }

  // --- Creazione / modifica ---
  openCreateDialog(): void {
    this.editMode.set(false);
    this.selectedTenant = null;
    this.form = this.emptyForm();
    this.displayDialog = true;
  }

  openEditDialog(t: Tenant): void {
    this.editMode.set(true);
    this.selectedTenant = t;
    this.form = {
      partitaIva: t.partitaIva,
      ragioneSociale: t.ragioneSociale,
      codiceFiscale: t.codiceFiscale ?? '',
      pec: t.pec ?? '',
      telefono: t.telefono ?? '',
      atecoCode: t.atecoCode ?? '',
      address: t.address,
      civico: t.civico ?? '',
      city: t.city,
      province: t.province,
      postalCode: t.postalCode,
      country: t.country ?? '',
      subscriptionTier: t.subscriptionTier,
      subscriptionStatus: t.subscriptionStatus,
      firLimitPerMonth: t.firLimitPerMonth ?? null,
      userLimitTotal: t.userLimitTotal ?? null,
    };
    this.displayDialog = true;
  }

  save(): void {
    if (!this.validateForm()) {
      this.toast.warn('Compila tutti i campi obbligatori');
      return;
    }

    this.saving.set(true);

    if (this.editMode() && this.selectedTenant) {
      const dto: UpdateTenantDto = this.buildUpdateDto();
      this.tenantService.update(this.selectedTenant.id, dto).subscribe({
        next: () => {
          this.saving.set(false);
          this.displayDialog = false;
          this.toast.success('Tenant aggiornato');
          this.loadTenants();
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(err?.error?.message || 'Errore nell\'aggiornamento del tenant');
        },
      });
      return;
    }

    const dto: CreateTenantDto = this.buildCreateDto();
    this.tenantService.create(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.displayDialog = false;
        this.toast.success('Tenant creato');
        this.loadTenants();
      },
      error: (err) => {
        this.saving.set(false);
        if (err?.status === 409) {
          this.toast.error('Esiste già un tenant con questa partita IVA');
        } else {
          this.toast.error(err?.error?.message || 'Errore nella creazione del tenant');
        }
      },
    });
  }

  validateForm(): boolean {
    return !!(
      this.form.ragioneSociale?.trim() &&
      this.form.partitaIva?.trim() &&
      this.form.address?.trim() &&
      this.form.city?.trim() &&
      this.form.province?.trim() &&
      this.form.province.trim().length === 2 &&
      this.form.postalCode?.trim() &&
      this.form.postalCode.trim().length === 5
    );
  }

  // --- Cambio stato (sospendi / riattiva) ---
  confirmSetStatus(t: Tenant, status: 'SUSPENDED' | 'ACTIVE'): void {
    const action = status === 'SUSPENDED' ? 'sospendere' : 'riattivare';
    this.confirmationService.confirm({
      message: `Sei sicuro di voler ${action} il tenant "${t.ragioneSociale}"?`,
      header: status === 'SUSPENDED' ? 'Conferma sospensione' : 'Conferma riattivazione',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Conferma',
      rejectLabel: 'Annulla',
      accept: () => {
        this.tenantService.setStatus(t.id, status).subscribe({
          next: () => {
            this.toast.success(status === 'SUSPENDED' ? 'Tenant sospeso' : 'Tenant riattivato');
            this.loadTenants();
          },
          error: (err) => {
            this.toast.error(err?.error?.message || 'Errore nel cambio di stato del tenant');
          },
        });
      },
    });
  }

  // --- Helpers ---
  private buildCreateDto(): CreateTenantDto {
    return {
      partitaIva: this.form.partitaIva.trim(),
      ragioneSociale: this.form.ragioneSociale.trim(),
      address: this.form.address.trim(),
      city: this.form.city.trim(),
      province: this.form.province.trim().toUpperCase(),
      postalCode: this.form.postalCode.trim(),
      ...this.optionalFields(),
    };
  }

  private buildUpdateDto(): UpdateTenantDto {
    return {
      ragioneSociale: this.form.ragioneSociale.trim(),
      address: this.form.address.trim(),
      city: this.form.city.trim(),
      province: this.form.province.trim().toUpperCase(),
      postalCode: this.form.postalCode.trim(),
      ...this.optionalFields(),
    };
  }

  private optionalFields(): Partial<CreateTenantDto> {
    const trim = (v: string): string | undefined => {
      const t = v?.trim();
      return t ? t : undefined;
    };
    return {
      codiceFiscale: trim(this.form.codiceFiscale),
      pec: trim(this.form.pec),
      telefono: trim(this.form.telefono),
      atecoCode: trim(this.form.atecoCode),
      civico: trim(this.form.civico),
      country: trim(this.form.country),
      subscriptionTier: this.form.subscriptionTier || undefined,
      subscriptionStatus: this.form.subscriptionStatus || undefined,
      firLimitPerMonth: this.form.firLimitPerMonth ?? undefined,
      userLimitTotal: this.form.userLimitTotal ?? undefined,
    };
  }

  private emptyForm(): TenantFormData {
    return {
      partitaIva: '',
      ragioneSociale: '',
      codiceFiscale: '',
      pec: '',
      telefono: '',
      atecoCode: '',
      address: '',
      civico: '',
      city: '',
      province: '',
      postalCode: '',
      country: 'IT',
      subscriptionTier: 'FREE',
      subscriptionStatus: 'TRIAL',
      firLimitPerMonth: null,
      userLimitTotal: null,
    };
  }
}
