import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RegistryService } from '../registry/registry.service'
import { PeseService } from '../pese/pese.service'
import { RitiriComponent } from './ritiri.component'
import { RitiroVista } from './ritiri.model'
import { RitiriService } from './ritiri.service'
import { ritiroDiProva } from './ritiri-test-utils'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

describe('RitiriComponent', () => {
  let fixture: ComponentFixture<RitiriComponent>
  let servizio: jasmine.SpyObj<RitiriService>
  let toast: jasmine.SpyObj<ToastService>

  const righe: RitiroVista[] = [
    ritiroDiProva({ id: 'r1' }),
    ritiroDiProva({
      id: 'r2',
      statoVisibile: 'FIR_BOZZA',
      fir: { id: 'f2', numero: null, status: 'DRAFT' },
    }),
    ritiroDiProva({
      id: 'r3',
      stato: 'NON_ESEGUITO',
      statoVisibile: 'NON_ESEGUITO',
      motivo: 'mezzo guasto',
    }),
    ritiroDiProva({ id: 'r4', stato: 'ANNULLATO', statoVisibile: 'ANNULLATO', motivo: 'chiuso' }),
  ]

  async function crea(ruolo = 'ADMIN', elenco: RitiroVista[] = righe): Promise<void> {
    servizio = jasmine.createSpyObj<RitiriService>('RitiriService', [
      'elenca',
      'dettaglio',
      'annulla',
      'nonEseguito',
      'riprogramma',
      'generaFir',
    ])
    servizio.elenca.and.returnValue(of({ righe: elenco, totale: elenco.length }))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warn'])
    await TestBed.configureTestingModule({
      imports: [RitiriComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: RitiriService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: PeseService, useValue: { elencaAutomezzi: () => of({ righe: [] }) } },
        { provide: RegistryService, useValue: {} },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(RitiriComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('mostra una riga per ritiro con stato, motivo e numero del FIR', async () => {
    await crea()
    expect(document.body.querySelectorAll('[data-testid^="ri-riga-"]').length).toBe(4)
    expect(q('ri-riga-r1')?.textContent).toContain('Da generare')
    expect(q('ri-riga-r2')?.textContent).toContain('FIR in bozza')
    expect(q('ri-motivo-r3')?.textContent).toContain('mezzo guasto')
    expect(q('ri-fir-r2')?.getAttribute('href')).toBe('/fir/f2')
  })

  it('i filtri viaggiano al servizio alla ricerca', async () => {
    await crea()
    fixture.componentInstance.filtri.dal = '2026-11-01'
    fixture.componentInstance.filtri.statoVisibile = 'DA_GENERARE'
    bottone('ri-cerca')!.click()
    const ultimo = servizio.elenca.calls.mostRecent().args[0]!
    expect(ultimo.dal).toBe('2026-11-01')
    expect(ultimo.statoVisibile).toBe('DA_GENERARE')
    expect(ultimo.pagina).toBe(1)
    expect(ultimo.cerCode).toBeUndefined()
  })

  it('solo i ritiri da generare si possono spuntare', async () => {
    await crea()
    expect(q<HTMLInputElement>('ri-sel-r1')!.disabled).toBeFalse()
    expect(q<HTMLInputElement>('ri-sel-r2')!.disabled).toBeTrue()
    expect(q<HTMLInputElement>('ri-sel-r3')!.disabled).toBeTrue()
    expect(bottone('ri-genera')!.disabled).toBeTrue()
  })

  it('Genera FIR manda i ritiri spuntati e apre l’esito', async () => {
    await crea()
    servizio.generaFir.and.returnValue(
      of({ esiti: [{ ritiroId: 'r1', esito: 'CREATO' as const, firId: 'f1' }] })
    )
    const sel = q<HTMLInputElement>('ri-sel-r1')!
    sel.click()
    fixture.detectChanges()
    expect(bottone('ri-genera')!.disabled).toBeFalse()
    bottone('ri-genera')!.click()
    fixture.detectChanges()
    expect(servizio.generaFir).toHaveBeenCalledOnceWith(['r1'])
    expect(q('eg-riepilogo')).not.toBeNull()
  })

  it('Annulla chiede il motivo e non parte senza', async () => {
    await crea()
    fixture.componentInstance.apriAzione('ANNULLA', righe[0])
    fixture.detectChanges()
    expect(q('ri-azione-indietro')).not.toBeNull()
    bottone('ri-azione-conferma')!.click()
    fixture.detectChanges()
    expect(servizio.annulla).not.toHaveBeenCalled()
    expect(q('ri-azione-errore')?.textContent).toContain('motivo')
  })

  it('Annulla con motivo chiama il servizio con la versione e ricarica', async () => {
    await crea()
    servizio.annulla.and.returnValue(of(righe[0]))
    fixture.componentInstance.apriAzione('ANNULLA', righe[0])
    fixture.componentInstance.motivo = 'cliente chiuso'
    fixture.detectChanges()
    const prima = servizio.elenca.calls.count()
    bottone('ri-azione-conferma')!.click()
    expect(servizio.annulla).toHaveBeenCalledOnceWith('r1', 'cliente chiuso', 1)
    expect(servizio.elenca.calls.count()).toBe(prima + 1)
    expect(toast.success).toHaveBeenCalled()
  })

  it('un 409 RITIRO_CON_FIR resta nel dialog con la frase che dice cosa fare', async () => {
    await crea()
    servizio.nonEseguito.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'RITIRO_CON_FIR' } }))
    )
    fixture.componentInstance.apriAzione('NON_ESEGUITO', righe[0])
    fixture.componentInstance.motivo = 'mezzo guasto'
    fixture.detectChanges()
    bottone('ri-azione-conferma')!.click()
    fixture.detectChanges()
    expect(q('ri-azione-errore')?.textContent).toContain('annulla prima il FIR')
  })

  it('Riprogramma chiede la data e la manda al servizio', async () => {
    await crea()
    servizio.riprogramma.and.returnValue(of(righe[2]))
    fixture.componentInstance.apriAzione('RIPROGRAMMA', righe[2])
    fixture.componentInstance.nuovaData = '2026-11-20'
    fixture.detectChanges()
    bottone('ri-azione-conferma')!.click()
    expect(servizio.riprogramma).toHaveBeenCalledOnceWith('r3', '2026-11-20', 1)
  })

  it('le azioni dipendono dallo stato del ritiro', async () => {
    await crea()
    const c = fixture.componentInstance
    expect(c.azioni(righe[0]).principale).not.toBeNull()
    expect(c.azioni(righe[0]).altre.map(a => a.etichetta)).toEqual([
      'Non eseguito',
      'Annulla il ritiro',
    ])
    // con un FIR attivo niente modifica e l'annullo è spiegato
    expect(c.azioni(righe[1]).principale).toBeNull()
    expect(c.azioni(righe[1]).altre[0].disabilitata).toBeTrue()
    // non eseguito: si può riprogramma
    expect(c.azioni(righe[2]).altre.map(a => a.etichetta)).toContain('Riprogramma')
    // annullato: nessuna azione
    expect(c.azioni(righe[3]).altre).toEqual([])
  })

  it('un lettore non vede selezione, azioni né pulsanti di scrittura', async () => {
    await crea('VIEWER')
    expect(q('ri-nuovo')).toBeNull()
    expect(q('ri-genera')).toBeNull()
    expect(q('ri-sel-r1')).toBeNull()
  })

  it('senza ritiri mostra il messaggio e nessun paginatore', async () => {
    await crea('ADMIN', [])
    expect(q('ri-vuota')?.textContent).toContain('Nessun ritiro')
    expect(document.body.querySelector('.p-paginator')).toBeNull()
  })

  it('un errore di lettura si mostra in un avviso', async () => {
    await crea()
    servizio.elenca.and.returnValue(throwError(() => ({ status: 500 })))
    fixture.componentInstance.carica()
    fixture.detectChanges()
    expect(q('ri-errore')?.textContent).toContain('Impossibile leggere i ritiri')
  })
})
