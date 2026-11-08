import { Component } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { PrimeNGConfig } from 'primeng/api'
import { TRADUZIONE_PRIMENG_IT } from '../../core/config/primeng-it'
import { CampoDataComponent } from './campo-data.component'

@Component({
  standalone: true,
  imports: [CampoDataComponent, ReactiveFormsModule, FormsModule],
  template: `
    <label for="d1">Dal</label>
    <app-campo-data
      inputId="d1"
      ariaLabel="Data iniziale"
      [ariaDescribedby]="descrizione"
      [min]="min"
      [max]="max"
      [vuoto]="vuoto"
      [formControl]="controllo"
      data-testid="campo-prova"
    />
    <p id="nota-d1">Nota</p>
  `,
})
class OspiteComponent {
  controllo = new FormControl<string | null>('')
  descrizione: string | null = 'nota-d1'
  min: string | null = null
  max: string | null = null
  vuoto: '' | null = ''
}

describe('CampoDataComponent', () => {
  let fixture: ComponentFixture<OspiteComponent>
  let ospite: OspiteComponent

  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input#d1')
  const scrivi = (testo: string): void => {
    const el = input()
    el.value = testo
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const esci = (): void => {
    input().dispatchEvent(new Event('blur', { bubbles: true }))
    fixture.detectChanges()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OspiteComponent, NoopAnimationsModule],
    }).compileComponents()
    TestBed.inject(PrimeNGConfig).setTranslation(TRADUZIONE_PRIMENG_IT)
    fixture = TestBed.createComponent(OspiteComponent)
    ospite = fixture.componentInstance
    fixture.detectChanges()
  })

  it('mostra il valore AAAA-MM-GG come gg/mm/aaaa e non usa il campo nativo', async () => {
    ospite.controllo.setValue('2026-03-29')
    fixture.detectChanges()
    await fixture.whenStable()
    expect(input().value).toBe('29/03/2026')
    expect(fixture.nativeElement.querySelector('input[type="date"]')).toBeNull()
  })

  it('l inputId arriva all input interno e la label lo raggiunge', () => {
    expect(input()).not.toBeNull()
    expect(input().getAttribute('placeholder')).toBe('gg/mm/aaaa')
  })

  it('passa aria-describedby e aria-label all input interno, anche da disabilitato', () => {
    expect(input().getAttribute('aria-describedby')).toBe('nota-d1')
    expect(input().getAttribute('aria-label')).toBe('Data iniziale')
    ospite.controllo.disable()
    fixture.detectChanges()
    expect(input().disabled).toBeTrue()
    expect(input().getAttribute('aria-describedby')).toBe('nota-d1')
    ospite.descrizione = null
    fixture.detectChanges()
    expect(input().hasAttribute('aria-describedby')).toBeFalse()
  })

  it('scrive la data digitata come AAAA-MM-GG senza spostamenti di fuso (anche a cavallo dell ora legale)', () => {
    for (const [testo, atteso] of [
      ['29/03/2026', '2026-03-29'],
      ['25/10/2026', '2026-10-25'],
      ['01/01/2027', '2027-01-01'],
    ] as const) {
      scrivi(testo)
      esci()
      expect(ospite.controllo.value).toBe(atteso)
    }
  })

  it('non applica il valore mentre si digita: solo all uscita dal campo', () => {
    ospite.controllo.setValue('2026-01-01')
    fixture.detectChanges()
    scrivi('05/02/2026')
    expect(ospite.controllo.value).toBe('2026-01-01')
    esci()
    expect(ospite.controllo.value).toBe('2026-02-05')
  })

  it('applica il valore anche con Invio', () => {
    scrivi('05/02/2026')
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(ospite.controllo.value).toBe('2026-02-05')
  })

  it('svuotando il campo il valore e vuoto; con vuoto=null e null', () => {
    ospite.controllo.setValue('2026-01-01')
    fixture.detectChanges()
    scrivi('')
    esci()
    expect(ospite.controllo.value).toBe('')
    ospite.vuoto = null
    ospite.controllo.setValue('2026-01-01')
    fixture.detectChanges()
    scrivi('')
    esci()
    expect(ospite.controllo.value).toBeNull()
  })

  it('un testo che non e una data azzera il valore e ripulisce il campo', () => {
    ospite.controllo.setValue('2026-01-01')
    fixture.detectChanges()
    scrivi('31/02/20')
    esci()
    expect(ospite.controllo.value).toBe('')
    expect(input().value).toBe('')
  })

  it('rispetta min e max: una data fuori intervallo non viene accettata', () => {
    ospite.min = '2026-02-01'
    ospite.max = '2026-02-28'
    fixture.detectChanges()
    scrivi('15/03/2026')
    esci()
    expect(ospite.controllo.value).toBe('')
    scrivi('15/02/2026')
    esci()
    expect(ospite.controllo.value).toBe('2026-02-15')
  })

  it('il testid dell ospite resta sull host', () => {
    expect(
      fixture.nativeElement.querySelector('app-campo-data[data-testid="campo-prova"]')
    ).not.toBeNull()
  })
})
