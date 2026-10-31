import {
  Directive,
  ElementRef,
  EventEmitter,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core'

export const MSG_PUNTO_DECIMALE =
  'Per i decimali usare la virgola (esempio 12,5): il punto non è accettato.'

/** Punto ammesso solo come raggruppamento delle migliaia (1.250 o 1.250,75), come lo scrive il campo. */
const RAGGRUPPATO = /^\d{1,3}(\.\d{3})+(,\d*)?$/

/** Messaggio di rifiuto per un testo di peso con un punto fuori posto; null se va bene. */
export function controllaTestoPeso(testo: string): string | null {
  const t = testo.trim()
  if (!t.includes('.')) return null
  return RAGGRUPPATO.test(t) ? null : MSG_PUNTO_DECIMALE
}

/**
 * Su `p-inputNumber` con locale it-IT: PrimeNG scarta in silenzio il punto digitato ("12.5"
 * diventa 125) e lo toglie dal testo incollato. Qui il punto non e' mai accettato come
 * decimale: il tasto viene bloccato (tranne il tastierino numerico, che PrimeNG converte nella
 * virgola), il testo incollato con un punto fuori posto viene scartato, e `rifiutato` emette
 * il messaggio da mostrare (null quando il campo torna valido).
 */
@Directive({ selector: 'p-inputNumber[appPesoIt]', standalone: true })
export class PesoItalianoDirective implements OnInit, OnDestroy {
  @Output() rifiutato = new EventEmitter<string | null>()

  private readonly alTasto = (e: Event): void => {
    const k = e as KeyboardEvent
    if (k.ctrlKey || k.metaKey || k.altKey) return
    if (k.key === '.' && k.code !== 'NumpadDecimal') {
      k.preventDefault()
      k.stopPropagation()
      this.segnala(MSG_PUNTO_DECIMALE)
    } else if (/^\d$/.test(k.key) || k.key === ',') {
      this.segnala(null)
    }
  }

  private readonly alIncolla = (e: Event): void => {
    const testo = (e as ClipboardEvent).clipboardData?.getData('Text') ?? ''
    const errore = controllaTestoPeso(testo)
    if (errore) {
      e.preventDefault()
      e.stopPropagation()
      this.segnala(errore)
    } else {
      this.segnala(null)
    }
  }

  private segnala(m: string | null): void {
    this.zone.run(() => this.rifiutato.emit(m))
  }

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly zone: NgZone
  ) {}

  ngOnInit(): void {
    // Fase di cattura: deve precedere i gestori interni dell'input di PrimeNG.
    this.zone.runOutsideAngular(() => {
      this.host.nativeElement.addEventListener('keydown', this.alTasto, true)
      this.host.nativeElement.addEventListener('paste', this.alIncolla, true)
    })
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('keydown', this.alTasto, true)
    this.host.nativeElement.removeEventListener('paste', this.alIncolla, true)
  }
}
