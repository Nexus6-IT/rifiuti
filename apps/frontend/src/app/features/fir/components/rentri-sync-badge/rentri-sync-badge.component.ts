import { Component, Input, OnInit, OnDestroy, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'
import { Subject, takeUntil, timer, switchMap } from 'rxjs'
import { RENTRISyncService, SyncJobStatus } from '../../services/rentri-sync.service'
import { RENTRISyncStatusValue } from '../../../../shared/models/fir.model'

/**
 * Badge di stato RENTRI per la riga di un FIR (R1 Task 3).
 *
 * Comunica UNA cosa sola a colpo d'occhio: il formulario è a posto con
 * l'ente (verde), sta andando (blu/grigio) o richiede attenzione
 * (arancio/rosso) — vive nella lista FIR, non in un pannello tecnico
 * separato (criterio di valore del task).
 *
 * Stati reali (v. backend `RENTRISyncStatus`): PENDING, SYNCING, SYNCED,
 * FAILED, PERMANENTLY_FAILED. In modalità IBRIDA un esito tecnicamente
 * riuscito può restare "proposto" (`rentriNumeroFirProposto`) finché
 * l'operatore non conferma esplicitamente il legame: un numero proposto
 * NON è il numero ufficiale e va mostrato in modo distinto.
 *
 * Uso:
 * ```html
 * <app-rentri-sync-badge
 *   [numeroFir]="fir.numeroProgressivo || fir.id"
 *   [rentriSyncStatus]="fir.rentriSyncStatus"
 *   [rentriNumeroFir]="fir.rentriNumeroFir"
 *   [rentriNumeroFirProposto]="fir.rentriNumeroFirProposto"
 *   [syncAttempts]="fir.rentriSyncAttempts"
 *   [lastSyncError]="fir.rentriLastSyncError">
 * </app-rentri-sync-badge>
 * ```
 */
@Component({
  selector: 'app-rentri-sync-badge',
  standalone: true,
  imports: [CommonModule, TagModule, TooltipModule],
  template: `
    <div class="rentri-sync-badge" [attr.data-testid]="'rentri-sync-badge-' + numeroFir">
      @if (isPolling()) {
        <p-tag
          [severity]="'info'"
          [value]="'In corso: ' + (pollingStatus()?.progress ?? 0) + '%'"
          [pTooltip]="getTooltipText()"
          tooltipPosition="top"
          styleClass="sync-status-badge"
        >
          <i class="pi pi-spin pi-spinner mr-1"></i>
        </p-tag>
      } @else {
        <p-tag
          [severity]="getSeverity()"
          [value]="getDisplayText()"
          [pTooltip]="getTooltipText()"
          tooltipPosition="top"
          styleClass="sync-status-badge"
        >
          <i [class]="getIcon()" class="mr-1"></i>
        </p-tag>
      }
    </div>
  `,
  styles: [
    `
      .rentri-sync-badge {
        display: inline-block;
      }

      :host ::ng-deep .sync-status-badge {
        font-size: var(--font-size-xs);
        padding: 0.25rem 0.5rem;
      }

      :host ::ng-deep .sync-status-badge i {
        font-size: var(--font-size-xs);
      }
    `,
  ],
})
export class RENTRISyncBadgeComponent implements OnInit, OnDestroy {
  private readonly rentriSyncService = inject(RENTRISyncService)
  private readonly destroy$ = new Subject<void>()

  /** Numero FIR (o id) del formulario — identifica il badge nella riga (testid). */
  @Input({ required: true }) numeroFir!: string

  /** Stato di sincronizzazione RENTRI del FIR. */
  @Input({ required: true }) rentriSyncStatus!: RENTRISyncStatusValue

  /** Job ID per una sincronizzazione in corso (facoltativo). */
  @Input() syncJobId?: string

  /** Numero FIR ufficiale RENTRI (legame confermato). */
  @Input() rentriNumeroFir?: string | null

  /**
   * Numero FIR proposto in modalità ibrida, in attesa di conferma esplicita:
   * finché è valorizzato e `rentriNumeroFir` è nullo, il legame NON è
   * ufficiale.
   */
  @Input() rentriNumeroFirProposto?: string | null

  /** Numero di tentativi di trasmissione effettuati. */
  @Input() syncAttempts: number = 0

  /** Ultimo messaggio di errore dell'ultima trasmissione fallita. */
  @Input() lastSyncError?: string | null

  /** Abilita il polling automatico per sincronizzazioni in corso. */
  @Input() autoPoll: boolean = true

  /** Intervallo di polling in millisecondi. */
  @Input() pollInterval: number = 3000

  // Signals
  protected readonly isPolling = signal(false)
  protected readonly pollingStatus = signal<SyncJobStatus | null>(null)

  /** Legame proposto in attesa di conferma (modalità ibrida): non ancora ufficiale. */
  private get hasProposalPending(): boolean {
    return !!this.rentriNumeroFirProposto && !this.rentriNumeroFir
  }

  ngOnInit(): void {
    if (this.autoPoll && this.syncJobId && this.rentriSyncStatus === 'SYNCING') {
      this.startPolling()
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next()
    this.destroy$.complete()
  }

  private startPolling(): void {
    if (!this.syncJobId) return

    this.isPolling.set(true)

    timer(0, this.pollInterval)
      .pipe(
        switchMap(() => this.rentriSyncService.getSyncStatus(this.syncJobId!)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: status => {
          this.pollingStatus.set(status)

          if (status.status === 'completed' || status.status === 'failed') {
            this.isPolling.set(false)
            this.destroy$.next()
          }
        },
        error: () => {
          this.isPolling.set(false)
        },
      })
  }

  /** Severità del badge: verde = a posto, blu/grigio = in corso, arancio/rosso = attenzione. */
  protected getSeverity(): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    if (this.hasProposalPending) {
      return 'warning'
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return 'success'
      case 'PENDING':
        return 'secondary'
      case 'SYNCING':
        return 'info'
      case 'FAILED':
        return 'warning'
      case 'PERMANENTLY_FAILED':
        return 'danger'
      default:
        return 'secondary'
    }
  }

  /** Testo del badge in italiano, coerente con gli stati reali di RENTRISyncStatus. */
  protected getDisplayText(): string {
    if (this.hasProposalPending) {
      return `Da confermare: ${this.rentriNumeroFirProposto}`
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return this.rentriNumeroFir ? `A posto — ${this.rentriNumeroFir}` : 'A posto con RENTRI'
      case 'PENDING':
        return 'Da trasmettere'
      case 'SYNCING':
        return 'Trasmissione in corso'
      case 'FAILED':
        return `Riprova ${this.syncAttempts}/5`
      case 'PERMANENTLY_FAILED':
        return 'Richiede intervento'
      default:
        return 'Stato sconosciuto'
    }
  }

  /** Icona coerente con lo stato mostrato. */
  protected getIcon(): string {
    if (this.hasProposalPending) {
      return 'pi pi-question-circle'
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return 'pi pi-check-circle'
      case 'PENDING':
        return 'pi pi-clock'
      case 'SYNCING':
        return 'pi pi-spin pi-spinner'
      case 'FAILED':
        return 'pi pi-exclamation-triangle'
      case 'PERMANENTLY_FAILED':
        return 'pi pi-times-circle'
      default:
        return 'pi pi-question-circle'
    }
  }

  /** Testo del tooltip, con dettaglio dell'errore quando disponibile. */
  protected getTooltipText(): string {
    if (this.isPolling()) {
      const status = this.pollingStatus()
      return status
        ? `Trasmissione in corso (${status.progress}% completato) — tentativo ${status.attemptsMade}`
        : 'Trasmissione in corso...'
    }

    if (this.hasProposalPending) {
      return `Numero FIR ${this.rentriNumeroFirProposto} proposto da RENTRI: conferma il legame per renderlo ufficiale`
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return this.rentriNumeroFir
          ? `Sincronizzato con RENTRI — numero ufficiale ${this.rentriNumeroFir}`
          : 'Sincronizzato con RENTRI'

      case 'PENDING':
        return 'In attesa di essere trasmesso a RENTRI'

      case 'SYNCING':
        return 'Trasmissione a RENTRI in corso...'

      case 'FAILED': {
        const attemptsText = `Verrà ritentato automaticamente (${this.syncAttempts}/5 tentativi)`
        return this.lastSyncError
          ? `Trasmissione non riuscita: ${this.lastSyncError}\n${attemptsText}`
          : `Trasmissione non riuscita — ${attemptsText}`
      }

      case 'PERMANENTLY_FAILED': {
        const detail = this.lastSyncError ? `: ${this.lastSyncError}` : ''
        return `Numero massimo di tentativi raggiunto${detail}. Richiede intervento manuale.`
      }

      default:
        return 'Stato di sincronizzazione RENTRI sconosciuto'
    }
  }
}
