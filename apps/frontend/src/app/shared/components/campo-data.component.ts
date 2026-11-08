import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostBinding,
  Input,
  forwardRef,
  inject,
} from '@angular/core'
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms'
import { CalendarModule } from 'primeng/calendar'
import { dataLocale, isoLocale } from '../utils/data-iso'

/**
 * Campo data unico dell'app: `p-calendar` in italiano (`gg/mm/aaaa`) al posto di `<input type="date">`,
 * che nei browser mostra il formato del sistema e non si controlla da test.
 *
 * - Il valore e' una stringa `AAAA-MM-GG` costruita dal giorno locale, mai da `toISOString`
 *   (nessuno spostamento di fuso); campo vuoto = `''` (oppure `null` con `[vuoto]="null"`).
 * - Il valore si applica quando si sceglie un giorno dal calendario, all'uscita dal campo
 *   (blur), con Invio e con «Pulisci»: non a ogni tasto. Un filtro non parte quindi con una data
 *   a meta' digitazione. Un testo che non e' una data (o fuori da `min`/`max`) vale «vuoto».
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
    `,
  ],
  template: `
    <p-calendar
      [inputId]="inputId"
      [ngModel]="data"
      (ngModelChange)="aggiorna($event)"
      (onSelect)="applica($event)"
      (onBlur)="applica(data)"
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
      appendTo="body"
    />
  `,
})
export class CampoDataComponent implements ControlValueAccessor, AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  private readonly cdr = inject(ChangeDetectorRef)

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

  private ultimoEmesso: string | null | undefined = undefined
  private onChange: (v: string | null) => void = () => undefined
  private onTouched: () => void = () => undefined

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
    this.imposta(input, 'aria-invalid', this.ariaInvalid ? 'true' : null)
  }

  private imposta(el: HTMLElement, nome: string, valore: string | null): void {
    if (valore) {
      if (el.getAttribute(nome) !== valore) el.setAttribute(nome, valore)
    } else if (el.hasAttribute(nome)) {
      el.removeAttribute(nome)
    }
  }
}
