import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Observable, of, throwError } from 'rxjs'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ClientiService } from '../clienti/clienti.service'
import { ATTESA_PROPOSTA_MS } from '../legami/blocco-fatturazione.component'
import { proposta, riga as rigaLegame } from '../legami/blocco-fatturazione.test-util'
import { FatturazioneCorrezione, LegameVista, PropostaLegame } from '../legami/legami.model'
import { LegamiService } from '../legami/legami.service'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import { CorreggiMovimentoDialogComponent } from './correggi-movimento-dialog.component'
import { EsitoCorrezioneMovimento, Movimento, RegistroService } from './registro.service'

/**
 * Rettifica e annullamento con il legame col listino (fase 4.3, Task 27): avvisi del legame,
 * blocco «Fatturazione» riutilizzato, esito `fatturazione` della risposta come avviso.
 */
function mov(parziale: Partial<Movimento> = {}): Movimento {
  return {
    id: 'm1',
    registroId: 'r1',
    tenantId: 't1',
    progressiveNumber: 12,
    progressiveYear: 2026,
    type: 'SCARICO',
    movementDate: '2026-10-20T00:00:00.000Z',
    registrationDate: '2026-10-21T08:00:00.000Z',
    causale: 'SCARICO_A_TERZI',
    cerCode: '17 04 05',
    quantity: 120,
    unit: 'KG',
    entryHash: 'abc',
    createdAt: '2026-10-21T08:00:00.000Z',
    tipoAnnotazione: 'ORDINARIA',
    stato: 'VIGENTE',
    ...parziale,
  }
}

function legame(parziale: Partial<LegameVista> = {}): LegameVista {
  return {
    id: 'lg-1',
    movimentoOriginaleId: 'm1',
    movimentoVigenteId: 'm1',
    stato: 'CONFERMATO',
    dataMovimento: '2026-10-20',
    cliente: { id: 'cl-1', etichetta: 'Rossi Srl', fonte: 'FIR' },
    dettaglioCliente: null,
    contratto: { id: 'co-1', etichetta: 'Contratto 2026' },
    elenco: { id: 'el-1', etichetta: 'Listino base' },
    righe: [rigaLegame()],
    motivi: [],
    avvisi: [],
    motivoEsclusione: null,
    confermatoIl: '2026-10-21T08:00:00.000Z',
    fatturatoIl: null,
    riferimentoFattura: null,
    documentoId: null,
    scostamentoDopoFattura: false,
    scostamentoAperto: false,
    scostamentoIl: null,
    versione: 2,
    ...parziale,
  }
}

