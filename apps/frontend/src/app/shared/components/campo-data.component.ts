import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostBinding,
  HostListener,
  Input,
  ViewChild,
  forwardRef,
  inject,
} from '@angular/core'
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms'
import { Calendar, CalendarModule } from 'primeng/calendar'
import { dataLocale, isoLocale } from '../utils/data-iso'

/**
 * Campo data unico dell'app: `p-calendar` in italiano (`gg/mm/aaaa`) al posto di `<input type="date">`,
 * che nei browser mostra il formato del sistema e non si controlla da test.
 *
 * - Il valore e' una stringa `AAAA-MM-GG` costruita dal giorno locale, mai da `toISOString`
 *   (nessuno spostamento di fuso); campo vuoto = `''` (oppure `null` con `[vuoto]="null"`).
 * - Il valore si applica quando si sceglie un giorno dal calendario, all'uscita dal campo
 *   (blur), con Invio e con «Pulisci»: non a ogni tasto. Un filtro non parte quindi con una data
 *   a meta' digitazione.
 * - Un testo che non e' una data non cambia il valore se c'era gia' una data (`p-calendar` lo scarta
 *   e il campo torna a quella) e lo svuota se non c'era; stessa cosa per una data fuori da
 *   `min`/`max`. In tutti e due i casi sotto il campo compare «Data non valida» (e `aria-invalid`)
 *   finche' non si riscrive o si sceglie un giorno.
 * - Esc con il calendario aperto chiude solo il calendario, anche dentro un `p-dialog` (che ascolta
 *   Esc sul document). Sotto i 640 px l'input e' in sola lettura: il tocco apre il calendario e la
 *   tastiera virtuale non sale sopra il pannello.
 * - Frecce destra/sinistra nel calendario passano alla settimana dopo/prima senza saltare di mese
 *   (`p-calendar` 17.18 salta di mese alla fine della riga).
 * - `inputId` va sull'input interno (la `<label for>` lo raggiunge); `ariaDescribedby` e `ariaLabel`
 *   sull'input interno anche da disabilitato (`p-calendar` 17.18 non li espone); lo stesso vale per
 *   `ariaRequired` e `ariaInvalid`.
 * - L'host accetta `data-testid` come ogni altro componente.
 */
