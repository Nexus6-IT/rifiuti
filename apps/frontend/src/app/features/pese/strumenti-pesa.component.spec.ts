import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { of, throwError } from 'rxjs'
import { StrumentiPesaComponent } from './strumenti-pesa.component'
import { ElencoConPermessi, PeseService, StrumentoPesa } from './pese.service'
import { RegistroService } from '../registro/registro.service'
import { ToastService } from '../../core/services/toast.service'
import { giornoRoma } from './pese-formato'

function strumento(p: Partial<StrumentoPesa> = {}): StrumentoPesa {
  return {
    id: 's1',
    registroId: null,
    descrizione: 'Pesa a ponte',
    costruttore: 'Bilanciai',
    modello: 'P3',
    matricola: 'M-77',
    portataMaxKg: 60000,
    divisioneKg: 20,
    dataUltimaVerificazione: '2025-05-10',
    attivo: true,
    ...p,
  }
}
const elenco = (
  righe: StrumentoPesa[],
  puoRettificare = true
): ElencoConPermessi<StrumentoPesa> => ({
  righe,
  puoOperare: true,
  puoRettificare,
})
const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const qb = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}
const scrivi = (i: HTMLInputElement, t: string) => {
  i.value = t
  i.dispatchEvent(new Event('input', { bubbles: true }))
}
const incolla = (i: HTMLInputElement, t: string) => {
  const dt = new DataTransfer()
  dt.setData('text', t)
  i.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  )
}

describe('StrumentiPesaComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let registri: jasmine.SpyObj<RegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<StrumentiPesaComponent>

  function apri(e: ElencoConPermessi<StrumentoPesa>) {
    pese.elencaStrumenti.and.returnValue(of(e))
    fixture = TestBed.createComponent(StrumentiPesaComponent)
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaStrumenti',
      'creaStrumento',
      'aggiornaStrumento',
    ])
    registri = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    registri.listRegistri.and.returnValue(of([]))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [StrumentiPesaComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistroService, useValue: registri },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('mostra portata, divisione e data di verificazione', () => {
    apri(elenco([strumento()]))
    const t = q('str-riga-s1')!.textContent!
    expect(t).toContain('Pesa a ponte')
    expect(t).toContain('60.000 kg')
    expect(t).toContain('20 kg')
    expect(t).toContain('10/05/2025')
    expect(q('str-verificazione-scaduta-s1')).toBeNull()
  })

  it('avvisa se la verificazione e scaduta o manca', () => {
    apri(
      elenco([
        strumento({ dataUltimaVerificazione: '2019-01-01' }),
        strumento({ id: 's2', dataUltimaVerificazione: null }),
      ])
    )
    expect(q('str-verificazione-scaduta-s1')?.textContent).toContain('scaduta')
    expect(q('str-verificazione-scaduta-s2')?.textContent).toContain('Nessuna verificazione')
    expect(giornoRoma()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('senza puoRettificare niente pulsanti e una spiegazione', () => {
    apri(elenco([strumento()], false))
    expect(q('str-nuovo')).toBeNull()
    expect(q('str-modifica-s1')).toBeNull()
    expect(q('str-sola-lettura')?.textContent).toContain('amministratore')
  })

  it('crea lo strumento: "0,5" vale 0,5 e la descrizione e obbligatoria', () => {
    apri(elenco([]))
    qb('str-nuovo')!.click()
    fixture.detectChanges()
    qb('str-salva')!.click()
    fixture.detectChanges()
    expect(pese.creaStrumento).not.toHaveBeenCalled()
    expect(q('str-descrizione-errore')).not.toBeNull()
    scrivi(document.getElementById('str-descrizione') as HTMLInputElement, 'Pesa 2')
    incolla(document.getElementById('str-divisione') as HTMLInputElement, '0,5')
    pese.creaStrumento.and.returnValue(of(strumento()))
    qb('str-salva')!.click()
    expect(pese.creaStrumento).toHaveBeenCalledTimes(1)
    const dati = pese.creaStrumento.calls.mostRecent().args[0]
    expect(dati.descrizione).toBe('Pesa 2')
    expect(dati.divisioneKg).toBe(0.5)
  })

  it('"0.5" nella divisione e rifiutato', () => {
    apri(elenco([]))
    qb('str-nuovo')!.click()
    fixture.detectChanges()
    scrivi(document.getElementById('str-descrizione') as HTMLInputElement, 'Pesa 2')
    incolla(document.getElementById('str-divisione') as HTMLInputElement, '0.5')
    fixture.detectChanges()
    expect(q('str-divisione-errore')?.textContent).toContain('virgola')
    qb('str-salva')!.click()
    expect(pese.creaStrumento).not.toHaveBeenCalled()
  })

  it('mostra testuale l errore 400 del backend', () => {
    apri(elenco([strumento()]))
    qb('str-modifica-s1')!.click()
    fixture.detectChanges()
    pese.aggiornaStrumento.and.returnValue(
      throwError(() => ({
        status: 400,
        error: { message: ['La divisione deve essere maggiore di zero.'] },
      }))
    )
    qb('str-salva')!.click()
    fixture.detectChanges()
    expect(q('str-errore')?.textContent).toContain('La divisione deve essere maggiore di zero.')
    expect(q('str-errore')?.getAttribute('role')).toBe('alert')
  })

  it('la divisione accetta tre decimali ("0,001"), la portata solo due', () => {
    apri(elenco([]))
    qb('str-nuovo')!.click()
    fixture.detectChanges()
    scrivi(document.getElementById('str-descrizione') as HTMLInputElement, 'Pesa 3')
    incolla(document.getElementById('str-divisione') as HTMLInputElement, '0,001')
    pese.creaStrumento.and.returnValue(of(strumento()))
    qb('str-salva')!.click()
    expect(pese.creaStrumento.calls.mostRecent().args[0].divisioneKg).toBe(0.001)
  })
})
