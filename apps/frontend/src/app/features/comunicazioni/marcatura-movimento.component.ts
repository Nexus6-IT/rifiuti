import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { ToastService } from '../../core/services/toast.service'
import { CONSORZI, Consorzio, MarcaturaMovimento, etichettaConsorzio } from './consorzi.model'
import { ConsorziService } from './consorzi.service'

interface RigaConsorzio {
  consorzio: Consorzio
  stato: 'REGOLA' | 'MANUALE' | 'ESCLUSO' | 'NO'
  testo: string
  /**
   * Solo per `MANUALE`: `true` se una regola attiva prenderebbe comunque il movimento, `false` se
   * nessuna lo prende, `null` se non si sa (risposta senza `regolaPrende`).
   */
  regolaPrende: boolean | null
}

/**
 * Correzione manuale dei consorzi di un movimento (4.9b, T12), nel dettaglio del registro. Per ogni
 * consorzio dice se il movimento e' marcato (da regola o a mano) o escluso a mano, e permette di
 * cambiarlo: marcare, escludere, togliere la correzione. Lettura per tutti, scrittura ADMIN (il
 * backend lo impone e dice se l'utente puo' con `puoModificare`).
 */
@Component({
  selector: 'app-marcatura-movimento',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <section class="marcatura-mov" data-testid="marcatura-movimento" aria-label="Consorzi">
      <h3 class="section-title">Consorzi</h3>
      <p *ngIf="errore()" role="alert" data-testid="marcatura-errore">{{ errore() }}</p>
      <p *ngIf="permessoNonLetto()" class="text-secondary" data-testid="marcatura-permesso-errore">
        Non è stato possibile verificare se puoi modificare i consorzi.
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="leggiPermesso()"
          data-testid="marcatura-riprova"
        ></p-button>
      </p>
      <ul class="m-0 p-0 list-none" *ngIf="!errore()">
        <li
          *ngFor="let r of righe()"
          class="flex flex-wrap align-items-center gap-2 mb-2"
          [attr.data-testid]="'marcatura-riga-' + r.consorzio"
        >
          <strong style="min-width: 6rem">{{ nome(r.consorzio) }}</strong>
          <span [class.text-secondary]="r.stato === 'NO'" data-testid="marcatura-stato">{{
            r.testo
          }}</span>
          <ng-container *ngIf="puoModificare()">
            <p-button
              *ngIf="r.stato === 'NO'"
              label="Marca a mano"
              icon="pi pi-tag"
              [text]="true"
              size="small"
              [disabled]="inCorso()"
              (onClick)="imposta(r.consorzio, false)"
              [attr.data-testid]="'marcatura-marca-' + r.consorzio"
            ></p-button>
            <p-button
              *ngIf="r.stato === 'REGOLA'"
              label="Escludi"
              icon="pi pi-ban"
              [text]="true"
              size="small"
              [disabled]="inCorso()"
              (onClick)="imposta(r.consorzio, true)"
              [attr.data-testid]="'marcatura-escludi-' + r.consorzio"
            ></p-button>
            <p-button
              *ngIf="r.stato === 'MANUALE' || r.stato === 'ESCLUSO'"
              [label]="etichettaTogli(r)"
              icon="pi pi-undo"
              [text]="true"
              size="small"
              [disabled]="inCorso()"
              (onClick)="rimuovi(r.consorzio)"
              [attr.data-testid]="'marcatura-togli-' + r.consorzio"
            ></p-button>
          </ng-container>
        </li>
      </ul>
    </section>
  `,
})
export class MarcaturaMovimentoComponent implements OnChanges {
  private readonly servizio = inject(ConsorziService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) movimentoId!: string
  /** Esito noto (dall'elenco del registro): evita la lettura. */
  @Input() marcatura: MarcaturaMovimento | null = null
  @Output() readonly cambiato = new EventEmitter<MarcaturaMovimento>()

  readonly corrente = signal<MarcaturaMovimento>({ marcature: [], esclusi: [] })
  readonly puoModificare = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  /** La lettura del permesso e' fallita: si riprova al prossimo uso o con «Riprova». */
  readonly permessoNonLetto = signal(false)

  readonly nome = etichettaConsorzio
  private permessoLetto = false
  private permessoInLettura = false

  ngOnChanges(): void {
    this.errore.set(null)
    // Il permesso non cambia fra un input e l'altro: una lettura sola per istanza, ripetuta solo
    // se la precedente e' fallita (e mai in parallelo a una ancora in corso).
    this.leggiPermesso()
    if (this.marcatura) {
      this.corrente.set(this.marcatura)
      return
    }
    this.servizio.consorziDeiMovimenti([this.movimentoId]).subscribe({
      next: m => this.corrente.set(m[this.movimentoId] ?? { marcature: [], esclusi: [] }),
      error: () => this.errore.set('Impossibile leggere i consorzi del movimento.'),
    })
  }

  /** Legge il permesso di modifica; no-op se gia' letto o in corso. Dopo un errore si puo' ripetere. */
  leggiPermesso(): void {
    if (this.permessoLetto || this.permessoInLettura) return
    this.permessoInLettura = true
    this.servizio.regole().subscribe({
      next: r => {
        this.permessoInLettura = false
        this.permessoLetto = true
        this.permessoNonLetto.set(false)
        this.puoModificare.set(r.puoModificare)
      },
      error: () => {
        this.permessoInLettura = false
        this.permessoNonLetto.set(true)
        this.puoModificare.set(false)
      },
    })
  }

  etichettaTogli(r: RigaConsorzio): string {
    if (r.stato === 'ESCLUSO') return 'Togli l’esclusione'
    return r.regolaPrende === true ? 'Torna alla regola' : 'Togli la marcatura'
  }

  righe(): RigaConsorzio[] {
    const m = this.corrente()
    return CONSORZI.map(({ value }): RigaConsorzio => {
      const marcatura = m.marcature.find(x => x.consorzio === value)
      if (marcatura?.origine === 'MANUALE') {
        const regolaPrende = m.regolaPrende === undefined ? null : m.regolaPrende.includes(value)
        const nota =
          regolaPrende === null
            ? ''
            : regolaPrende
              ? ' (una regola lo prenderebbe comunque)'
              : ' (nessuna regola lo prende)'
        return { consorzio: value, stato: 'MANUALE', testo: `Marcato a mano${nota}`, regolaPrende }
      }
      if (marcatura)
        return {
          consorzio: value,
          stato: 'REGOLA',
          testo: 'Marcato da una regola',
          regolaPrende: null,
        }
      if (m.esclusi.includes(value))
        return {
          consorzio: value,
          stato: 'ESCLUSO',
          testo: 'Escluso a mano (una regola lo prenderebbe)',
          regolaPrende: null,
        }
      return { consorzio: value, stato: 'NO', testo: 'Non marcato', regolaPrende: null }
    })
  }

  imposta(consorzio: Consorzio, escluso: boolean): void {
    this.applica(this.servizio.impostaOverride(this.movimentoId, consorzio, escluso))
  }

  rimuovi(consorzio: Consorzio): void {
    this.applica(this.servizio.rimuoviOverride(this.movimentoId, consorzio))
  }

  private applica(chiamata: ReturnType<ConsorziService['impostaOverride']>): void {
    this.inCorso.set(true)
    chiamata.subscribe({
      next: m => {
        this.inCorso.set(false)
        this.corrente.set(m)
        this.cambiato.emit(m)
      },
      error: () => {
        this.inCorso.set(false)
        this.toast.error('Operazione non riuscita.')
      },
    })
  }
}
