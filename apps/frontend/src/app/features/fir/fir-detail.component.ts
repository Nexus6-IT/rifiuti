import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router, RouterModule } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { MessageModule } from 'primeng/message'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ToastModule } from 'primeng/toast'
import { DialogModule } from 'primeng/dialog'
import { RadioButtonModule } from 'primeng/radiobutton'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { InputNumberModule } from 'primeng/inputnumber'
import { ConfirmationService, MessageService } from 'primeng/api'
import { FirService } from './fir.service'
import { puoModificareFir } from './fir-permissions'
import { testoMotivoNonModificabile } from './fir-form'
import { FIR, FIRStato, ParteFIR, ScostamentoPeso } from '../../shared/models/fir.model'
import {
  formattaNumero,
  formattaPercentuale,
  SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO,
} from './scostamento-peso'
import { RENTRISyncBadgeComponent } from './components/rentri-sync-badge/rentri-sync-badge.component'
import { RENTRISyncLogsComponent } from './components/rentri-sync-logs/rentri-sync-logs.component'
import { etichettaIdentificativiCompleta } from '../registry/identificativo-fiscale'
import { RENTRISyncService } from './services/rentri-sync.service'
import { AuthService } from '../../core/services/auth.service'
import { RentriFormulariService } from '../rentri/rentri-formulari.service'
import {
  RentriFirLifecycleService,
  AllegatoFirRentri,
  AzioneRentri,
} from '../rentri/rentri-fir-lifecycle.service'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

/** Limite di dimensione dell'allegato (byte), replica lato UI del vincolo del
 * contratto (`DatiAllegatoModel.contenuto`, 1 MB) — difesa aggiuntiva,
 * l'autorità resta il backend (`GestisciAllegatiFIRUseCase`). */
const LIMITE_ALLEGATO_BYTES = 1 * 1024 * 1024

/** Opzioni del dialog di accettazione/respingimento (R3 Task 4). */
type OpzioneAccettazione = 'A' | 'P' | 'R'

/** Etichette leggibili della causale di respingimento (`CausaliRespingimento`, contratto RENTRI). */
const CAUSALI_RESPINGIMENTO: { value: 'NC' | 'IR' | 'A'; label: string }[] = [
  { value: 'NC', label: 'Non conformità' },
  { value: 'IR', label: 'Irricevibile' },
  { value: 'A', label: 'Altro' },
]

/** Origini di legame per cui il rilascio è ammesso (R2 Task 3): mai su TRASMESSO_DA_NOI. */
const ORIGINI_RILASCIABILI = ['ACQUISITO_DA_TERZI', 'AGGANCIO_MANUALE']

/** Ruoli autorizzati a trasmettere/confermare verso RENTRI (v. RENTRISyncController backend). */
const RENTRI_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

/** Etichette italiane per l'origine del legame RENTRI (v. RentriOrigineLegame nel dominio). */
const ORIGINE_LEGAME_LABELS: Record<string, string> = {
  TRASMESSO_DA_NOI: 'Trasmesso da noi',
  ACQUISITO_DA_TERZI: 'Acquisito da terzi',
  AGGANCIO_MANUALE: 'Aggancio manuale',
}

/**
 * Pagina di dettaglio del formulario FIR (R1 Task 4).
 *
 * Contenitore naturale di tutto ciò che riguarda un singolo formulario:
 * dati, stato verso RENTRI (con numero ufficiale e origine del legame),
 * cronologia delle trasmissioni e azioni disponibili — senza dover aprire
 * il portale RENTRI o cambiare modello mentale rispetto alla lista `/fir`.
 *
 * Il numero proposto in modalità ibrida (`rentriNumeroFirProposto` con
 * `rentriNumeroFir` nullo) NON è il legame ufficiale e va mostrato come
 * tale (v. `rentri-sync-badge`, riusato qui invariato).
 */
