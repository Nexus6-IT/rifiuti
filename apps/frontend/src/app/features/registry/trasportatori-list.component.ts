import { Component, OnInit, computed, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { TableModule } from 'primeng/table'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { DialogModule } from 'primeng/dialog'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { MessageModule } from 'primeng/message'
import { TagModule } from 'primeng/tag'
import { RegistryService, CreateTrasportatoreDto } from './registry.service'
import { Trasportatore, Indirizzo, Ditta, SedeDitta } from '../../shared/models/registry.model'
import { AuthService } from '../../core/services/auth.service'
import { puoGestireAnagrafiche } from './registry-permissions'
import { DittaIdentificativiComponent } from './ditta-identificativi.component'
import { SediDittaDialogComponent } from './sedi-ditta-dialog.component'
import {
  ErroriIdentificativi,
  identificativiPerSalvataggio,
  separaIdentificativo,
} from './identificativo-fiscale'
import { AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { MemoriaAzioni } from '../clienti/tabelle/azioni-lista'
import { chiediConferma } from '../clienti/tabelle/tabella-comune'
import { azioniAnagrafica } from './azioni-anagrafica'
import { CampoDataComponent } from '../../shared/components/campo-data.component'

@Component({
  selector: 'app-trasportatori-list',
  standalone: true,
  imports: [
    CampoDataComponent,
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DialogModule,
    ConfirmDialogModule,
    ProgressSpinnerModule,
    MessageModule,
    TagModule,
    DittaIdentificativiComponent,
    SediDittaDialogComponent,
    AzioniRigaComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Trasportatori</h1>
          <p class="page-subtitle">
            Anagrafica dei trasportatori iscritti all'Albo Gestori Ambientali
          </p>
        </div>
        <div class="page-actions">
          @if (puoGestire()) {
            <p-button
              label="Nuovo trasportatore"
              icon="pi pi-plus"
              (onClick)="showCreateDialog()"
              styleClass="wf-primario"
              ariaLabel="Crea nuovo trasportatore"
              data-testid="trasportatori-nuovo-button"
            />
          }
        </div>
      </header>

      <section class="surface-card table-card registry-panel" aria-label="Elenco trasportatori">
        <!-- Toolbar di ricerca -->
        <div class="barra-filtri registry-toolbar">
          <span class="barra-filtri__ricerca">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              pInputText
              type="search"
              [(ngModel)]="searchTerm"
              placeholder="Ragione sociale o P.IVA"
              aria-label="Cerca tra i trasportatori (filtra la pagina corrente)"
            />
          </span>
          <span class="barra-filtri__destra registry-count" aria-live="polite">
            {{ totalRecords ?? 0 }}
            {{ (totalRecords ?? 0) === 1 ? 'trasportatore' : 'trasportatori' }}
          </span>
        </div>

        <!-- Stato errore -->
        <p-message
          *ngIf="error && !loading"
          severity="error"
          [text]="error"
          styleClass="w-full mb-3"
        />

        <!-- Tabella -->
        <div class="table-responsive">
          <p-table
            #dt
            [value]="filteredTrasportatori"
            [loading]="loading"
            [paginator]="true"
            [alwaysShowPaginator]="false"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadTrasportatori($event)"
            [rowsPerPageOptions]="[10, 25, 50]"
            currentPageReportTemplate="{first}-{last} di {totalRecords}"
            [showCurrentPageReport]="totalRecords > 0"
            styleClass="p-datatable-sm lista-telefono"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Ragione sociale</th>
                <th scope="col" class="num-col">P.IVA / C.F.</th>
                @if (visibili.has('numero')) {
                  <th scope="col">N. iscrizione Albo</th>
                }
                <th scope="col">Sede legale</th>
                @if (visibili.has('pec')) {
                  <th scope="col">PEC</th>
                }
                @if (haAzioni) {
                  <th scope="col" class="num-col azioni-col">Azioni</th>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-trasportatore>
              <tr [attr.data-testid]="'trasportatori-row-' + trasportatore.id">
                <td class="chi">{{ trasportatore.ragioneSociale }}</td>
                <td class="num-col m2">
                  {{ identificativo(trasportatore).prefisso }}
                  <span
                    class="mono"
                    [attr.data-testid]="'trasportatori-identificativo-' + trasportatore.id"
                    >{{ identificativo(trasportatore).numero || '—' }}</span
                  >
                  @if (trasportatore.partitaIVA && trasportatore.codiceFiscale) {
                    <span class="mono ident-secondario">{{ trasportatore.codiceFiscale }}</span>
                  }
                  @if (trasportatore.partitaIvaDaVerificare) {
                    <span
                      class="badge-da-verificare"
                      [attr.data-testid]="'trasportatori-da-verificare-' + trasportatore.id"
                      >Da verificare</span
                    >
                  }
                </td>
                @if (visibili.has('numero')) {
                  <td class="m-hide">
                    @if (trasportatore.numeroIscrizione) {
                      <p-tag [value]="trasportatore.numeroIscrizione" severity="info" />
                    } @else {
                      <span class="text-tertiary">—</span>
                    }
                  </td>
                }
                <td class="m-hide">{{ formatIndirizzo(trasportatore.sedeLegale) }}</td>
                @if (visibili.has('pec')) {
                  <td class="m-hide">
                    <span [class.text-tertiary]="!trasportatore.pec">{{
                      trasportatore.pec || '—'
                    }}</span>
                  </td>
                }
                @if (haAzioni) {
                  <td class="azioni-col">
                    <app-azioni-riga
                      [attr.data-testid]="'trasportatori-azioni-' + trasportatore.id"
                      [nome]="trasportatore.ragioneSociale"
                      [principale]="azioni.di(trasportatore).principale"
                      [altre]="azioni.di(trasportatore).altre"
                    />
                  </td>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td [attr.colspan]="colonneTotali">
                  <div class="empty-state">
                    <i class="pi pi-truck empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun trasportatore trovato</p>
                    <p>Crea il primo trasportatore per associarlo ai formulari.</p>
                    @if (puoGestire()) {
                      <p-button
                        label="Nuovo trasportatore"
                        icon="pi pi-plus"
                        [outlined]="true"
                        (onClick)="showCreateDialog()"
                        ariaLabel="Crea nuovo trasportatore"
                      />
                    }
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="loadingbody">
              <tr>
                <td [attr.colspan]="colonneTotali">
                  <div class="loading-row">
                    <p-progressSpinner
                      styleClass="loading-spinner"
                      strokeWidth="4"
                      aria-label="Caricamento in corso"
                    />
                    <span>Caricamento trasportatori…</span>
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
        [style]="{ width: '46rem' }"
        [breakpoints]="{ '768px': '95vw' }"
        [header]="editMode ? 'Modifica trasportatore' : 'Nuovo trasportatore'"
        [dismissableMask]="true"
        data-testid="trasportatori-form-dialog"
      >
        <form class="dialog-form" (ngSubmit)="saveTrasportatore()">
          <fieldset class="form-fieldset">
            <legend class="form-legend">Dati aziendali</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12">
                <label for="tra-ragione"
                  >Ragione sociale <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="tra-ragione"
                  name="ragioneSociale"
                  [(ngModel)]="formData.ragioneSociale"
                  [readOnly]="!!dittaTrovata"
                  placeholder="es. Trasporti S.r.l."
                  required
                  autocomplete="organization"
                />
              </div>
              <div class="field col-12">
                <app-ditta-identificativi
                  testidPrefix="trasportatori"
                  pfx="tra"
                  tipo="trasportatore"
                  [modalita]="editMode ? 'edit' : 'create'"
                  [(partitaIVA)]="formData.partitaIVA"
                  [(codiceFiscale)]="formData.codiceFiscale"
                  [partitaIvaOriginale]="selectedTrasportatore?.partitaIVA ?? null"
                  [codiceFiscaleOriginale]="selectedTrasportatore?.codiceFiscale ?? null"
                  [partitaIvaDaVerificare]="!!selectedTrasportatore?.partitaIvaDaVerificare"
                  [errori]="erroriId"
                  (dittaTrovata)="onDittaTrovata($event)"
                  (sedeScelta)="onSedeScelta($event)"
                />
              </div>
              <div class="field col-12 md:col-6">
                <label for="tra-iscrizione"
                  >N. iscrizione Albo Gestori <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="tra-iscrizione"
                  name="numeroIscrizione"
                  [(ngModel)]="formData.numeroIscrizione"
                  placeholder="es. MI/000123"
                  required
                />
              </div>
              <div class="field col-12">
                <label for="tra-pec">PEC</label>
                <input
                  pInputText
                  id="tra-pec"
                  name="pec"
                  type="email"
                  [(ngModel)]="formData.pec"
                  placeholder="pec@esempio.it"
                  autocomplete="email"
                />
              </div>
              <!-- Scadenza iscrizione — facoltativa (Task 3 scadenzario): il
                   dato può mancare per le anagrafiche già esistenti. -->
              <div class="field col-12 md:col-6">
                <label for="tra-scad-iscrizione">Scadenza iscrizione Albo</label>
                <app-campo-data
                  inputId="tra-scad-iscrizione"
                  name="scadenzaIscrizione"
                  [(ngModel)]="formData.scadenzaIscrizione"
                  data-testid="trasportatori-scadenza-iscrizione-input"
                  [piena]="true"
                />
                <small class="field-hint"
                  >Facoltativa: se nota, abilita il promemoria di scadenza.</small
                >
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Sede legale</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-8">
                <label for="tra-via">Via <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="tra-via"
                  name="via"
                  [(ngModel)]="formData.sedeLegale.via"
                  placeholder="es. Via Roma"
                  required
                  autocomplete="address-line1"
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="tra-civico">Civico <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="tra-civico"
                  name="civico"
                  [(ngModel)]="formData.sedeLegale.civico"
                  placeholder="es. 12"
                  required
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="tra-cap">CAP <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="tra-cap"
                  name="cap"
                  [(ngModel)]="formData.sedeLegale.cap"
                  placeholder="5 cifre"
                  maxlength="5"
                  inputmode="numeric"
                  required
                  autocomplete="postal-code"
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="tra-comune">Comune <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="tra-comune"
                  name="comune"
                  [(ngModel)]="formData.sedeLegale.comune"
                  placeholder="es. Milano"
                  required
                  autocomplete="address-level2"
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="tra-prov"
                  >Provincia <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="tra-prov"
                  name="provincia"
                  [(ngModel)]="formData.sedeLegale.provincia"
                  placeholder="es. MI"
                  maxlength="2"
                  style="text-transform: uppercase"
                  required
                />
              </div>
            </div>
          </fieldset>
        </form>

        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            icon="pi pi-times"
            (onClick)="displayDialog = false"
            data-testid="trasportatori-form-cancel-button"
          />
          <p-button
            label="Salva"
            icon="pi pi-check"
            (onClick)="saveTrasportatore()"
            [loading]="saving"
            data-testid="trasportatori-form-save-button"
          />
        </ng-template>
      </p-dialog>

      <app-sedi-ditta-dialog
        [(visible)]="sediVisibili"
        [dittaId]="sediDittaId"
        [ragioneSociale]="sediRagioneSociale"
        [puoGestire]="puoGestire()"
        (modificata)="ricarica()"
      />

      <p-confirmDialog data-testid="trasportatori-confirm-dialog" />
    </div>
  `,
  styles: [
    `
      .registry-panel {
        padding: 0;
        overflow: hidden;
      }

      .registry-toolbar {
        margin: 0;
        padding: var(--spacing-base) var(--spacing-lg);
        border-bottom: 1px solid var(--surface-border);
      }
      .registry-count {
        white-space: nowrap;
      }

      .table-responsive {
        border-radius: 0;
      }
      :host ::ng-deep .p-datatable {
        border: none;
        border-radius: 0;
      }

      .mono {
        font-family: var(--font-family-mono);
      }
      .chi {
        overflow-wrap: anywhere;
      }
      .ident-secondario {
        margin-left: var(--spacing-sm);
        color: var(--text-tertiary);
      }
      .badge-da-verificare {
        display: inline-block;
        margin-left: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        border: 1px solid var(--color-warning, #b45309);
        border-radius: 999px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        white-space: nowrap;
      }
      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-2xl);
        color: var(--text-tertiary);
      }
      :host ::ng-deep .loading-spinner {
        width: 2.25rem;
        height: 2.25rem;
      }

      /* Telefono: il riquadro non ha padding, le righe a due linee tengono il loro. */
      @media (max-width: 640px) {
        :host ::ng-deep .p-datatable.lista-telefono .p-datatable-tbody > tr {
          padding-left: var(--spacing-base);
          padding-right: var(--spacing-base);
        }
        .registry-toolbar {
          padding: var(--spacing-md) var(--spacing-base);
        }
      }

      .empty-state__icon {
        font-size: 2.75rem;
      }

      .dialog-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }
      .form-fieldset {
        border: none;
        padding: 0;
        margin: 0;
      }
      .form-legend {
        font-family: var(--font-display);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-base);
        color: var(--text-primary);
        padding: 0 0 var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--surface-border);
        width: 100%;
      }
      .field {
        margin-bottom: var(--spacing-base);
      }
      .field label {
        display: block;
        margin-bottom: var(--spacing-xs);
      }
      .req {
        color: var(--color-danger);
        margin-left: 0.15rem;
      }
      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        display: block;
        margin-top: var(--spacing-xs);
      }
    `,
  ],
})
export class TrasportatoriListComponent implements OnInit {
  trasportatori: Trasportatore[] = []
  loading = false
  saving = false
  error = ''
  totalRecords = 0
  pageSize = 10
  currentPage = 1
  searchTerm = ''

  displayDialog = false
  editMode = false
  selectedTrasportatore: Trasportatore | null = null

  formData: CreateTrasportatoreDto = this.getEmptyFormData()

  /** Errori di partita IVA e codice fiscale, mostrati dal componente degli identificativi. */
  erroriId: ErroriIdentificativi = {}
  /** Ditta gia' presente trovata dalla ricerca (solo in creazione): blocca la ragione sociale. */
  dittaTrovata: Ditta | null = null

  // Dialog delle sedi della ditta
  sediVisibili = false
  sediDittaId = ''
  sediRagioneSociale = ''

  private readonly authService = inject(AuthService)
  // Ricalcola il gating in base al ruolo dell'utente autenticato: stesso
  // schema di `fir-list.component.ts` (`puoCreareFir`). Il backend è
  // l'unica fonte di verità (RegistryController, @Roles su POST/PUT/DELETE
  // trasportatori), qui si evita solo di mostrare un'azione che il server
  // rifiuterebbe con 403.
  readonly puoGestire = computed(() => puoGestireAnagrafiche(this.authService.currentUser()?.role))

  /** Azioni di riga: Modifica sulla riga, nel menu ⋯ «Sedi (n)» ed «Elimina». */
  readonly azioni = new MemoriaAzioni<Trasportatore>(r =>
    azioniAnagrafica({
      nome: r.ragioneSociale,
      puoGestire: this.puoGestire(),
      dittaId: r.dittaId,
      numeroSedi: r.numeroSedi,
      modifica: () => this.editTrasportatore(r),
      sedi: () => this.apriSedi(r),
      elimina: () => this.deleteTrasportatore(r),
    })
  )

  /** Colonne facoltative con almeno un dato nella pagina (le altre non si disegnano). */
  private visibiliPer: { righe: Trasportatore[]; colonne: Set<string> } | null = null
  get visibili(): Set<string> {
    if (this.visibiliPer?.righe !== this.trasportatori) {
      this.visibiliPer = {
        righe: this.trasportatori,
        colonne: colonneConDati(this.trasportatori, {
          pec: r => r.pec,
          numero: r => r.numeroIscrizione,
        }),
      }
    }
    return this.visibiliPer.colonne
  }

  /** La colonna «Azioni» c'e' solo se almeno una riga ha un'azione (anche solo «Sedi» in sola lettura). */
  get haAzioni(): boolean {
    return this.puoGestire() || this.trasportatori.some(r => !!r.dittaId)
  }

  /** Colonne del p-table, per le righe dello stato vuoto e del caricamento. */
  get colonneTotali(): number {
    return 3 + this.visibili.size + (this.haAzioni ? 1 : 0)
  }

  /** «P.IVA» o «C.F.» in caratteri normali e il numero (l'unica parte in mono). */
  identificativo(r: Trasportatore): { prefisso: string; numero: string } {
    return separaIdentificativo(r.partitaIVA, r.codiceFiscale)
  }

  constructor(
    private registryService: RegistryService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadTrasportatori({ first: 0, rows: this.pageSize })
  }

  /** Filtra la pagina corrente in base al testo di ricerca (case-insensitive). */
  get filteredTrasportatori(): Trasportatore[] {
    const term = this.searchTerm?.trim().toLowerCase()
    if (!term) return this.trasportatori
    return this.trasportatori.filter(t =>
      [
        t.ragioneSociale,
        t.partitaIVA,
        t.codiceFiscale,
        t.numeroIscrizione,
        t.pec,
        t.sedeLegale ? this.formatIndirizzo(t.sedeLegale) : '',
      ]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(term))
    )
  }

  loadTrasportatori(event: any): void {
    this.loading = true
    this.error = ''
    const page = Math.floor(event.first / event.rows) + 1
    this.currentPage = page

    this.registryService.getTrasportatori(page, event.rows).subscribe({
      next: response => {
        this.trasportatori = response.items ?? []
        this.totalRecords = response.total ?? this.trasportatori.length
        this.loading = false
      },
      error: err => {
        this.loading = false
        this.error = err?.error?.message || 'Errore nel caricamento dei trasportatori'
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.error,
        })
      },
    })
  }

  showCreateDialog(): void {
    this.editMode = false
    this.selectedTrasportatore = null
    this.formData = this.getEmptyFormData()
    this.erroriId = {}
    this.dittaTrovata = null
    this.displayDialog = true
  }

  editTrasportatore(trasportatore: Trasportatore): void {
    this.editMode = true
    this.selectedTrasportatore = trasportatore
    this.formData = {
      ragioneSociale: trasportatore.ragioneSociale,
      partitaIVA: trasportatore.partitaIVA ?? '',
      codiceFiscale: trasportatore.codiceFiscale ?? '',
      numeroIscrizione: trasportatore.numeroIscrizione,
      sedeLegale: { ...trasportatore.sedeLegale },
      pec: trasportatore.pec,
      // Il backend restituisce una stringa ISO (yyyy-MM-dd): compatibile
      // direttamente con il campo data (`app-campo-data`).
      scadenzaIscrizione: trasportatore.scadenzaIscrizione ?? '',
    }
    this.erroriId = {}
    this.dittaTrovata = null
    this.displayDialog = true
  }

  /** Ditta trovata (o non piu' valida): blocca/sblocca la ragione sociale e precompila. */
  onDittaTrovata(ditta: Ditta | null): void {
    this.dittaTrovata = ditta
    if (ditta) this.formData.ragioneSociale = ditta.ragioneSociale
  }

  /** Sede scelta fra quelle della ditta: precompila indirizzo e PEC; "Nuova sede" li svuota. */
  onSedeScelta(sede: SedeDitta | null): void {
    this.formData.sedeLegale = {
      via: sede?.via ?? '',
      civico: sede?.civico ?? '',
      cap: sede?.cap ?? '',
      comune: sede?.citta ?? '',
      provincia: sede?.provincia ?? '',
    }
    // anche i contatti della sede: cosi' quelli mostrati sono quelli che il backend manterra'
    this.formData.pec = sede?.pec ?? ''
  }

  apriSedi(trasportatore: Trasportatore): void {
    this.sediDittaId = trasportatore.dittaId ?? ''
    this.sediRagioneSociale = trasportatore.ragioneSociale
    this.sediVisibili = true
  }

  ricarica(): void {
    this.loadTrasportatori({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
  }

  saveTrasportatore(): void {
    const id = identificativiPerSalvataggio(
      {
        partitaIVA: this.formData.partitaIVA ?? '',
        codiceFiscale: this.formData.codiceFiscale ?? '',
      },
      'trasportatore',
      this.editMode && this.selectedTrasportatore
        ? {
            partitaIva: this.selectedTrasportatore.partitaIVA,
            codiceFiscale: this.selectedTrasportatore.codiceFiscale ?? null,
            partitaIvaDaVerificare: !!this.selectedTrasportatore.partitaIvaDaVerificare,
          }
        : null
    )
    this.erroriId = id.errori
    const identificativi = {
      ...(id.partitaIVA && { partitaIVA: id.partitaIVA }),
      ...(id.codiceFiscale && { codiceFiscale: id.codiceFiscale }),
    }
    if (Object.keys(id.errori).length > 0 || !this.validateForm()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Compila tutti i campi obbligatori',
      })
      return
    }

    this.saving = true
    // Facoltativa: campo vuoto = azzeramento esplicito in modifica (`null`),
    // semplicemente non inviato in creazione (`undefined`).
    const scadenzaIscrizione =
      this.formData.scadenzaIscrizione || (this.editMode ? null : undefined)

    const operation =
      this.editMode && this.selectedTrasportatore
        ? this.registryService.updateTrasportatore(
            this.selectedTrasportatore.id,
            // Gli identificativi impostati non si cambiano: si inviano solo quelli aggiunti o, per la
            // P.IVA "da verificare", sostituiti (D2.7-D2.8); mai quelli invariati.
            {
              ragioneSociale: this.formData.ragioneSociale,
              ...identificativi,
              sedeLegale: this.formData.sedeLegale,
              numeroIscrizione: this.formData.numeroIscrizione,
              pec: this.formData.pec,
              scadenzaIscrizione,
            }
          )
        : this.registryService.createTrasportatore({
            ...this.formData,
            partitaIVA: id.partitaIVA,
            codiceFiscale: id.codiceFiscale,
            scadenzaIscrizione,
          })

    operation.subscribe({
      next: entity => {
        // Avvisi non bloccanti del backend (es. ragione sociale mantenuta)
        for (const avviso of entity.avvisi ?? []) {
          this.messageService.add({ severity: 'info', summary: 'Informazione', detail: avviso })
        }
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: this.editMode ? 'Trasportatore aggiornato' : 'Trasportatore creato',
        })
        this.displayDialog = false
        this.saving = false
        this.loadTrasportatori({
          first: (this.currentPage - 1) * this.pageSize,
          rows: this.pageSize,
        })
      },
      error: () => {
        this.saving = false
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel salvataggio del trasportatore',
        })
      },
    })
  }

  deleteTrasportatore(trasportatore: Trasportatore): void {
    chiediConferma(this.confirmationService, `Eliminare ${trasportatore.ragioneSociale}?`, () => {
      this.registryService.deleteTrasportatore(trasportatore.id).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Successo',
            detail: 'Trasportatore eliminato',
          })
          this.loadTrasportatori({
            first: (this.currentPage - 1) * this.pageSize,
            rows: this.pageSize,
          })
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Errore',
            detail: "Errore nell'eliminazione del trasportatore",
          })
        },
      })
    })
  }

  validateForm(): boolean {
    return !!(
      this.formData.ragioneSociale?.trim() &&
      this.formData.numeroIscrizione?.trim() &&
      this.formData.sedeLegale.via?.trim() &&
      this.formData.sedeLegale.civico?.trim() &&
      this.formData.sedeLegale.cap?.trim() &&
      this.formData.sedeLegale.comune?.trim() &&
      this.formData.sedeLegale.provincia?.trim()
    )
  }

  formatIndirizzo(indirizzo: Indirizzo): string {
    if (!indirizzo) return 'N/D'
    return `${indirizzo.via} ${indirizzo.civico}, ${indirizzo.cap} ${indirizzo.comune} (${indirizzo.provincia})`
  }

  private getEmptyFormData(): CreateTrasportatoreDto {
    return {
      ragioneSociale: '',
      partitaIVA: '',
      numeroIscrizione: '',
      sedeLegale: {
        via: '',
        civico: '',
        cap: '',
        comune: '',
        provincia: '',
      },
      pec: '',
      scadenzaIscrizione: '',
    }
  }
}
