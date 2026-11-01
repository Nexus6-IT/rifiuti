import { CommonModule } from '@angular/common'
import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'

interface OpzioneContratto {
  id: string
  etichetta: string
}

const etichetta = (c: { numero: string; descrizione?: string }): string =>
  c.descrizione ? `${c.numero} — ${c.descrizione}` : c.numero

/**
 * Contratto principale a cui questo è allegato (D28): i contratti dello stesso cliente, non
 * annullati e non a loro volta allegati, escluso questo. È solo un aiuto alla scelta: le regole
 * le applica il backend (D20) e il suo messaggio si mostra com'è. Il principale già scelto resta
 * fra le opzioni anche se l'elenco non lo contiene più.
 */
@Component({
  selector: 'app-contratto-principale-select',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextModule],
  template: `
    <label for="contratto-dlg-principale">Contratto principale</label>
    <select
      id="contratto-dlg-principale"
      class="p-inputtext"
      [formControl]="controllo"
      data-testid="contratto-dlg-principale"
    >
      <option value="">—</option>
      <option *ngFor="let o of opzioni()" [value]="o.id">{{ o.etichetta }}</option>
    </select>
    <ng-container *ngIf="parziale() || ricerca !== ''">
      <small class="field-hint" data-testid="contratto-dlg-principale-parziale"
        >Elenco parziale: cerca per numero o descrizione.</small
      >
      <input
        pInputText
        type="search"
        aria-label="Cerca il contratto principale"
        placeholder="Cerca per numero o descrizione"
        [value]="ricerca"
        [disabled]="controllo.disabled"
        (change)="cerca($any($event.target).value)"
        (keydown.enter)="$event.preventDefault(); cerca($any($event.target).value)"
        data-testid="contratto-dlg-principale-cerca"
      />
    </ng-container>
    <small
      *ngIf="errore() as e"
      class="field-error"
      role="alert"
      data-testid="contratto-dlg-principale-errore"
      >{{ e }}</small
    >
  `,
})
export class ContrattoPrincipaleSelectComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ClientiService)

  @Input({ required: true }) controllo!: FormControl<string>
  /** Cliente del contratto: i candidati sono i suoi contratti. */
  @Input() clienteId = ''
  /** Questo contratto (null = nuovo): non può essere principale di sé stesso. */
  @Input() contrattoId: string | null = null
  /** Il principale attuale, per mostrarne il numero se l'elenco non lo contiene. */
  @Input() corrente: { id: string; numero: string } | null = null

  private readonly candidati = signal<OpzioneContratto[]>([])
  readonly errore = signal<string | null>(null)
  /** Il server ha più contratti di quelli ricevuti (massimo 100 per richiesta). */
  readonly parziale = signal(false)
  ricerca = ''
  private lettura?: Subscription

  readonly opzioni = (): OpzioneContratto[] => {
    const lista = this.candidati()
    const scelto = this.controllo?.value
    if (!scelto || lista.some(o => o.id === scelto)) return lista
    const nome = this.corrente?.id === scelto ? this.corrente.numero : 'Contratto scelto'
    return [{ id: scelto, etichetta: nome }, ...lista]
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['clienteId'] || c['contrattoId']) {
      this.ricerca = ''
      this.carica()
    }
  }

  /** Ricerca sul server per testo (numero o descrizione) quando l'elenco è parziale. */
  cerca(testo: string): void {
    this.ricerca = testo.trim()
    this.carica()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
  }

  private carica(): void {
    this.lettura?.unsubscribe()
    this.candidati.set([])
    this.errore.set(null)
    this.parziale.set(false)
    if (!this.clienteId) return
    this.lettura = this.servizio.contratti
      .list({
        clienteId: this.clienteId,
        dimensione: 100,
        ...(this.ricerca ? { testo: this.ricerca } : {}),
      })
      .subscribe({
        next: p => {
          this.parziale.set(p.totale > p.elementi.length)
          this.candidati.set(
            p.elementi
              .filter(
                (c: ContrattoCliente) =>
                  c.id !== this.contrattoId && c.stato !== 'ANNULLATO' && !c.contrattoPrincipale
              )
              .map(c => ({ id: c.id, etichetta: etichetta(c) }))
          )
        },
        error: err =>
          this.errore.set(messaggioErrore(err, 'Impossibile caricare i contratti del cliente.')),
      })
  }
}
