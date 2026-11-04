import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { HttpErrorResponse } from '@angular/common/http'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Observable, Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import {
  ATTESA_PROPOSTA_MS,
  ATTESA_RICERCA_CLIENTI_MS,
  BloccoFatturazioneComponent,
  StatoBlocco,
  SceltaLegame,
} from './blocco-fatturazione.component'
import { DATI, proposta, riga } from './blocco-fatturazione.test-util'
import { DatiLegameRegistrazione, PropostaLegame } from './legami.model'
import { LegamiService } from './legami.service'
import { ClientiService } from '../clienti/clienti.service'

/** Logica del blocco «Fatturazione»: visibilità, proposta, debounce, scelte e blocco `legame`. */
const CLIENTI = [
  { id: 'cl-7', ditta: { ragioneSociale: 'Bianchi Srl' } },
  { id: 'cl-8', ditta: { ragioneSociale: 'Neri Spa' } },
] as never[]

describe('BloccoFatturazioneComponent — logica', () => {
  let servizio: { proposta: jasmine.Spy }
  let clientiList: jasmine.Spy
  let ruolo: string
  let fixture: ComponentFixture<BloccoFatturazioneComponent>
  let legami: (DatiLegameRegistrazione | null)[]
  let stati: StatoBlocco[]
  const confermabile = (): boolean => stati[stati.length - 1]?.confermabile ?? false
  let scelte: (SceltaLegame | null)[]

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`)
  const testo = (testid: string): string =>
    (q(testid)?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const ultimo = (): DatiLegameRegistrazione | null => legami[legami.length - 1] ?? null

  function crea(risposta: Observable<PropostaLegame> = of(proposta())): void {
    servizio.proposta.and.returnValue(risposta)
    TestBed.configureTestingModule({
      imports: [BloccoFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        {
          provide: ClientiService,
          useValue: { clienti: { list: clientiList } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    })
    fixture = TestBed.createComponent(BloccoFatturazioneComponent)
    legami = []
    stati = []
    fixture.componentInstance.statoChange.subscribe(x => stati.push(x))
    scelte = []
    fixture.componentInstance.legameChange.subscribe(l => legami.push(l))
    fixture.componentInstance.sceltaChange.subscribe(s => scelte.push(s))
    fixture.componentRef.setInput('datiMovimento', DATI)
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    // ngModel scrive il valore nei campi in un microtask
    tick()
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = { proposta: jasmine.createSpy('proposta') }
    clientiList = jasmine
      .createSpy('list')
      .and.callFake(() => of({ elementi: CLIENTI, totale: CLIENTI.length }))
    ruolo = 'OPERATOR'
  })

  it('causale non fatturabile: blocco nascosto e nessun legame', fakeAsync(() => {
    crea(of(proposta({ fatturabile: false })))
    expect(q('blocco-fatturazione')).toBeNull()
    expect(ultimo()).toBeNull()
  }))

  it('fatturazione spenta: nascosto', fakeAsync(() => {
    crea(of(proposta({ attiva: false })))
    expect(q('blocco-fatturazione')).toBeNull()
    expect(ultimo()).toBeNull()
  }))

  it('viewer: blocco non mostrato e proposta mai chiesta', fakeAsync(() => {
    ruolo = 'VIEWER'
    crea()
    expect(q('blocco-fatturazione')).toBeNull()
    expect(servizio.proposta).not.toHaveBeenCalled()
  }))

  it('dati del movimento incompleti: nessuna richiesta', fakeAsync(() => {
    crea()
    servizio.proposta.calls.reset()
    fixture.componentRef.setInput('datiMovimento', null)
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    expect(servizio.proposta).not.toHaveBeenCalled()
    expect(q('blocco-fatturazione')).toBeNull()
    expect(ultimo()).toBeNull()
  }))

  it('proposta completa: cliente con «da FIR», contratto, elenco, 2 righe con prezzi', fakeAsync(() => {
    crea()
    expect(testo('fatt-cliente')).toContain('Rossi Srl')
    expect(q('fatt-da-fir')).not.toBeNull()
    expect(testo('fatt-contratto')).toBe('Contratto 2026')
    expect(testo('fatt-elenco')).toBe('Listino base')
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="riga-"]').length).toBe(2)
    // prezzo con la virgola e senza separatore delle migliaia
    const prezzo = fixture.nativeElement.querySelector('#prezzo-ra-1') as HTMLInputElement
    expect(prezzo.value).toBe('0,5')
    expect(testo('importo-ra-1')).toContain('60,00')
  }))

  it('la richiesta porta i dati del movimento col punto e senza scelte', fakeAsync(() => {
    crea()
    expect(servizio.proposta).toHaveBeenCalledTimes(1)
    expect(servizio.proposta.calls.mostRecent().args[0]).toEqual(DATI)
  }))

  it('debounce: tre modifiche ravvicinate danno una sola richiesta', fakeAsync(() => {
    crea()
    servizio.proposta.calls.reset()
    for (const q of ['121', '122', '123']) {
      fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: q })
      fixture.detectChanges()
      tick(100)
    }
    expect(servizio.proposta).not.toHaveBeenCalled()
    tick(ATTESA_PROPOSTA_MS)
    expect(servizio.proposta).toHaveBeenCalledTimes(1)
    expect(servizio.proposta.calls.mostRecent().args[0].quantity).toBe('123')
  }))

  it('dati identici non rifanno la richiesta', fakeAsync(() => {
    crea()
    servizio.proposta.calls.reset()
    fixture.componentRef.setInput('datiMovimento', { ...DATI })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    expect(servizio.proposta).not.toHaveBeenCalled()
  }))

  it('CONTRATTO_AMBIGUO: menu dei candidati e Conferma disabilitato finché non se ne sceglie uno', fakeAsync(() => {
    const ambigua = proposta({
      contratto: null,
      elenco: null,
      righe: [],
      motivi: ['CONTRATTO_AMBIGUO'],
      candidati: {
        contratti: [
          { id: 'co-1', etichetta: 'Contratto A' },
          { id: 'co-2', etichetta: 'Contratto B' },
        ],
        elenchi: [],
        righe: [],
      },
    })
    crea(of(ambigua))
    const menu = q('fatt-contratto-menu') as HTMLSelectElement
    expect(menu).not.toBeNull()
    expect(menu.options.length).toBe(3)
    expect(confermabile()).toBeFalse()
    expect(testo('fatt-motivi')).toContain('Più contratti possibili')

    servizio.proposta.and.returnValue(
      of(proposta({ contratto: { id: 'co-2', etichetta: 'Contratto B' } }))
    )
    menu.value = 'co-2'
    menu.dispatchEvent(new Event('change'))
    tick()
    fixture.detectChanges()
    expect(servizio.proposta.calls.mostRecent().args[0].scelte).toEqual({ contrattoId: 'co-2' })
    expect(scelte[scelte.length - 1]).toEqual({ contrattoId: 'co-2' })
    expect(confermabile()).toBeTrue()
  }))

  it('legame emesso: azione PROPOSTA con TUTTE le righe; la conferma la decide chi registra', fakeAsync(() => {
    crea()
    expect(ultimo()).toEqual({
      azione: 'PROPOSTA',
      righe: [{ rigaAddebitoId: 'ra-1' }, { rigaAddebitoId: 'ra-2' }],
    })
    expect(stati[stati.length - 1]).toEqual({ visibile: true, confermabile: true })
  }))

  it('ritocco di una sola riga: l’altra resta nel legame, senza valori', fakeAsync(() => {
    crea()
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-2', campo: 'quantita', valore: '2' })
    fixture.detectChanges()
    expect(ultimo()?.righe).toEqual([
      { rigaAddebitoId: 'ra-1' },
      { rigaAddebitoId: 'ra-2', quantita: '2' },
    ])
  }))

  it('sconto svuotato: inviato come null (nessuno sconto)', fakeAsync(() => {
    crea(of(proposta({ righe: [riga({ sconto: '10' })] })))
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'sconto', valore: null })
    fixture.detectChanges()
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1', sconto: null }])
  }))

  it('riga a prezzo speciale: prezzo non modificabile', fakeAsync(() => {
    crea(of(proposta({ righe: [riga({ prezzoSpeciale: true, prezzo: null })] })))
    expect(q('prezzo-speciale-ra-1')).not.toBeNull()
    expect(fixture.nativeElement.querySelector('#prezzo-ra-1')).toBeNull()
    expect(fixture.nativeElement.querySelector('#sconto-ra-1')).toBeNull()
  }))

  it('prezzo scritto a mano: badge «prezzo manuale» e avviso PREZZO_MANUALE', fakeAsync(() => {
    crea()
    expect(q('badge-prezzo-manuale-ra-1')).toBeNull()
    fixture.componentInstance.alModifica({
      rigaAddebitoId: 'ra-1',
      campo: 'prezzo',
      valore: '12.5',
    })
    fixture.detectChanges()
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()
    expect(testo('fatt-avviso-PREZZO_MANUALE')).toContain('Prezzo modificato a mano')
    expect(ultimo()?.righe?.[0]).toEqual({ rigaAddebitoId: 'ra-1', prezzo: '12.5' })
  }))

  it('cambio di contratto con prezzi manuali: avviso, i valori si perdono solo dopo «Cambia comunque»', fakeAsync(() => {
    crea(
      of(
        proposta({
          candidati: {
            contratti: [
              { id: 'co-1', etichetta: 'Contratto 2026' },
              { id: 'co-2', etichetta: 'Contratto B' },
            ],
            elenchi: [],
            righe: [],
          },
        })
      )
    )
    fixture.componentInstance.alModifica({
      rigaAddebitoId: 'ra-1',
      campo: 'prezzo',
      valore: '12.5',
    })
    fixture.detectChanges()
    servizio.proposta.calls.reset()

    const menu = q('fatt-contratto-menu') as HTMLSelectElement
    menu.value = 'co-2'
    menu.dispatchEvent(new Event('change'))
    fixture.detectChanges()
    expect(testo('fatt-cambio-avviso')).toContain('andranno persi')
    expect(servizio.proposta).not.toHaveBeenCalled()
    expect(menu.value).toBe('co-1')

    // annullando, il prezzo manuale resta
    ;(q('fatt-cambio-annulla') as HTMLButtonElement).click()
    fixture.detectChanges()
    expect(q('fatt-cambio-avviso')).toBeNull()
    expect(q('badge-prezzo-manuale-ra-1')).not.toBeNull()

    menu.value = 'co-2'
    menu.dispatchEvent(new Event('change'))
    fixture.detectChanges()
    ;(q('fatt-cambio-conferma') as HTMLButtonElement).click()
    tick()
    fixture.detectChanges()
    expect(servizio.proposta.calls.mostRecent().args[0].scelte).toEqual({ contrattoId: 'co-2' })
    expect(q('badge-prezzo-manuale-ra-1')).toBeNull()
  }))

  it('errore della proposta (500): avviso e nessun blocco `legame`, la registrazione resta possibile', fakeAsync(() => {
    crea(throwError(() => new HttpErrorResponse({ status: 500 })))
    expect(testo('fatt-errore-proposta')).toContain('Puoi registrare il movimento')
    expect(stati[stati.length - 1]?.visibile).toBeTrue()
    expect(confermabile()).toBeFalse()
    expect(ultimo()).toBeNull()
  }))

  it('nuova proposta: le modifiche di righe sparite si scartano', fakeAsync(() => {
    crea()
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-2', campo: 'quantita', valore: '3' })
    servizio.proposta.and.returnValue(of(proposta({ righe: [riga()] })))
    fixture.componentRef.setInput('datiMovimento', { ...DATI, cerCode: '17 04 02' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1' }])
  }))

  it('un altro FIR azzera scelta e ritocchi', fakeAsync(() => {
    crea()
    fixture.componentRef.setInput('datiMovimento', { ...DATI, firId: 'fir-1' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    fixture.componentRef.setInput('scelta', { contrattoId: 'co-9' })
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'prezzo', valore: '9' })
    fixture.componentRef.setInput('datiMovimento', { ...DATI, firId: 'fir-2' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    expect(fixture.componentInstance.scelta).toBeNull()
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1' }, { rigaAddebitoId: 'ra-2' }])
  }))

  it('durante l’attesa il blocco non è confermabile', fakeAsync(() => {
    crea()
    expect(confermabile()).toBeTrue()
    fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: '130' })
    fixture.detectChanges()
    tick(100)
    expect(confermabile()).toBeFalse()
    tick(ATTESA_PROPOSTA_MS)
    expect(confermabile()).toBeTrue()
  }))

  it('durante il debounce il legame emesso è null e il blocco segnala l’attesa', fakeAsync(() => {
    crea()
    const attese: boolean[] = []
    fixture.componentInstance.inAttesaChange.subscribe(a => attese.push(a))
    fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: '130' })
    fixture.detectChanges()
    tick(100)
    expect(ultimo()).toBeNull()
    expect(attese).toEqual([true])
    tick(ATTESA_PROPOSTA_MS)
    expect(ultimo()).not.toBeNull()
    expect(attese).toEqual([true, false])
  }))

  it('SENZA_QUANTITA: scritta la quantità si può confermare e la quantità viaggia', fakeAsync(() => {
    crea(
      of(
        proposta({
          motivi: ['SENZA_QUANTITA'],
          righe: [riga({ quantita: null, importo: null })],
        })
      )
    )
    expect(confermabile()).toBeFalse()
    expect(testo('fatt-motivi')).toContain('Manca la quantità')
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'quantita', valore: '4' })
    fixture.detectChanges()
    expect(q('fatt-motivi')).toBeNull()
    expect(confermabile()).toBeTrue()
    expect(ultimo()).toEqual({
      azione: 'PROPOSTA',
      righe: [{ rigaAddebitoId: 'ra-1', quantita: '4' }],
    })
  }))

  it('SENZA_PREZZO: scritto il prezzo il motivo sparisce, ma un altro motivo resta', fakeAsync(() => {
    crea(
      of(
        proposta({
          motivi: ['SENZA_PREZZO', 'ELENCO_SCADUTO'],
          righe: [riga({ prezzo: null })],
        })
      )
    )
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'prezzo', valore: '3' })
    fixture.detectChanges()
    expect(testo('fatt-motivi')).not.toContain('Manca il prezzo')
    expect(testo('fatt-motivi')).toContain('non è valido')
    expect(confermabile()).toBeFalse()
  }))

  it('un ritocco riportato al valore della proposta non è più un ritocco', fakeAsync(() => {
    crea(of(proposta({ righe: [riga({ sconto: null })] })))
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'sconto', valore: '5' })
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1', sconto: '5' }])
    fixture.componentInstance.alModifica({ rigaAddebitoId: 'ra-1', campo: 'sconto', valore: null })
    fixture.detectChanges()
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1' }])
    expect(q('badge-prezzo-manuale-ra-1')).toBeNull()
    fixture.componentInstance.alModifica({
      rigaAddebitoId: 'ra-1',
      campo: 'prezzo',
      valore: '0.50',
    })
    expect(ultimo()?.righe).toEqual([{ rigaAddebitoId: 'ra-1' }])
  }))

  it('campo in errore, poi proposta non fatturabile: il blocco torna valido', fakeAsync(() => {
    crea()
    const validi: boolean[] = []
    fixture.componentInstance.validoChange.subscribe(v => validi.push(v))
    fixture.componentInstance.alErrori(true)
    expect(validi).toEqual([false])
    servizio.proposta.and.returnValue(of(proposta({ fatturabile: false })))
    fixture.componentRef.setInput('datiMovimento', { ...DATI, causale: 'ALTRA' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    expect(validi).toEqual([false, true])
    expect(q('blocco-fatturazione')).toBeNull()
  }))

  it('campo in errore, poi proposta 500: il blocco torna valido e non manda legame', fakeAsync(() => {
    crea()
    const validi: boolean[] = []
    fixture.componentInstance.validoChange.subscribe(v => validi.push(v))
    fixture.componentInstance.alErrori(true)
    servizio.proposta.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })))
    fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: '9' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    expect(validi[validi.length - 1]).toBeTrue()
    expect(ultimo()).toBeNull()
  }))

  it('proposta senza cliente: menu dei clienti, la scelta va nelle scelte della richiesta', fakeAsync(() => {
    crea(
      of(
        proposta({
          cliente: null,
          dettaglioCliente: 'cliente disattivato',
          contratto: null,
          elenco: null,
          righe: [],
          motivi: ['SENZA_CLIENTE'],
        })
      )
    )
    expect(q('fatt-cliente-menu')).not.toBeNull()
    expect(testo('fatt-cliente')).toContain('cliente disattivato')
    servizio.proposta.and.returnValue(
      of(proposta({ cliente: { id: 'cl-7', etichetta: 'Bianchi Srl', fonte: 'UTENTE' } }))
    )
    fixture.componentInstance.scegliCliente('cl-7')
    tick()
    fixture.detectChanges()
    expect(servizio.proposta.calls.mostRecent().args[0].scelte).toEqual({ clienteId: 'cl-7' })
    expect(ultimo()?.clienteId).toBe('cl-7')
    expect(q('fatt-da-fir')).toBeNull()
  }))

  it('risposta che arriva dopo una modifica: vale solo l’ultima richiesta', fakeAsync(() => {
    const prima = new Subject<PropostaLegame>()
    crea(prima)
    servizio.proposta.and.returnValue(
      of(proposta({ cliente: { id: 'cl-2', etichetta: 'Verdi Spa', fonte: 'FIR' } }))
    )
    fixture.componentRef.setInput('datiMovimento', { ...DATI, quantity: '5' })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    prima.next(proposta())
    fixture.detectChanges()
    expect(testo('fatt-cliente')).toContain('Verdi Spa')
  }))

  describe('ricerca dei clienti', () => {
    const senzaCliente = () =>
      of(
        proposta({
          cliente: null,
          contratto: null,
          elenco: null,
          righe: [],
          motivi: ['SENZA_CLIENTE'],
        })
      )

    it('prima richiesta: clienti attivi, dimensione entro il massimo del backend (100)', fakeAsync(() => {
      crea(senzaCliente())
      const [filtro] = clientiList.calls.mostRecent().args
      expect(filtro).toEqual({ soloAttivi: true, dimensione: 50 })
      expect(filtro.dimensione).toBeLessThanOrEqual(100)
    }))

    it('digitando nel filtro: ricerca sul server con `testo`, una sola richiesta dopo il debounce', fakeAsync(() => {
      crea(senzaCliente())
      clientiList.calls.reset()
      fixture.componentInstance.cercaClienti('bi')
      tick(100)
      fixture.componentInstance.cercaClienti('bian')
      tick(ATTESA_RICERCA_CLIENTI_MS)
      expect(clientiList).toHaveBeenCalledTimes(1)
      expect(clientiList.calls.mostRecent().args[0]).toEqual({
        testo: 'bian',
        soloAttivi: true,
        dimensione: 50,
      })
    }))

    it('ricerca fallita: errore visibile, il blocco resta utilizzabile', fakeAsync(() => {
      crea(senzaCliente())
      clientiList.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })))
      fixture.componentInstance.cercaClienti('x')
      tick(ATTESA_RICERCA_CLIENTI_MS)
      fixture.detectChanges()
      expect(q('fatt-clienti-errore')).not.toBeNull()
      expect(q('blocco-fatturazione')).not.toBeNull()
    }))
  })
})
