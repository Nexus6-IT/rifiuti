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
 * precedente quando l'ultima riga dell'ultima pagina viene eliminata. Il componente chiama
 * `avvia()` in `ngOnInit` e `ferma()` in `ngOnDestroy`.
 */
export class ElencoPaginato<T> {
  readonly righe = signal<T[]>([])
  readonly totale = signal(0)
  readonly errore = signal<string | null>(null)
  readonly caricamento = signal(false)

  dimensione = DIMENSIONE_PREDEFINITA
  primo = 0
  private testo = ''
  private readonly ricerca = new Subject<string>()
  private readonly annulla = new Subject<void>()
  private readonly distrutto = new Subject<void>()

  constructor(
    private readonly fonte: (filtro: FiltroPagina & { testo?: string }) => Observable<Pagina<T>>,
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
      ...(this.testo ? { testo: this.testo } : {}),
    })
      .pipe(takeUntil(this.annulla))
      .subscribe({
        next: p => {
          // Pagina rimasta vuota (eliminata l'ultima riga dell'ultima): si torna indietro.
          if (p.elementi.length === 0 && p.totale > 0 && this.primo > 0) {
            this.primo = (Math.ceil(p.totale / this.dimensione) - 1) * this.dimensione
            this.carica()
            return
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
