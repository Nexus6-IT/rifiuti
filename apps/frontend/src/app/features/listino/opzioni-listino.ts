import { FormControl } from '@angular/forms'
import { Signal, WritableSignal, computed, signal } from '@angular/core'
import { Subscription } from 'rxjs'
import { AggiuntaInLinea } from '../clienti/aggiunta-in-linea'
import { Rif } from '../clienti/clienti.model'
import { Opzione, conCorrente, etichettaCodice } from '../clienti/opzioni-fatturazione'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { CodiceIva, CodificaAddebito, GenereCodificaAddebito } from './listino.model'
import { ListinoService } from './listino.service'

/** Le sei voci dell'addebito che si scelgono da una tabella: i cinque generi e il codice IVA. */
export type ChiaveOpzione = GenereCodificaAddebito | 'IVA'

export const CHIAVI_OPZIONE: readonly ChiaveOpzione[] = [
  'GRUPPO',
  'CATEGORIA',
  'CENTRO_RICAVO',
  'CATEGORIA_STATISTICA_1',
  'CATEGORIA_STATISTICA_2',
  'IVA',
]

const GENERI: readonly GenereCodificaAddebito[] = CHIAVI_OPZIONE.filter(
  (c): c is GenereCodificaAddebito => c !== 'IVA'
)

/**
 * Le liste di scelta del dialog dell'addebito (schema di `OpzioniFatturazione`, R17): le sole
 * voci attive dei cinque generi di codifica e dei codici IVA, la voce corrente di un addebito già
 * salvato (anche se disattivata nel frattempo) e lo stato dei sub-dialog "Nuovo …"
 * (`AggiuntaInLinea`). Il componente la costruisce con i propri controlli, chiama `carica()`
 * all'apertura e `azzera()` alla chiusura.
 */
export class OpzioniListino {
  readonly inLinea = new AggiuntaInLinea<ChiaveOpzione>()

  private readonly basi: Record<ChiaveOpzione, WritableSignal<Opzione[]>> = {
    GRUPPO: signal([]),
    CATEGORIA: signal([]),
    CENTRO_RICAVO: signal([]),
    CATEGORIA_STATISTICA_1: signal([]),
    CATEGORIA_STATISTICA_2: signal([]),
    IVA: signal([]),
  }
  private readonly correnti = signal<Partial<Record<ChiaveOpzione, Rif | null>>>({})

  /** Voci da mostrare, la corrente compresa. */
  readonly lista = Object.fromEntries(
    CHIAVI_OPZIONE.map(c => [
      c,
      computed(() => conCorrente(this.basi[c](), this.correnti()[c] ?? null)),
    ])
  ) as Record<ChiaveOpzione, Signal<Opzione[]>>

  private letture?: Subscription

  constructor(
    private readonly servizio: ListinoService,
    private readonly controlli: Record<ChiaveOpzione, FormControl<string>>,
    /** Errore di caricamento delle liste. */
    private readonly errore: (messaggio: string) => void
  ) {}

  carica(): void {
    this.letture?.unsubscribe()
    const s = new Subscription()
    this.letture = s
    const fallito = (err: unknown) =>
      this.errore(messaggioErrore(err, 'Impossibile caricare le tabelle del listino.'))
    for (const genere of GENERI) {
      s.add(
        this.servizio.codifiche.list(genere).subscribe({
          next: l => this.basi[genere].set(l.map(etichetta)),
          error: fallito,
        })
      )
    }
    s.add(
      this.servizio.codiciIva.list().subscribe({
        next: l => this.basi.IVA.set(l.map(etichetta)),
        error: fallito,
      })
    )
  }

  /** Dopo la lettura di un addebito salvato: le sue voci restano scelte anche se disattivate. */
  impostaCorrenti(correnti: Partial<Record<ChiaveOpzione, Rif | null>>): void {
    this.correnti.set(correnti)
  }

  azzera(): void {
    this.letture?.unsubscribe()
    this.correnti.set({})
    this.inLinea.aperto = null
  }

  chiudiSub(visibile: boolean): void {
    if (!visibile) this.inLinea.chiudi()
  }

  private aggiungi(chiave: ChiaveOpzione, voce: Opzione): void {
    this.basi[chiave].update(v => [...v.filter(o => o.id !== voce.id), voce])
    this.inLinea.salvato(voce, id => this.controlli[chiave].setValue(id), false)
  }

  dopoCodifica(c: CodificaAddebito): void {
    this.aggiungi(c.genere, etichetta(c))
  }

  dopoIva(c: CodiceIva): void {
    this.aggiungi('IVA', etichetta(c))
  }
}

const etichetta = (c: { id: string; codice: string; descrizione: string }): Opzione => ({
  id: c.id,
  etichetta: etichettaCodice(c.codice, c.descrizione),
})
