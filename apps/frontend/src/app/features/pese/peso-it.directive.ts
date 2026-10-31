import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
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
 * decimale, da qualunque strada arrivi:
 * - `keydown` del tasto punto (tranne il tastierino numerico, che PrimeNG converte in virgola);
 * - `paste`, e `beforeinput` (tastiere Android, trascinamento `insertFromDrop`), dove si valuta
 *   il testo risultante: un punto fuori dal raggruppamento delle migliaia viene scartato;
 * - composizione (non annullabile): su `input` se il valore nativo ha un punto fuori posto si
 *   ripristina l'ultimo valore valido.
 * `rifiutato` emette il messaggio da mostrare e `null` quando il campo torna valido. Imposta
 * anche `aria-describedby` (aiuto + errore) e `aria-invalid` sull'input interno, che PrimeNG
 * non espone.
 */
@Directive({ selector: 'p-inputNumber[appPesoIt]', standalone: true })
export class PesoItalianoDirective implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @Output() rifiutato = new EventEmitter<string | null>()
  /** Id del testo di aiuto, collegato con aria-describedby. */
  @Input() pesoAiutoId: string | null = null
  /** Id del messaggio d'errore visibile, o null se il campo non e' in errore. */
  @Input() pesoErroreId: string | null = null

  private ultimoValido = ''

  private interno(): HTMLInputElement | null {
    return this.host.nativeElement.querySelector('input')
  }

  private readonly alFuoco = (): void => {
    this.ultimoValido = this.interno()?.value ?? ''
  }

  private readonly alTasto = (e: Event): void => {
    const k = e as KeyboardEvent
    if (k.ctrlKey || k.metaKey || k.altKey) return
    if (k.key === '.' && k.code !== 'NumpadDecimal') {
      k.preventDefault()
      k.stopPropagation()
      this.segnala(MSG_PUNTO_DECIMALE)
    } else if (/^\d$/.test(k.key) || k.key === ',' || k.key === 'Backspace' || k.key === 'Delete') {
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

  /** Inserimenti nativi (tastiere che non mandano keydown utili, trascinamento). */
  private readonly primaDellInput = (e: Event): void => {
    const ie = e as InputEvent
    if (ie.inputType !== 'insertText' && ie.inputType !== 'insertFromDrop') return
    const testo = ie.data ?? ie.dataTransfer?.getData('text') ?? ''
    if (!testo.includes('.')) return
    const campo = this.interno()
    const valore = campo?.value ?? ''
    const da = campo?.selectionStart ?? valore.length
    const a = campo?.selectionEnd ?? valore.length
    const risultante = valore.slice(0, da) + testo + valore.slice(a)
    const errore = controllaTestoPeso(risultante)
    if (errore && ie.cancelable) {
      e.preventDefault()
      e.stopPropagation()
      this.segnala(errore)
    }
  }

  /** Composizione: l'evento non si annulla, quindi si ripristina il valore. */
  private readonly alInput = (e: Event): void => {
    const campo = this.interno()
    if (!campo || e.target !== campo) return
    const errore = controllaTestoPeso(campo.value)
    if (errore) {
      campo.value = this.ultimoValido
      e.stopPropagation()
      this.segnala(errore)
    } else {
      this.ultimoValido = campo.value
      this.segnala(null)
    }
  }

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly zone: NgZone
  ) {}

  private segnala(m: string | null): void {
    this.zone.run(() => this.rifiutato.emit(m))
  }

  ngOnInit(): void {
    // Fase di cattura: deve precedere i gestori interni dell'input di PrimeNG.
    const el = this.host.nativeElement
    this.zone.runOutsideAngular(() => {
      el.addEventListener('focusin', this.alFuoco, true)
      el.addEventListener('keydown', this.alTasto, true)
      el.addEventListener('paste', this.alIncolla, true)
      el.addEventListener('beforeinput', this.primaDellInput, true)
      el.addEventListener('input', this.alInput, true)
    })
  }

  ngAfterViewInit(): void {
    this.applicaAria()
  }

  ngOnChanges(): void {
    this.applicaAria()
  }

  private applicaAria(): void {
    const campo = this.interno()
    if (!campo) return
    const ids = [this.pesoAiutoId, this.pesoErroreId].filter(Boolean).join(' ')
    if (ids) campo.setAttribute('aria-describedby', ids)
    else campo.removeAttribute('aria-describedby')
    if (this.pesoErroreId) campo.setAttribute('aria-invalid', 'true')
    else campo.removeAttribute('aria-invalid')
  }

  ngOnDestroy(): void {
    const el = this.host.nativeElement
    el.removeEventListener('focusin', this.alFuoco, true)
    el.removeEventListener('keydown', this.alTasto, true)
    el.removeEventListener('paste', this.alIncolla, true)
    el.removeEventListener('beforeinput', this.primaDellInput, true)
    el.removeEventListener('input', this.alInput, true)
  }
}
