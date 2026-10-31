import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { HttpErrorResponse } from '@angular/common/http'
import { AbbinamentoScaricoDialogComponent } from './abbinamento-scarico-dialog.component'
import { AbbinamentiService, PropostaScarico } from './abbinamenti.service'
import { ToastService } from '../../core/services/toast.service'
import { carico, proposta, scarico } from './abbinamenti.fixture.spec'

describe('AbbinamentoScaricoDialogComponent', () => {
  let fixture: ComponentFixture<AbbinamentoScaricoDialogComponent>
  let comp: AbbinamentoScaricoDialogComponent
  let servizio: jasmine.SpyObj<AbbinamentiService>
  let toast: jasmine.SpyObj<ToastService>
  const s = scarico({ stato: 'NON_ABBINATO', abbinato: 0, righe: [] })

  afterEach(async () => {
    // chiude il dialog e svuota le animazioni prima dello smontaggio (niente NG0205)
    fixture?.componentRef.setInput('visible', false)
    fixture?.detectChanges()
    await fixture?.whenStable()
    await new Promise(r => setTimeout(r, 30))
    fixture?.destroy()
  })

  function setup(): void {
    servizio = jasmine.createSpyObj<AbbinamentiService>('AbbinamentiService', ['proposta', 'salva'])
    servizio.proposta.and.returnValue(of(proposta()))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [AbbinamentoScaricoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AbbinamentiService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(AbbinamentoScaricoDialogComponent)
    comp = fixture.componentInstance
  }

  function apri(): void {
    fixture.componentRef.setInput('scarico', s)
    fixture.componentRef.setInput('unita', 'kg')
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
  }

  it('all apertura carica la proposta e precompila le quantita dalle righe esistenti', () => {
    setup()
    servizio.proposta.and.returnValue(
      of(proposta({ scarico: scarico() /* una riga da 400 su c1 */ }))
    )
    apri()
    expect(servizio.proposta).toHaveBeenCalledWith('s1')
    expect(comp.modifica()?.candidati.length).toBe(2)
    expect(comp.quantitaDi(comp.modifica()!.candidati[0])).toBe(400)
  })

  it('apre l editor con la proposta e salva solo le quantita maggiori di zero', () => {
    setup()
    apri()
    comp.usaProposta()
    expect(comp.quantitaDi(comp.modifica()!.candidati[0])).toBe(400)
    expect(comp.quantitaDi(comp.modifica()!.candidati[1])).toBeNull()
    expect(comp.totaleModifica()).toBe(400)
    const esito = { scarico: s, avvisi: ['Abbinamento parziale: restano 0 da abbinare.'] }
    servizio.salva.and.returnValue(of(esito))
    const salvato: unknown[] = []
    const chiuso: boolean[] = []
    comp.salvato.subscribe(e => salvato.push(e))
    comp.visibleChange.subscribe(v => chiuso.push(v))
    comp.salvaModifica()
    expect(servizio.salva).toHaveBeenCalledWith('s1', [{ caricoId: 'c1', quantita: 400 }])
    expect(salvato).toEqual([esito])
    expect(chiuso).toEqual([false])
  })

  it('Usa la proposta FIFO ripristina dopo una modifica a mano', () => {
    setup()
    apri()
    comp.usaProposta()
    comp.impostaQuantita(comp.modifica()!.candidati[0], 7)
    comp.impostaQuantita(comp.modifica()!.candidati[1], 3)
    expect(comp.totaleModifica()).toBe(10)
    comp.usaProposta()
    expect(comp.totaleModifica()).toBe(400)
    expect(comp.quantitaDi(comp.modifica()!.candidati[1])).toBeNull()
  })

  it('una giacenza iniziale viaggia come giacenzaInizialeId', () => {
    setup()
    servizio.proposta.and.returnValue(
      of(proposta({ candidati: [carico({ tipo: 'APERTURA', id: 'g1', numero: null })] }))
    )
    apri()
    comp.impostaQuantita(comp.modifica()!.candidati[0], 50.5)
    servizio.salva.and.returnValue(of({ scarico: s, avvisi: [] }))
    comp.salvaModifica()
    expect(servizio.salva).toHaveBeenCalledWith('s1', [
      { giacenzaInizialeId: 'g1', quantita: 50.5 },
    ])
  })

  it('totale oltre lo scarico: il salvataggio e bloccato', () => {
    setup()
    apri()
    comp.impostaQuantita(comp.modifica()!.candidati[0], 500)
    expect(comp.superaScarico()).toBe(true)
    comp.salvaModifica()
    expect(servizio.salva).not.toHaveBeenCalled()
  })

  it('scoperto della proposta e righe esistenti fuori dai candidati', () => {
    setup()
    servizio.proposta.and.returnValue(
      of(
        proposta({
          scoperto: 25,
          scarico: scarico({
            righe: [
              {
                carico: { tipo: 'MOVIMENTO', id: 'zz', numero: '9/2026', giorno: '2026-05-01' },
                quantita: 10,
                origine: 'MANUALE',
              },
            ],
          }),
        })
      )
    )
    apri()
    expect(comp.modifica()?.scoperto).toBe(25)
    expect(comp.modifica()?.righeFuori.length).toBe(1)
    expect(comp.testoRigheFuori(comp.modifica()!)).toContain('9/2026')
    expect(comp.testoRigheFuori(comp.modifica()!)).toContain('vengono tolti')
  })

  it('una seconda apertura annulla la proposta precedente', () => {
    setup()
    const primo = new Subject<PropostaScarico>()
    servizio.proposta.and.returnValues(primo, of(proposta()))
    apri()
    fixture.componentRef.setInput('visible', false)
    fixture.detectChanges()
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    primo.next(proposta({ scoperto: 999 }))
    expect(comp.modifica()?.scoperto).toBe(0)
  })

  it('alla chiusura lo stato si azzera', () => {
    setup()
    apri()
    expect(comp.modifica()).not.toBeNull()
    fixture.componentRef.setInput('visible', false)
    fixture.detectChanges()
    expect(comp.modifica()).toBeNull()
  })

  it('scollega: elenco vuoto dopo conferma, l avviso del server passa al chiamante', () => {
    setup()
    apri()
    const avviso =
      'Lo scarico è senza abbinamento: il prossimo ricalcolo lo riabbinerà con il FIFO.'
    const esito = { scarico: s, avvisi: [avviso] }
    servizio.salva.and.returnValue(of(esito))
    const salvato: unknown[] = []
    comp.salvato.subscribe(e => salvato.push(e))
    comp.chiediScollega()
    expect(comp.confermaScollega()).toBe(true)
    expect(servizio.salva).not.toHaveBeenCalled()
    comp.scollega()
    expect(servizio.salva).toHaveBeenCalledWith('s1', [])
    expect(salvato).toEqual([esito])
  })

  it('errore 400: resta aperto e mostra il messaggio del backend cosi com e', () => {
    setup()
    apri()
    servizio.salva.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.' },
          })
      )
    )
    const chiuso: boolean[] = []
    comp.visibleChange.subscribe(v => chiuso.push(v))
    comp.impostaQuantita(comp.modifica()!.candidati[0], 400)
    comp.salvaModifica()
    expect(chiuso).toEqual([])
    expect(comp.erroreModifica()).toBe(
      'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.'
    )
    expect(comp.inElaborazione()).toBe(false)
  })

  it('errore nel caricamento della proposta: toast e chiusura', () => {
    setup()
    servizio.proposta.and.returnValue(throwError(() => new Error('rete')))
    const chiuso: boolean[] = []
    comp.visibleChange.subscribe(v => chiuso.push(v))
    apri()
    expect(toast.error).toHaveBeenCalledWith('Impossibile caricare la proposta.')
    expect(chiuso).toEqual([false])
  })

  it('classe diversa: solo se entrambe le classi sono note e differiscono', () => {
    setup()
    apri()
    const m = comp.modifica()!
    expect(comp.classeDiversa(m, carico({ classe: 'R13' }))).toBe(false)
    expect(comp.classeDiversa(m, carico({ classe: 'D15' }))).toBe(true)
    expect(comp.classeDiversa(m, carico({ classe: null }))).toBe(false)
  })
})