const opzione = (codice: string, fatturabile?: boolean): OpzioneCausaleApi => ({
  codice,
  descrizione: codice,
  origine: 'SISTEMA',
  ruoloMud: 'ESCLUSO',
  codiceRentri: null,
  operazione: null,
  versioneId: null,
  ...(fatturabile === undefined ? {} : { fatturabile }),
})

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)
const testo = (testid: string): string => (q(testid)?.textContent ?? '').replace(/\s+/g, ' ').trim()
const bottone = (testid: string): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="${testid}"] button`)

describe('CorreggiMovimentoDialog - legame col listino', () => {
  let fixture: ComponentFixture<CorreggiMovimentoDialogComponent>
  let registro: jasmine.SpyObj<RegistroService>
  let legami: jasmine.SpyObj<LegamiService>
  let toast: jasmine.SpyObj<ToastService>
  let causali: { opzioni: jasmine.Spy; invalida: jasmine.Spy }
  let ruolo: string
  let chiusure: boolean[]
  let corretti: EsitoCorrezioneMovimento[]
  let proposteDaRestituire: PropostaLegame

  function esito(
    fatturazione?: FatturazioneCorrezione,
    avvisi: string[] = []
  ): EsitoCorrezioneMovimento {
    return {
      movimento: mov({ id: 'm9', progressiveNumber: 13, tipoAnnotazione: 'RETTIFICA' }),
      avvisi,
      ...(fatturazione ? { fatturazione } : {}),
    }
  }

  function apri(
    modo: 'rettifica' | 'annullamento',
    esistente: Observable<LegameVista>,
    m: Movimento = mov()
  ): void {
    legami.perMovimento.and.returnValue(esistente)
    fixture = TestBed.createComponent(CorreggiMovimentoDialogComponent)
    chiusure = []
    corretti = []
    fixture.componentInstance.visibleChange.subscribe(v => chiusure.push(v))
    fixture.componentInstance.corretto.subscribe(e => corretti.push(e))
    fixture.componentRef.setInput('modo', modo)
    fixture.componentRef.setInput('movimento', m)
    fixture.componentRef.setInput('visible', true)
    aggiorna()
    tick(ATTESA_PROPOSTA_MS)
    aggiorna()
  }

  function aggiorna(): void {
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
  }

  let contratti = true

  const motivo = (): void => {
    fixture.componentInstance.form.patchValue({ motivo: 'Quantità errata' })
    aggiorna()
  }

  beforeEach(() => {
    registro = jasmine.createSpyObj<RegistroService>('RegistroService', ['rettifica', 'annulla'])
    legami = jasmine.createSpyObj<LegamiService>('LegamiService', ['perMovimento', 'proposta'])
    proposteDaRestituire = proposta()
    legami.proposta.and.callFake(() => of(proposteDaRestituire))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    causali = {
      opzioni: jasmine.createSpy('opzioni').and.returnValue(of([opzione('SCARICO_A_TERZI', true)])),
      invalida: jasmine.createSpy('invalida'),
    }
    ruolo = 'OPERATOR'
    contratti = true
    TestBed.configureTestingModule({
      imports: [CorreggiMovimentoDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        {
          provide: FeatureFlagsService,
          useValue: { has: (k: string) => k !== 'contratti' || contratti },
        },
        { provide: RegistroService, useValue: registro },
        { provide: LegamiService, useValue: legami },
        { provide: ToastService, useValue: toast },
        { provide: CausaliRegistroService, useValue: causali },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: [], totale: 0 }) } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    })
  })

  afterEach(() => fixture?.destroy())

  it('I1: senza il modulo contratti la rettifica non legge il legame e non mostra avvisi', fakeAsync(() => {
    contratti = false
    apri('rettifica', of(legame()))
    expect(legami.perMovimento).not.toHaveBeenCalled()
    expect(legami.proposta).not.toHaveBeenCalled()
    expect(q('correzione-errore-legame')).toBeNull()
    expect(q('blocco-fatturazione')).toBeNull()
  }))

  it('rettifica con CER cambiato: avviso «serve una nuova conferma» e blocco rivalutato sul CER nuovo', fakeAsync(() => {
    apri('rettifica', of(legame()))
    expect(q('correzione-cer-cambiato')).toBeNull()
    legami.proposta.calls.reset()

    fixture.componentInstance.form.patchValue({ cerCode: '17 04 02' })
    aggiorna()
    expect(testo('correzione-cer-cambiato')).toContain('serve una nuova conferma')
    // m1: promemoria anche sotto il campo CER
    expect(testo('correzione-cer-cambiato-campo')).toContain('riconfermato')
    tick(ATTESA_PROPOSTA_MS)
    aggiorna()
    expect(legami.proposta).toHaveBeenCalledTimes(1)
    expect(legami.proposta.calls.mostRecent().args[0].cerCode).toBe('17 04 02')

    // il CER torna quello di prima: l'avviso sparisce
    fixture.componentInstance.form.patchValue({ cerCode: '17 04 05' })
    aggiorna()
    expect(q('correzione-cer-cambiato')).toBeNull()
    expect(q('correzione-cer-cambiato-campo')).toBeNull()
    tick(ATTESA_PROPOSTA_MS)
  }))

  it('CER cambiato senza legame (404): nessun avviso «nuova conferma», il blocco propone sul CER nuovo', fakeAsync(() => {
    apri(
      'rettifica',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    fixture.componentInstance.form.patchValue({ cerCode: '17 04 02' })
    aggiorna()
    tick(ATTESA_PROPOSTA_MS)
    aggiorna()
    expect(q('correzione-cer-cambiato')).toBeNull()
    expect(legami.proposta.calls.mostRecent().args[0].cerCode).toBe('17 04 02')
    expect(q('blocco-fatturazione')).not.toBeNull()
  }))

  it('annullamento di un movimento fatturato: avviso, ma si può procedere comunque (O1)', fakeAsync(() => {
    registro.annulla.and.returnValue(of(esito()))
    apri('annullamento', of(legame({ stato: 'FATTURATO', fatturatoIl: '2026-11-10T00:00:00Z' })))
    expect(testo('correzione-avviso-fatturato')).toContain('già fatturato')
    expect(testo('correzione-avviso-fatturato')).toContain('annullarlo comunque')
    motivo()
    expect(bottone('correzione-invia')!.disabled).toBeFalse()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(registro.annulla).toHaveBeenCalledOnceWith('m1', { motivo: 'Quantità errata' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(chiusure).toEqual([false])
  }))

  it('annullamento di un movimento NON fatturato o senza legame: nessun avviso', fakeAsync(() => {
    apri('annullamento', of(legame()))
    expect(q('correzione-avviso-fatturato')).toBeNull()
    fixture.destroy()
    apri(
      'annullamento',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    expect(q('correzione-avviso-fatturato')).toBeNull()
  }))

  it('rettifica di un movimento già fatturato: avviso e nessun blocco da compilare', fakeAsync(() => {
    apri('rettifica', of(legame({ stato: 'IMPORTATO_FATTURATO' })))
    expect(q('correzione-avviso-fatturato')).not.toBeNull()
    expect(q('blocco-fatturazione')).toBeNull()
    expect(legami.proposta).not.toHaveBeenCalled()
  }))

  it('esito NON_RIUSCITO: la correzione è riuscita, è un avviso (mai un errore) e il dialog si chiude', fakeAsync(() => {
    registro.rettifica.and.returnValue(
      of(esito({ esito: 'NON_RIUSCITO', legameId: null, stato: null, motivi: [], avvisi: [] }))
    )
    apri(
      'rettifica',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(toast.success).toHaveBeenCalled()
    expect(toast.warn).toHaveBeenCalledOnceWith(jasmine.stringMatching(/Da collegare/))
    expect(toast.error).not.toHaveBeenCalled()
    expect(chiusure).toEqual([false])
    expect(corretti.length).toBe(1)
  }))

  it('esito DA_RIALLINEARE: avviso «da riallineare», non un errore', fakeAsync(() => {
    registro.rettifica.and.returnValue(
      of(esito({ esito: 'DA_RIALLINEARE', legameId: 'lg-1', stato: null, motivi: [], avvisi: [] }))
    )
    apri('rettifica', of(legame()))
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(toast.warn).toHaveBeenCalledOnceWith(jasmine.stringMatching(/riallineare/))
    expect(toast.error).not.toHaveBeenCalled()
  }))

  it('avvisi del backend già col rimando a «Da collegare»: nessun avviso doppio', fakeAsync(() => {
    const testoBackend =
      'Correzione registrata; il collegamento non è stato aggiornato: lo trovi in "Da collegare".'
    registro.rettifica.and.returnValue(
      of(
        esito({ esito: 'DA_RIALLINEARE', legameId: 'lg-1', stato: null, motivi: [], avvisi: [] }, [
          testoBackend,
        ])
      )
    )
    apri('rettifica', of(legame()))
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(toast.warn).toHaveBeenCalledOnceWith(testoBackend)
  }))

  it('esito COLLEGATO con CAMBIO_CER_DA_CONFERMARE: avviso con il testo del vocabolario', fakeAsync(() => {
    registro.rettifica.and.returnValue(
      of(
        esito({
          esito: 'COLLEGATO',
          legameId: 'lg-1',
          stato: 'PROPOSTO',
          motivi: [],
          avvisi: ['CAMBIO_CER_DA_CONFERMARE'],
        })
      )
    )
    apri('rettifica', of(legame()))
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(toast.warn).toHaveBeenCalledOnceWith(jasmine.stringMatching(/conferma di nuovo/))
  }))

  it('legame nuovo: «Rettifica e conferma legame» invia legame.azione CONFERMA con la selezione delle righe', fakeAsync(() => {
    registro.rettifica.and.returnValue(of(esito()))
    apri(
      'rettifica',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    motivo()
    expect(q('blocco-fatturazione')).not.toBeNull()
    bottone('correzione-invia-conferma')!.click()
    aggiorna()
    const corpo = registro.rettifica.calls.mostRecent().args[1]
    expect(corpo.legame?.azione).toBe('CONFERMA')
    expect(corpo.legame?.righe?.map(r => r.rigaAddebitoId)).toEqual(['ra-1', 'ra-2'])
    expect(corpo.cerCode).toBe('17 04 05')
  }))

  it('legame nuovo: «Rettifica» invia azione PROPOSTA', fakeAsync(() => {
    registro.rettifica.and.returnValue(of(esito()))
    apri(
      'rettifica',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect(registro.rettifica.calls.mostRecent().args[1].legame?.azione).toBe('PROPOSTA')
  }))

  it('legame esistente: il blocco manda solo le scelte, mai la selezione delle righe', fakeAsync(() => {
    registro.rettifica.and.returnValue(of(esito()))
    apri('rettifica', of(legame({ stato: 'PROPOSTO' })))
    motivo()
    bottone('correzione-invia-conferma')!.click()
    aggiorna()
    const l = registro.rettifica.calls.mostRecent().args[1].legame
    expect(l?.azione).toBe('CONFERMA')
    expect(l && 'righe' in l).toBeFalse()
    // righe in sola lettura: nessun campo da ritoccare nel blocco
    expect(document.body.querySelector('#qta-ra-1')).toBeNull()
  }))

  it('causale non fatturabile per l’API: nessuna proposta, un solo pulsante «Rettifica»', fakeAsync(() => {
    causali.opzioni.and.returnValue(of([opzione('SCARICO_A_TERZI', false)]))
    apri(
      'rettifica',
      throwError(() => new HttpErrorResponse({ status: 404 }))
    )
    expect(legami.proposta).not.toHaveBeenCalled()
    expect(q('correzione-invia-conferma')).toBeNull()
    motivo()
    registro.rettifica.and.returnValue(of(esito()))
    bottone('correzione-invia')!.click()
    aggiorna()
    expect('legame' in registro.rettifica.calls.mostRecent().args[1]).toBeFalse()
  }))

  it('VIEWER: il legame non si legge mai e non c’è nessun blocco', fakeAsync(() => {
    ruolo = 'VIEWER'
    apri('annullamento', of(legame({ stato: 'FATTURATO' })))
    expect(legami.perMovimento).not.toHaveBeenCalled()
    expect(q('correzione-avviso-fatturato')).toBeNull()
    expect(q('blocco-fatturazione')).toBeNull()
  }))

  it('l’annullamento non porta mai il blocco `legame`', fakeAsync(() => {
    registro.annulla.and.returnValue(of(esito()))
    apri('annullamento', of(legame()))
    motivo()
    bottone('correzione-invia')!.click()
    aggiorna()
    expect('legame' in registro.annulla.calls.mostRecent().args[1]).toBeFalse()
    expect(q('blocco-fatturazione')).toBeNull()
  }))

  describe('legame esistente (revisione)', () => {
    const conPrezzoManuale = (parziale: Partial<LegameVista> = {}): LegameVista =>
      legame({
        righe: [rigaLegame({ prezzo: '1.5', prezzoManuale: true, importo: '99.00' })],
        ...parziale,
      })

    it('I1: mostra il legame com’è (prezzo manuale, importo del server), non la proposta di oggi', fakeAsync(() => {
      registro.rettifica.and.returnValue(of(esito()))
      apri('rettifica', of(conPrezzoManuale()))
      expect(testo('correzione-legame-attuale')).toContain('Confermato')
      expect(testo('correzione-legame-attuale')).toContain('Rossi Srl')
      expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
      // un solo importo (quello del legame): la tabella della proposta (60,00) non c'è
      expect(document.body.querySelectorAll('[data-testid="importo-ra-1"]').length).toBe(1)
      expect(testo('importo-ra-1')).toContain('99,00')
      // CONFERMATO e CER invariato: «Rettifica e conferma» non serve
      expect(q('correzione-invia-conferma')).toBeNull()
      motivo()
      bottone('correzione-invia')!.click()
      aggiorna()
      expect('legame' in registro.rettifica.calls.mostRecent().args[1]).toBeFalse()
    }))

    it('I1: le scelte del legame sono le scelte iniziali del blocco e non si rimandano', fakeAsync(() => {
      registro.rettifica.and.returnValue(of(esito()))
      apri(
        'rettifica',
        of(
          legame({
            stato: 'PROPOSTO',
            cliente: { id: 'cl-9', etichetta: 'Verdi Srl', fonte: 'UTENTE' },
            contratto: { id: 'co-9', etichetta: 'Contratto speciale' },
            elenco: { id: 'el-9', etichetta: 'Elenco speciale' },
          })
        )
      )
      expect(legami.proposta.calls.mostRecent().args[0].scelte).toEqual({
        clienteId: 'cl-9',
        contrattoId: 'co-9',
        elencoId: 'el-9',
      })
      expect(q('correzione-scelte-cambiate')).toBeNull()
      motivo()
      bottone('correzione-invia-conferma')!.click()
      aggiorna()
      expect(registro.rettifica.calls.mostRecent().args[1].legame).toEqual({ azione: 'CONFERMA' })
    }))

    it('I1: se l’utente cambia il contratto, avviso esplicito e la scelta entra nel corpo', fakeAsync(() => {
      registro.rettifica.and.returnValue(of(esito()))
      proposteDaRestituire = proposta({
        candidati: {
          contratti: [
            { id: 'co-1', etichetta: 'Contratto 2026' },
            { id: 'co-2', etichetta: 'Contratto B' },
          ],
          elenchi: [{ id: 'el-1', etichetta: 'Listino base' }],
          righe: [],
        },
      })
      apri('rettifica', of(legame()))
      const menu = document.body.querySelector('#fatt-contratto') as HTMLSelectElement
      menu.value = 'co-2'
      menu.dispatchEvent(new Event('change'))
      aggiorna()
      tick(ATTESA_PROPOSTA_MS)
      aggiorna()
      expect(testo('correzione-scelte-cambiate')).toContain('prezzi congelati')
      expect(testo('correzione-scelte-cambiate')).toContain('scritti a mano')
      expect(testo('correzione-scelte-cambiate')).toContain('Proposto')
      motivo()
      bottone('correzione-invia')!.click()
      aggiorna()
      expect(registro.rettifica.calls.mostRecent().args[1].legame).toEqual({
        azione: 'PROPOSTA',
        contrattoId: 'co-2',
      })
    }))

    it('CER cambiato: l’avviso dice che si perdono anche i prezzi scritti a mano', fakeAsync(() => {
      apri('rettifica', of(conPrezzoManuale()))
      fixture.componentInstance.form.patchValue({ cerCode: '17 04 02' })
      aggiorna()
      expect(testo('correzione-cer-cambiato')).toContain('scritti a mano')
      expect(testo('correzione-cer-cambiato')).toContain('serve una nuova conferma')
      // con il CER nuovo la proposta rigenerata si mostra
      tick(ATTESA_PROPOSTA_MS)
      aggiorna()
      expect(document.body.querySelectorAll('[data-testid="importo-ra-1"]').length).toBe(2)
    }))

    it('CER cambiato: contratto ed elenco del blocco si mandano anche se uguali al legame', fakeAsync(() => {
      registro.rettifica.and.returnValue(of(esito()))
      apri('rettifica', of(legame()))
      fixture.componentInstance.form.patchValue({ cerCode: '17 04 02' })
      aggiorna()
      tick(ATTESA_PROPOSTA_MS)
      aggiorna()
      motivo()
      bottone('correzione-invia')!.click()
      aggiorna()
      const inviato = registro.rettifica.calls.mostRecent().args[1].legame
      expect(inviato?.azione).toBe('PROPOSTA')
      expect(typeof inviato?.contrattoId).toBe('string')
      expect(typeof inviato?.elencoId).toBe('string')
    }))

    it('CER cambiato con causale non fatturabile: nessun avviso «nuova conferma» (il legame viene escluso)', fakeAsync(() => {
      causali.opzioni.and.returnValue(of([opzione('SCARICO_A_TERZI', false)]))
      apri('rettifica', of(legame()))
      fixture.componentInstance.form.patchValue({ cerCode: '17 04 02' })
      aggiorna()
      expect(q('correzione-cer-cambiato')).toBeNull()
    }))

    it('I2: lettura del legame fallita (500): avviso, nessun blocco, corpo senza `legame`, rettifica possibile', fakeAsync(() => {
      registro.rettifica.and.returnValue(of(esito()))
      apri(
        'rettifica',
        throwError(() => new HttpErrorResponse({ status: 500 }))
      )
      expect(testo('correzione-errore-legame')).toContain('la rettifica parte senza modificarlo')
      expect(q('blocco-fatturazione')).toBeNull()
      expect(legami.proposta).not.toHaveBeenCalled()
      expect(q('correzione-invia-conferma')).toBeNull()
      motivo()
      expect(bottone('correzione-invia')!.disabled).toBeFalse()
      bottone('correzione-invia')!.click()
      aggiorna()
      expect('legame' in registro.rettifica.calls.mostRecent().args[1]).toBeFalse()
      expect(toast.error).not.toHaveBeenCalled()
    }))

    it('I2: il 404 resta «legame nuovo» e non mostra l’avviso di lettura', fakeAsync(() => {
      apri(
        'rettifica',
        throwError(() => new HttpErrorResponse({ status: 404 }))
      )
      expect(q('correzione-errore-legame')).toBeNull()
      expect(q('blocco-fatturazione')).not.toBeNull()
    }))
  })
})
