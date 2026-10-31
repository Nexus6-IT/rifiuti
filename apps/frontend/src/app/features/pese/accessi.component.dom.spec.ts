import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { AccessiComponent } from './accessi.component'
import { AccessoRiepilogo, AccessoVista, ElencoAccessi, PeseService } from './pese.service'
import { PeseComponent } from './pese.component'
import { q, qb, scegli, scrivi } from './pese-test-utils'

const riga = (id: string, p: Partial<AccessoRiepilogo> = {}): AccessoRiepilogo => ({
  id,
  numero: 'ACC-' + id,
  stato: 'CHIUSO',
  verso: 'CARICO',
  modo: 'DOPPIA',
  targa: 'AB123CD',
  cerCode: '17 05 04',
  apertoIl: '2026-10-30T08:00:00.000Z',
  nettoKg: 16000,
  qualita: 'DUE_PESATE',
  manuale: false,
  rettificato: false,
  collegato: false,
  ...p,
})
const elenco = (righe: AccessoRiepilogo[], puoOperare = true): ElencoAccessi => ({
  righe,
  totale: righe.length,
  pagina: 1,
  puoOperare,
  puoRettificare: false,
})
const reg = (id: string, principale = false): RegistroVista => ({
  id,
  unitaLocaleId: 'u' + id,
  numIscrSito: null,
  denominazione: 'Sede ' + id,
  codice: id,
  attivo: true,
  principale,
})

describe('AccessiComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let registri: jasmine.SpyObj<RegistroService>
  let fixture: ComponentFixture<AccessiComponent>

  async function apri(regs: RegistroVista[], puoOperare = true) {
    registri.listRegistri.and.returnValue(of(regs))
    pese.elencaAccessi.and.callFake(f =>
      of(
        f?.stato === 'APERTO'
          ? elenco([riga('x1', { stato: 'APERTO', nettoKg: null, qualita: null })], puoOperare)
          : elenco([riga('a1', { manuale: true, rettificato: true, collegato: true })], puoOperare)
      )
    )
    fixture = TestBed.createComponent(AccessiComponent)
    fixture.detectChanges()
    // ngModel dentro un <form> registra i controlli in modo asincrono
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaAccessi',
      'elencaStrumenti',
      'elencaAutomezzi',
      'dettaglioAccesso',
    ])
    pese.elencaStrumenti.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: true }))
    pese.elencaAutomezzi.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: true }))
    registri = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    TestBed.configureTestingModule({
      imports: [AccessiComponent, PeseComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistroService, useValue: registri },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('i mezzi in impianto stanno in testa, prima dello storico', async () => {
    await apri([reg('r1', true)])
    const aperti = q('ac-aperti')!
    const tabella = q('ac-tabella')!
    expect(aperti.textContent).toContain('ACC-x1')
    expect(aperti.compareDocumentPosition(tabella) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('il filtro registro compare solo con più registri e parte dal predefinito', async () => {
    await apri([reg('r1', true)])
    expect(q('ac-f-registro')).toBeNull()
    fixture.destroy()
    await apri([reg('r1'), reg('r2', true)])
    expect(q<HTMLSelectElement>('ac-f-registro')!.value).toBe('r2')
    expect(pese.elencaAccessi.calls.mostRecent().args[0]?.registroId).toBe('r2')
  })

  it('la riga mostra i badge Manuale, Rettificato e Collegato', async () => {
    await apri([reg('r1', true)])
    const t = q('ac-riga-a1')!.textContent!
    expect(t).toContain('Manuale')
    expect(t).toContain('Rettificato')
    expect(t).toContain('Collegato')
    expect(t).toContain('16.000 kg')
  })

  it('filtra per stato, periodo e targa', async () => {
    await apri([reg('r1', true)])
    scegli(q<HTMLSelectElement>('ac-f-stato')!, 'ANNULLATO')
    scrivi(q<HTMLInputElement>('ac-f-targa')!, ' ab123 ')
    scrivi(q<HTMLInputElement>('ac-f-dal')!, '2026-10-01')
    scrivi(q<HTMLInputElement>('ac-f-al')!, '2026-10-31')
    fixture.detectChanges()
    pese.elencaAccessi.calls.reset()
    qb('ac-cerca')!.click()
    const f = pese.elencaAccessi.calls
      .allArgs()
      .map(a => a[0])
      .find(x => x?.stato === 'ANNULLATO')!
    expect(f).toEqual(
      jasmine.objectContaining({
        stato: 'ANNULLATO',
        targa: 'ab123',
        dal: '2026-10-01',
        al: '2026-10-31',
        pagina: 1,
      })
    )
  })

  it('Nuovo accesso solo con puoOperare', async () => {
    await apri([reg('r1', true)], false)
    expect(q('ac-nuovo')).toBeNull()
    expect(q('ac-sola-lettura')).not.toBeNull()
    fixture.destroy()
    await apri([reg('r1', true)], true)
    expect(qb('ac-nuovo')).not.toBeNull()
  })

  it('apre il dettaglio dalla riga', async () => {
    pese.dettaglioAccesso.and.returnValue(
      of({
        id: 'a1',
        numero: 'ACC-a1',
        pesate: [],
        collegamenti: [],
        avvisi: [],
        stato: 'CHIUSO',
        verso: 'CARICO',
        modo: 'DOPPIA',
        registro: { id: 'r1', descrizione: 'S' },
        netto: { stato: 'INCOMPLETO', avvisi: [] },
        puoOperare: false,
        puoRettificare: false,
        apertoIl: '2026-10-30T08:00:00.000Z',
      } as unknown as AccessoVista)
    )
    await apri([reg('r1', true)])
    qb('ac-apri-a1')!.click()
    fixture.detectChanges()
    expect(pese.dettaglioAccesso).toHaveBeenCalledWith('a1')
    expect(q('ad-indietro')).not.toBeNull()
  })
})

describe('PeseComponent (schede)', () => {
  it('mostra una scheda alla volta e si muove con le frecce', async () => {
    const pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaAccessi',
      'elencaStrumenti',
      'elencaAutomezzi',
    ])
    pese.elencaAccessi.and.returnValue(of(elenco([])))
    pese.elencaStrumenti.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: false }))
    pese.elencaAutomezzi.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: false }))
    const registri = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    registri.listRegistri.and.returnValue(of([]))
    TestBed.configureTestingModule({
      imports: [PeseComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistroService, useValue: registri },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
      ],
    })
    const f = TestBed.createComponent(PeseComponent)
    f.detectChanges()
    expect(q('pese-scheda-accessi')!.getAttribute('aria-selected')).toBe('true')
    expect(document.body.querySelector('app-pese-strumenti')).toBeNull()
    q('pese-scheda-accessi')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    )
    f.detectChanges()
    expect(q('pese-scheda-automezzi')!.getAttribute('aria-selected')).toBe('true')
    expect(document.body.querySelector('app-pese-automezzi')).not.toBeNull()
    f.destroy()
  })
})
