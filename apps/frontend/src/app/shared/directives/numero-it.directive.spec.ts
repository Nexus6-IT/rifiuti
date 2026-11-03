import { Component } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms'
import { InputNumberModule } from 'primeng/inputnumber'
import {
  NumeroItalianoDirective,
  MSG_PUNTO_DECIMALE,
  controllaTestoNumero,
} from './numero-it.directive'
import { MSG_NUMERO } from '../utils/numero-modificabile'

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, InputNumberModule, NumeroItalianoDirective],
  template: `
    <label id="l-peso">Peso</label>
    <p-inputNumber
      appPesoIt
      [formControl]="peso"
      inputId="peso"
      mode="decimal"
      locale="it-IT"
      [minFractionDigits]="0"
      [maxFractionDigits]="2"
      ariaLabelledBy="l-peso"
      [useGrouping]="false"
      [messaggioInterno]="false"
      pesoAiutoId="aiuto-peso"
      [pesoErroreId]="messaggio ? 'err-peso' : null"
      (rifiutato)="messaggio = $event"
    ></p-inputNumber>
  `,
})
class OspiteComponent {
  peso = new FormControl<number | null>(null)
  messaggio: string | null = null
}

describe('controllaTestoNumero', () => {
  it('accetta la virgola e le cifre semplici, senza separatore delle migliaia', () => {
    expect(controllaTestoNumero('12,5')).toBeNull()
    expect(controllaTestoNumero('1000')).toBeNull()
    expect(controllaTestoNumero('1250,75')).toBeNull()
  })

  it('il punto e vietato anche come separatore delle migliaia', () => {
    expect(controllaTestoNumero('1.250')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('1.250,75')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('1.250.000')).toBe(MSG_PUNTO_DECIMALE)
  })

  it('negli interi sono vietati sia il punto sia la virgola', () => {
    expect(controllaTestoNumero('1000', true)).toBeNull()
    expect(controllaTestoNumero('12,5', true)).toBe(MSG_NUMERO)
    expect(controllaTestoNumero('12.5', true)).toBe(MSG_NUMERO)
  })

  it('rifiuta il punto come separatore decimale', () => {
    expect(controllaTestoNumero('12.5')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('12.55')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('0.5')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('1.25')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoNumero('1.2345')).toBe(MSG_PUNTO_DECIMALE)
  })
})

describe('PesoItalianoDirective (eventi reali)', () => {
  let fixture: ComponentFixture<OspiteComponent>
  let input: HTMLInputElement

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OspiteComponent] })
    fixture = TestBed.createComponent(OspiteComponent)
    fixture.detectChanges()
    input = fixture.nativeElement.querySelector('input')
  })

  it("l'input interno e collegato all'etichetta", () => {
    expect(input.getAttribute('aria-labelledby')).toBe('l-peso')
  })

  it('il tasto punto viene bloccato e segnalato, non diventa 125', () => {
    const e = new KeyboardEvent('keydown', {
      key: '.',
      code: 'Period',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(e)
    expect(e.defaultPrevented).toBeTrue()
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
    expect(fixture.componentInstance.peso.value).toBeNull()
  })

  it('il punto del tastierino numerico non e bloccato (e la virgola per PrimeNG)', () => {
    const e = new KeyboardEvent('keydown', {
      key: '.',
      code: 'NumpadDecimal',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(e)
    expect(e.defaultPrevented).toBeFalse()
  })

  it('"12.5" incollato e rifiutato e il valore non cambia; "12,5" incollato vale 12,5', () => {
    const incolla = (testo: string) => {
      const dt = new DataTransfer()
      dt.setData('text', testo)
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      input.dispatchEvent(e)
      return e
    }
    const e1 = incolla('12.5')
    expect(e1.defaultPrevented).toBeTrue()
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
    expect(fixture.componentInstance.peso.value).toBeNull()

    incolla('12,5')
    expect(fixture.componentInstance.messaggio).toBeNull()
    expect(fixture.componentInstance.peso.value).toBe(12.5)
  })

  it('"1.250" incollato e rifiutato (niente migliaia con il punto); "1000" vale 1000', () => {
    const incolla = (testo: string) => {
      const dt = new DataTransfer()
      dt.setData('text', testo)
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      input.dispatchEvent(e)
      return e
    }
    expect(incolla('1.250').defaultPrevented).toBeTrue()
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
    expect(fixture.componentInstance.peso.value).toBeNull()
    incolla('1000')
    expect(fixture.componentInstance.peso.value).toBe(1000)
  })

  it('beforeinput con "." (tastiere Android) e annullato e segnalato', () => {
    const e = new InputEvent('beforeinput', {
      data: '.',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(e)
    expect(e.defaultPrevented).toBeTrue()
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
  })

  it('beforeinput da trascinamento: "12.5" e "1.250" rifiutati, "1250" accettato', () => {
    const drop = (testo: string) => {
      const dt = new DataTransfer()
      dt.setData('text', testo)
      const e = new InputEvent('beforeinput', {
        inputType: 'insertFromDrop',
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(e)
      return e
    }
    expect(drop('12.5').defaultPrevented).toBeTrue()
    fixture.componentInstance.messaggio = null
    expect(drop('1.250').defaultPrevented).toBeTrue()
    fixture.componentInstance.messaggio = null
    expect(drop('1250').defaultPrevented).toBeFalse()
    expect(fixture.componentInstance.messaggio).toBeNull()
  })

  it('composizione: il valore nativo con "." viene ripristinato e segnalato', () => {
    input.value = '12'
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    input.value = '12.5'
    input.dispatchEvent(
      new InputEvent('input', { data: '.', inputType: 'insertCompositionText', bubbles: true })
    )
    expect(input.value).toBe('12')
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
    input.value = '125'
    input.dispatchEvent(
      new InputEvent('input', { inputType: 'insertCompositionText', bubbles: true })
    )
    expect(fixture.componentInstance.messaggio).toBeNull()
  })

  it('un valore valido (cancellazione) azzera il messaggio', () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '.', code: 'Period', bubbles: true, cancelable: true })
    )
    expect(fixture.componentInstance.messaggio).toBe(MSG_PUNTO_DECIMALE)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true })
    )
    expect(fixture.componentInstance.messaggio).toBeNull()
  })

  it("imposta aria-describedby e aria-invalid sull'input interno", () => {
    expect(input.getAttribute('aria-describedby')).toBe('aiuto-peso')
    expect(input.hasAttribute('aria-invalid')).toBeFalse()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '.', code: 'Period', bubbles: true, cancelable: true })
    )
    fixture.detectChanges()
    expect(input.getAttribute('aria-describedby')).toBe('aiuto-peso err-peso')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})

