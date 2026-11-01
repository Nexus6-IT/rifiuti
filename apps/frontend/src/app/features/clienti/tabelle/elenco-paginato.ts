import { signal } from '@angular/core'
import { Observable, Subject, debounceTime, distinctUntilChanged, map, takeUntil } from 'rxjs'
import { FiltroPagina, Pagina } from '../clienti.model'
import { messaggioErrore } from './tabella-comune'

const DIMENSIONE_PREDEFINITA = 25
const ATTESA_RICERCA_MS = 300

/**
 * Elenco paginato lazy con ricerca (agenti, clienti, e i contratti): ricerca con debounce e
 * `distinctUntilChanged`, ogni caricamento annulla il precedente (una risposta in ritardo non
 * vale più), pagina e dimensione dal paginator, `caricamento` per la tabella e ritorno alla pagina
 * precedente quando l'ultima riga dell'ultima pagina viene eliminata (solo se la pagina di
 * arrivo è davvero precedente: niente ciclo se il server risponde in modo incoerente). Filtri
 * aggiuntivi (`F`, es. stato e cliente dei contratti) con `impostaFiltri`: tornano a pagina 1 e
 * restano con ricerca e paginazione. Il componente chiama `avvia()` in `ngOnInit` e `ferma()` in
 * `ngOnDestroy`.
 */
export class ElencoPaginato<T, F extends object = object> {
  readonly righe = signal<T[]>([])
  readonly totale = signal(0)
  readonly errore = signal<string | null>(null)
  readonly caricamento = signal(false)

  dimensione = DIMENSIONE_PREDEFINITA
  primo = 0
  private testo = ''
  private filtri: Partial<F> = {}
  private readonly ricerca = new Subject<string>()
  private readonly annulla = new Subject<void>()
  private readonly distrutto = new Subject<void>()

  constructor(
    private readonly fonte: (
      filtro: FiltroPagina & { testo?: string } & Partial<F>
    ) => Observable<Pagina<T>>,
    private readonly ripiego: string
  ) {}

  avvia(): void {
    this.ricerca
      .pipe(
        map(t => t.trim()),
        debounceTime(ATTESA_RICERCA_MS),
        distinctUntilChanged(),
        takeUntil(this.distrutto)
      )
      .subscribe(t => {
        this.testo = t
        this.primo = 0
        this.carica()
      })
    this.carica()
  }

  ferma(): void {
    this.annulla.next()
    this.distrutto.next()
  }

  cerca(valore: string): void {
    this.ricerca.next(valore)
  }

  /** Sostituisce i filtri (i valori `undefined`, `null` e vuoti non viaggiano) e riparte da pagina 1. */
  impostaFiltri(filtri: Partial<F>): void {
    this.filtri = Object.fromEntries(
      Object.entries(filtri).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ) as Partial<F>
    this.primo = 0
    this.carica()
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.dimensione = ev.rows || this.dimensione
    this.primo = ev.first ?? 0
    this.carica()
  }

  carica(): void {
    this.annulla.next()
    this.caricamento.set(true)
    this.fonte({
      pagina: Math.floor(this.primo / this.dimensione) + 1,
      dimensione: this.dimensione,
      ...this.filtri,
      ...(this.testo ? { testo: this.testo } : {}),
    })
      .pipe(takeUntil(this.annulla))
      .subscribe({
        next: p => {
          // Pagina rimasta vuota (eliminata l'ultima riga dell'ultima): si torna indietro, ma solo
          // se l'ultima pagina è davvero prima di questa (altrimenti si mostra la pagina vuota).
          if (p.elementi.length === 0 && p.totale > 0 && this.primo > 0) {
            const nuovoPrimo = (Math.ceil(p.totale / this.dimensione) - 1) * this.dimensione
            if (nuovoPrimo < this.primo) {
              this.primo = nuovoPrimo
              this.carica()
              return
            }
          }
          this.righe.set(p.elementi)
          this.totale.set(p.totale)
          this.errore.set(null)
          this.caricamento.set(false)
        },
        error: err => {
          this.errore.set(messaggioErrore(err, this.ripiego))
          this.caricamento.set(false)
        },
      })
  }
}