@Component({
  selector: 'app-fir-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ButtonModule,
    TagModule,
    MessageModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
    ToastModule,
    DialogModule,
    RadioButtonModule,
    DropdownModule,
    InputTextareaModule,
    InputNumberModule,
    NumeroItalianoDirective,
    RENTRISyncBadgeComponent,
    RENTRISyncLogsComponent,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="page pagina-lavoro fir-detail" data-testid="fir-detail-page">
      <header class="page-header">
        <div class="page-header__titles header-with-back">
          <button
            pButton
            type="button"
            icon="pi pi-arrow-left"
            class="p-button-text p-button-rounded"
            (click)="goBack()"
            aria-label="Torna all'elenco dei FIR"
            data-testid="fir-detail-back"
          ></button>
          <div>
            <h1 class="page-title">Formulario {{ fir()?.numeroProgressivo || fir()?.id || '' }}</h1>
            <p class="page-subtitle">Dettaglio del formulario, stato RENTRI e cronologia</p>
          </div>
        </div>
      </header>

      @if (loading()) {
        <div class="surface-card">
          <div
            class="loading-container"
            role="status"
            aria-live="polite"
            data-testid="fir-detail-loading"
          >
            <p-progressSpinner ariaLabel="Caricamento"></p-progressSpinner>
            <p>Caricamento del formulario...</p>
          </div>
        </div>
      }

      @if (error() && !loading()) {
        <div class="surface-card" role="alert">
          <div class="empty-state" data-testid="fir-detail-error">
            <i
              class="pi pi-exclamation-triangle empty-state__icon"
              style="color: var(--color-danger);"
              aria-hidden="true"
            ></i>
            <p class="empty-state__title">Impossibile mostrare il formulario</p>
            <p>{{ error() }}</p>
            <p-button
              label="Torna all'elenco"
              icon="pi pi-arrow-left"
              [outlined]="true"
              (onClick)="goBack()"
            />
          </div>
        </div>
      }

      @if (!loading() && !error() && fir(); as f) {
        <!-- Dati del formulario -->
        <section class="surface-card detail-section" aria-label="Dati del formulario">
          <h2 class="section-title">Dati del formulario</h2>
          <div class="detail-grid">
            <div class="detail-field">
              <span class="detail-label">Numero</span>
              <span class="detail-value cell-mono" data-testid="fir-detail-numero">{{
                f.numeroProgressivo || 'N/D'
              }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Stato</span>
              <span data-testid="fir-detail-stato">
                <p-tag [value]="getStatoLabel(f.stato)" [severity]="getStatoSeverity(f.stato)" />
              </span>
              @if (motivoNonModificabile(f); as motivo) {
                <small class="detail-hint" data-testid="fir-detail-motivo-non-modificabile">{{
                  motivo
                }}</small>
              }
            </div>
            <div class="detail-field">
              <span class="detail-label">Data creazione</span>
              <span class="detail-value" data-testid="fir-detail-data-creazione">{{
                f.createdAt | date: 'dd/MM/yyyy HH:mm'
              }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Data presa in carico</span>
              <span class="detail-value">{{
                f.dataPresaCarico ? (f.dataPresaCarico | date: 'dd/MM/yyyy HH:mm') : '—'
              }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Data consegna</span>
              <span class="detail-value">{{
                f.dataConsegna ? (f.dataConsegna | date: 'dd/MM/yyyy HH:mm') : '—'
              }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Quantità verificata a destino</span>
              <span class="detail-value" data-testid="fir-detail-quantita-verificata">
                @if (f.pesoEffettivo != null) {
                  {{ formattaQuantita(f.pesoEffettivo) }} {{ f.rifiuto.unitaMisura }}
                  @if (f.scostamentoPeso; as s) {
                    <span
                      class="detail-scostamento"
                      [class.detail-scostamento--oltre]="s.oltreSoglia"
                      data-testid="fir-detail-scostamento"
                    >
                      ({{ testoScostamento(s) }})
                    </span>
                  }
                } @else {
                  —
                }
              </span>
            </div>
          </div>
        </section>

        <!-- Parti coinvolte -->
        <section class="surface-card detail-section" aria-label="Parti coinvolte">
          <h2 class="section-title">Parti coinvolte</h2>
          <div class="parti-grid">
            <div class="parte-card" data-testid="fir-detail-produttore">
              <h3>Produttore</h3>
              <p class="parte-ragione">{{ f.produttore?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">{{ identificativi(f.produttore) }}</p>
              @if (f.produttore?.indirizzo) {
                <p class="parte-dettaglio">{{ f.produttore?.indirizzo }}</p>
              }
            </div>
            <div class="parte-card" data-testid="fir-detail-trasportatore">
              <h3>Trasportatore</h3>
              <p class="parte-ragione">{{ f.trasportatore?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">{{ identificativi(f.trasportatore) }}</p>
              @if (f.trasportatore?.targaVeicolo) {
                <p class="parte-dettaglio">Targa {{ f.trasportatore?.targaVeicolo }}</p>
              }
            </div>
            <div class="parte-card" data-testid="fir-detail-destinatario">
              <h3>Destinatario</h3>
              <p class="parte-ragione">{{ f.destinatario?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">{{ identificativi(f.destinatario) }}</p>
              @if (f.destinatario?.indirizzo) {
                <p class="parte-dettaglio">{{ f.destinatario?.indirizzo }}</p>
              }
            </div>
          </div>
        </section>

        <!-- Dati rifiuto -->
        <section class="surface-card detail-section" aria-label="Dati rifiuto">
          <h2 class="section-title">Dati rifiuto</h2>
          <div class="detail-grid" data-testid="fir-detail-rifiuto">
            <div class="detail-field">
              <span class="detail-label">Codice CER</span>
              <span class="detail-value cell-mono">{{ f.rifiuto.cerCode }}</span>
            </div>
            <div class="detail-field">
              <span class="detail-label">Quantità dichiarata</span>
              <span class="detail-value">{{ f.rifiuto.quantita }} {{ f.rifiuto.unitaMisura }}</span>
            </div>
            @if (f.rifiuto.statoFisico) {
              <div class="detail-field">
                <span class="detail-label">Stato fisico</span>
                <span class="detail-value">{{ f.rifiuto.statoFisico }}</span>
              </div>
            }
            @if (f.rifiuto.caratteristichePericolo) {
              <div class="detail-field">
                <span class="detail-label">Caratteristiche di pericolo HP</span>
                <span class="detail-value">{{ f.rifiuto.caratteristichePericolo }}</span>
              </div>
            }
            @if (f.rifiuto.numeroColli) {
              <div class="detail-field">
                <span class="detail-label">N° colli</span>
                <span class="detail-value">{{ f.rifiuto.numeroColli }}</span>
              </div>
            }
            @if (f.rifiuto.codiceOperazione) {
              <div class="detail-field">
                <span class="detail-label">Operazione destinatario R/D</span>
                <span class="detail-value">{{ f.rifiuto.codiceOperazione }}</span>
              </div>
            }
          </div>
          @if (f.annotazioni) {
            <div class="detail-field detail-field--full">
              <span class="detail-label">Annotazioni</span>
              <span class="detail-value">{{ f.annotazioni }}</span>
            </div>
          }
        </section>

        <!-- Stato verso RENTRI -->
        @if (mostraStatoRentri(f)) {
          <section class="surface-card detail-section" aria-label="Stato verso RENTRI">
            <h2 class="section-title">Stato verso RENTRI</h2>
            <div class="rentri-status" data-testid="fir-detail-rentri-status">
              <app-rentri-sync-badge
                [numeroFir]="f.numeroProgressivo || f.id"
                [rentriSyncStatus]="f.rentriSyncStatus || 'PENDING'"
                [rentriNumeroFir]="f.rentriNumeroFir"
                [rentriNumeroFirProposto]="f.rentriNumeroFirProposto"
                [syncAttempts]="f.rentriSyncAttempts || 0"
                [lastSyncError]="f.rentriLastSyncError"
                [messaggioErrore]="f.rentriMessaggioErrore"
              />
            </div>
            @if (f.rentriMessaggioErrore) {
              <p-message
                severity="warn"
                [text]="f.rentriMessaggioErrore"
                styleClass="w-full mb-3"
                data-testid="fir-detail-rentri-messaggio-errore"
              />
            }
            <div class="detail-grid">
              <div class="detail-field">
                <span class="detail-label">Numero FIR ufficiale</span>
                <span
                  class="detail-value cell-mono"
                  data-testid="fir-detail-rentri-numero-ufficiale"
                >
                  {{ f.rentriNumeroFir || 'Non ancora assegnato' }}
                </span>
              </div>
              @if (f.rentriNumeroFirProposto && !f.rentriNumeroFir) {
                <div class="detail-field">
                  <span class="detail-label">Numero proposto (da confermare)</span>
                  <span
                    class="detail-value cell-mono"
                    data-testid="fir-detail-rentri-numero-proposto"
                  >
                    {{ f.rentriNumeroFirProposto }}
                  </span>
                </div>
              }
              @if (f.rentriOrigineLegame) {
                <div class="detail-field">
                  <span class="detail-label">Origine del legame</span>
                  <span class="detail-value" data-testid="fir-detail-rentri-origine">
                    {{ getOrigineLegameLabel(f.rentriOrigineLegame) }}
                  </span>
                </div>
              }
            </div>
          </section>
        }

        <!-- Azioni disponibili -->
        @if (haAzioni(f)) {
          <section class="surface-card detail-section" aria-label="Azioni disponibili">
            <h2 class="section-title">Azioni disponibili</h2>
            <div class="row-actions" data-testid="fir-detail-actions">
              @if (puoModificare(f)) {
                <p-button
                  label="Modifica"
                  icon="pi pi-pencil"
                  [outlined]="true"
                  (onClick)="modifica(f)"
                  data-testid="fir-detail-modifica"
                  [attr.aria-label]="'Modifica FIR ' + (f.numeroProgressivo || f.id)"
                />
              }
              @if (f.stato === 'BOZZA') {
                <p-button
                  label="Emetti"
                  icon="pi pi-send"
                  (onClick)="emettiFIR(f)"
                  data-testid="fir-detail-emetti"
                  [attr.aria-label]="'Emetti FIR ' + (f.numeroProgressivo || f.id)"
                />
              }
              @if (f.stato === 'EMESSO') {
                <p-button
                  label="Presa in carico"
                  icon="pi pi-truck"
                  (onClick)="presaInCarico(f)"
                  data-testid="fir-detail-presa-in-carico"
                  [attr.aria-label]="'Presa in carico FIR ' + (f.numeroProgressivo || f.id)"
                />
              }
              @if (canTrasmettereRentri(f)) {
                <p-button
                  label="Trasmetti a RENTRI"
                  icon="pi pi-send"
                  [outlined]="true"
                  (onClick)="trasmettiRENTRI(f)"
                  data-testid="fir-detail-rentri-trasmetti"
                  [attr.aria-label]="'Trasmetti a RENTRI il FIR ' + (f.numeroProgressivo || f.id)"
                />
              }
              @if (canRiprovareRentri(f)) {
                <p-button
                  label="Riprova"
                  icon="pi pi-refresh"
                  severity="warning"
                  [outlined]="true"
                  (onClick)="trasmettiRENTRI(f)"
                  data-testid="fir-detail-rentri-riprova"
                  [attr.aria-label]="
                    'Riprova la trasmissione RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (mostraRitrasmettiDopoVerifica(f)) {
                <p-button
                  label="Ritrasmetti"
                  icon="pi pi-send"
                  severity="warning"
                  [outlined]="true"
                  (onClick)="ritrasmettiDopoVerifica(f)"
                  data-testid="fir-detail-rentri-ritrasmetti-dopo-verifica"
                  [attr.aria-label]="
                    'Ritrasmetti a RENTRI il FIR ' +
                    (f.numeroProgressivo || f.id) +
                    ' dopo la verifica sul portale'
                  "
                />
              }
              @if (mostraRileggiEsito(f)) {
                <p-button
                  label="Rileggi esito"
                  icon="pi pi-replay"
                  severity="warning"
                  [outlined]="true"
                  (onClick)="rileggiEsito(f)"
                  data-testid="fir-detail-rentri-rileggi-esito"
                  [attr.aria-label]="
                    'Rileggi esito RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (mostraVaiAlCertificato(f)) {
                <p-button
                  label="Vai al certificato"
                  icon="pi pi-id-card"
                  severity="danger"
                  [outlined]="true"
                  routerLink="/rentri/certificato"
                  data-testid="fir-detail-rentri-vedi-certificato"
                  aria-label="Vai alla pagina del certificato RENTRI"
                />
              }
              @if (canConfermareLegameRentri(f)) {
                <p-button
                  label="Conferma il legame"
                  icon="pi pi-check-circle"
                  severity="info"
                  [outlined]="true"
                  (onClick)="confermaLegameRENTRI(f)"
                  data-testid="fir-detail-rentri-conferma-legame"
                  [attr.aria-label]="
                    'Conferma il legame RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (canRilasciareLegameRentri(f)) {
                <p-button
                  label="Rilascia legame RENTRI"
                  icon="pi pi-unlink"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="rilasciaLegameRENTRI(f)"
                  data-testid="fir-detail-rentri-rilascia-legame"
                  [attr.aria-label]="
                    'Rilascia il legame RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (canAccettareCarico(f)) {
                <p-button
                  label="Accetta il carico"
                  icon="pi pi-inbox"
                  severity="success"
                  [outlined]="true"
                  (onClick)="apriDialogAccettazione(f)"
                  data-testid="fir-detail-rentri-accetta-carico"
                  [attr.aria-label]="
                    'Accetta o respingi il carico del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (canAnnullareRentri(f)) {
                <p-button
                  label="Annulla il formulario"
                  icon="pi pi-ban"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="apriDialogAnnullamento()"
                  data-testid="fir-detail-rentri-annulla-formulario"
                  [attr.aria-label]="
                    'Annulla il formulario RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
              @if (canScaricarePdfRentri(f)) {
                <p-button
                  label="Scarica il PDF"
                  icon="pi pi-file-pdf"
                  [outlined]="true"
                  [loading]="pdfScaricamentoInCorso()"
                  (onClick)="scaricaPdfRentri(f)"
                  data-testid="fir-detail-rentri-scarica-pdf"
                  [attr.aria-label]="
                    'Scarica il PDF del formulario RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
                <p-button
                  label="Aggiorna lo stato"
                  icon="pi pi-refresh"
                  [outlined]="true"
                  severity="secondary"
                  [loading]="aggiornamentoStatoInCorso()"
                  (onClick)="aggiornaStatoRentri(f)"
                  data-testid="fir-detail-rentri-aggiorna-stato"
                  [attr.aria-label]="
                    'Aggiorna lo stato RENTRI del FIR ' + (f.numeroProgressivo || f.id)
                  "
                />
              }
            </div>
          </section>
        }

        <!-- Allegati del formulario (R3 Task 6) -->
        @if (canGestireAllegati(f)) {
          <section class="surface-card detail-section" aria-label="Allegati del formulario">
            <h2 class="section-title">Allegati</h2>

            <div class="field mb-3">
              <label for="fir-allegati-upload" class="block mb-2"
                >Aggiungi un allegato (solo PDF, max 1 MB)</label
              >
              <input
                id="fir-allegati-upload"
                type="file"
                accept="application/pdf"
                [disabled]="allegatiCaricamentoInCorso()"
                (change)="onFileSelezionatoAllegato($event, f)"
                data-testid="fir-detail-allegati-upload-input"
                aria-describedby="fir-allegati-upload-hint"
              />
              <small id="fir-allegati-upload-hint" class="block mt-1 text-tertiary">
                Il file viene inviato a RENTRI: nessuna firma richiesta.
              </small>
            </div>

            @if (allegatiCaricamentoInCorso()) {
              <p-progressSpinner styleClass="small-spinner" strokeWidth="4" />
            }

            <ul class="allegati-list" data-testid="fir-detail-allegati-list">
              @for (allegato of allegati(); track allegato.id) {
                <li
                  class="allegati-row"
                  [attr.data-testid]="'fir-detail-allegati-row-' + allegato.id"
                >
                  <span class="allegati-nome">{{ allegato.filename }}</span>
                  <span class="allegati-dimensione"
                    >{{ (allegato.sizeBytes / 1024).toFixed(0) }} KB</span
                  >
                  <p-button
                    label="Elimina"
                    icon="pi pi-trash"
                    severity="danger"
                    [outlined]="true"
                    [loading]="allegatoEliminazioneInCorso() === allegato.id"
                    (onClick)="eliminaAllegatoFir(f, allegato)"
                    [attr.data-testid]="'fir-detail-allegati-elimina-' + allegato.id"
                    [attr.aria-label]="'Elimina allegato ' + allegato.filename"
                  />
                </li>
              } @empty {
                <li class="allegati-vuoto">Nessun allegato caricato.</li>
              }
            </ul>
          </section>
        }

        <!-- Cronologia delle trasmissioni -->
        <section class="detail-section" aria-label="Cronologia delle trasmissioni RENTRI">
          <app-rentri-sync-logs [firId]="f.id"></app-rentri-sync-logs>
        </section>
      }
    </div>

    <p-confirmDialog></p-confirmDialog>
    <p-confirmDialog
      key="rentri-rilascia-legame"
      data-testid="fir-detail-rentri-rilascia-legame-confirm-dialog"
    ></p-confirmDialog>

    <!-- Accettazione/respingimento del carico (R3 Task 4) -->
    <p-dialog
      header="Accetta o respingi il carico"
      [(visible)]="accettazioneDialogVisible"
      [modal]="true"
      [style]="{ width: '30rem' }"
      data-testid="fir-detail-rentri-accettazione-dialog"
    >
      <div class="accettazione-form">
        <div class="accettazione-opzioni" role="radiogroup" aria-label="Esito dell'accettazione">
          <label class="accettazione-opzione" data-testid="fir-detail-rentri-accettazione-completa">
            <p-radioButton
              name="accettazioneOpzione"
              value="A"
              [(ngModel)]="accettazioneOpzione"
            ></p-radioButton>
            <span>Accetta per intero</span>
          </label>
          <label class="accettazione-opzione" data-testid="fir-detail-rentri-accettazione-parziale">
            <p-radioButton
              name="accettazioneOpzione"
              value="P"
              [(ngModel)]="accettazioneOpzione"
            ></p-radioButton>
            <span>Accetta parzialmente</span>
          </label>
          <label class="accettazione-opzione" data-testid="fir-detail-rentri-accettazione-respingi">
            <p-radioButton
              name="accettazioneOpzione"
              value="R"
              [(ngModel)]="accettazioneOpzione"
            ></p-radioButton>
            <span>Respingi il carico</span>
          </label>
        </div>

        @if (accettazioneOpzione() === 'A' || accettazioneOpzione() === 'P') {
          <div class="form-field">
            <label for="accettazione-quantita">Quantità accettata (kg) *</label>
            <p-inputNumber
              appNumeroIt
              locale="it-IT"
              [useGrouping]="false"
              mode="decimal"
              inputId="accettazione-quantita"
              [(ngModel)]="accettazioneQuantitaKg"
              [min]="0"
              [maxFractionDigits]="2"
              data-testid="fir-detail-rentri-accettazione-quantita-input"
            ></p-inputNumber>
          </div>
        }

        @if (accettazioneOpzione() === 'P' || accettazioneOpzione() === 'R') {
          <div class="form-field">
            <label for="accettazione-causale">Causale del respingimento *</label>
            <p-dropdown
              inputId="accettazione-causale"
              [options]="causaliRespingimento"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona una causale"
              [(ngModel)]="accettazioneCausale"
              data-testid="fir-detail-rentri-accettazione-causale-select"
            ></p-dropdown>
          </div>
          <div class="form-field">
            <label for="accettazione-motivo">Motivazione *</label>
            <textarea
              pInputTextarea
              id="accettazione-motivo"
              rows="4"
              [(ngModel)]="accettazioneMotivo"
              placeholder="Descrivi il motivo del respingimento (o della parzialità)"
              data-testid="fir-detail-rentri-accettazione-motivo-input"
            ></textarea>
          </div>
        }
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          icon="pi pi-times"
          [outlined]="true"
          (onClick)="chiudiDialogAccettazione()"
          data-testid="fir-detail-rentri-accettazione-cancel-button"
        />
        <p-button
          label="Conferma"
          icon="pi pi-check"
          [disabled]="!accettazioneValida()"
          [loading]="accettazioneInCorso()"
          (onClick)="confermaAccettazione()"
          data-testid="fir-detail-rentri-accettazione-confirm-button"
        />
      </ng-template>
    </p-dialog>

    <!-- Annullamento del formulario, con nota (R3 Task 5) -->
    <p-dialog
      header="Annulla il formulario"
      [(visible)]="annullamentoDialogVisible"
      [modal]="true"
      [style]="{ width: '30rem' }"
      data-testid="fir-detail-rentri-annulla-dialog"
    >
      <div class="annullamento-form">
        <p class="annullamento-avviso">
          L'annullamento è irreversibile presso RENTRI: una volta confermato dall'ente, il
          formulario non può tornare in lavorazione. Sarà necessario emetterne uno nuovo per
          proseguire il trasporto.
        </p>
        <div class="form-field">
          <label for="annullamento-motivo">Motivo dell'annullamento *</label>
          <textarea
            pInputTextarea
            id="annullamento-motivo"
            rows="4"
            maxlength="1024"
            [(ngModel)]="annullamentoMotivo"
            placeholder="Descrivi il motivo dell'annullamento: verrà trasmesso a RENTRI come nota"
            data-testid="fir-detail-rentri-annulla-motivo-input"
          ></textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Chiudi"
          icon="pi pi-times"
          [outlined]="true"
          (onClick)="chiudiDialogAnnullamento()"
          data-testid="fir-detail-rentri-annulla-cancel-button"
        />
        <p-button
          label="Conferma annullamento"
          icon="pi pi-check"
          severity="danger"
          [disabled]="!annullamentoValido()"
          [loading]="annullamentoInCorso()"
          (onClick)="confermaAnnullamento()"
          data-testid="fir-detail-rentri-annulla-confirm-button"
        />
      </ng-template>
    </p-dialog>

    <p-toast></p-toast>
  `,
  styles: [
    `
      .header-with-back {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-2xl);
        gap: var(--spacing-base);
        color: var(--text-secondary);
      }

      .fir-detail .detail-section {
        margin-bottom: var(--spacing-base);
      }

      .section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0 0 var(--spacing-md);
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--spacing-base);
      }

      .detail-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .detail-field--full {
        margin-top: var(--spacing-base);
      }

      .detail-label {
        font-size: 0.8125rem;
        color: var(--text-tertiary);
        font-weight: var(--font-weight-medium);
      }

      .detail-value {
        font-size: var(--font-size-sm);
      }

      .detail-hint {
        display: block;
        margin-top: 0.25rem;
        color: var(--text-tertiary);
      }

      .detail-scostamento--oltre {
        color: var(--stato-warn-ink);
        font-weight: var(--font-weight-medium);
      }

      .cell-mono {
        font-family: var(--font-family-mono);
      }

      .parti-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: var(--spacing-base);
      }

      .parte-card {
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md) var(--spacing-base);
      }
      .parte-card h3 {
        margin: 0 0 var(--spacing-xs);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
      }
      .parte-ragione {
        font-weight: var(--font-weight-semibold);
        margin: 0 0 var(--spacing-xs);
      }
      .parte-dettaglio {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }

      .rentri-status {
        margin-bottom: var(--spacing-base);
      }

      .row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .accettazione-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }

      .accettazione-opzioni {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .accettazione-opzione {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        cursor: pointer;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-field label {
        font-weight: var(--font-weight-medium);
      }

      .form-field textarea,
      .form-field p-inputnumber,
      .form-field p-dropdown {
        width: 100%;
      }

      .allegati-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .allegati-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        border: 1px solid var(--surface-border, #e5e7eb);
        border-radius: 6px;
      }

      .allegati-nome {
        flex: 1;
        font-weight: var(--font-weight-medium);
        word-break: break-all;
      }

      .allegati-dimensione {
        color: var(--text-color-secondary);
        font-size: 0.875rem;
      }

      .allegati-vuoto {
        color: var(--text-color-secondary);
        font-style: italic;
      }
    `,
  ],
})
export class FirDetailComponent implements OnInit {
  /** "P.IVA X · C.F. Y", "C.F. Y" per un privato (snapshot della parte nel FIR). */
  identificativi(parte: ParteFIR | null | undefined): string {
    return etichettaIdentificativiCompleta(parte?.partitaIva, parte?.codiceFiscale)
  }

  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly firService = inject(FirService)
  private readonly rentriSyncService = inject(RENTRISyncService)
  private readonly rentriFormulariService = inject(RentriFormulariService)
  private readonly rentriFirLifecycleService = inject(RentriFirLifecycleService)
  private readonly authService = inject(AuthService)
  private readonly confirmationService = inject(ConfirmationService)
  private readonly messageService = inject(MessageService)

  protected readonly fir = signal<FIR | null>(null)
  protected readonly loading = signal(true)
  protected readonly error = signal<string | null>(null)

  /** Etichette leggibili delle causali di respingimento, esposte al template. */
  protected readonly causaliRespingimento = CAUSALI_RESPINGIMENTO

  // --- Accettazione/respingimento del carico (R3 Task 4) ---
  protected readonly accettazioneDialogVisible = signal(false)
  protected readonly accettazioneOpzione = signal<OpzioneAccettazione>('A')
  protected readonly accettazioneInCorso = signal(false)
  protected accettazioneQuantitaKg: number | null = null
  protected accettazioneCausale: 'NC' | 'IR' | 'A' | null = null
  protected accettazioneMotivo = ''

  // --- Annullamento del formulario, con nota (R3 Task 5) ---
  protected readonly annullamentoDialogVisible = signal(false)
  protected readonly annullamentoInCorso = signal(false)
  protected annullamentoMotivo = ''

  // --- Allegati del formulario (R3 Task 6) ---
  protected readonly allegati = signal<AllegatoFirRentri[]>([])
  protected readonly allegatiCaricamentoInCorso = signal(false)
  /** `id` locale dell'allegato in eliminazione, o `null` se nessuna eliminazione in corso. */
  protected readonly allegatoEliminazioneInCorso = signal<string | null>(null)

  // --- Stampa PDF e aggiornamento dello stato (R3 Task 7) ---
  protected readonly pdfScaricamentoInCorso = signal(false)
  protected readonly aggiornamentoStatoInCorso = signal(false)

  // --- Azioni disponibili da RENTRI, pilotano i pulsanti del ciclo di vita (R3 Task 8) ---
  /** Ultima risposta nota di `/azioni`. Vuota finché non arriva (fail-closed). */
  protected readonly azioniRentri = signal<AzioneRentri[]>([])

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')
    if (!id) {
      this.error.set('Formulario non trovato.')
      this.loading.set(false)
      return
    }
    this.loadFIR(id)
  }

  private loadFIR(id: string): void {
    this.loading.set(true)
    this.error.set(null)
    this.firService.getFIRById(id).subscribe({
      next: fir => {
        this.fir.set(fir)
        this.loading.set(false)
        if (this.canGestireAllegati(fir)) {
          this.caricaElencoAllegati(fir.id)
        } else {
          this.allegati.set([])
        }
        // R3 Task 8: carica le azioni disponibili in background per pilotare
        // i pulsanti del ciclo di vita (`canAccettareCarico`/`canAnnullareRentri`).
        // Fail-closed: FIR non legato, ruolo non abilitato, o l'endpoint fallisce
        // (rete, 403, ecc.) → lista vuota, nessun pulsante governato da `/azioni`
        // compare. Diverso da «Aggiorna lo stato» (R3 Task 7): quello è un'azione
        // esplicita dell'utente e mostra il proprio errore; questo è un
        // caricamento silenzioso, nessun toast se fallisce.
        if (!!fir.rentriNumeroFir && this.canManageRENTRI()) {
          this.rentriFirLifecycleService.azioniDisponibili(fir.id).subscribe({
            next: risultato => this.azioniRentri.set(risultato.azioni),
            error: () => this.azioniRentri.set([]),
          })
        } else {
          this.azioniRentri.set([])
        }
      },
      error: err => {
        // Il backend risponde 404 sia per FIR inesistente sia per FIR di un
        // altro tenant (nessuna fuga di esistenza): il messaggio resta
        // identico in entrambi i casi.
        this.error.set(
          err?.status === 404
            ? 'Formulario non trovato.'
            : this.extractError(err, 'Impossibile caricare il formulario. Riprova.')
        )
        this.loading.set(false)
      },
    })
  }

  private extractError(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: string | string[] } })?.error?.message
    if (Array.isArray(message)) return message.join(', ')
    return message || fallback
  }

  goBack(): void {
    this.router.navigate(['/fir'])
  }

  reload(): void {
    const id = this.route.snapshot.paramMap.get('id')
    if (id) this.loadFIR(id)
  }

  getStatoLabel(stato: FIRStato): string {
    const labels: Record<FIRStato, string> = {
      [FIRStato.BOZZA]: 'Bozza',
      [FIRStato.EMESSO]: 'Emesso',
      [FIRStato.IN_TRANSITO]: 'In transito',
      [FIRStato.CONSEGNATO]: 'Consegnato',
      [FIRStato.ANNULLATO]: 'Annullato',
    }
    return labels[stato] ?? stato
  }

  getStatoSeverity(
    stato: FIRStato
  ): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | undefined {
    const severityMap: Record<FIRStato, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
      [FIRStato.BOZZA]: 'secondary',
      [FIRStato.EMESSO]: 'info',
      [FIRStato.IN_TRANSITO]: 'warning',
      [FIRStato.CONSEGNATO]: 'success',
      [FIRStato.ANNULLATO]: 'danger',
    }
    return severityMap[stato]
  }

  getOrigineLegameLabel(origine: string): string {
    return ORIGINE_LEGAME_LABELS[origine] ?? origine
  }

  /** V. fir-list.component.ts: lo stato RENTRI non ha senso prima dell'emissione o dopo l'annullo. */
  mostraStatoRentri(fir: FIR): boolean {
    return fir.stato !== FIRStato.BOZZA && fir.stato !== FIRStato.ANNULLATO
  }

  /** Ruoli SUPER_ADMIN/ADMIN/OPERATOR: stessi ruoli richiesti dal backend su RENTRISyncController. */
  private canManageRENTRI(): boolean {
    const role = this.authService.currentUser()?.role
    return !!role && RENTRI_ROLES.includes(role)
  }

  canTrasmettereRentri(fir: FIR): boolean {
    return !!fir.canSyncToRENTRI && fir.rentriSyncStatus === 'PENDING' && this.canManageRENTRI()
  }

  /**
   * Mostra «Riprova» SOLO quando l'ultimo fallimento è di una famiglia per
   * cui ritentare ha senso (R1 Task 5, v. backend `traduciErroreRentri`).
   * Prima di questo controllo il pulsante compariva per qualunque FIR in
   * stato FAILED, anche dopo un 403 (credenziale non valida: ritentare non
   * cambia nulla) o un 429/423 (l'ente ha sospeso/bandito le richieste:
   * ritentare a mano peggiora la situazione) — esattamente il «tranello» che
   * il task vuole evitare. `rentriAzioneErrore` assente (FIR senza un
   * ultimo errore tradotto, es. dati di uno storico precedente a questo
   * cambiamento) ricade nel comportamento preesistente.
   */
  canRiprovareRentri(fir: FIR): boolean {
    if (!fir.canSyncToRENTRI || fir.rentriSyncStatus !== 'FAILED' || !this.canManageRENTRI()) {
      return false
    }
    return fir.rentriAzioneErrore === undefined || fir.rentriAzioneErrore === null
      ? true
      : fir.rentriAzioneErrore === 'RIPROVA'
  }

  /**
   * «Ritrasmetti» compare solo quando l'esito della trasmissione è incerto
   * (`VERIFICA_SU_RENTRI`) e il FIR è fermo: nessun nuovo tentativo parte da
   * solo e «Riprova» non è proposto. La ritrasmissione passa da una conferma.
   */
  mostraRitrasmettiDopoVerifica(fir: FIR): boolean {
    return (
      fir.rentriSyncStatus === 'PERMANENTLY_FAILED' &&
      fir.rentriAzioneErrore === 'VERIFICA_SU_RENTRI' &&
      !fir.rentriNumeroFir &&
      this.canManageRENTRI()
    )
  }

  /**
   * «Rileggi esito»: RENTRI ha la transazione ma l'esito non si è letto. Nessun
   * dialog: la riapertura riprende la stessa transazione, non crea un nuovo
   * formulario, quindi non c'è un doppione da scongiurare.
   */
  mostraRileggiEsito(fir: FIR): boolean {
    return (
      fir.rentriSyncStatus === 'PERMANENTLY_FAILED' &&
      fir.rentriAzioneErrore === 'RILEGGI_ESITO' &&
      !fir.rentriNumeroFir &&
      this.canManageRENTRI()
    )
  }

  /** «Vai al certificato»: unica azione utile quando il certificato manca o RENTRI l'ha rifiutato (403). Un codice non ritentabile produce sempre PERMANENTLY_FAILED; FAILED resta ammesso per prudenza. */
  mostraVaiAlCertificato(fir: FIR): boolean {
    return (
      (fir.rentriSyncStatus === 'FAILED' || fir.rentriSyncStatus === 'PERMANENTLY_FAILED') &&
      fir.rentriAzioneErrore === 'VEDI_CERTIFICATO' &&
      this.canManageRENTRI()
    )
  }

  canConfermareLegameRentri(fir: FIR): boolean {
    return !!fir.rentriNumeroFirProposto && !fir.rentriNumeroFir && this.canManageRENTRI()
  }

  /**
   * «Rilascia legame RENTRI» compare SOLO quando l'origine del legame è
   * ACQUISITO_DA_TERZI o AGGANCIO_MANUALE (R2 Task 3/8) — MAI su
   * TRASMESSO_DA_NOI: un formulario che abbiamo creato e trasmesso noi non si
   * "rilascia" da qui (si annullerebbe con gli endpoint del ciclo di vita,
   * R3). Un pulsante che appare e poi fallisce con un 400 di dominio è peggio
   * di un pulsante assente: il controllo qui rispecchia esattamente il
   * vincolo già imposto lato dominio (`FIR.rilasciaLegameRENTRI`).
   */
  canRilasciareLegameRentri(fir: FIR): boolean {
    return (
      !!fir.rentriNumeroFir &&
      !!fir.rentriOrigineLegame &&
      ORIGINI_RILASCIABILI.includes(fir.rentriOrigineLegame) &&
      this.canManageRENTRI()
    )
  }

  formattaQuantita(n: number): string {
    return formattaNumero(n)
  }

  /** "+25% · +30 kg" accanto alla quantità verificata; con dichiarata assente solo la differenza. */
  testoScostamento(s: ScostamentoPeso): string {
    const diff = `${s.differenza > 0 ? '+' : ''}${formattaNumero(s.differenza)} ${s.unita}`
    const base = s.percentuale === null ? diff : `${formattaPercentuale(s.percentuale)} · ${diff}`
    return s.oltreSoglia
      ? `scostamento ${base}: oltre la soglia del ${SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO}%`
      : `scostamento ${base}`
  }

  /** «Modifica» solo su una bozza modificabile e per i ruoli che possono modificare. */
  puoModificare(fir: FIR): boolean {
    return (
      fir.stato === FIRStato.BOZZA &&
      !!fir.modificabile &&
      puoModificareFir(this.authService.currentUser()?.role)
    )
  }

  /** Perché una bozza non è modificabile (vuoto se lo è o se non è una bozza). */
  motivoNonModificabile(fir: FIR): string {
    if (fir.stato !== FIRStato.BOZZA || fir.modificabile !== false) return ''
    return testoMotivoNonModificabile(fir.motivoNonModificabile)
  }

  /** Apre la modifica nella lista (il dialog di «Nuovo FIR» è riusato). */
  modifica(fir: FIR): void {
    void this.router.navigate(['/fir'], { queryParams: { modifica: fir.id } })
  }

  haAzioni(fir: FIR): boolean {
    return (
      this.puoModificare(fir) ||
      fir.stato === FIRStato.BOZZA ||
      fir.stato === FIRStato.EMESSO ||
      this.canTrasmettereRentri(fir) ||
      this.canRiprovareRentri(fir) ||
      this.mostraRitrasmettiDopoVerifica(fir) ||
      this.mostraRileggiEsito(fir) ||
      this.mostraVaiAlCertificato(fir) ||
      this.canConfermareLegameRentri(fir) ||
      this.canRilasciareLegameRentri(fir) ||
      this.canAccettareCarico(fir) ||
      this.canAnnullareRentri(fir) ||
      this.canScaricarePdfRentri(fir)
    )
  }

  emettiFIR(fir: FIR): void {
    this.firService.emettiFIR(fir.id).subscribe({
      next: updated => {
        this.fir.set(updated)
        this.messageService.add({
          severity: 'success',
          summary: 'FIR emesso',
          detail: 'Il formulario è stato emesso correttamente',
        })
      },
      error: err => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, "Errore nell'emissione del FIR"),
        })
      },
    })
  }

  presaInCarico(fir: FIR): void {
    this.firService.presaInCarico(fir.id).subscribe({
      next: updated => {
        this.fir.set(updated)
        this.messageService.add({
          severity: 'success',
          summary: 'Presa in carico registrata',
          detail: 'Il formulario è ora in transito',
        })
      },
      error: err => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nella presa in carico'),
        })
      },
    })
  }

  /** Trasmette (o ritrasmette) il FIR a RENTRI: verbo del mestiere, non del protocollo. */
  trasmettiRENTRI(fir: FIR): void {
    this.rentriSyncService.syncFIR(fir.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Trasmissione avviata',
          detail: 'Il FIR è stato messo in coda per la trasmissione a RENTRI',
        })
        this.reload()
      },
      error: err => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nella trasmissione a RENTRI'),
        })
      },
    })
  }

  /**
   * Ritrasmette il FIR dopo un esito incerto, ma solo dopo una conferma
   * esplicita: se il formulario esiste già su RENTRI, ritrasmettere crea un doppione.
   */
  ritrasmettiDopoVerifica(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Ritrasmetti a RENTRI',
      message:
        'Hai controllato sul portale RENTRI che il formulario non esiste? Se esiste, ritrasmettere crea un doppione.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Ritrasmetti',
      rejectLabel: 'Annulla',
      accept: () => {
        this.rentriSyncService.syncFIR(fir.id, { confermaNuovaTrasmissione: true }).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Trasmissione avviata',
              detail: 'Il FIR è stato messo in coda per la trasmissione a RENTRI',
            })
            this.reload()
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, 'Errore nella trasmissione a RENTRI'),
            })
          },
        })
      },
    })
  }

  /** Riapre la trasmissione per rileggere l'esito della transazione già accettata da RENTRI. */
  rileggiEsito(fir: FIR): void {
    this.rentriSyncService.syncFIR(fir.id, { confermaNuovaTrasmissione: true }).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Rilettura avviata',
          detail: "L'esito della trasmissione a RENTRI verrà riletto a breve",
        })
        this.reload()
      },
      error: err => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, "Errore nella rilettura dell'esito RENTRI"),
        })
      },
    })
  }

  /** Conferma il legame RENTRI proposto in modalità ibrida, promuovendolo a legame ufficiale. */
  confermaLegameRENTRI(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Conferma legame RENTRI',
      message: `Confermi il legame con il numero FIR RENTRI ${fir.rentriNumeroFirProposto}?`,
      icon: 'pi pi-check-circle',
      acceptLabel: 'Conferma',
      rejectLabel: 'Annulla',
      accept: () => {
        this.rentriSyncService.confermaLegame(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Legame confermato',
              detail: 'Il numero FIR RENTRI è ora il legame ufficiale',
            })
            this.reload()
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, 'Errore nella conferma del legame RENTRI'),
            })
          },
        })
      },
    })
  }

  /**
   * Rilascia il legame RENTRI di questo FIR: il formulario resta su RENTRI,
   * smette solo di essere collegato a questo FIR nel gestionale (R2 Task 8,
   * `RilasciaFormularioRENTRIUseCase`). Il FIR locale NON viene cancellato.
   */
  rilasciaLegameRENTRI(fir: FIR): void {
    this.confirmationService.confirm({
      key: 'rentri-rilascia-legame',
      header: 'Rilascia legame RENTRI',
      message:
        'Il formulario resterà su RENTRI, ma non sarà più collegato a questo FIR nel gestionale. ' +
        'Confermi il rilascio del legame con il numero FIR RENTRI ' +
        `${fir.rentriNumeroFir}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Rilascia',
      rejectLabel: 'Annulla',
      accept: () => {
        this.rentriFormulariService.rilasciaLegame(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Legame rilasciato',
              detail: 'Il legame RENTRI è stato rilasciato: il formulario resta su RENTRI',
            })
            this.reload()
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, 'Errore nel rilascio del legame RENTRI'),
            })
          },
        })
      },
    })
  }

  /** Vero se `operazione` compare nell'ultima risposta nota di `/azioni`.
   * Fail-closed: lista vuota (non ancora caricata, o l'ente l'ha rifiutata)
   * → nessuna operazione è "disponibile". */
  protected haOperazioneRentri(operazione: string): boolean {
    return this.azioniRentri().some(a => a.operazione === operazione)
  }

  /**
   * «Accetta il carico» compare solo per un FIR già legato a RENTRI (R3
   * Task 4) E quando l'ente dichiara `'Accettazione'` fra le azioni
   * disponibili ORA per il formulario (R3 Task 8, `/azioni`). Prima di
   * questo cambiamento il criterio era provvisorio (qualunque FIR legato,
   * lasciando al backend l'ultima parola): ora è la stessa `/azioni`
   * caricata in `loadFIR` a pilotare il pulsante. Se il caricamento in
   * background non è ancora arrivato (o è fallito), `azioniRentri` è vuota
   * e il pulsante resta temporaneamente assente — non è un bug, è la stessa
   * cautela fail-closed del resto del piano. Il backend resta comunque
   * l'autorità finale (`AccettaORespingiFIRUseCase` verifica di nuovo
   * `/azioni` prima di scrivere, lato server).
   */
  canAccettareCarico(fir: FIR): boolean {
    return (
      !!fir.rentriNumeroFir && this.canManageRENTRI() && this.haOperazioneRentri('Accettazione')
    )
  }

  apriDialogAccettazione(fir: FIR): void {
    this.accettazioneOpzione.set('A')
    this.accettazioneQuantitaKg = fir.rifiuto?.quantita ?? null
    this.accettazioneCausale = null
    this.accettazioneMotivo = ''
    this.accettazioneDialogVisible.set(true)
  }

  chiudiDialogAccettazione(): void {
    this.accettazioneDialogVisible.set(false)
  }

  /**
   * Validazione lato UI, indipendente da quella del backend (che resta
   * comunque l'autorità fail-closed): niente invio con motivazione vuota per
   * un respingimento/parziale, niente invio senza quantità per
   * intero/parziale — DEVE essere impossibile, non solo scoraggiato.
   */
  accettazioneValida(): boolean {
    const opzione = this.accettazioneOpzione()
    if (
      (opzione === 'A' || opzione === 'P') &&
      (this.accettazioneQuantitaKg === null || this.accettazioneQuantitaKg === undefined)
    ) {
      return false
    }
    if (
      (opzione === 'P' || opzione === 'R') &&
      (!this.accettazioneCausale || this.accettazioneMotivo.trim() === '')
    ) {
      return false
    }
    return true
  }

  /** Accetta o respinge (anche parzialmente) il carico: verbo del mestiere, mai gergo del protocollo RENTRI. */
  confermaAccettazione(): void {
    const fir = this.fir()
    if (!fir || !this.accettazioneValida()) {
      return
    }

    const opzione = this.accettazioneOpzione()
    this.accettazioneInCorso.set(true)

    this.rentriFirLifecycleService
      .accettaORespingi(fir.id, {
        tipoAccettazione: opzione,
        quantitaAccettataKg:
          opzione === 'A' || opzione === 'P'
            ? (this.accettazioneQuantitaKg ?? undefined)
            : undefined,
        causaleRespingimento:
          opzione === 'P' || opzione === 'R' ? (this.accettazioneCausale ?? undefined) : undefined,
        motivoRespingimento:
          opzione === 'P' || opzione === 'R' ? this.accettazioneMotivo : undefined,
      })
      .subscribe({
        next: () => {
          this.accettazioneInCorso.set(false)
          this.accettazioneDialogVisible.set(false)
          this.messageService.add({
            severity: 'success',
            summary: opzione === 'R' ? 'Carico respinto' : 'Carico accettato',
            detail:
              'La richiesta è stata inviata a RENTRI: segui il tuo dispositivo per confermare la firma.',
          })
          this.reload()
        },
        error: err => {
          this.accettazioneInCorso.set(false)
          this.messageService.add({
            severity: 'error',
            summary: 'Errore',
            detail: this.extractError(err, "Errore nell'invio dell'accettazione a RENTRI"),
          })
        },
      })
  }

  /**
   * Stesso criterio di `canAccettareCarico`, ora pilotato da `/azioni` (R3
   * Task 8): un FIR legato a RENTRI mostra «Annulla il formulario» solo
   * quando l'ente dichiara `'Annulla'` fra le azioni disponibili ORA. Lista
   * `azioniRentri` vuota (caricamento in background non ancora arrivato, o
   * fallito) → pulsante temporaneamente assente, fail-closed, non un bug. Il
   * backend resta comunque l'autorità fail-closed (`AnnullaFIRRentriUseCase`
   * verifica `/azioni` prima di scrivere, due volte).
   */
  canAnnullareRentri(fir: FIR): boolean {
    return !!fir.rentriNumeroFir && this.canManageRENTRI() && this.haOperazioneRentri('Annulla')
  }

  /**
   * Nessun parametro di proposito: `confermaAnnullamento()` risolve il
   * formulario da `this.fir()`, non da un argomento. Accettarne uno qui e poi
   * ignorarlo suggerirebbe che il dialog sia legato a QUEL FIR mentre l'azione
   * ne usa un'altra fonte — un'incoerenza che prima o poi qualcuno segue.
   */
  apriDialogAnnullamento(): void {
    this.annullamentoMotivo = ''
    this.annullamentoDialogVisible.set(true)
  }

  chiudiDialogAnnullamento(): void {
    this.annullamentoDialogVisible.set(false)
  }

  annullamentoValido(): boolean {
    return this.annullamentoMotivo.trim() !== '' && this.annullamentoMotivo.length <= 1024
  }

  /** Annulla il formulario: verbo del mestiere, mai gergo del protocollo RENTRI. */
  confermaAnnullamento(): void {
    const fir = this.fir()
    if (!fir || !this.annullamentoValido()) {
      return
    }

    this.annullamentoInCorso.set(true)

    this.rentriFirLifecycleService
      .annullaFIR(fir.id, { motivo: this.annullamentoMotivo })
      .subscribe({
        next: () => {
          this.annullamentoInCorso.set(false)
          this.annullamentoDialogVisible.set(false)
          this.messageService.add({
            severity: 'success',
            summary: 'Formulario annullato',
            detail:
              'La richiesta è stata inviata a RENTRI: segui il tuo dispositivo per confermare la firma.',
          })
          this.reload()
        },
        error: err => {
          this.annullamentoInCorso.set(false)
          this.messageService.add({
            severity: 'error',
            summary: 'Errore',
            detail: this.extractError(err, "Errore nell'annullamento del formulario su RENTRI"),
          })
        },
      })
  }

  // --- Allegati del formulario (R3 Task 6) ---

  /**
   * A differenza di `canAccettareCarico`/`canAnnullareRentri`, QUESTO metodo
   * NON è stato convertito a `/azioni` dal Task 8 — resta debito NON chiuso.
   * Esiste una `Operazione: 'Allegato'` nel catalogo RENTRI, quindi in
   * teoria si potrebbe gatare anche questa sezione, ma la sezione mostra
   * insieme l'upload di un NUOVO allegato e l'elenco/eliminazione di quelli
   * GIÀ caricati: se si gatasse l'intera sezione su
   * `haOperazioneRentri('Allegato')`, un utente perderebbe la visibilità/
   * possibilità di eliminare allegati già presenti in uno stato in cui
   * l'ente non accetta più NUOVI allegati (probabilmente l'ente separa le
   * due permission, il piano non lo chiarisce). Convertirlo richiederebbe
   * una decisione di design (separare "posso aggiungere" da "posso vedere/
   * eliminare") che il piano non specifica — non la si inventa qui. Resta
   * quindi governato dal solo legame RENTRI + ruolo, come prima del Task 8.
   */
  canGestireAllegati(fir: FIR): boolean {
    return !!fir.rentriNumeroFir && this.canManageRENTRI()
  }

  private caricaElencoAllegati(firId: string): void {
    this.allegatiCaricamentoInCorso.set(true)
    this.rentriFirLifecycleService.elencaAllegati(firId).subscribe({
      next: allegati => {
        this.allegati.set(allegati)
        this.allegatiCaricamentoInCorso.set(false)
      },
      error: err => {
        this.allegatiCaricamentoInCorso.set(false)
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Impossibile caricare gli allegati'),
        })
      },
    })
  }

  /**
   * Legge il file scelto dall'utente e lo invia a RENTRI. Formato e
   * dimensione sono verificati QUI, lato UI, PRIMA di leggere il file — pura
   * difesa in profondità: l'autorità resta il backend
   * (`GestisciAllegatiFIRUseCase`), che rifiuterebbe comunque un file non
   * ammesso senza mai chiamare l'ente.
   */
  onFileSelezionatoAllegato(event: Event, fir: FIR): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      this.messageService.add({
        severity: 'error',
        summary: 'Formato non ammesso',
        detail: "Solo file PDF sono ammessi come allegato ('application/pdf').",
      })
      input.value = ''
      return
    }
    if (file.size > LIMITE_ALLEGATO_BYTES) {
      this.messageService.add({
        severity: 'error',
        summary: 'File troppo grande',
        detail: 'Il file supera 1 MB: non verrà inviato a RENTRI.',
      })
      input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      // result è "data:...;base64,XXXX": teniamo solo la parte base64.
      const result = reader.result as string
      const contenutoBase64 = result.includes(',') ? result.split(',')[1] : result
      this.caricaAllegato(fir, file.name, file.type, contenutoBase64)
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  private caricaAllegato(
    fir: FIR,
    nomeFile: string,
    contentType: string,
    contenutoBase64: string
  ): void {
    this.allegatiCaricamentoInCorso.set(true)
    this.rentriFirLifecycleService
      .caricaAllegato(fir.id, { nomeFile, contentType, contenutoBase64 })
      .subscribe({
        next: allegato => {
          this.allegati.update(elenco => [allegato, ...elenco])
          this.allegatiCaricamentoInCorso.set(false)
          this.messageService.add({
            severity: 'success',
            summary: 'Allegato caricato',
            detail: `'${nomeFile}' è stato aggiunto al formulario RENTRI.`,
          })
        },
        error: err => {
          this.allegatiCaricamentoInCorso.set(false)
          this.messageService.add({
            severity: 'error',
            summary: 'Errore',
            detail: this.extractError(err, "Errore nel caricamento dell'allegato su RENTRI"),
          })
        },
      })
  }

  /** Elimina un allegato: verbo del mestiere, con conferma (azione distruttiva su RENTRI). */
  eliminaAllegatoFir(fir: FIR, allegato: AllegatoFirRentri): void {
    this.confirmationService.confirm({
      header: 'Elimina allegato',
      message: `Eliminare l'allegato '${allegato.filename}' dal formulario RENTRI?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Elimina',
      rejectLabel: 'Annulla',
      accept: () => {
        this.allegatoEliminazioneInCorso.set(allegato.id)
        this.rentriFirLifecycleService.eliminaAllegato(fir.id, allegato.id).subscribe({
          next: () => {
            this.allegati.update(elenco => elenco.filter(a => a.id !== allegato.id))
            this.allegatoEliminazioneInCorso.set(null)
            this.messageService.add({
              severity: 'success',
              summary: 'Allegato eliminato',
              detail: `'${allegato.filename}' è stato rimosso dal formulario RENTRI.`,
            })
          },
          error: err => {
            this.allegatoEliminazioneInCorso.set(null)
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, "Errore nell'eliminazione dell'allegato su RENTRI"),
            })
          },
        })
      },
    })
  }

  // --- Stampa PDF e aggiornamento dello stato (R3 Task 7) ---

  /**
   * NON convertito a `/azioni` dal Task 8, e non per debito ma per
   * costruzione: governa "Scarica il PDF" e "Aggiorna lo stato", nessuna
   * delle due un'operazione di SCRITTURA del ciclo di vita del formulario.
   * Non esiste una `Operazione` nel catalogo RENTRI (`Trasporto`,
   * `Accettazione`, `Annulla`, `Allegato`, ecc. — v.
   * `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`, tipo
   * `Operazione`) che corrisponda a "stampa" o "consultazione stato": sono
   * azioni di LETTURA sempre disponibili per un FIR legato, non governate
   * dalla macchina a stati che `/azioni` descrive. Restano quindi locali per
   * costruzione, non per debito residuo come `canGestireAllegati`.
   */
  canScaricarePdfRentri(fir: FIR): boolean {
    return !!fir.rentriNumeroFir && this.canManageRENTRI()
  }

  /**
   * Scarica il PDF del formulario: il backend fa da TRAMITE (proxy dello
   * stream, mai un redirect al portale RENTRI — v. `RentriFirLifecycleService.scaricaPdf`
   * e il backend `RentriFirLifecycleController.scaricaPdf`). Il file arriva
   * come `Blob` e viene aperto/scaricato interamente dentro WasteFlow:
   * l'utente non lascia mai la pagina.
   */
  scaricaPdfRentri(fir: FIR): void {
    this.pdfScaricamentoInCorso.set(true)
    this.rentriFirLifecycleService.scaricaPdf(fir.id).subscribe({
      next: risposta => {
        this.pdfScaricamentoInCorso.set(false)

        if (risposta.status === 204 || !risposta.body) {
          this.messageService.add({
            severity: 'info',
            summary: 'PDF non ancora disponibile',
            detail:
              "L'ente non ha ancora restituito un PDF per questo formulario. Riprova più tardi.",
          })
          return
        }

        const nomeFile = this.estraiNomeFileDaContentDisposition(
          risposta.headers.get('content-disposition')
        )
        this.avviaDownloadBlob(
          risposta.body,
          nomeFile ?? `FIR-${fir.numeroProgressivo || fir.id}.pdf`
        )
      },
      error: err => {
        this.pdfScaricamentoInCorso.set(false)
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nello scaricamento del PDF da RENTRI'),
        })
      },
    })
  }

  private estraiNomeFileDaContentDisposition(header: string | null): string | null {
    if (!header) return null
    const match = /filename="?([^";]+)"?/i.exec(header)
    return match ? match[1] : null
  }

  private avviaDownloadBlob(blob: Blob, nomeFile: string): void {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = nomeFile
    link.click()
    window.URL.revokeObjectURL(url)
  }

  /**
   * «Aggiorna lo stato»: azione ESPLICITA dell'utente, mai un timer/polling
   * automatico — per lo stesso motivo per cui la diagnostica RENTRI (R5) non
   * interroga l'ente a ogni caricamento di pagina: saremmo noi la causa del
   * "ban" (423) che vogliamo evitare. Richiama `/azioni` (Task 2), che
   * riconcilia `rentriStatoFormulario` lato backend, poi ricarica il FIR per
   * riflettere l'eventuale cambiamento.
   *
   * DEBITO NOTO (R3 Task 8, revisione): questo metodo chiama `azioniDisponibili`
   * e scarta il risultato, poi `this.reload()` → `loadFIR()` richiama la
   * STESSA `azioniDisponibili` una seconda volta — due chiamate all'ente per
   * un solo click utente. Un fix "banale" (usare qui il risultato della prima
   * chiamata per impostare `azioniRentri` prima di ricaricare) richiederebbe
   * di rendere `loadFIR`/`reload()` — condivisi da altri percorsi (apertura
   * pagina, altre azioni del ciclo di vita) — capaci di accettare un
   * risultato `/azioni` già disponibile, per evitare la ri-chiamata interna.
   * Non banale da fare in sicurezza in questo giro; non risolto per non
   * rischiare di rompere `loadFIR`/`reload()` o il test che verifica che
   * questo metodo chiami `/azioni` esplicitamente. Da riprendere se il doppio
   * giro di rete diventa un problema reale (rate limiting RENTRI).
   */
  aggiornaStatoRentri(fir: FIR): void {
    this.aggiornamentoStatoInCorso.set(true)
    this.rentriFirLifecycleService.azioniDisponibili(fir.id).subscribe({
      next: () => {
        this.aggiornamentoStatoInCorso.set(false)
        this.messageService.add({
          severity: 'success',
          summary: 'Stato aggiornato',
          detail: 'Lo stato del formulario è stato verificato presso RENTRI.',
        })
        this.reload()
      },
      error: err => {
        this.aggiornamentoStatoInCorso.set(false)
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, "Errore nell'aggiornamento dello stato da RENTRI"),
        })
      },
    })
  }
}