@Component({
  standalone: true,
  imports: [FormsModule, InputNumberModule, NumeroItalianoDirective],
  template: `
    <p-inputNumber
      appNumeroIt
      [(ngModel)]="valore"
      inputId="n"
      locale="it-IT"
      [useGrouping]="false"
      [maxFractionDigits]="3"
    ></p-inputNumber>
    <p-inputNumber
      appNumeroIt
      soloIntero
      [(ngModel)]="intero"
      inputId="i"
      locale="it-IT"
      [useGrouping]="false"
      [maxFractionDigits]="0"
    ></p-inputNumber>
  `,
})
class OspiteInternoComponent {
  valore: number | null = null
  intero: number | null = null
}

describe('NumeroItalianoDirective (messaggio interno e campi interi)', () => {
  let fixture: ComponentFixture<OspiteInternoComponent>
  let decimale: HTMLInputElement
  let intero: HTMLInputElement

  const tasto = (el: HTMLInputElement, key: string, code = 'Key') => {
    const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e
  }
  const incolla = (el: HTMLInputElement, testo: string) => {
    const dt = new DataTransfer()
    dt.setData('text', testo)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    )
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OspiteInternoComponent] })
    fixture = TestBed.createComponent(OspiteInternoComponent)
    fixture.detectChanges()
    const campi = fixture.nativeElement.querySelectorAll('input')
    decimale = campi[0]
    intero = campi[1]
  })

  const messaggi = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="numero-errore"]')).map(
      e => (e as HTMLElement).textContent ?? ''
    )

  it('punto: messaggio sotto il campo, valore invariato; "12,5" vale 12.5 e toglie il messaggio', () => {
    expect(tasto(decimale, '.', 'Period').defaultPrevented).toBeTrue()
    expect(messaggi()).toEqual(['Usa la virgola per i decimali'])
    expect(decimale.getAttribute('aria-invalid')).toBe('true')
    incolla(decimale, '12,5')
    fixture.detectChanges()
    expect(fixture.componentInstance.valore).toBe(12.5)
    expect(messaggi()).toEqual([])
    expect(decimale.hasAttribute('aria-invalid')).toBeFalse()
  })

  it('"1000" resta 1000, senza separatore delle migliaia', () => {
    incolla(decimale, '1000')
    fixture.detectChanges()
    expect(fixture.componentInstance.valore).toBe(1000)
    expect(decimale.value).toBe('1000')
  })

  it('campo intero: punto e virgola sono rifiutati con "Numero non valido"', () => {
    expect(tasto(intero, '.', 'Period').defaultPrevented).toBeTrue()
    expect(messaggi()).toEqual(['Numero non valido'])
    expect(tasto(intero, ',', 'Comma').defaultPrevented).toBeTrue()
    incolla(intero, '12,5')
    expect(fixture.componentInstance.intero).toBeNull()
    incolla(intero, '1000')
    fixture.detectChanges()
    expect(fixture.componentInstance.intero).toBe(1000)
    expect(intero.value).toBe('1000')
  })
})
