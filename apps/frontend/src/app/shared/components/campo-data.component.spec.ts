import { Component } from '@angular/core'
import { DialogModule } from 'primeng/dialog'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { PrimeNGConfig } from 'primeng/api'
import { TRADUZIONE_PRIMENG_IT } from '../../core/config/primeng-it'
import { isoLocale } from '../utils/data-iso'
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

  it('una data fuori da min/max scritta a mano non cambia il valore e mostra «Data non valida»', () => {
    ospite.min = '2026-02-01'
    ospite.max = '2026-02-28'
    ospite.controllo.setValue('2026-02-10')
    fixture.detectChanges()
    scrivi('15/03/2026')
    esci()
    expect(ospite.controllo.value).toBe('2026-02-10')
    const errore = fixture.nativeElement.querySelector('[data-testid="campo-data-errore"]')
    expect(errore?.textContent).toContain('Data non valida')
    expect(errore?.getAttribute('role')).toBe('alert')
    expect(input().getAttribute('aria-invalid')).toBe('true')
    // riscrivendo una data buona il messaggio sparisce
    scrivi('20/02/2026')
    esci()
    expect(fixture.nativeElement.querySelector('[data-testid="campo-data-errore"]')).toBeNull()
    expect(input().hasAttribute('aria-invalid')).toBeFalse()
    expect(ospite.controllo.value).toBe('2026-02-20')
  })

  it('un testo che non e una data mostra «Data non valida» e svuota il valore', () => {
    scrivi('31/02/2026')
    esci()
    expect(ospite.controllo.value).toBe('')
    expect(fixture.nativeElement.querySelector('[data-testid="campo-data-errore"]')).not.toBeNull()
  })

  it('una data scritta senza zeri iniziali (5/2/2026) e valida e non mostra errori', () => {
    scrivi('5/2/2026')
    esci()
    expect(ospite.controllo.value).toBe('2026-02-05')
    expect(fixture.nativeElement.querySelector('[data-testid="campo-data-errore"]')).toBeNull()
  })

  it('il fuso dei test e fisso (Europe/Rome), cosi toISOString non passa per caso', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120)
  })

  it('touched si accende all uscita dal campo, non prima', () => {
    expect(ospite.controllo.touched).toBeFalse()
    scrivi('05/02/2026')
    expect(ospite.controllo.touched).toBeFalse()
    esci()
    expect(ospite.controllo.touched).toBeTrue()
  })

  it('il testid dell ospite resta sull host', () => {
    expect(
      fixture.nativeElement.querySelector('app-campo-data[data-testid="campo-prova"]')
    ).not.toBeNull()
  })
})

/** Il pannello sta nel body (`appendTo="body"`): si cerca nel document, non nel fixture. */
const pannello = (): HTMLElement | null => document.body.querySelector('.p-datepicker')
const tasto = (el: HTMLElement, key: string, codice: number): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', {
    key,
    keyCode: codice,
    which: codice,
    bubbles: true,
    cancelable: true,
  })
  el.dispatchEvent(e)
  return e
}
const bottonePannello = (testo: string): HTMLElement => {
  const trovato = Array.from(
    document.body.querySelectorAll<HTMLElement>('.p-datepicker-buttonbar button')
  ).find(b => b.textContent?.trim() === testo)
  if (!trovato) throw new Error(`bottone «${testo}» non trovato nel pannello`)
  return trovato
}
const giorno = (n: string): HTMLElement => {
  const cella = Array.from(
    document.body.querySelectorAll<HTMLElement>('.p-datepicker table td > span:not(.p-disabled)')
  ).find(c => c.textContent?.trim() === n)
  if (!cella) throw new Error(`giorno ${n} non trovato nel pannello`)
  return cella
}

