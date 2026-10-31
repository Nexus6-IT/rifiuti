import { Component } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { InputNumberModule } from 'primeng/inputnumber'
import { PesoItalianoDirective, MSG_PUNTO_DECIMALE, controllaTestoPeso } from './peso-it.directive'

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, InputNumberModule, PesoItalianoDirective],
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

describe('controllaTestoPeso', () => {
  it('accetta la virgola e il punto solo come raggruppamento di migliaia', () => {
    expect(controllaTestoPeso('12,5')).toBeNull()
    expect(controllaTestoPeso('1.250')).toBeNull()
    expect(controllaTestoPeso('1.250,75')).toBeNull()
    expect(controllaTestoPeso('1.250.000')).toBeNull()
  })

  it('rifiuta il punto come separatore decimale', () => {
    expect(controllaTestoPeso('12.5')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoPeso('12.55')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoPeso('0.5')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoPeso('1.25')).toBe(MSG_PUNTO_DECIMALE)
    expect(controllaTestoPeso('1.2345')).toBe(MSG_PUNTO_DECIMALE)
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

  it('"1.250" incollato resta 1250 (raggruppamento)', () => {
    const dt = new DataTransfer()
    dt.setData('text', '1.250')
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    )
    expect(fixture.componentInstance.peso.value).toBe(1250)
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

  it('beforeinput da trascinamento: "12.5" rifiutato, "1.250" accettato', () => {
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
    expect(drop('1.250').defaultPrevented).toBeFalse()
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
