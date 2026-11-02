import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of } from 'rxjs'
import { bottone, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ElencoDialogComponent } from './elenco-dialog.component'
import { ElencoAddebiti } from './listino.model'
import { ListinoService } from './listino.service'

const elenco = (): ElencoAddebiti =>
  ({
    id: 'e1',
    contrattoId: 'cc1',
    codice: '001',
    descrizione: 'Elenco',
    nota1: null,
    nota2: null,
    validoDal: null,
    validoAl: null,
    predefinito: false,
    codiceCig: null,
    codiceCup: null,
    idDocumentoPa: null,
    dataDocumentoPa: null,
    righe: 0,
    versione: 3,
    modificabile: true,
    eliminabile: true,
    allegati: [],
  }) as ElencoAddebiti

describe('ElencoDialogComponent', () => {
  let fixture: ComponentFixture<ElencoDialogComponent>
  let elenchi: { prossimoCodice: jasmine.Spy; crea: jasmine.Spy; modifica: jasmine.Spy }

  async function apri(soloLettura: boolean, e: ElencoAddebiti | null = elenco()) {
    fixture = TestBed.createComponent(ElencoDialogComponent)
    fixture.componentRef.setInput('contrattoId', 'cc1')
    fixture.componentRef.setInput('elenco', e)
    fixture.componentRef.setInput('soloLettura', soloLettura)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    elenchi = {
      prossimoCodice: jasmine.createSpy('prossimoCodice').and.returnValue(of('002')),
      crea: jasmine.createSpy('crea').and.returnValue(of(elenco())),
      modifica: jasmine.createSpy('modifica').and.returnValue(of(elenco())),
    }
    TestBed.configureTestingModule({
      imports: [ElencoDialogComponent],
      providers: [provideNoopAnimations(), { provide: ListinoService, useValue: { elenchi } }],
    })
  })
  afterEach(() => fixture?.destroy())

  it('salva() non scrive in sola lettura', async () => {
    await apri(true)
    fixture.componentInstance.salva()
    expect(elenchi.modifica).not.toHaveBeenCalled()
    expect(elenchi.crea).not.toHaveBeenCalled()
  })

  it('con il permesso salva (e il pulsante Salva funziona)', async () => {
    await apri(false)
    bottone('listino-elenco-salva')!.click()
    expect(elenchi.modifica).toHaveBeenCalledTimes(1)
  })

  it('distrutto con il salvataggio in corso non emette più nulla', async () => {
    const risposta$ = new Subject<ElencoAddebiti>()
    elenchi.modifica.and.returnValue(risposta$)
    await apri(false)
    const salvati: ElencoAddebiti[] = []
    fixture.componentInstance.salvato.subscribe(e => salvati.push(e))
    fixture.componentInstance.salva()
    fixture.destroy()
    risposta$.next(elenco())
    expect(salvati.length).toBe(0)
  })

  it('distrutto con la proposta del codice in volo non scrive nel modulo', async () => {
    const codice$ = new Subject<string>()
    elenchi.prossimoCodice.and.returnValue(codice$)
    await apri(false, null)
    fixture.destroy()
    expect(() => codice$.next('009')).not.toThrow()
  })
})