describe('CampoDataComponent: pannello del calendario', () => {
  let fixture: ComponentFixture<OspiteComponent>
  let ospite: OspiteComponent
  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input#d1')

  async function apri(): Promise<void> {
    // focus vero: la freccia giu parte dal campo con il focus, come con la tastiera
    input().focus()
    fixture.detectChanges()
    await fixture.whenStable()
    // p-calendar sceglie la cella focalizzabile a fine animazione, fuori dalla zona
    await new Promise(r => setTimeout(r, 50))
    fixture.detectChanges()
    expect(pannello()).not.toBeNull()
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

  it('scegliere un giorno dal pannello porta AAAA-MM-GG al form e accende touched', async () => {
    ospite.controllo.setValue('2026-02-10')
    fixture.detectChanges()
    await apri()
    expect(ospite.controllo.touched).toBeFalse()
    giorno('15').click()
    fixture.detectChanges()
    expect(ospite.controllo.value).toBe('2026-02-15')
    expect(ospite.controllo.touched).toBeTrue()
  })

  it('«Oggi» sceglie il giorno di oggi (giorno locale)', async () => {
    await apri()
    bottonePannello('Oggi').click()
    fixture.detectChanges()
    expect(ospite.controllo.value).toBe(isoLocale(new Date()))
    expect(ospite.controllo.touched).toBeTrue()
  })

  it('«Cancella» svuota il campo e il valore torna vuoto', async () => {
    ospite.controllo.setValue('2026-02-10')
    fixture.detectChanges()
    await apri()
    bottonePannello('Cancella').click()
    fixture.detectChanges()
    expect(ospite.controllo.value).toBe('')
    expect(ospite.controllo.touched).toBeTrue()
    expect(input().value).toBe('')
  })

  it('si apre da tastiera (focus sul campo) e la freccia giu porta il focus nella griglia', async () => {
    ospite.controllo.setValue('2026-11-08')
    fixture.detectChanges()
    await apri()
    tasto(input(), 'ArrowDown', 40)
    fixture.detectChanges()
    const attivo = document.activeElement as HTMLElement
    expect(pannello()?.contains(attivo)).toBeTrue()
    expect(attivo.textContent?.trim()).toBe('8')
  })

  it('a calendario chiuso (dopo Esc) la freccia giu lo riapre e porta il focus sul giorno', async () => {
    ospite.controllo.setValue('2026-11-08')
    fixture.detectChanges()
    await apri()
    tasto(input(), 'Escape', 27)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(pannello()).toBeNull()
    input().focus()
    tasto(input(), 'ArrowDown', 40)
    fixture.detectChanges()
    await fixture.whenStable()
    await new Promise(r => setTimeout(r, 80))
    fixture.detectChanges()
    expect(pannello()).not.toBeNull()
    expect((document.activeElement as HTMLElement).textContent?.trim()).toBe('8')
  })

  it('la freccia destra su una domenica (fine riga) va al lunedi dopo, non al mese dopo', async () => {
    ospite.controllo.setValue('2026-11-08') // domenica: ultima cella della riga
    fixture.detectChanges()
    await apri()
    const domenica = giorno('8')
    domenica.focus()
    const e = tasto(domenica, 'ArrowRight', 39)
    fixture.detectChanges()
    expect(e.defaultPrevented).toBeTrue()
    expect((document.activeElement as HTMLElement).textContent?.trim()).toBe('9')
    expect(pannello()?.textContent).toContain('novembre')
    // e la sinistra torna indietro di un giorno, anche a inizio riga
    tasto(document.activeElement as HTMLElement, 'ArrowLeft', 37)
    fixture.detectChanges()
    expect((document.activeElement as HTMLElement).textContent?.trim()).toBe('8')
    expect(pannello()?.textContent).toContain('novembre')
  })

  it('sotto i 640 px (tocco) il campo e in sola lettura e si apre lo stesso da tastiera', async () => {
    const mq = {
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList
    spyOn(window, 'matchMedia').and.returnValue(mq)
    fixture.destroy()
    fixture = TestBed.createComponent(OspiteComponent)
    ospite = fixture.componentInstance
    fixture.detectChanges()
    expect(input().readOnly).toBeTrue()
    await apri()
    tasto(input(), 'ArrowDown', 40)
    expect(pannello()?.contains(document.activeElement)).toBeTrue()
  })

  it('su desktop il campo non e in sola lettura', () => {
    expect(input().readOnly).toBeFalse()
  })
})

@Component({
  standalone: true,
  imports: [CampoDataComponent, ReactiveFormsModule, DialogModule],
  template: `
    <p-dialog [(visible)]="aperto" header="Prova" [modal]="true">
      <label for="dd">Scadenza</label>
      <app-campo-data inputId="dd" [formControl]="controllo" />
    </p-dialog>
  `,
})
class OspiteDialogComponent {
  aperto = true
  controllo = new FormControl<string | null>('')
}

describe('CampoDataComponent dentro un p-dialog', () => {
  let fixture: ComponentFixture<OspiteDialogComponent>
  const input = (): HTMLInputElement => document.body.querySelector('input#dd')!

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OspiteDialogComponent, NoopAnimationsModule],
    }).compileComponents()
    TestBed.inject(PrimeNGConfig).setTranslation(TRADUZIONE_PRIMENG_IT)
    fixture = TestBed.createComponent(OspiteDialogComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    input().dispatchEvent(new Event('focus'))
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  })

  it('Esc sul campo con il calendario aperto chiude solo il calendario; il secondo Esc chiude il dialog', async () => {
    expect(pannello()).not.toBeNull()
    tasto(input(), 'Escape', 27)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(pannello()).toBeNull()
    expect(fixture.componentInstance.aperto).toBeTrue()
    expect(document.body.querySelector('.p-dialog')).not.toBeNull()
    tasto(input(), 'Escape', 27)
    fixture.detectChanges()
    expect(fixture.componentInstance.aperto).toBeFalse()
  })

  it('Esc con il focus su un giorno del pannello chiude solo il calendario', async () => {
    const cella = giorno('15')
    cella.focus()
    tasto(cella, 'Escape', 27)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(pannello()).toBeNull()
    expect(fixture.componentInstance.aperto).toBeTrue()
  })
})
