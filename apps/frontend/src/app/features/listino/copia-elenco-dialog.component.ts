import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { Subscription } from 'rxjs'
import { leggiErroriAzione } from './errori-azione'
import { ElencoAddebiti, EsitoCopia } from './listino.model'
import { ListinoService } from './listino.service'
import { SceltaElencoOrigineComponent } from './scelta-elenco-origine.component'

/** Testo dei conteggi di una copia (D18, R45): solo le voci diverse da zero. */
export function righeEscluse(e: EsitoCopia['escluse']): string[] {
  const voci: [number, string][] = [
    [e.minimi, 'minimi'],
    [e.acconti, 'acconti'],
    [e.conguagli, 'conguagli'],
    [e.duplicate, 'già presenti'],
    [e.condizioni, 'per le regole di condizione'],
  ]
  return voci.filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`)
}

/**
 * Copia da un altro elenco (E25): SOSTITUISCE le righe dell'elenco di arrivo con quelle
 * dell'origine. Prima la scelta (cliente → contratto → elenco), poi una conferma esplicita che lo
 * dice, poi l'esito coi conteggi. Un 409 (versione dell'elenco superata, contratto annullato)
 * mostra il messaggio con "Ricarica"; Esc o "Annulla" non chiudono mentre la copia è in corso.
 */
@Component({
  selector: 'app-copia-elenco-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, SceltaElencoOrigineComponent],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Copia da un altro elenco"
      [modal]="true"
      [closable]="!inCorso()"
      [style]="{ width: '40rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <div *ngIf="esito() as e" class="dlg-form" role="status" data-testid="copia-esito">
        <p>Righe copiate: {{ e.copiate }}.</p>
        <p *ngIf="escluse().length > 0" data-testid="copia-escluse">
          Non copiate: {{ escluse().join(', ') }}.
        </p>
      </div>

      <div *ngIf="!esito() && inConferma()" class="dlg-form" data-testid="copia-conferma">
        <p>
          Le righe dell'elenco <strong>{{ elenco?.codice }}</strong> ({{ elenco?.righe }}) saranno
          <strong>sostituite</strong> con quelle dell'elenco
          <strong>{{ origine()?.codice }}</strong> ({{ origine()?.righe }}). L'operazione non si
          annulla. Minimi, acconti e conguagli non si copiano.
        </p>
      </div>

      <div *ngIf="!esito()" class="dlg-form" [hidden]="inConferma()">
        <app-scelta-elenco-origine
          prefisso="copia-origine"
          [escludiElencoId]="elenco?.id ?? null"
          [azzera]="aperture"
          (scelto)="origine.set($event)"
        />
      </div>

      <ul *ngIf="errori().length > 0" role="alert" class="field-error" data-testid="copia-errore">
        <li *ngFor="let m of errori()">{{ m }}</li>
      </ul>

      <ng-template pTemplate="footer">
        <p-button
          *ngIf="conflitto()"
          label="Ricarica"
          icon="pi pi-refresh"
          [outlined]="true"
          (onClick)="ricarica.emit()"
          data-testid="copia-ricarica"
        />
        <p-button
          [label]="esito() ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="copia-chiudi"
        />
        <ng-container *ngIf="!esito()">
          <p-button
            *ngIf="!inConferma()"
            label="Avanti"
            [disabled]="!origine()"
            (onClick)="inConferma.set(true)"
            data-testid="copia-avanti"
          />
          <ng-container *ngIf="inConferma()">
            <p-button
              label="Indietro"
              [text]="true"
              [disabled]="inCorso()"
              (onClick)="inConferma.set(false)"
              data-testid="copia-indietro"
            />
            <p-button
              label="Sostituisci le righe"
              icon="pi pi-check"
              [disabled]="inCorso()"
              (onClick)="copia()"
              data-testid="copia-conferma-finale"
            />
          </ng-container>
        </ng-container>
      </ng-template>
    </p-dialog>
  `,
  styles: ['.dlg-form { display: flex; flex-direction: column; gap: 0.5rem; }'],
})
export class CopiaElencoDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)

  @Input() visible = false
  /** L'elenco di arrivo, di cui sostituire le righe. */
  @Input() elenco: ElencoAddebiti | null = null
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Copia riuscita: la pagina rilegge elenchi e righe. */
  @Output() copiato = new EventEmitter<EsitoCopia>()
  @Output() ricarica = new EventEmitter<void>()

  aperture = 0
  readonly origine = signal<ElencoAddebiti | null>(null)
  readonly inConferma = signal(false)
  readonly inCorso = signal(false)
  readonly esito = signal<EsitoCopia | null>(null)
  readonly escluse = signal<string[]>([])
  readonly errori = signal<string[]>([])
  readonly conflitto = signal(false)
  private richiesta?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) {
      this.richiesta?.unsubscribe()
      this.aperture++
      this.origine.set(null)
      this.inConferma.set(false)
      this.inCorso.set(false)
      this.esito.set(null)
      this.escluse.set([])
      this.errori.set([])
      this.conflitto.set(false)
    }
  }

  ngOnDestroy(): void {
    this.richiesta?.unsubscribe()
  }

  copia(): void {
    const arrivo = this.elenco
    const origine = this.origine()
    if (!arrivo || !origine || this.inCorso() || !this.inConferma()) return
    this.inCorso.set(true)
    this.errori.set([])
    this.conflitto.set(false)
    this.richiesta = this.servizio.azioni
      .sostituisciDa(arrivo.id, origine.id, arrivo.versione)
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.inConferma.set(false)
          this.esito.set(r)
          this.escluse.set(righeEscluse(r.escluse))
          this.copiato.emit(r)
        },
        error: err => {
          const e = leggiErroriAzione(err, 'Impossibile copiare le righe.')
          this.inCorso.set(false)
          this.inConferma.set(false)
          this.errori.set(e.messaggi)
          this.conflitto.set(e.conflitto)
        },
      })
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.visibleChange.emit(false)
  }
}
