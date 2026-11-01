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
import { FormsModule } from '@angular/forms'
import { AutoCompleteModule } from 'primeng/autocomplete'
import { ButtonModule } from 'primeng/button'
import { Subscription } from 'rxjs'
import { Cliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione } from '../clienti/opzioni-fatturazione'

export const etichettaCliente = (c: {
  ragioneSociale: string
  partitaIva: string | null
}): string => (c.partitaIva ? `${c.ragioneSociale} (${c.partitaIva})` : c.ragioneSociale)

/**
 * Cliente: autocomplete sui clienti attivi (ricerca per testo sul server) e "Nuovo cliente" accanto
 * (aggiunta in linea). `escludiId` toglie dai suggerimenti il cliente del contratto, per il campo
 * del cliente di fatturazione. Emette il `Cliente` intero, perché il dialog ne precompila i
 * predefiniti (D4); `null` quando la scelta viene tolta o il testo digitato non corrisponde più.
 */
@Component({
  selector: 'app-scelta-cliente',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule, ButtonModule],
  template: `
    <label [for]="prefisso">{{ etichetta }}</label>
    <div class="scelta">
      <p-autoComplete
        [inputId]="prefisso"
        [ngModel]="modello"
        (ngModelChange)="cambiaModello($event)"
        [ngModelOptions]="{ standalone: true }"
        [suggestions]="suggerimenti()"
        (completeMethod)="cerca($event)"
        (onSelect)="seleziona($event.value)"
        (onClear)="svuota()"
        field="etichetta"
        [dropdown]="true"
        [forceSelection]="true"
        [minLength]="0"
        [showClear]="true"
        [disabled]="disabled"
        [ariaLabel]="etichetta"
        styleClass="w-full"
        [attr.data-testid]="prefisso"
      />
      <p-button
        *ngIf="puoCreare"
        label="Nuovo cliente"
        icon="pi pi-plus"
        [text]="true"
        size="small"
        (onClick)="nuovo.emit($event)"
        [attr.data-testid]="prefissoNuovo"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .scelta {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .scelta p-autocomplete {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ],
})
export class SceltaClienteComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ClientiService)

  @Input({ required: true }) prefisso!: string
  @Input({ required: true }) prefissoNuovo!: string
  @Input({ required: true }) etichetta!: string
  /** La scelta corrente, impostata da fuori (lettura del contratto, cliente appena creato). */
  @Input() valore: Opzione | null = null
  @Input() escludiId: string | null = null
  @Input() disabled = false
  @Input() puoCreare = false
  @Output() scelto = new EventEmitter<Cliente | null>()
  @Output() nuovo = new EventEmitter<unknown>()

  readonly suggerimenti = signal<Opzione[]>([])
  /** Quello che mostra l'autocomplete: la scelta, oppure il testo che l'operatore sta digitando. */
  modello: unknown = null
  private trovati = new Map<string, Cliente>()
  private ricerca?: Subscription
  private conScelta = false

  ngOnChanges(c: SimpleChanges): void {
    if (c['valore']) {
      this.modello = this.valore
      this.conScelta = this.valore !== null
    }
  }

  ngOnDestroy(): void {
    this.ricerca?.unsubscribe()
  }

  cerca(ev: { query: string }): void {
    this.ricerca?.unsubscribe()
    const testo = ev.query.trim()
    this.ricerca = this.servizio.clienti
      .list({ pagina: 1, dimensione: 20, soloAttivi: true, ...(testo ? { testo } : {}) })
      .subscribe({
        next: p => {
          const elenco = p.elementi.filter(c => c.id !== this.escludiId)
          this.trovati = new Map(elenco.map(c => [c.id, c]))
          this.suggerimenti.set(
            elenco.map(c => ({ id: c.id, etichetta: etichettaCliente(c.ditta) }))
          )
        },
        error: () => this.suggerimenti.set([]),
      })
  }

  seleziona(voce: Opzione): void {
    this.conScelta = true
    this.scelto.emit(this.trovati.get(voce.id) ?? null)
  }

  svuota(): void {
    this.conScelta = false
    this.scelto.emit(null)
  }

  /**
   * Il modello cambia anche senza `onSelect` / `onClear` (testo digitato, `forceSelection` che
   * svuota al blur): se c'era una scelta, non vale più.
   */
  cambiaModello(valore: unknown): void {
    this.modello = valore
    const id = (valore as Opzione | null)?.id
    if (typeof id !== 'string' && this.conScelta) this.svuota()
  }
}