@Component({
  selector: 'app-campo-data',
  standalone: true,
  imports: [FormsModule, CalendarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CampoDataComponent), multi: true },
  ],
  styles: [
    `
      :host {
        display: inline-block;
      }
      :host(.campo-data--piena) {
        display: block;
        width: 100%;
      }
      .campo-data__errore {
        display: block;
        margin-top: 4px;
        color: var(--color-danger);
        font-size: 0.8125rem;
      }
    `,
  ],
  template: `
    <p-calendar
      [inputId]="inputId"
      [ngModel]="data"
      (ngModelChange)="aggiorna($event)"
      (onSelect)="applica($event)"
      (onBlur)="alUscire($event)"
      (onClearClick)="applica(null)"
      (keydown.enter)="applica(data)"
      [disabled]="disabilitato"
      [minDate]="minData"
      [maxDate]="maxData"
      [placeholder]="placeholder"
      dateFormat="dd/mm/yy"
      [showIcon]="true"
      [showButtonBar]="true"
      [styleClass]="piena ? 'w-full' : ''"
      [inputStyleClass]="piena ? 'w-full' : ''"
      [readonlyInput]="telefono"
      (onInput)="invalido = false"
      (onShow)="alMostrare()"
      appendTo="body"
    />
    @if (invalido) {
      <small class="campo-data__errore" role="alert" data-testid="campo-data-errore"
        >Data non valida o fuori dal periodo consentito</small
      >
    }
  `,
})
export class CampoDataComponent implements ControlValueAccessor, AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  private readonly cdr = inject(ChangeDetectorRef)
  @ViewChild(Calendar) private calendario?: Calendar

  /** `id` dell'input interno: e' quello della `<label for>`. */
  @Input() inputId = ''
  @Input() ariaLabel: string | null = null
  /** `id` del testo che descrive il campo (per esempio il perche' e' disabilitato). */
  @Input() ariaDescribedby: string | null = null
  @Input() placeholder = 'gg/mm/aaaa'
  @Input() ariaRequired = false
  @Input() ariaInvalid = false
  /** Valore del campo vuoto: `''` (predefinito) o `null`. */
  @Input() vuoto: '' | null = ''
  /** A tutta larghezza (nei form); altrimenti largo quanto il contenuto (nelle barre dei filtri). */
  @Input() @HostBinding('class.campo-data--piena') piena = false

  /** Prima data accettata, `AAAA-MM-GG`. */
  @Input() set min(v: string | null) {
    this.minData = dataLocale(v)
  }
  /** Ultima data accettata, `AAAA-MM-GG`. */
  @Input() set max(v: string | null) {
    this.maxData = dataLocale(v)
  }
  minData: Date | null = null
  maxData: Date | null = null

  /** Giorno mostrato; resta lo stesso oggetto finche' non cambia, altrimenti ngModel lo riscrive in loop. */
  data: Date | null = null
  disabilitato = false
  /** Telefono: input in sola lettura, per non far salire la tastiera virtuale sopra il pannello. */
  telefono = false
  /** L'ultimo testo scritto a mano non e' una data accettata. */
  invalido = false

  private ultimoEmesso: string | null | undefined = undefined
  private onChange: (v: string | null) => void = () => undefined
  private onTouched: () => void = () => undefined

  private entraNellaGriglia = false

  constructor() {
    // Freccia giu' dal campo: entra nella griglia sul giorno scelto (o su oggi). Va in cattura sull'host
    // per passare davanti a `p-calendar`, che dal campo con il focus porta sul bottone «Mese precedente».
    this.host.nativeElement.addEventListener('keydown', e => this.frecciaGiuDalCampo(e), true)
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(max-width: 639.98px)')
      this.telefono = mq.matches
      const alCambio = (e: MediaQueryListEvent): void => {
        this.telefono = e.matches
        this.cdr.markForCheck()
      }
      mq.addEventListener('change', alCambio)
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', alCambio))
    }
  }

  writeValue(v: string | null): void {
    this.data = dataLocale(v ?? null)
    this.ultimoEmesso = this.data ? isoLocale(this.data) : this.vuoto
    this.cdr.markForCheck()
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn
  }
  setDisabledState(disabled: boolean): void {
    this.disabilitato = disabled
    this.cdr.markForCheck()
  }

  /** Cio' che `p-calendar` ha capito del testo: una data valida, `null` o (con testo libero) una stringa. */
  aggiorna(v: Date | string | null): void {
    this.data = v instanceof Date && !Number.isNaN(v.getTime()) ? v : null
  }

  /**
   * Uscita dal campo: se il testo scritto non corrisponde al giorno accettato (non e' una data, o e'
   * fuori da `min`/`max`) mostra l'errore; poi applica il valore. Va letto prima che `p-calendar`
   * riscriva l'input, e `onBlur` parte prima.
   */
  alUscire(evento: Event): void {
    const testo = ((evento.target as HTMLInputElement | null)?.value ?? '').trim()
    this.invalido = testo !== '' && !this.testoCorrispondeA(testo, this.data)
    this.applica(this.data)
  }

  private testoCorrispondeA(testo: string, giorno: Date | null): boolean {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(testo)
    return (
      !!m &&
      !!giorno &&
      Number(m[1]) === giorno.getDate() &&
      Number(m[2]) === giorno.getMonth() + 1 &&
      Number(m[3]) === giorno.getFullYear()
    )
  }

  /** Esc su un calendario che si e' appena chiuso (`p-calendar` fa `preventDefault`) non deve arrivare al dialog. */
  @HostListener('keydown', ['$event'])
  fermaEscChiusura(e: KeyboardEvent): void {
    if (e.key === 'Escape' && e.defaultPrevented) e.stopPropagation()
  }

  private frecciaGiuDalCampo(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' || !(e.target instanceof HTMLInputElement) || !this.calendario) return
    e.preventDefault()
    e.stopPropagation()
    if (this.calendario.overlayVisible) {
      this.focalizzaGiorno()
    } else {
      // Chiuso (per esempio dopo Esc): lo apre, e il focus va al giorno appena il pannello c'e'.
      // Con il click sull'icona, che passa dal template di `p-calendar` e lo aggiorna da solo.
      this.entraNellaGriglia = true
      this.host.nativeElement.querySelector<HTMLElement>('.p-datepicker-trigger')?.click()
    }
  }

  private focalizzaGiorno(): void {
    const pannello = this.calendario?.overlay as HTMLElement | null | undefined
    if (!pannello) return
    const cella =
      pannello.querySelector<HTMLElement>('td > span.p-highlight') ??
      pannello.querySelector<HTMLElement>('td.p-datepicker-today > span:not(.p-disabled)') ??
      pannello.querySelector<HTMLElement>('td > span:not(.p-disabled)')
    if (!cella) return
    pannello
      .querySelectorAll<HTMLElement>('td > span[tabindex="0"]')
      .forEach(c => (c.tabIndex = -1))
    cella.tabIndex = 0
    cella.focus()
  }

  /** Il pannello sta nel body: Esc e frecce si gestiscono sull'elemento del pannello. */
  alMostrare(): void {
    if (this.entraNellaGriglia) {
      this.entraNellaGriglia = false
      setTimeout(() => this.focalizzaGiorno(), 10)
    }
    const pannello = this.calendario?.overlay as HTMLElement | null | undefined
    if (!pannello || pannello.dataset['campoData'] === '1') return
    pannello.dataset['campoData'] = '1'
    pannello.addEventListener('keydown', e => this.fermaEscChiusura(e))
    pannello.addEventListener('keydown', e => this.frecciaOrizzontale(e), true)
  }

  /** Destra/sinistra fra i giorni del mese in ordine di lettura: a fine riga si va alla riga dopo, non al mese dopo. */
  private frecciaOrizzontale(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const cella = e.target instanceof HTMLElement ? e.target.closest('span[data-date]') : null
    if (!(cella instanceof HTMLElement)) return
    const tabella = cella.closest('table')
    if (!tabella) return
    const giorni = Array.from(tabella.querySelectorAll<HTMLElement>('td > span[data-date]'))
    const arrivo = giorni[giorni.indexOf(cella) + (e.key === 'ArrowRight' ? 1 : -1)]
    // Oltre il mese o su un giorno non selezionabile decide `p-calendar` (cambio mese).
    if (!arrivo || arrivo.classList.contains('p-disabled')) return
    cella.tabIndex = -1
    arrivo.tabIndex = 0
    arrivo.focus()
    e.preventDefault()
    e.stopPropagation()
  }

  /** Porta il giorno al form: solo se e' cambiato rispetto all'ultimo valore dato. */
  applica(v: Date | string | null | undefined): void {
    const giorno = v instanceof Date && !Number.isNaN(v.getTime()) ? v : null
    this.data = giorno
    const iso = giorno ? isoLocale(giorno) : this.vuoto
    if (iso !== this.ultimoEmesso) {
      this.ultimoEmesso = iso
      this.onChange(iso)
    }
    this.onTouched()
  }

  /** Gli attributi ARIA vanno sull'input interno, che nasce dopo il primo giro di rilevamento. */
  ngAfterViewChecked(): void {
    const input = this.host.nativeElement.querySelector<HTMLInputElement>('input.p-inputtext')
    if (!input) return
    this.imposta(input, 'aria-describedby', this.ariaDescribedby)
    this.imposta(input, 'aria-label', this.ariaLabel)
    this.imposta(input, 'aria-required', this.ariaRequired ? 'true' : null)
    this.imposta(input, 'aria-invalid', this.ariaInvalid || this.invalido ? 'true' : null)
  }

  private imposta(el: HTMLElement, nome: string, valore: string | null): void {
    if (valore) {
      if (el.getAttribute(nome) !== valore) el.setAttribute(nome, valore)
    } else if (el.hasAttribute(nome)) {
      el.removeAttribute(nome)
    }
  }
}
