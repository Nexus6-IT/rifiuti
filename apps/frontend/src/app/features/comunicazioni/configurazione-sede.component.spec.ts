import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { ConfigurazioneSedeComponent } from './configurazione-sede.component'
import { DatiComunicazioniService } from './dati-comunicazioni.service'
import {
  ConfigurazioneComunicazioniRisposta,
  ConsorzioConfigurabile,
} from './dati-comunicazioni.model'
import { ToastService } from '../../core/services/toast.service'

function config(
  consorzio: ConsorzioConfigurabile,
  dati: Record<string, unknown>,
  over: Partial<ConfigurazioneComunicazioniRisposta> = {}
): ConfigurazioneComunicazioniRisposta {
  return { unitaLocaleId: 'u1', consorzio, salvata: true, dati, puoModificare: true, ...over }
}

describe('ConfigurazioneSedeComponent', () => {
  let fixture: ComponentFixture<ConfigurazioneSedeComponent>
  let svc: jasmine.SpyObj<DatiComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>
  const q = <T extends HTMLElement>(id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as T | null

  function setup(
    risposte: Partial<Record<ConsorzioConfigurabile, ConfigurazioneComunicazioniRisposta>> = {}
  ): void {
    svc = jasmine.createSpyObj<DatiComunicazioniService>('DatiComunicazioniService', [
      'configurazione',
      'impostaConfigurazione',
    ])
    svc.configurazione.and.callFake((_u, c) => of(risposte[c] ?? config(c, {}, { salvata: false })))
    svc.impostaConfigurazione.and.callFake((_u, c, dati) =>
      of({ unitaLocaleId: 'u1', consorzio: c, salvata: true, dati })
    )
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [ConfigurazioneSedeComponent],
      providers: [
        { provide: DatiComunicazioniService, useValue: svc },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(ConfigurazioneSedeComponent)
    fixture.componentRef.setInput('unitaLocaleId', 'u1')
    fixture.detectChanges()
  }

  it('parte da CONOU, legge la configurazione e dice se sono i valori di partenza', () => {
    setup()
    expect(svc.configurazione).toHaveBeenCalledWith('u1', 'CONOU')
    expect(q('config-predefiniti')).not.toBeNull()
  })

  it('CONOU: salva il codice deposito conservando i predefiniti per CER', () => {
    setup({
      CONOU: config('CONOU', {
        codiceDeposito: 'DEP001',
        predefinitiPerCer: { '130205': { prodotto: 'A' } },
      }),
    })
    const c = fixture.componentInstance
    expect(c.deposito).toBe('DEP001')
    c.deposito = 'NUOVO1'
    c.salva()
    expect(svc.impostaConfigurazione).toHaveBeenCalledWith('u1', 'CONOU', {
      codiceDeposito: 'NUOVO1',
      predefinitiPerCer: { '130205': { prodotto: 'A' } },
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('un deposito svuotato si toglie dai dati', () => {
    setup({ CONOU: config('CONOU', { codiceDeposito: 'DEP001' }) })
    const c = fixture.componentInstance
    c.deposito = '  '
    expect(c.datiDaSalvare()).toEqual({})
  })

  it('cambiare consorzio rilegge e mostra i campi di quel consorzio', () => {
    setup({ ORSO: config('ORSO', { modalita: 'DETTAGLIATA' }) })
    fixture.componentInstance.scegli('ORSO')
    fixture.detectChanges()
    expect(svc.configurazione).toHaveBeenCalledWith('u1', 'ORSO')
    expect(fixture.componentInstance.modalita).toBe('DETTAGLIATA')
    expect(fixture.nativeElement.querySelector('#config-modalita')).not.toBeNull()
    expect(fixture.nativeElement.querySelector('#config-deposito')).toBeNull()
  })

  it('COBAT e O.R.R.: i campi mostrati finiscono nei dati, il resto si conserva', () => {
    setup({
      COBAT: config('COBAT', {
        campagnaPredefinita: { codice: '26', descrizione: 'C' },
        pgfPerCer: { '160601': 'A' },
      }),
      ORR: config('ORR', { autorizzazioneImpiantoId: 'aut-1', tipoImpianto: 'STO' }),
    })
    const c = fixture.componentInstance
    c.scegli('COBAT')
    c.campagnaCodice = '27'
    expect(c.datiDaSalvare()).toEqual({
      campagnaPredefinita: { codice: '27', descrizione: 'C' },
      pgfPerCer: { '160601': 'A' },
    })
    c.scegli('ORR')
    c.tipoImpianto = 'REC'
    c.atecoZero = true
    expect(c.datiDaSalvare()).toEqual({
      autorizzazioneImpiantoId: 'aut-1',
      tipoImpianto: 'REC',
      atecoProduttoreMancanteComeZero: true,
      usaAutorizzazioniPredefinite: false,
    })
  })

  it('errori del backend: elenco, nessun toast; sola lettura: niente salvataggio', () => {
    setup()
    svc.impostaConfigurazione.and.returnValue(
      throwError(() => ({
        error: { details: { errori: ['codiceDeposito: da 3 a 10 caratteri alfanumerici'] } },
      }))
    )
    fixture.componentInstance.salva()
    fixture.detectChanges()
    expect(q('config-errori-campo')?.textContent).toContain('codiceDeposito')
    expect(toast.success).not.toHaveBeenCalled()

    TestBed.resetTestingModule()
    setup({ CONOU: config('CONOU', {}, { puoModificare: false }) })
    fixture.componentInstance.salva()
    expect(svc.impostaConfigurazione).not.toHaveBeenCalled()
    expect(q('config-salva')).toBeNull()
  })

  it('CONOU: modifica dei predefiniti per CER (prodotto e percentuale) dalle righe', () => {
    setup({
      CONOU: config('CONOU', {
        codiceDeposito: 'DEP001',
        predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 84.99 } },
      }),
    })
    const c = fixture.componentInstance
    expect(c.predefiniti).toEqual([{ cer: '130205', prodotto: 'A', percentuale: '84.99' }])
    c.aggiungiPredefinito()
    c.predefiniti[1] = { cer: '13 01 01*', prodotto: 'B', percentuale: '70,5' }
    expect(c.datiDaSalvare()).toEqual({
      codiceDeposito: 'DEP001',
      predefinitiPerCer: {
        '130205': { prodotto: 'A', percentualeOlio: 84.99 },
        '130101': { prodotto: 'B', percentualeOlio: 70.5 },
      },
    })
    c.togliPredefinito(0)
    expect(Object.keys(c.datiDaSalvare()['predefinitiPerCer'] as object)).toEqual(['130101'])
  })

  it('CONOU: una riga senza percentuale salva solo il prodotto; una riga senza CER si ignora', () => {
    setup({ CONOU: config('CONOU', {}) })
    const c = fixture.componentInstance
    c.aggiungiPredefinito()
    c.aggiungiPredefinito()
    c.predefiniti[0] = { cer: '130205', prodotto: 'C', percentuale: '' }
    expect(c.datiDaSalvare()).toEqual({ predefinitiPerCer: { '130205': { prodotto: 'C' } } })
    c.predefiniti = []
    expect(c.datiDaSalvare()).toEqual({})
  })

  it('CONOU: togliere tutte le righe svuota la mappa gia salvata', () => {
    setup({
      CONOU: config('CONOU', { predefinitiPerCer: { '130205': { prodotto: 'A' } } }),
    })
    const c = fixture.componentInstance
    c.togliPredefinito(0)
    expect(c.datiDaSalvare()).toEqual({ predefinitiPerCer: {} })
  })

  it('COBAT: modifica del PGF per CER dalle righe', () => {
    setup({
      COBAT: config('COBAT', {
        campagnaPredefinita: { codice: '26', descrizione: 'C' },
        pgfPerCer: { '160601': 'A' },
      }),
    })
    const c = fixture.componentInstance
    c.scegli('COBAT')
    expect(c.pgfRighe).toEqual([{ cer: '160601', pgf: 'A' }])
    c.aggiungiPgf()
    c.pgfRighe[1] = { cer: '16 06 02*', pgf: 'C' }
    expect(c.datiDaSalvare()['pgfPerCer']).toEqual({ '160601': 'A', '160602': 'C' })
    c.togliPgf(0)
    expect(c.datiDaSalvare()['pgfPerCer']).toEqual({ '160602': 'C' })
  })

  it('solo chi puo modificare vede aggiungi e togli', () => {
    setup({
      CONOU: config(
        'CONOU',
        { predefinitiPerCer: { '130205': { prodotto: 'A' } } },
        { puoModificare: false }
      ),
    })
    expect(q('config-predefinito-aggiungi')).toBeNull()
    expect(q('config-predefinito-togli')).toBeNull()
  })
})
