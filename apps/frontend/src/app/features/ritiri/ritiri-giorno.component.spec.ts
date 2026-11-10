import { HttpClientTestingModule } from '@angular/common/http/testing'
import { HttpHeaders, HttpResponse } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { PeseService } from '../pese/pese.service'
import { ordinaGiro, oggiIso, RitiriGiornoComponent } from './ritiri-giorno.component'
import { RitiroVista } from './ritiri.model'
import { RitiriService } from './ritiri.service'
import { ritiroDiProva } from './ritiri-test-utils'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

describe('ordinaGiro e oggiIso', () => {
  it('ordina per ordine di giro, i senza ordine in fondo, poi fascia', () => {
    const r = ordinaGiro([
      ritiroDiProva({ id: 'c', ordineGiro: null, fascia: 'POMERIGGIO' }),
      ritiroDiProva({ id: 'b', ordineGiro: 2 }),
      ritiroDiProva({ id: 'd', ordineGiro: null, fascia: 'MATTINA' }),
      ritiroDiProva({ id: 'a', ordineGiro: 1 }),
    ])
    expect(r.map(x => x.id)).toEqual(['a', 'b', 'd', 'c'])
  })
  it('oggiIso usa il giorno locale', () => {
    expect(oggiIso(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03')
  })
})

describe('RitiriGiornoComponent', () => {
  let fixture: ComponentFixture<RitiriGiornoComponent>
  let servizio: jasmine.SpyObj<RitiriService>
  let toast: jasmine.SpyObj<ToastService>

  const righe: RitiroVista[] = [
    ritiroDiProva({ id: 'r2', ordineGiro: 2, fir: { id: 'f2', numero: '12', status: 'DRAFT' } }),
    ritiroDiProva({ id: 'r1', ordineGiro: 1 }),
    ritiroDiProva({
      id: 'r3',
      ordineGiro: 3,
      stato: 'NON_ESEGUITO',
      statoVisibile: 'NON_ESEGUITO',
      motivo: 'mezzo guasto',
    }),
    ritiroDiProva({ id: 'r4', ordineGiro: 4, stato: 'ANNULLATO', statoVisibile: 'ANNULLATO' }),
  ]

  async function crea(ruolo = 'OPERATOR'): Promise<void> {
    servizio = jasmine.createSpyObj<RitiriService>('RitiriService', [
      'elenca',
      'nonEseguito',
      'scaricaPdfFir',
    ])
    servizio.elenca.and.returnValue(of({ righe, totale: righe.length }))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warn'])
    await TestBed.configureTestingModule({
      imports: [RitiriGiornoComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RitiriService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        {
          provide: PeseService,
          useValue: {
            elencaAutomezzi: () => of({ righe: [{ id: 'a1', targa: 'AB123CD' }] }),
          },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(RitiriGiornoComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('chiede il giorno di oggi e mostra le card in ordine di giro, senza gli annullati', async () => {
    await crea()
    const f = servizio.elenca.calls.mostRecent().args[0]!
    expect(f.dal).toBe(oggiIso())
    expect(f.al).toBe(oggiIso())
    const ids = Array.from(document.body.querySelectorAll('[data-testid^="rg-r"]')).map(e =>
      e.getAttribute('data-testid')
    )
    expect(ids).toEqual(['rg-r1', 'rg-r2', 'rg-r3'])
    expect(q('rg-mappa-r1')!.getAttribute('href')).toContain('maps')
    expect(q('rg-r1')!.textContent).toContain('170504')
    expect(q('rg-motivo-r3')!.textContent).toContain('mezzo guasto')
  })

  it('il filtro per mezzo ricarica con automezzoId', async () => {
    await crea()
    fixture.componentInstance.cambiaMezzo('a1')
    expect(servizio.elenca.calls.mostRecent().args[0]!.automezzoId).toBe('a1')
  })

  it('PDF solo con FIR, Non eseguito solo se programmato e senza FIR', async () => {
    await crea()
    expect(q('rg-pdf-r1')).toBeNull()
    expect(q('rg-pdf-r2')).not.toBeNull()
    expect(q('rg-ne-r1')).not.toBeNull()
    expect(q('rg-ne-r2')).toBeNull()
    expect(q('rg-ne-r3')).toBeNull()
  })

  it('un ruolo senza permesso di scrittura non vede Non eseguito', async () => {
    await crea('VIEWER')
    expect(q('rg-ne-r1')).toBeNull()
  })

  it('PDF del FIR scarica il blob del FIR del ritiro', async () => {
    await crea()
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    servizio.scaricaPdfFir.and.returnValue(
      of(new HttpResponse({ body: new Blob(['x']), headers: new HttpHeaders() }))
    )
    bottone('rg-pdf-r2')!.click()
    expect(servizio.scaricaPdfFir).toHaveBeenCalledWith('f2')
  })

  it('PDF in errore avvisa con un toast', async () => {
    await crea()
    servizio.scaricaPdfFir.and.returnValue(throwError(() => ({ status: 500 })))
    bottone('rg-pdf-r2')!.click()
    expect(toast.error).toHaveBeenCalled()
  })

  it('Non eseguito esige il motivo, poi chiama il servizio con la versione e ricarica', async () => {
    await crea()
    bottone('rg-ne-r1')!.click()
    fixture.detectChanges()
    bottone('ne-conferma')!.click()
    fixture.detectChanges()
    expect(q('ne-errore')!.textContent).toContain('obbligatorio')
    expect(servizio.nonEseguito).not.toHaveBeenCalled()

    servizio.nonEseguito.and.returnValue(of(ritiroDiProva({ id: 'r1', stato: 'NON_ESEGUITO' })))
    const area = q<HTMLTextAreaElement>('ne-motivo')!
    area.value = 'cliente assente'
    area.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    const chiamateElenco = servizio.elenca.calls.count()
    bottone('ne-conferma')!.click()
    fixture.detectChanges()
    expect(servizio.nonEseguito).toHaveBeenCalledWith('r1', 'cliente assente', 1)
    expect(toast.success).toHaveBeenCalled()
    expect(servizio.elenca.calls.count()).toBe(chiamateElenco + 1)
    expect(q('ne-conferma')).toBeNull()
  })

  it('un 409 resta dentro il dialog come errore', async () => {
    await crea()
    bottone('rg-ne-r1')!.click()
    fixture.detectChanges()
    servizio.nonEseguito.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'RITIRO_CON_FIR' } }))
    )
    const area = q<HTMLTextAreaElement>('ne-motivo')!
    area.value = 'x'
    area.dispatchEvent(new Event('input'))
    bottone('ne-conferma')!.click()
    fixture.detectChanges()
    expect(q('ne-errore')!.textContent).toContain('FIR attivo')
  })

  it('errore di caricamento mostrato come avviso', async () => {
    await crea()
    servizio.elenca.and.returnValue(throwError(() => ({ status: 500 })))
    fixture.componentInstance.carica()
    fixture.detectChanges()
    expect(q('rg-errore')).not.toBeNull()
  })
})
