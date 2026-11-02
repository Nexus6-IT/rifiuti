import { CommonModule } from '@angular/common'
import {
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { Subscription } from 'rxjs'
import { AllegatoElenco } from './listino.model'
import { ListinoService } from './listino.service'
import { chiediConferma, messaggioErrore } from '../clienti/tabelle/tabella-comune'

type Posizione = 1 | 2
const POSIZIONI: readonly Posizione[] = [1, 2]

const dimensioneLeggibile = (byte: number): string =>
  byte >= 1024 * 1024
    ? `${(byte / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(byte / 1024))} KB`

/**
 * I due PDF di un elenco di addebiti (E4, modello: gli allegati del contratto della 4.1b): carica,
 * apri, rimuovi. Il formato e il limite di 4 MB li controlla il backend (413 e 415): il suo
 * messaggio si mostra com'è. Gli allegati non toccano la versione dell'elenco. Eccezione dichiarata
 * a D16 (R47): si caricano e si tolgono anche con il contratto annullato, quindi `soloLettura` vale
 * solo per chi non scrive (VIEWER), non per lo stato del contratto.
 */
@Component({
  selector: 'app-allegati-elenco',
  standalone: true,
  imports: [CommonModule, ButtonModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  template: `
    <div *ngIf="elencoId" class="allegati">
      <div
        *ngFor="let p of posizioni"
        class="riga"
        [attr.data-testid]="'elenco-allegato-riga-' + p"
      >
        <span class="etichetta">PDF {{ p }}</span>
        <span class="nome" [attr.data-testid]="'elenco-allegato-nome-' + p">
          <ng-container *ngIf="allegatoIn(p) as a; else nessuno">
            {{ a.nomeFile }} ({{ dimensione(a.dimensioneByte) }})
          </ng-container>
          <ng-template #nessuno>Nessun file</ng-template>
        </span>
        <p-button
          *ngIf="allegatoIn(p)"
          label="Apri"
          icon="pi pi-external-link"
          [text]="true"
          [disabled]="occupata() !== null"
          (onClick)="apri(p)"
          [attr.data-testid]="'elenco-allegato-apri-' + p"
        />
        <p-button
          *ngIf="allegatoIn(p) && !soloLettura"
          label="Rimuovi"
          icon="pi pi-trash"
          severity="danger"
          [text]="true"
          [disabled]="occupata() !== null"
          (onClick)="rimuovi(p)"
          [attr.data-testid]="'elenco-allegato-rimuovi-' + p"
        />
        <ng-container *ngIf="!allegatoIn(p) && !soloLettura">
          <input
            #file
            type="file"
            accept="application/pdf,.pdf"
            hidden
            (change)="scelto(p, file)"
            [attr.data-testid]="'elenco-allegato-file-' + p"
          />
          <p-button
            label="Carica"
            icon="pi pi-upload"
            [text]="true"
            [disabled]="occupata() !== null"
            (onClick)="file.click()"
            [attr.data-testid]="'elenco-allegato-carica-' + p"
          />
        </ng-container>
      </div>
      <p
        *ngIf="errore() as e"
        role="alert"
        class="field-error"
        data-testid="elenco-allegati-errore"
      >
        {{ e }}
      </p>
    </div>
    <p-confirmDialog (onHide)="confermaAperta.set(false)" />
  `,
  styles: [
    `
      .allegati {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .riga {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .etichetta {
        font-weight: 600;
        min-width: 4rem;
      }
      .nome {
        flex: 1 1 12rem;
      }
    `,
  ],
})
export class AllegatiElencoComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly conferma = inject(ConfirmationService)
  private readonly zona = inject(NgZone)

  @Input() elencoId: string | null = null
  @Input() soloLettura = false

  readonly posizioni = POSIZIONI
  readonly dimensione = dimensioneLeggibile
  readonly elenco = signal<AllegatoElenco[]>([])
  readonly errore = signal<string | null>(null)
  /** Posizione con una richiesta in corso: finché c'è, tutte le azioni sono ferme (una sola operazione alla volta). */
  readonly occupata = signal<Posizione | null>(null)
  readonly confermaAperta = signal(false)

  private lettura?: Subscription
  private operazione?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['elencoId']) this.carica()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
    this.operazione?.unsubscribe()
  }

  allegatoIn(p: Posizione): AllegatoElenco | undefined {
    return this.elenco().find(a => a.posizione === p)
  }

  private carica(): void {
    this.lettura?.unsubscribe()
    this.operazione?.unsubscribe()
    this.elenco.set([])
    this.errore.set(null)
    this.occupata.set(null)
    // Una conferma aperta era per un allegato dell'elenco precedente.
    this.conferma.close()
    this.confermaAperta.set(false)
    if (!this.elencoId) return
    this.lettura = this.servizio.allegatiElenco.elenco(this.elencoId).subscribe({
      next: l => this.elenco.set(l),
      error: err => this.errore.set(messaggioErrore(err, 'Impossibile caricare gli allegati.')),
    })
  }

  scelto(p: Posizione, input: HTMLInputElement): void {
    const file = input.files?.[0]
    input.value = ''
    if (!file || !this.elencoId || this.occupata() !== null) return
    this.errore.set(null)
    this.occupata.set(p)
    this.operazione = this.servizio.allegatiElenco.carica(this.elencoId, p, file).subscribe({
      next: a => {
        this.occupata.set(null)
        this.elenco.update(l => [...l.filter(x => x.posizione !== a.posizione), a])
      },
      error: err => {
        this.occupata.set(null)
        this.errore.set(messaggioErrore(err, 'Impossibile caricare il PDF.'))
      },
    })
  }

  /**
   * Apre il PDF in una nuova scheda da un object URL, revocato dopo un minuto. La scheda si apre
   * subito, dentro il click (altrimenti il blocco popup la ferma), e riceve l'indirizzo a
   * scaricamento finito.
   */
  apri(p: Posizione): void {
    const a = this.allegatoIn(p)
    if (!a || !this.elencoId || this.occupata() !== null) return
    const scheda = window.open('', '_blank')
    if (scheda) scheda.opener = null
    this.errore.set(null)
    this.occupata.set(p)
    this.operazione = this.servizio.allegatiElenco.scarica(this.elencoId, a.id).subscribe({
      next: blob => {
        this.occupata.set(null)
        const url = URL.createObjectURL(blob)
        if (scheda) scheda.location.href = url
        else window.open(url, '_blank')
        // Fuori dalla zona: un timer di un minuto non deve tenere "instabile" l'applicazione.
        this.zona.runOutsideAngular(() => setTimeout(() => URL.revokeObjectURL(url), 60_000))
      },
      error: err => {
        this.occupata.set(null)
        scheda?.close()
        this.errore.set(messaggioErrore(err, 'Impossibile aprire il PDF.'))
      },
    })
  }

  rimuovi(p: Posizione): void {
    const a = this.allegatoIn(p)
    if (!a || !this.elencoId || this.occupata() !== null) return
    const elencoId = this.elencoId
    this.confermaAperta.set(true)
    chiediConferma(
      this.conferma,
      `Rimuovere il PDF "${a.nomeFile}"?`,
      () => {
        this.confermaAperta.set(false)
        if (this.elencoId !== elencoId) return
        this.errore.set(null)
        this.occupata.set(p)
        this.operazione = this.servizio.allegatiElenco.rimuovi(elencoId, a.id).subscribe({
          next: () => {
            this.occupata.set(null)
            this.elenco.update(l => l.filter(x => x.id !== a.id))
          },
          error: err => {
            this.occupata.set(null)
            this.errore.set(messaggioErrore(err, 'Impossibile rimuovere il PDF.'))
          },
        })
      },
      { header: 'Conferma rimozione', acceptLabel: 'Rimuovi' }
    )
  }
}
