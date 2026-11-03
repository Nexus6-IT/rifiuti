import {
  AfterViewInit,
  booleanAttribute,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
} from '@angular/core'
import { MSG_NUMERO, MSG_VIRGOLA, leggiIntero, leggiNumero } from '../utils/numero-modificabile'

/** Messaggio di rifiuto del punto: lo stesso del listino («Usa la virgola per i decimali»). */
export const MSG_PUNTO_DECIMALE = MSG_VIRGOLA

/**
 * Messaggio di rifiuto per un testo con un punto (o, per gli interi, con un separatore
 * qualunque) fuori regola; null se va bene. Usa il parser condiviso `numero-modificabile`: il
 * punto non e' mai ammesso, nemmeno come separatore delle migliaia.
 */
export function controllaTestoNumero(testo: string, soloIntero = false): string | null {
  const t = testo.trim()
  if (soloIntero) {
    return /[.,]/.test(t) ? leggiIntero(t).errore : null
  }
  if (!t.includes('.')) return null
  return leggiNumero(t).errore
}

/** Alias storico dei pesi. */
export const controllaTestoPeso = controllaTestoNumero

/**
 * Regola unica dei campi numerici MODIFICABILI (decisione di Graziano, 03/11): virgola
 * decimale, punto vietato, nessun separatore delle migliaia (il campo va usato con
 * `locale="it-IT"` e `[useGrouping]="false"`).
 * Su `p-inputNumber` con locale it-IT: PrimeNG scarta in silenzio il punto digitato ("12.5"
 * diventa 125) e lo toglie dal testo incollato. Qui il punto non e' mai accettato, da
 * qualunque strada arrivi (nei campi interi nemmeno la virgola):
 * - `keydown` del tasto punto (tranne il tastierino numerico, che PrimeNG converte in virgola);
 * - `paste`, e `beforeinput` (tastiere Android, trascinamento `insertFromDrop`), dove si valuta
 *   il testo risultante: un punto fuori dal raggruppamento delle migliaia viene scartato;
 * - composizione (non annullabile): su `input` se il valore nativo ha un punto fuori posto si
 *   ripristina l'ultimo valore valido.
 * `rifiutato` emette il messaggio da mostrare e `null` quando il campo torna valido. Imposta
 * anche `aria-describedby` (aiuto + errore) e `aria-invalid` sull'input interno, che PrimeNG
 * non espone.
 */
@Directive({
  selector: 'p-inputNumber[appNumeroIt], p-inputNumber[appPesoIt]',
  standalone: true,
})
export class NumeroItalianoDirective implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @Output() rifiutato = new EventEmitter<string | null>()
  /** Id del testo di aiuto, collegato con aria-describedby. */
  @Input() pesoAiutoId: string | null = null
  /** Id del messaggio d'errore visibile, o null se il campo non e' in errore. */
  @Input() pesoErroreId: string | null = null
  /** Campo intero: nemmeno la virgola e' accettata. */
  @Input({ transform: booleanAttribute }) soloIntero = false
  /**
   * Se vero (predefinito) la direttiva scrive da sola il messaggio sotto il campo; i form che lo
   * mostrano per conto loro (pese) passano `[messaggioInterno]="false"`.
   */
  @Input() messaggioInterno = true

  private elMessaggio: HTMLElement | null = null

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
    if (this.soloIntero && (k.key === '.' || k.key === ',')) {
      k.preventDefault()
      k.stopPropagation()
      this.segnala(MSG_NUMERO)
    } else if (k.key === '.' && k.code !== 'NumpadDecimal') {
      k.preventDefault()
      k.stopPropagation()
      this.segnala(MSG_PUNTO_DECIMALE)
    } else if (/^\d$/.test(k.key) || k.key === ',' || k.key === 'Backspace' || k.key === 'Delete') {
      this.segnala(null)
    }
  }

  private readonly alIncolla = (e: Event): void => {
    const testo = (e as ClipboardEvent).clipboardData?.getData('Text') ?? ''
    const errore = controllaTestoNumero(testo, this.soloIntero)
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
    if (!/[.,]/.test(testo) || (!this.soloIntero && !testo.includes('.'))) return
    const campo = this.interno()
    const valore = campo?.value ?? ''
    const da = campo?.selectionStart ?? valore.length
    const a = campo?.selectionEnd ?? valore.length
    const risultante = valore.slice(0, da) + testo + valore.slice(a)
    const errore = controllaTestoNumero(risultante, this.soloIntero)
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
    const errore = controllaTestoNumero(campo.value, this.soloIntero)
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
    private readonly zone: NgZone,
    private readonly renderer: Renderer2
  ) {}

  private segnala(m: string | null): void {
    this.zone.run(() => {
      this.mostra(m)
      this.rifiutato.emit(m)
    })
  }

  /** Scrive (o toglie) il messaggio sotto il campo, con `aria-describedby`/`aria-invalid`. */
  private mostra(m: string | null): void {
    if (!this.messaggioInterno) return
    const host = this.host.nativeElement
    if (m === null) {
      this.elMessaggio?.remove()
      this.elMessaggio = null
      if (this.pesoErroreId === null) this.interno()?.removeAttribute('aria-invalid')
      return
    }
    if (!this.elMessaggio) {
      const el = this.renderer.createElement('small') as HTMLElement
      el.className = 'field-error p-error block mt-1'
      el.setAttribute('role', 'alert')
      el.setAttribute('data-testid', 'numero-errore')
      host.parentNode?.insertBefore(el, host.nextSibling)
      this.elMessaggio = el
    }
    this.elMessaggio.textContent = m
    this.interno()?.setAttribute('aria-invalid', 'true')
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
    this.elMessaggio?.remove()
    const el = this.host.nativeElement
    el.removeEventListener('focusin', this.alFuoco, true)
    el.removeEventListener('keydown', this.alTasto, true)
    el.removeEventListener('paste', this.alIncolla, true)
    el.removeEventListener('beforeinput', this.primaDellInput, true)
    el.removeEventListener('input', this.alInput, true)
  }
}
