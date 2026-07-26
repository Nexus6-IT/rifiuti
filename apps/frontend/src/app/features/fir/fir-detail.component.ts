import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute, Router, RouterModule } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { MessageModule } from 'primeng/message'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ToastModule } from 'primeng/toast'
import { ConfirmationService, MessageService } from 'primeng/api'
import { FirService } from './fir.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { RENTRISyncBadgeComponent } from './components/rentri-sync-badge/rentri-sync-badge.component'
import { RENTRISyncLogsComponent } from './components/rentri-sync-logs/rentri-sync-logs.component'
import { RENTRISyncService } from './services/rentri-sync.service'
import { AuthService } from '../../core/services/auth.service'
import { RentriFormulariService } from '../rentri/rentri-formulari.service'

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
    RouterModule,
    ButtonModule,
    TagModule,
    MessageModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
    ToastModule,
    RENTRISyncBadgeComponent,
    RENTRISyncLogsComponent,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="page fir-detail" data-testid="fir-detail-page">
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
          </div>
        </section>

        <!-- Parti coinvolte -->
        <section class="surface-card detail-section" aria-label="Parti coinvolte">
          <h2 class="section-title">Parti coinvolte</h2>
          <div class="parti-grid">
            <div class="parte-card" data-testid="fir-detail-produttore">
              <h3>Produttore</h3>
              <p class="parte-ragione">{{ f.produttore?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">P.IVA {{ f.produttore?.partitaIva || 'N/D' }}</p>
              @if (f.produttore?.indirizzo) {
                <p class="parte-dettaglio">{{ f.produttore?.indirizzo }}</p>
              }
            </div>
            <div class="parte-card" data-testid="fir-detail-trasportatore">
              <h3>Trasportatore</h3>
              <p class="parte-ragione">{{ f.trasportatore?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">P.IVA {{ f.trasportatore?.partitaIva || 'N/D' }}</p>
              @if (f.trasportatore?.targaVeicolo) {
                <p class="parte-dettaglio">Targa {{ f.trasportatore?.targaVeicolo }}</p>
              }
            </div>
            <div class="parte-card" data-testid="fir-detail-destinatario">
              <h3>Destinatario</h3>
              <p class="parte-ragione">{{ f.destinatario?.ragioneSociale || 'N/D' }}</p>
              <p class="parte-dettaglio">P.IVA {{ f.destinatario?.partitaIva || 'N/D' }}</p>
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
            </div>
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
        margin-bottom: var(--spacing-lg);
      }

      .section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        margin: 0 0 var(--spacing-base);
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
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-weight: var(--font-weight-medium);
      }

      .detail-value {
        font-size: var(--font-size-base);
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
        border: 1px solid var(--color-gray-200);
        border-radius: var(--radius-base);
        padding: var(--spacing-base);
      }
      .parte-card h3 {
        margin: 0 0 var(--spacing-xs);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        color: var(--text-secondary);
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
    `,
  ],
})
export class FirDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly firService = inject(FirService)
  private readonly rentriSyncService = inject(RENTRISyncService)
  private readonly rentriFormulariService = inject(RentriFormulariService)
  private readonly authService = inject(AuthService)
  private readonly confirmationService = inject(ConfirmationService)
  private readonly messageService = inject(MessageService)

  protected readonly fir = signal<FIR | null>(null)
  protected readonly loading = signal(true)
  protected readonly error = signal<string | null>(null)

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

  /** «Vai al certificato»: unica azione utile quando RENTRI ha rifiutato per un certificato non valido (403). */
  mostraVaiAlCertificato(fir: FIR): boolean {
    return (
      fir.rentriSyncStatus === 'FAILED' &&
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

  haAzioni(fir: FIR): boolean {
    return (
      fir.stato === FIRStato.BOZZA ||
      fir.stato === FIRStato.EMESSO ||
      this.canTrasmettereRentri(fir) ||
      this.canRiprovareRentri(fir) ||
      this.mostraVaiAlCertificato(fir) ||
      this.canConfermareLegameRentri(fir) ||
      this.canRilasciareLegameRentri(fir)
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
}
