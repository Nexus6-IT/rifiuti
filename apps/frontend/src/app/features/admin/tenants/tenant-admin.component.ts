import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserAdminService } from '../users/user-admin.service';
import {
  TenantAdminService,
  Tenant,
  CreateTenantDto,
  UpdateTenantDto,
  SubscriptionStatus,
  SubscriptionTier,
  FeatureFlag,
} from './tenant-admin.service';

interface SelectOption<T> {
  label: string;
  value: T;
}

/** Catalogo feature (chiave → etichetta IT) attivabili per tenant. */
const FEATURE_CATALOG: { key: FeatureFlag; label: string }[] = [
  { key: 'fir', label: 'Formulari FIR' },
  { key: 'cer', label: 'Catalogo CER' },
  { key: 'anagrafiche', label: 'Anagrafiche' },
  { key: 'mud', label: 'MUD' },
  { key: 'giacenze', label: 'Giacenze' },
  { key: 'contratti', label: 'Contratti' },
  { key: 'esg', label: 'ESG/CO2' },
  { key: 'anomalie', label: 'Anomalie' },
  { key: 'rentri', label: 'RENTRI' },
  { key: 'reference_data', label: 'Dati di riferimento' },
];

/** Feature predefinite per piano: l'admin puo' poi sovrascriverle. */
const TIER_DEFAULT_FEATURES: Record<string, FeatureFlag[]> = {
  TRIAL: ['fir', 'cer', 'anagrafiche'],
  PROFESSIONAL: ['fir', 'cer', 'anagrafiche', 'mud', 'giacenze', 'contratti', 'esg', 'anomalie'],
  ENTERPRISE: FEATURE_CATALOG.map((f) => f.key),
};

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
  TRIAL: 'Trial',
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
  featureFlags: FeatureFlag[];
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
    CheckboxModule,
    TooltipModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">{{ isSuperAdmin() ? 'Gestione Tenant' : 'Le mie aziende' }}</h1>
          <p class="page-subtitle">
            {{ isSuperAdmin()
              ? 'Amministrazione delle organizzazioni clienti della piattaforma'
              : 'Crea e gestisci le aziende a te assegnate, entro la quota disponibile' }}
          </p>
        </div>
        <div class="page-actions">
          <!-- Badge quota: solo per l'ADMIN, quando la quota è nota -->
          @if (!isSuperAdmin() && companyLimit() !== null) {
            <p-tag
              [value]="'Aziende: ' + ownedCount() + '/' + companyLimit()"
              [severity]="quotaReached() ? 'danger' : 'info'"
              [attr.aria-label]="'Aziende utilizzate ' + ownedCount() + ' su ' + companyLimit() + ' disponibili'"
              styleClass="quota-badge"
            ></p-tag>
          }
          <p-button
            [label]="isSuperAdmin() ? 'Nuovo tenant' : 'Nuova azienda'"
            icon="pi pi-plus"
            [disabled]="!isSuperAdmin() && quotaReached()"
            (onClick)="onNewClick()"
            [pTooltip]="(!isSuperAdmin() && quotaReached()) ? 'Quota aziende raggiunta: contatta l\\'amministratore per aumentarla.' : ''"
            tooltipPosition="bottom"
            [ariaLabel]="isSuperAdmin() ? 'Crea un nuovo tenant' : 'Crea una nuova azienda'"
          />
        </div>
      </header>

      <!-- Messaggio quota raggiunta (ADMIN) -->
      @if (!isSuperAdmin() && quotaReached()) {
        <p class="quota-hint" role="status">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          Hai raggiunto la quota di aziende disponibili ({{ companyLimit() }}). Per crearne altre,
          richiedi un aumento della quota all'amministratore della piattaforma.
        </p>
      }

      <!-- Stato errore -->
      <section *ngIf="error()" class="surface-card" aria-live="polite">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger" aria-hidden="true"></i>
          <span class="empty-state__title">{{ isSuperAdmin() ? 'Impossibile caricare i tenant' : 'Impossibile caricare le aziende' }}</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadTenants()" />
        </div>
      </section>

      <!-- Tabella -->
      <section *ngIf="!error()" class="surface-card tenant-panel" [attr.aria-label]="isSuperAdmin() ? 'Elenco tenant' : 'Elenco aziende'">
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
                @if (isSuperAdmin()) {
                  <th scope="col">Piano</th>
                  <th scope="col">Stato</th>
                }
                <th scope="col" style="width: 9rem">Utenti</th>
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
                @if (isSuperAdmin()) {
                  <td>
                    <span class="cell-label">Piano</span>
                    {{ tierLabel(t.subscriptionTier) }}
                  </td>
                  <td>
                    <span class="cell-label">Stato</span>
                    <p-tag [value]="statusLabel(t.subscriptionStatus)" [severity]="statusSeverity(t.subscriptionStatus)"></p-tag>
                  </td>
                }
                <td>
                  <span class="cell-label">Utenti</span>
                  {{ t._count?.users ?? 0 }}<span class="text-tertiary"> / {{ t.userLimitTotal ?? '—' }} max</span>
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
                    <!-- Sospendi/riattiva: azione riservata al SUPER_ADMIN -->
                    @if (isSuperAdmin()) {
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
                    }
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td [attr.colspan]="colCount()">
                  <div class="empty-state">
                    <i class="pi pi-building empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">{{ isSuperAdmin() ? 'Nessun tenant' : 'Nessuna azienda' }}</span>
                    <p>
                      {{ isSuperAdmin()
                        ? 'Crea il primo tenant per iniziare a gestire le organizzazioni clienti.'
                        : 'Crea la tua prima azienda per iniziare.' }}
                    </p>
                    <p-button
                      [label]="isSuperAdmin() ? 'Nuovo tenant' : 'Nuova azienda'"
                      icon="pi pi-plus"
                      [disabled]="!isSuperAdmin() && quotaReached()"
                      (onClick)="onNewClick()"
                      [ariaLabel]="isSuperAdmin() ? 'Crea un nuovo tenant' : 'Crea una nuova azienda'"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="loadingbody">
              <tr>
                <td [attr.colspan]="colCount()">
                  <div class="loading-row">
                    <p-progressSpinner styleClass="loading-spinner" strokeWidth="4" aria-label="Caricamento in corso" />
                    <span>{{ isSuperAdmin() ? 'Caricamento tenant…' : 'Caricamento aziende…' }}</span>
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
        [header]="dialogHeader()"
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

          <!-- Piano, utenze, stato e feature: configurabili solo dal SUPER_ADMIN.
               Per l'ADMIN il backend forza piano TRIAL + feature di default. -->
          @if (isSuperAdmin()) {
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
                  (onChange)="onTierChange($event.value)"
                  aria-describedby="t-tier-help"
                ></p-dropdown>
                <small id="t-tier-help" class="block mt-1 text-tertiary">
                  Selezionando un piano si precompilano le feature predefinite.
                </small>
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
                <label for="t-user-limit">Numero massimo utenze</label>
                <p-inputNumber inputId="t-user-limit" [(ngModel)]="form.userLimitTotal" name="userLimitTotal"
                               [min]="0" styleClass="w-full" inputStyleClass="w-full"
                               aria-describedby="t-user-limit-help"></p-inputNumber>
                <small id="t-user-limit-help" class="block mt-1 text-tertiary">
                  Esclusi gli amministratori.
                </small>
              </div>
              <div class="field col-12 md:col-6">
                <label for="t-fir-limit">Limite FIR / mese</label>
                <p-inputNumber inputId="t-fir-limit" [(ngModel)]="form.firLimitPerMonth" name="firLimitPerMonth"
                               [min]="0" styleClass="w-full" inputStyleClass="w-full"
                               aria-describedby="t-fir-limit-help"></p-inputNumber>
                <small id="t-fir-limit-help" class="block mt-1 text-tertiary">
                  Opzionale: lasciare vuoto per nessun limite.
                </small>
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Feature abilitate</legend>
            <p class="feature-hint text-tertiary">
              Precompilate dal piano selezionato. Puoi modificarle (override) per questo tenant.
            </p>
            <div class="grid formgrid feature-grid" role="group" aria-label="Feature abilitate per il tenant">
              <div class="field col-12 md:col-6 feature-item" *ngFor="let f of featureCatalog">
                <p-checkbox
                  [inputId]="'feat-' + f.key"
                  [name]="'feat-' + f.key"
                  [value]="f.key"
                  [(ngModel)]="form.featureFlags"
                  [label]="f.label"
                ></p-checkbox>
              </div>
            </div>
          </fieldset>
          }
        </form>

        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" icon="pi pi-times" (onClick)="displayDialog = false" />
          <p-button
            [label]="submitLabel()"
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

    /* Allinea badge quota e bottone nella testata */
    .page-actions { display: flex; align-items: center; gap: var(--spacing-sm); flex-wrap: wrap; }
    :host ::ng-deep .quota-badge { font-weight: var(--font-weight-semibold); }

    /* Messaggio di quota raggiunta */
    .quota-hint {
      display: flex; align-items: center; gap: var(--spacing-sm);
      margin: 0 0 var(--spacing-base);
      padding: var(--spacing-sm) var(--spacing-base);
      border-radius: var(--radius-md);
      background: var(--surface-hover, rgba(0,0,0,0.03));
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
    }
    .quota-hint i { color: var(--color-warning, var(--brand-primary)); flex-shrink: 0; }

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

    /* Feature: lista checkbox */
    .feature-hint { font-size: var(--font-size-sm); margin: 0 0 var(--spacing-sm); }
    .feature-grid { margin-top: 0; }
    .feature-item { margin-bottom: var(--spacing-sm); display: flex; align-items: center; }
    :host ::ng-deep .feature-item .p-checkbox-label { margin-bottom: 0; margin-left: var(--spacing-sm); }

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
  private readonly userService = inject(UserAdminService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly tenants = signal<Tenant[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly saving = signal(false);
  readonly editMode = signal(false);

  /** True se l'utente corrente è SUPER_ADMIN (vista completa). */
  readonly isSuperAdmin = computed(() => this.auth.currentUser()?.role === 'SUPER_ADMIN');

  /**
   * Quota aziende dell'ADMIN corrente (max aziende creabili).
   * `null` = non ancora nota / non disponibile dal backend → in tal caso il
   * badge non viene mostrato e la creazione non viene bloccata lato client.
   */
  readonly companyLimit = signal<number | null>(null);

  /**
   * Numero di aziende create in self-service dall'admin corrente. Conta solo i
   * tenant con `ownerUserId` = id dell'utente corrente (esclude il tenant di
   * appartenenza che il backend include comunque nella lista). Se `ownerUserId`
   * non è esposto dal backend, ricade sul totale della lista.
   */
  readonly ownedCount = computed(() => {
    const meId = this.auth.currentUser()?.id;
    const rows = this.tenants();
    const withOwner = rows.filter((t) => t.ownerUserId != null);
    if (meId && withOwner.length > 0) {
      return rows.filter((t) => t.ownerUserId === meId).length;
    }
    return rows.length;
  });

  /** True se l'admin ha raggiunto la quota (count >= limite noto). */
  readonly quotaReached = computed(() => {
    const limit = this.companyLimit();
    if (limit === null) return false;
    return this.ownedCount() >= limit;
  });

  /** Numero di colonne della tabella (per i colspan di empty/loading). */
  readonly colCount = computed(() => (this.isSuperAdmin() ? 7 : 5));

  /** Intestazione del dialog adattata a ruolo e modalità. */
  readonly dialogHeader = computed(() => {
    if (this.isSuperAdmin()) return this.editMode() ? 'Modifica tenant' : 'Nuovo tenant';
    return this.editMode() ? 'Modifica azienda' : 'Nuova azienda';
  });

  /** Etichetta del bottone di conferma del dialog. */
  readonly submitLabel = computed(() => {
    if (this.editMode()) return 'Salva modifiche';
    return this.isSuperAdmin() ? 'Crea tenant' : 'Crea azienda';
  });

  displayDialog = false;
  selectedTenant: Tenant | null = null;
  form: TenantFormData = this.emptyForm();

  /** Catalogo feature mostrato come lista di checkbox. */
  readonly featureCatalog = FEATURE_CATALOG;

  readonly statusOptions: SelectOption<SubscriptionStatus>[] = (
    Object.keys(STATUS_LABELS) as SubscriptionStatus[]
  ).map((s) => ({ label: STATUS_LABELS[s], value: s }));

  readonly tierOptions: SelectOption<SubscriptionTier>[] = (
    Object.keys(TIER_LABELS) as SubscriptionTier[]
  ).map((t) => ({ label: TIER_LABELS[t], value: t }));

  ngOnInit(): void {
    this.loadTenants();
    // Per l'ADMIN recupero la quota aziende dal proprio record utente.
    if (!this.isSuperAdmin()) {
      this.loadCompanyLimit();
    }
  }

  /**
   * Carica la quota aziende dell'admin corrente leggendo il proprio record dalla
   * lista utenti (`GET /admin/users`, scoping al proprio tenant). Best-effort:
   * se non determinabile, la quota resta `null` (badge nascosto, nessun blocco).
   */
  private loadCompanyLimit(): void {
    const meId = this.auth.currentUser()?.id;
    this.userService.list().subscribe({
      next: (users) => {
        const me = users?.find((u) => u.id === meId);
        const limit = me?.companyLimit;
        this.companyLimit.set(typeof limit === 'number' ? limit : null);
      },
      error: () => this.companyLimit.set(null),
    });
  }

  /**
   * Click sul bottone "Nuova azienda/tenant". Per l'ADMIN blocca l'apertura se
   * la quota è raggiunta (oltre al `disabled`, per sicurezza).
   */
  onNewClick(): void {
    if (!this.isSuperAdmin() && this.quotaReached()) {
      this.toast.warn(
        `Quota aziende raggiunta (${this.companyLimit()}). Richiedi un aumento all'amministratore.`,
      );
      return;
    }
    this.openCreateDialog();
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

  /**
   * Al cambio del piano precompila le feature con i default del piano.
   * L'admin puo' poi modificarle liberamente (override).
   */
  onTierChange(tier: SubscriptionTier): void {
    this.form.featureFlags = [...(TIER_DEFAULT_FEATURES[tier] ?? [])];
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
      // featureFlags null = derivate dal piano: precompila coi default del piano.
      featureFlags: this.resolveFeatures(t.featureFlags, t.subscriptionTier),
    };
    this.displayDialog = true;
  }

  /** Normalizza le feature del tenant; se null/assenti usa i default del piano. */
  private resolveFeatures(
    flags: FeatureFlag[] | string[] | null | undefined,
    tier: SubscriptionTier,
  ): FeatureFlag[] {
    const known = new Set(FEATURE_CATALOG.map((f) => f.key));
    if (flags && flags.length > 0) {
      return (flags as string[]).filter((k): k is FeatureFlag => known.has(k as FeatureFlag));
    }
    return [...(TIER_DEFAULT_FEATURES[tier] ?? [])];
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
          this.toast.success(this.isSuperAdmin() ? 'Tenant aggiornato' : 'Azienda aggiornata');
          this.loadTenants();
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ||
              (this.isSuperAdmin()
                ? 'Errore nell\'aggiornamento del tenant'
                : 'Errore nell\'aggiornamento dell\'azienda'),
          );
        },
      });
      return;
    }

    const dto: CreateTenantDto = this.buildCreateDto();
    const successMsg = this.isSuperAdmin() ? 'Tenant creato' : 'Azienda creata';
    const dupMsg = this.isSuperAdmin()
      ? 'Esiste già un tenant con questa partita IVA'
      : 'Esiste già un\'azienda con questa partita IVA';
    this.tenantService.create(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.displayDialog = false;
        this.toast.success(successMsg);
        this.loadTenants();
        if (!this.isSuperAdmin()) {
          // Aggiorno il conteggio quota dopo la creazione.
          this.loadCompanyLimit();
        }
      },
      error: (err) => {
        this.saving.set(false);
        if (err?.status === 409) {
          this.toast.error(dupMsg);
        } else if (err?.status === 403) {
          // Limite aziende raggiunto lato backend (race o quota client non nota).
          this.toast.error(
            err?.error?.message || 'Limite aziende raggiunto: contatta l\'amministratore.',
          );
          // Riallineo il conteggio quota.
          if (!this.isSuperAdmin()) {
            this.loadCompanyLimit();
          }
        } else {
          this.toast.error(
            err?.error?.message ||
              (this.isSuperAdmin()
                ? 'Errore nella creazione del tenant'
                : 'Errore nella creazione dell\'azienda'),
          );
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
    // Campi anagrafici comuni a entrambi i ruoli.
    const anagrafica: Partial<CreateTenantDto> = {
      codiceFiscale: trim(this.form.codiceFiscale),
      pec: trim(this.form.pec),
      telefono: trim(this.form.telefono),
      atecoCode: trim(this.form.atecoCode),
      civico: trim(this.form.civico),
      country: trim(this.form.country),
    };

    // Piano/feature/limiti/stato: solo il SUPER_ADMIN li invia. Per l'ADMIN il
    // backend forza piano TRIAL + feature di default (form senza questi campi).
    if (!this.isSuperAdmin()) {
      return anagrafica;
    }

    return {
      ...anagrafica,
      subscriptionTier: this.form.subscriptionTier || undefined,
      subscriptionStatus: this.form.subscriptionStatus || undefined,
      firLimitPerMonth: this.form.firLimitPerMonth ?? undefined,
      userLimitTotal: this.form.userLimitTotal ?? undefined,
      featureFlags: this.form.featureFlags ?? [],
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
      subscriptionTier: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      firLimitPerMonth: null,
      userLimitTotal: null,
      featureFlags: [...TIER_DEFAULT_FEATURES['TRIAL']],
    };
  }
}
