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
import { RegistryService, CreateProduttoreDto } from './registry.service'
import { Produttore, Indirizzo, Ditta, SedeDitta } from '../../shared/models/registry.model'
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

@Component({
  selector: 'app-produttori-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DialogModule,
    ConfirmDialogModule,
    ProgressSpinnerModule,
    MessageModule,
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
          <h1 class="page-title">Produttori</h1>
          <p class="page-subtitle">Anagrafica dei produttori di rifiuti</p>
        </div>
        <div class="page-actions">
          @if (puoGestire()) {
            <p-button
              label="Nuovo produttore"
              icon="pi pi-plus"
              (onClick)="showCreateDialog()"
              styleClass="wf-primario"
              ariaLabel="Crea nuovo produttore"
              data-testid="produttori-nuovo-button"
            />
          }
        </div>
      </header>

      <section class="surface-card table-card registry-panel" aria-label="Elenco produttori">
        <!-- Toolbar di ricerca -->
        <div class="barra-filtri registry-toolbar">
          <span class="barra-filtri__ricerca">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              pInputText
              type="search"
              [(ngModel)]="searchTerm"
              placeholder="Cerca per ragione sociale, P.IVA, sede…"
              aria-label="Cerca tra i produttori (filtra la pagina corrente)"
            />
          </span>
          <span class="barra-filtri__destra registry-count" aria-live="polite">
            {{ totalRecords ?? 0 }} {{ (totalRecords ?? 0) === 1 ? 'produttore' : 'produttori' }}
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
            [value]="filteredProduttori"
            [loading]="loading"
            [paginator]="true"
            [alwaysShowPaginator]="false"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadProduttori($event)"
            [rowsPerPageOptions]="[10, 25, 50]"
            currentPageReportTemplate="{first}-{last} di {totalRecords}"
            [showCurrentPageReport]="totalRecords > 0"
            styleClass="p-datatable-sm lista-telefono"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Ragione sociale</th>
                <th scope="col" class="num-col">P.IVA / C.F.</th>
                <th scope="col">Sede legale</th>
                @if (visibili.has('pec')) {
                  <th scope="col">PEC</th>
                }
                @if (haAzioni) {
                  <th scope="col" class="num-col azioni-col">Azioni</th>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-produttore>
              <tr [attr.data-testid]="'produttori-row-' + produttore.id">
                <td class="chi">{{ produttore.ragioneSociale }}</td>
                <td class="num-col m2">
                  {{ identificativo(produttore).prefisso }}
                  <span
                    class="mono"
                    [attr.data-testid]="'produttori-identificativo-' + produttore.id"
                    >{{ identificativo(produttore).numero || '—' }}</span
                  >
                  @if (produttore.partitaIVA && produttore.codiceFiscale) {
                    <span class="mono ident-secondario">{{ produttore.codiceFiscale }}</span>
                  }
                  @if (produttore.partitaIvaDaVerificare) {
                    <span
                      class="badge-da-verificare"
                      [attr.data-testid]="'produttori-da-verificare-' + produttore.id"
                      >Da verificare</span
                    >
                  }
                </td>
                <td class="m-hide">{{ formatIndirizzo(produttore.sedeLegale) }}</td>
                @if (visibili.has('pec')) {
                  <td class="m-hide">
                    <span [class.text-tertiary]="!produttore.pec">{{ produttore.pec || '—' }}</span>
                  </td>
                }
                @if (haAzioni) {
                  <td class="azioni-col">
                    <app-azioni-riga
                      [attr.data-testid]="'produttori-modifica-' + produttore.id"
                      [nome]="produttore.ragioneSociale"
                      [principale]="azioni.di(produttore).principale"
                      [altre]="azioni.di(produttore).altre"
                    />
                  </td>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td [attr.colspan]="colonneTotali">
                  <div class="empty-state">
                    <i class="pi pi-building empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun produttore trovato</p>
                    <p>Crea il primo produttore per iniziare a registrare i rifiuti.</p>
                    @if (puoGestire()) {
                      <p-button
                        label="Nuovo produttore"
                        icon="pi pi-plus"
                        [outlined]="true"
                        (onClick)="showCreateDialog()"
                        ariaLabel="Crea nuovo produttore"
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
                    <span>Caricamento produttori…</span>
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
        [header]="editMode ? 'Modifica produttore' : 'Nuovo produttore'"
        [dismissableMask]="true"
        data-testid="produttori-form-dialog"
      >
        <form class="dialog-form" (ngSubmit)="saveProduttore()">
          <fieldset class="form-fieldset">
            <legend class="form-legend">Dati aziendali</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12">
                <label for="prod-ragione"
                  >Ragione sociale <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="prod-ragione"
                  name="ragioneSociale"
                  [(ngModel)]="formData.ragioneSociale"
                  [readOnly]="!!dittaTrovata"
                  placeholder="es. Azienda S.r.l."
                  required
                  autocomplete="organization"
                />
              </div>
              <div class="field col-12">
                <app-ditta-identificativi
                  testidPrefix="produttori"
                  pfx="prod"
                  tipo="produttore"
                  [modalita]="editMode ? 'edit' : 'create'"
                  [(partitaIVA)]="formData.partitaIVA"
                  [(codiceFiscale)]="formData.codiceFiscale"
                  [partitaIvaOriginale]="selectedProduttore?.partitaIVA ?? null"
                  [codiceFiscaleOriginale]="selectedProduttore?.codiceFiscale ?? null"
                  [partitaIvaDaVerificare]="!!selectedProduttore?.partitaIvaDaVerificare"
                  [errori]="erroriId"
                  (dittaTrovata)="onDittaTrovata($event)"
                  (sedeScelta)="onSedeScelta($event)"
                />
              </div>
              <div class="field col-12 md:col-6">
                <label for="prod-pec">PEC</label>
                <input
                  pInputText
                  id="prod-pec"
                  name="pec"
                  type="email"
                  [(ngModel)]="formData.pec"
                  placeholder="pec@esempio.it"
                  autocomplete="email"
                />
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Sede legale</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-8">
                <label for="prod-via">Via <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="prod-via"
                  name="via"
                  [(ngModel)]="formData.sedeLegale.via"
                  placeholder="es. Via Roma"
                  required
                  autocomplete="address-line1"
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-civico"
                  >Civico <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="prod-civico"
                  name="civico"
                  [(ngModel)]="formData.sedeLegale.civico"
                  placeholder="es. 12"
                  required
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-cap">CAP <span class="req" aria-hidden="true">*</span></label>
                <input
                  pInputText
                  id="prod-cap"
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
                <label for="prod-comune"
                  >Comune <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="prod-comune"
                  name="comune"
                  [(ngModel)]="formData.sedeLegale.comune"
                  placeholder="es. Milano"
                  required
                  autocomplete="address-level2"
                />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-prov"
                  >Provincia <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  pInputText
                  id="prod-prov"
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
            data-testid="produttori-form-cancel-button"
          />
          <p-button
            label="Salva"
            icon="pi pi-check"
            (onClick)="saveProduttore()"
            [loading]="saving"
            data-testid="produttori-form-save-button"
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

      <p-confirmDialog data-testid="produttori-confirm-dialog" />
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

      /* Form dialog */
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
export class ProduttoriListComponent implements OnInit {
  produttori: Produttore[] = []
  loading = false
  saving = false
  error = ''
  totalRecords = 0
  pageSize = 10
  currentPage = 1
  searchTerm = ''

  displayDialog = false
  editMode = false
  selectedProduttore: Produttore | null = null

  formData: CreateProduttoreDto = this.getEmptyFormData()

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
  // produttori), qui si evita solo di mostrare un'azione che il server
  // rifiuterebbe con 403.
  readonly puoGestire = computed(() => puoGestireAnagrafiche(this.authService.currentUser()?.role))

  /** Azioni di riga: Modifica sulla riga, nel menu ⋯ «Sedi (n)» ed «Elimina». */
  readonly azioni = new MemoriaAzioni<Produttore>(r =>
    azioniAnagrafica({
      nome: r.ragioneSociale,
      puoGestire: this.puoGestire(),
      dittaId: r.dittaId,
      numeroSedi: r.numeroSedi,
      modifica: () => this.editProduttore(r),
      sedi: () => this.apriSedi(r),
      elimina: () => this.deleteProduttore(r),
    })
  )

  /** Colonne facoltative con almeno un dato nella pagina (le altre non si disegnano). */
  private visibiliPer: { righe: Produttore[]; colonne: Set<string> } | null = null
  get visibili(): Set<string> {
    if (this.visibiliPer?.righe !== this.produttori) {
      this.visibiliPer = {
        righe: this.produttori,
        colonne: colonneConDati(this.produttori, {
          pec: r => r.pec,
        }),
      }
    }
    return this.visibiliPer.colonne
  }

  /** La colonna «Azioni» c'e' solo se almeno una riga ha un'azione (anche solo «Sedi» in sola lettura). */
  get haAzioni(): boolean {
    return this.puoGestire() || this.produttori.some(r => !!r.dittaId)
  }

  /** Colonne del p-table, per le righe dello stato vuoto e del caricamento. */
  get colonneTotali(): number {
    return 3 + this.visibili.size + (this.haAzioni ? 1 : 0)
  }

  /** «P.IVA» o «C.F.» in caratteri normali e il numero (l'unica parte in mono). */
  identificativo(r: Produttore): { prefisso: string; numero: string } {
    return separaIdentificativo(r.partitaIVA, r.codiceFiscale)
  }

  constructor(
    private registryService: RegistryService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadProduttori({ first: 0, rows: this.pageSize })
  }

  /** Filtra la pagina corrente in base al testo di ricerca (case-insensitive). */
  get filteredProduttori(): Produttore[] {
    const term = this.searchTerm?.trim().toLowerCase()
    if (!term) return this.produttori
    return this.produttori.filter(p =>
      [
        p.ragioneSociale,
        p.partitaIVA,
        p.codiceFiscale,
        p.pec,
        p.sedeLegale ? this.formatIndirizzo(p.sedeLegale) : '',
      ]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(term))
    )
  }

  loadProduttori(event: any): void {
    this.loading = true
    this.error = ''
    const page = Math.floor(event.first / event.rows) + 1
    this.currentPage = page

    this.registryService.getProduttori(page, event.rows).subscribe({
      next: response => {
        this.produttori = response.items ?? []
        this.totalRecords = response.total ?? this.produttori.length
        this.loading = false
      },
      error: err => {
        this.loading = false
        this.error = err?.error?.message || 'Errore nel caricamento dei produttori'
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
    this.selectedProduttore = null
    this.formData = this.getEmptyFormData()
    this.erroriId = {}
    this.dittaTrovata = null
    this.displayDialog = true
  }

  editProduttore(produttore: Produttore): void {
    this.editMode = true
    this.selectedProduttore = produttore
    this.formData = {
      ragioneSociale: produttore.ragioneSociale,
      partitaIVA: produttore.partitaIVA ?? '',
      codiceFiscale: produttore.codiceFiscale ?? '',
      sedeLegale: { ...produttore.sedeLegale },
      pec: produttore.pec,
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

  apriSedi(produttore: Produttore): void {
    this.sediDittaId = produttore.dittaId ?? ''
    this.sediRagioneSociale = produttore.ragioneSociale
    this.sediVisibili = true
  }

  ricarica(): void {
    this.loadProduttori({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
  }

  saveProduttore(): void {
    const id = identificativiPerSalvataggio(
      {
        partitaIVA: this.formData.partitaIVA ?? '',
        codiceFiscale: this.formData.codiceFiscale ?? '',
      },
      'produttore',
      this.editMode && this.selectedProduttore
        ? {
            partitaIva: this.selectedProduttore.partitaIVA,
            codiceFiscale: this.selectedProduttore.codiceFiscale ?? null,
            partitaIvaDaVerificare: !!this.selectedProduttore.partitaIvaDaVerificare,
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
    const operation =
      this.editMode && this.selectedProduttore
        ? this.registryService.updateProduttore(
            this.selectedProduttore.id,
            // Gli identificativi impostati non si cambiano: si inviano solo quelli aggiunti o, per la
            // P.IVA "da verificare", sostituiti (D2.7-D2.8); mai quelli invariati.
            {
              ragioneSociale: this.formData.ragioneSociale,
              ...identificativi,
              sedeLegale: this.formData.sedeLegale,
              pec: this.formData.pec,
            }
          )
        : this.registryService.createProduttore({
            ...this.formData,
            partitaIVA: id.partitaIVA,
            codiceFiscale: id.codiceFiscale,
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
          detail: this.editMode ? 'Produttore aggiornato' : 'Produttore creato',
        })
        this.displayDialog = false
        this.saving = false
        this.loadProduttori({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
      },
      error: () => {
        this.saving = false
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel salvataggio del produttore',
        })
      },
    })
  }

  deleteProduttore(produttore: Produttore): void {
    chiediConferma(this.confirmationService, `Eliminare ${produttore.ragioneSociale}?`, () => {
      this.registryService.deleteProduttore(produttore.id).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Successo',
            detail: 'Produttore eliminato',
          })
          this.loadProduttori({
            first: (this.currentPage - 1) * this.pageSize,
            rows: this.pageSize,
          })
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Errore',
            detail: "Errore nell'eliminazione del produttore",
          })
        },
      })
    })
  }

  validateForm(): boolean {
    return !!(
      this.formData.ragioneSociale?.trim() &&
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

  private getEmptyFormData(): CreateProduttoreDto {
    return {
      ragioneSociale: '',
      partitaIVA: '',
      sedeLegale: {
        via: '',
        civico: '',
        cap: '',
        comune: '',
        provincia: '',
      },
      pec: '',
    }
  }
}
