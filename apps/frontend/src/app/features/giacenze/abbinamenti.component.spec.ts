import { ComponentFixture, TestBed } from '@angular/core/testing'
import { Subject, of, throwError } from 'rxjs'
import { HttpErrorResponse } from '@angular/common/http'
import { AbbinamentiComponent } from './abbinamenti.component'
import { AbbinamentiService, PropostaScarico } from './abbinamenti.service'
import { RegistroService } from '../registro/registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ambito, carico, proposta, scarico, sede, vista } from './abbinamenti.fixture.spec'

describe('AbbinamentiComponent', () => {
  let fixture: ComponentFixture<AbbinamentiComponent>
  let comp: AbbinamentiComponent
  let servizio: jasmine.SpyObj<AbbinamentiService>
  let toast: jasmine.SpyObj<ToastService>

  function setup(registri = [sede('r1', 'Sede unica', true)]): void {
    servizio = jasmine.createSpyObj<AbbinamentiService>('AbbinamentiService', [
      'vista',
      'differenze',
      'proposta',
      'salva',
      'ricalcola',
    ])
    servizio.vista.and.returnValue(of(vista()))
    servizio.differenze.and.returnValue(of([]))
    servizio.proposta.and.returnValue(of(proposta()))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    const reg = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    reg.listRegistri.and.returnValue(of(registri))
    TestBed.configureTestingModule({
      imports: [AbbinamentiComponent],
      providers: [
        { provide: AbbinamentiService, useValue: servizio },
        { provide: RegistroService, useValue: reg },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(AbbinamentiComponent)
    comp = fixture.componentInstance
    fixture.detectChanges()
  }

  it('con un solo registro lo usa e carica vista e differenze', () => {
    setup()
    expect(servizio.vista).toHaveBeenCalledWith('r1')
    expect(servizio.differenze).toHaveBeenCalledWith('r1')
    expect(comp.piuRegistri()).toBe(false)
    expect(comp.vista()?.ambiti.length).toBe(1)
  })

  it('con piu sedi parte dalla principale; senza principale chiede di sceglierne una', () => {
    setup([sede('r1', 'A'), sede('r2', 'B', true)])
    expect(comp.registroSel()).toBe('r2')
    expect(comp.opzioniRegistro().map(o => o.label)).toEqual(['A', 'B'])
  })

  it('senza principale non carica nulla finche non si sceglie la sede', () => {
    setup([sede('r1', 'A'), sede('r2', 'B')])
    expect(servizio.vista).not.toHaveBeenCalled()
    comp.cambiaRegistro('r1')
    expect(servizio.vista).toHaveBeenCalledWith('r1')
  })

  it('titolo del pannello e filtro "solo da completare"', () => {
    setup()
    servizio.vista.and.returnValue(
      of(
        vista({
          ambiti: [
            ambito({
              classi: ['R13', 'D15'],
              carichi: [
                carico({ id: 'a', stato: 'ESAURITO' }),
                carico({ id: 'b', stato: 'APERTO' }),
              ],
              scarichi: [
                scarico({ id: 's1', stato: 'ABBINATO' }),
                scarico({ id: 's2', numero: '4/2026', stato: 'PARZIALE' }),
              ],
            }),
          ],
        })
      )
    )
    comp.reload()
    expect(comp.titoloAmbito(comp.vista()!.ambiti[0])).toBe('CER 15 01 01 · R13 / D15')
    expect(comp.scarichiVisibili(comp.vista()!.ambiti[0]).length).toBe(2)
    comp.soloDaCompletare.set(true)
    expect(comp.scarichiVisibili(comp.vista()!.ambiti[0]).map(s => s.id)).toEqual(['s2'])
    expect(comp.carichiVisibili(comp.vista()!.ambiti[0]).map(c => c.id)).toEqual(['b'])
  })

  it('stati: etichette e gravita dei tag', () => {
    setup()
    expect(comp.gravita('ABBINATO')).toBe('success')
    expect(comp.gravita('PARZIALE')).toBe('warning')
    expect(comp.gravita('NON_ABBINATO')).toBe('secondary')
    expect(comp.gravita('INCOERENTE')).toBe('danger')
    expect(comp.etichettaStato('NON_ABBINATO')).toBe('Non abbinato')
  })

  it('differenze non scaricabili: non si dice "nessuna differenza"', () => {
    setup()
    servizio.differenze.and.returnValue(throwError(() => new Error('rete')))
    comp.reload()
    expect(comp.differenzeNonDisponibili()).toBe(true)
    expect(comp.differenze()).toEqual([])
    expect(comp.vista()).not.toBeNull()
  })

  it('nessun registro: messaggio e nessuna chiamata', () => {
    setup([])
    expect(comp.nessunRegistro()).toBe(true)
    expect(servizio.vista).not.toHaveBeenCalled()
  })

  it('numeri in formato italiano', () => {
    setup()
    expect(comp.formattaQuantita(1234.5)).toBe('1.234,5')
  })

  it('Abbina con FIFO i non abbinati: chiama il ricalcolo, mostra gli avvisi e ricarica', () => {
    setup()
    servizio.ricalcola.and.returnValue(
      of({
        scarichiAbbinati: 2,
        righeScritte: 3,
        righeCancellate: 0,
        avvisi: ['1 scarico non è coperto'],
      })
    )
    servizio.vista.calls.reset()
    comp.abbinaNonAbbinati()
    expect(servizio.ricalcola).toHaveBeenCalledWith({ registroId: 'r1', modalita: 'NON_ABBINATI' })
    expect(comp.avvisi()).toEqual(['1 scarico non è coperto'])
    expect(servizio.vista).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalled()
  })

  it('Ricalcola gli automatici chiede conferma prima', () => {
    setup()
    servizio.ricalcola.and.returnValue(
      of({ scarichiAbbinati: 0, righeScritte: 0, righeCancellate: 0, avvisi: [] })
    )
    comp.chiediRicalcolo()
    expect(comp.confermaRicalcolo()).toBe(true)
    expect(servizio.ricalcola).not.toHaveBeenCalled()
    comp.ricalcolaAutomatici()
    expect(servizio.ricalcola).toHaveBeenCalledWith({ registroId: 'r1', modalita: 'AUTOMATICI' })
    expect(comp.confermaRicalcolo()).toBe(false)
  })

  it('errore del ricalcolo: toast con il messaggio del server, nessun id', () => {
    setup()
    servizio.ricalcola.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: {
              message:
                "Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici.",
            },
          })
      )
    )
    comp.ricalcolaAutomatici()
    expect(toast.error).toHaveBeenCalledWith(
      "Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici."
    )
  })

  describe('modifica di uno scarico', () => {
    const s = scarico({ stato: 'NON_ABBINATO', abbinato: 0, righe: [] })

    it('apre l editor con la proposta e salva solo le quantita maggiori di zero', () => {
      setup()
      comp.apriModifica(s)
      expect(servizio.proposta).toHaveBeenCalledWith('s1')
      expect(comp.modifica()?.candidati.length).toBe(2)
      comp.usaProposta()
      expect(comp.quantitaDi(comp.modifica()!.candidati[0])).toBe(400)
      expect(comp.totaleModifica()).toBe(400)
      servizio.salva.and.returnValue(
        of({ scarico: s, avvisi: ['Abbinamento parziale: restano 0 da abbinare.'] })
      )
      comp.salvaModifica()
      expect(servizio.salva).toHaveBeenCalledWith('s1', [{ caricoId: 'c1', quantita: 400 }])
      expect(comp.modifica()).toBeNull()
      expect(comp.avvisi()).toEqual(['Abbinamento parziale: restano 0 da abbinare.'])
    })

    it('una giacenza iniziale viaggia come giacenzaInizialeId', () => {
      setup()
      servizio.proposta.and.returnValue(
        of(proposta({ candidati: [carico({ tipo: 'APERTURA', id: 'g1', numero: null })] }))
      )
      comp.apriModifica(s)
      comp.impostaQuantita(comp.modifica()!.candidati[0], 50.5)
      servizio.salva.and.returnValue(of({ scarico: s, avvisi: [] }))
      comp.salvaModifica()
      expect(servizio.salva).toHaveBeenCalledWith('s1', [
        { giacenzaInizialeId: 'g1', quantita: 50.5 },
      ])
    })

    it('totale oltre lo scarico: il salvataggio e bloccato', () => {
      setup()
      comp.apriModifica(s)
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
      comp.apriModifica(s)
      expect(comp.modifica()?.scoperto).toBe(25)
      expect(comp.modifica()?.righeFuori.length).toBe(1)
      expect(comp.testoRigheFuori(comp.modifica()!)).toContain('9/2026')
      expect(comp.testoRigheFuori(comp.modifica()!)).toContain('vengono tolti')
    })

    it('una seconda Modifica annulla la proposta precedente', () => {
      setup()
      const primo = new Subject<PropostaScarico>()
      servizio.proposta.and.returnValues(primo, of(proposta()))
      comp.apriModifica(s)
      comp.apriModifica(s)
      primo.next(proposta({ scoperto: 999 }))
      expect(comp.modifica()?.scoperto).toBe(0)
    })

    it('Aggiorna chiude l editor aperto', () => {
      setup()
      comp.apriModifica(s)
      expect(comp.modifica()).not.toBeNull()
      comp.reload()
      expect(comp.modifica()).toBeNull()
    })

    it('scollega: elenco vuoto e l avviso del server (il ricalcolo riabbina) resta visibile', () => {
      setup()
      comp.apriModifica(s)
      const avviso =
        'Lo scarico è senza abbinamento: il prossimo ricalcolo lo riabbinerà con il FIFO.'
      servizio.salva.and.returnValue(of({ scarico: s, avvisi: [avviso] }))
      comp.chiediScollega()
      expect(comp.confermaScollega()).toBe(true)
      expect(servizio.salva).not.toHaveBeenCalled()
      comp.scollega()
      expect(servizio.salva).toHaveBeenCalledWith('s1', [])
      expect(comp.avvisi()).toEqual([avviso])
    })

    it('errore del server: resta aperto e mostra il messaggio', () => {
      setup()
      comp.apriModifica(s)
      servizio.salva.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.' },
            })
        )
      )
      comp.impostaQuantita(comp.modifica()!.candidati[0], 400)
      comp.salvaModifica()
      expect(comp.modifica()).not.toBeNull()
      expect(comp.erroreModifica()).toBe(
        'Il carico n. 1/2026 ha un residuo di 100: non basta per 400.'
      )
    })
  })
})
