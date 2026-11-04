import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ClientiService } from '../clienti/clienti.service'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { RegistroService } from '../registro/registro.service'
import {
  DaCollegareComponent,
  MSG_FATTURAZIONE_NON_ATTIVA,
  MSG_TETTO,
  TETTO_AZIONE_MASSA,
} from './da-collegare.component'
import { ListinoService } from '../listino/listino.service'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { LegamiService } from './legami.service'
import { LegameVista, RigaLista } from './legami.model'

function riga(n: number, extra: Partial<RigaLista> = {}): RigaLista {
  return {
    legameId: `l${n}`,
    movimentoId: `m${n}`,
    stato: 'PROPOSTO',
    dataMovimento: '2026-03-12',
    cerCode: '080318',
    descrizioneMovimento: null,
    quantita: '10',
    unita: 'kg',
    cliente: { id: 'c1', etichetta: 'Rossi Srl' },
    motivi: [],
    avvisi: [],
    versione: 1,
    confermabile: true,
    fatturato: false,
    ...extra,
  }
}

const legameVuoto = {
  id: 'l1',
  stato: 'PROPOSTO',
  righe: [],
  motivi: [],
  avvisi: [],
} as unknown as LegameVista

describe('DaCollegareComponent (DOM)', () => {
  let fixture: ComponentFixture<DaCollegareComponent>
  let servizio: jasmine.SpyObj<LegamiService>
  let fatturazione: jasmine.SpyObj<ImpostazioneFatturazioneService>
  let listaClienti: jasmine.Spy
  let listaContratti: jasmine.Spy
  let leggiCliente: jasmine.Spy

  async function crea(
    ruolo: string,
    righe: RigaLista[],
    totale = righe.length,
    query: Record<string, string> = {}
  ): Promise<void> {
    servizio = jasmine.createSpyObj('LegamiService', [
      'lista',
      'azioni',
      'daMovimento',
      'dettaglio',
      'riammetti',
      'aggiornaContatori',
      'anteprimaAggiornamento',
      'applicaAggiornamento',
    ])
    servizio.lista.and.returnValue(of({ elementi: righe, totale }))
    listaClienti = jasmine
      .createSpy('list')
      .and.returnValue(
        of({ elementi: [{ id: 'c1', ditta: { ragioneSociale: 'Rossi Srl' } }], totale: 1 })
      )
    listaContratti = jasmine.createSpy('list').and.returnValue(of({ elementi: [], totale: 0 }))
    leggiCliente = jasmine
      .createSpy('get')
      .and.callFake((id: string) =>
        of({ id, codice: 'C77', ditta: { ragioneSociale: 'Verdi Spa' } })
      )
    fatturazione = jasmine.createSpyObj('ImpostazioneFatturazioneService', ['leggi'])
    fatturazione.leggi.and.returnValue(
      of({ fatturazioneDa: '2026-01-01', versione: 1, modificatoIl: null })
    )
    await TestBed.configureTestingModule({
      imports: [DaCollegareComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: ImpostazioneFatturazioneService, useValue: fatturazione },
        {
          provide: ClientiService,
          useValue: {
            clienti: { list: listaClienti, get: leggiCliente },
            contratti: { list: listaContratti },
          },
        },
        {
          provide: ListinoService,
          useValue: { elenchi: { delContratto: () => of({ contesto: {}, elenchi: [] }) } },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
        { provide: RegistroService, useValue: { listRegistri: () => of([]) } },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(DaCollegareComponent)
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  const spunta = async (id: string, si = true): Promise<void> => {
    const c = q<HTMLInputElement>(id)!
    c.checked = si
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
  }

  it('usa la classe pagina-lavoro e lascia il posto delle azioni di pagina', async () => {
    await crea('ADMIN', [riga(1)])
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
    expect(q('legami-azioni-pagina')).not.toBeNull()
  })

  it('lista vuota con fatturazione spenta: messaggio «Fatturazione non attiva»', async () => {
    await crea('ADMIN', [])
    fatturazione.leggi.and.returnValue(
      of({ fatturazioneDa: null, versione: 0, modificatoIl: null })
    )
    fixture.componentInstance.carica()
    await stabilizza(fixture)
    expect(q('legami-vuota')?.textContent).toContain(MSG_FATTURAZIONE_NON_ATTIVA)
  })

  it('lista vuota con fatturazione attiva: «Nessun movimento da collegare»', async () => {
    await crea('ADMIN', [])
    expect(q('legami-vuota')?.textContent).toContain('Nessun movimento da collegare')
  })

  it('quantità con la virgola italiana, mai col punto', async () => {
    await crea('OPERATOR', [riga(1, { quantita: '12.5' })])
    const t = document.body.querySelector('[data-testid="riga-m1"]')!.textContent!
    expect(t).toContain('12,5 kg')
    expect(t).not.toContain('12.5')
  })

  it('badge e motivi per riga', async () => {
    await crea('ADMIN', [
      riga(1, { stato: 'MANCANTE', legameId: null, versione: null, motivi: ['SENZA_CONTRATTO'] }),
      riga(2, { stato: 'DA_RIALLINEARE', avvisi: ['CAMBIO_CER_DA_CONFERMARE'] }),
    ])
    expect(q('stato-m1')?.textContent).toContain('Senza legame')
    expect(q('stato-m2')?.textContent).toContain('Da riallineare')
    expect(q('motivi-m1')?.textContent).toContain('Il cliente non ha un contratto')
    expect(q('motivi-m2')?.textContent).toContain('Il codice CER è cambiato')
  })

  it('selezione di 501 righe: azione di massa disabilitata con il messaggio del tetto', async () => {
    await crea('OPERATOR', [riga(1)])
    for (let i = 0; i <= TETTO_AZIONE_MASSA; i++) fixture.componentInstance.seleziona(riga(i), true)
    await stabilizza(fixture)
    expect(bottone('massa-conferma')!.disabled).toBeTrue()
    expect(bottone('massa-escludi')!.disabled).toBeTrue()
    expect(q('massa-tetto')?.textContent).toContain(MSG_TETTO)
    expect(q('massa-tetto')?.textContent).toContain('501')
  })

  it('con 500 righe selezionate le azioni sono attive', async () => {
    await crea('OPERATOR', [riga(1)])
    for (let i = 0; i < TETTO_AZIONE_MASSA; i++) fixture.componentInstance.seleziona(riga(i), true)
    await stabilizza(fixture)
    expect(bottone('massa-conferma')!.disabled).toBeFalse()
    expect(q('massa-tetto')).toBeNull()
  })

  it('escludi senza motivo: pulsante disabilitato; con il motivo parte con ESCLUDI', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    bottone('massa-escludi')!.click()
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeTrue()
    const t = q<HTMLTextAreaElement>('massa-motivo')!
    t.value = '   '
    t.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeTrue()
    t.value = 'Rifiuto di prova'
    t.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeFalse()
    servizio.azioni.and.returnValue(of({ riusciti: 1, falliti: [] }))
    bottone('massa-escludi-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.azioni).toHaveBeenCalledOnceWith({
      azione: 'ESCLUDI',
      elementi: [{ legameId: 'l1', versione: 1 }],
      motivo: 'Rifiuto di prova',
    })
  })

  it('conferma di massa: i MANCANTI vanno per movimento, gli altri con la versione vista', async () => {
    await crea('OPERATOR', [
      riga(1),
      riga(2, { stato: 'MANCANTE', legameId: null, versione: null }),
    ])
    await spunta('seleziona-pagina')
    servizio.azioni.and.returnValue(of({ riusciti: 2, falliti: [] }))
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.azioni).toHaveBeenCalledOnceWith({
      azione: 'CONFERMA',
      elementi: [{ legameId: 'l1', versione: 1 }],
      movimentoIds: ['m2'],
    })
  })

  it('esito di massa: «3 confermati, 1 saltato» con i motivi', async () => {
    await crea('OPERATOR', [riga(1), riga(2)])
    await spunta('seleziona-pagina')
    servizio.azioni.and.returnValue(
      of({
        riusciti: 3,
        falliti: [{ legameId: 'l2', codice: 'LEGAME_INCOMPLETO', messaggio: 'Manca il prezzo' }],
      })
    )
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(q('esito-riepilogo')?.textContent).toContain('3 confermati, 1 saltato')
    expect(q('esito-saltati')?.textContent).toContain('Manca il prezzo')
    expect(q('esito-saltati')?.textContent).toContain('12/03/2026')
  })

  it('409 OPERAZIONE_CONCORRENTE: messaggio «riprova» e selezione conservata', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    servizio.azioni.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'OPERAZIONE_CONCORRENTE', message: 'x' } }))
    )
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(q('legami-errore')?.textContent).toContain('riprova')
    expect(fixture.componentInstance.selezionate()).toBe(1)
  })

  it('VIEWER: nessuna azione, nessuna casella, solo il dettaglio', async () => {
    await crea('VIEWER', [riga(1)])
    expect(q('sel-m1')).toBeNull()
    expect(q('seleziona-pagina')).toBeNull()
    expect(q('barra-massa')).toBeNull()
    expect(q('apri-m1')?.textContent).toContain('Dettaglio')
  })

  it('riammetti dal filtro Esclusi', async () => {
    await crea('OPERATOR', [])
    servizio.lista.and.returnValue(
      of({ elementi: [riga(7, { stato: 'ESCLUSO', versione: 4 })], totale: 1 })
    )
    const c = q<HTMLInputElement>('filtro-esclusi')!
    c.checked = true
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
    const ultima = servizio.lista.calls.mostRecent().args[0]!
    expect(ultima.esclusi).toBeTrue()
    expect(ultima.stati).toEqual(['ESCLUSO'])
    servizio.riammetti.and.returnValue(of(legameVuoto))
    bottone('riammetti-m7')!.click()
    await stabilizza(fixture)
    expect(servizio.riammetti).toHaveBeenCalledOnceWith('l7', 4)
  })

  it('esclusi spento: la query porta esclusi=false', async () => {
    await crea('OPERATOR', [riga(1)])
    expect(servizio.lista.calls.first().args[0]!.esclusi).toBeFalse()
  })

  it('MANCANTE e DA_RIALLINEARE: daMovimento poi dettaglio (candidati); PROPOSTO: solo dettaglio', async () => {
    await crea('OPERATOR', [
      riga(1),
      riga(2, { stato: 'MANCANTE', legameId: null, versione: null, motivi: ['CONTRATTO_AMBIGUO'] }),
      riga(3, { stato: 'DA_RIALLINEARE', legameId: 'l3' }),
    ])
    const conCandidati = {
      ...legameVuoto,
      id: 'l2',
      motivi: ['CONTRATTO_AMBIGUO'],
      candidati: {
        contratti: [
          { id: 'k1', etichetta: 'A' },
          { id: 'k2', etichetta: 'B' },
        ],
        elenchi: [],
        righe: [],
      },
    } as unknown as LegameVista
    servizio.daMovimento.and.returnValue(of(legameVuoto))
    servizio.dettaglio.and.returnValue(of(conCandidati))
    bottone('apri-m2')!.click()
    await stabilizza(fixture)
    expect(servizio.daMovimento).toHaveBeenCalledWith('m2')
    expect(servizio.dettaglio).toHaveBeenCalledWith('l1')
    expect(fixture.componentInstance.aperto()?.candidati?.contratti.length).toBe(2)
    expect(q('legame-contratto')).not.toBeNull()
    fixture.componentInstance.chiudiLegame()
    bottone('apri-m3')!.click()
    await stabilizza(fixture)
    expect(servizio.daMovimento).toHaveBeenCalledWith('m3')
    fixture.componentInstance.chiudiLegame()
    servizio.daMovimento.calls.reset()
    bottone('apri-m1')!.click()
    await stabilizza(fixture)
    expect(servizio.dettaglio).toHaveBeenCalledWith('l1')
    expect(servizio.daMovimento).not.toHaveBeenCalled()
  })

  it('VIEWER: non chiama mai daMovimento; DA_RIALLINEARE si legge con dettaglio, MANCANTE è disattivato', async () => {
    await crea('VIEWER', [
      riga(2, { stato: 'MANCANTE', legameId: null, versione: null }),
      riga(3, { stato: 'DA_RIALLINEARE', legameId: 'l3' }),
    ])
    expect(bottone('apri-m2')!.disabled).toBeTrue()
    expect(q('apri-m2')!.title).toContain('Nessun legame ancora')
    servizio.dettaglio.and.returnValue(of(legameVuoto))
    bottone('apri-m3')!.click()
    await stabilizza(fixture)
    expect(servizio.dettaglio).toHaveBeenCalledWith('l3')
    expect(servizio.daMovimento).not.toHaveBeenCalled()
  })

  it('aprire un MANCANTE e chiudere senza salvare: la lista si rilegge e il contatore si aggiorna', async () => {
    await crea('OPERATOR', [riga(2, { stato: 'MANCANTE', legameId: null, versione: null })])
    servizio.daMovimento.and.returnValue(of(legameVuoto))
    servizio.dettaglio.and.returnValue(of(legameVuoto))
    bottone('apri-m2')!.click()
    await stabilizza(fixture)
    servizio.lista.calls.reset()
    fixture.componentInstance.chiudiLegame()
    expect(servizio.lista).toHaveBeenCalledTimes(1)
    expect(servizio.aggiornaContatori).toHaveBeenCalled()
  })

  it('azione di massa riuscita: il contatore del menu si aggiorna', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    servizio.azioni.and.returnValue(of({ riusciti: 1, falliti: [] }))
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.aggiornaContatori).toHaveBeenCalled()
  })

  it('cambio di un filtro: la selezione si azzera', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    expect(fixture.componentInstance.selezionate()).toBe(1)
    const c = q<HTMLInputElement>('filtro-esclusi')!
    c.checked = true
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
    expect(fixture.componentInstance.selezionate()).toBe(0)
  })

  it('clienti: la prima lettura chiede solo attivi con dimensione entro il limite del backend (100)', async () => {
    await crea('OPERATOR', [riga(1)])
    const arg = listaClienti.calls.first().args[0]
    expect(arg.soloAttivi).toBeTrue()
    expect(arg.dimensione).toBeLessThanOrEqual(100)
    expect('testo' in arg).toBeFalse()
    expect(fixture.componentInstance.opzioniClienti()).toEqual([
      { label: 'Rossi Srl', value: 'c1' },
    ])
  })

  it('clienti: la ricerca digitata va al server con `testo`, dopo l’attesa', async () => {
    await crea('OPERATOR', [riga(1)])
    listaClienti.calls.reset()
    await fakeAsync(async () => {
      fixture.componentInstance.cercaClienti('ros')
      fixture.componentInstance.cercaClienti('rossi')
      tick(100)
      expect(listaClienti).not.toHaveBeenCalled()
      tick(300)
    })()
    expect(listaClienti).toHaveBeenCalledTimes(1)
    expect(listaClienti.calls.mostRecent().args[0]).toEqual({
      testo: 'rossi',
      soloAttivi: true,
      dimensione: 25,
    })
  })

  it('clienti: se la chiamata fallisce compare un errore e il menu resta com’era', async () => {
    await crea('OPERATOR', [riga(1)])
    listaClienti.and.returnValue(throwError(() => ({ status: 400 })))
    await fakeAsync(async () => {
      fixture.componentInstance.cercaClienti('x')
      tick(400)
    })()
    await stabilizza(fixture)
    expect(q('clienti-errore')?.textContent).toContain('Impossibile caricare i clienti')
    expect(fixture.componentInstance.opzioniClienti().length).toBe(1)
  })

  it('daMovimento riesce ma dettaglio fallisce: la lista si rilegge e l’errore resta visibile', async () => {
    await crea('OPERATOR', [riga(2, { stato: 'MANCANTE', legameId: null, versione: null })])
    servizio.daMovimento.and.returnValue(of(legameVuoto))
    servizio.dettaglio.and.returnValue(throwError(() => ({ status: 500 })))
    servizio.lista.calls.reset()
    bottone('apri-m2')!.click()
    await stabilizza(fixture)
    expect(servizio.lista).toHaveBeenCalledTimes(1)
    expect(q('legami-errore')).not.toBeNull()
  })
  it('?clienteId nell’indirizzo applica il filtro cliente alla prima lettura', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    await crea('OPERATOR', [riga(1)], 1, { clienteId: id })
    expect(servizio.lista.calls.first().args[0]!.clienteId).toBe(id)
    expect(fixture.componentInstance.clienteId).toBe(id)
  })

  it('?clienteId non valido si ignora', async () => {
    await crea('OPERATOR', [riga(1)], 1, { clienteId: 'x; DROP' })
    expect(servizio.lista.calls.first().args[0]!.clienteId).toBeUndefined()
  })

  it('?clienteId di un cliente fuori dai primi 25: lo legge per id e il menu ha l’etichetta', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    await crea('OPERATOR', [riga(1)], 1, { clienteId: id })
    expect(leggiCliente).toHaveBeenCalledOnceWith(id)
    expect(fixture.componentInstance.opzioniClienti()[0]).toEqual({
      label: 'C77 · Verdi Spa',
      value: id,
    })
  })

  it('?clienteId già fra i clienti caricati: nessuna lettura per id', async () => {
    await crea('OPERATOR', [riga(1)], 1, { clienteId: 'c1' })
    expect(leggiCliente).not.toHaveBeenCalled()
  })

  it('?contrattoId valido va come filtro contrattoId; non valido si ignora', async () => {
    const id = '22222222-2222-4222-8222-222222222222'
    await crea('OPERATOR', [riga(1)], 1, { contrattoId: id })
    expect(servizio.lista.calls.first().args[0]!.contrattoId).toBe(id)
    expect(q('filtro-contratto')).not.toBeNull()
    bottone('filtro-contratto-togli')!.click()
    await stabilizza(fixture)
    expect(servizio.lista.calls.mostRecent().args[0]!.contrattoId).toBeUndefined()
    fixture.destroy()
    TestBed.resetTestingModule()
    await crea('OPERATOR', [riga(1)], 1, { contrattoId: 'x' })
    expect(servizio.lista.calls.first().args[0]!.contrattoId).toBeUndefined()
  })

  it('carica(): una nuova lettura annulla la richiesta precedente', async () => {
    await crea('OPERATOR', [riga(1)])
    const lenta = new Subject<{ elementi: RigaLista[]; totale: number }>()
    const veloce = new Subject<{ elementi: RigaLista[]; totale: number }>()
    servizio.lista.and.returnValues(lenta, veloce)
    fixture.componentInstance.carica()
    fixture.componentInstance.carica()
    veloce.next({ elementi: [riga(2)], totale: 1 })
    lenta.next({ elementi: [riga(9)], totale: 1 })
    expect(lenta.observed).toBeFalse()
    expect(fixture.componentInstance.righe().map(r => r.movimentoId)).toEqual(['m2'])
  })

  it('riga saltata su un’altra pagina: l’esito la descrive con data e CER, non «Movimento»', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    servizio.azioni.and.returnValue(
      of({
        riusciti: 0,
        falliti: [{ legameId: 'l1', codice: 'LEGAME_INCOMPLETO', messaggio: 'Manca il prezzo' }],
      })
    )
    // Dopo l'azione la lista mostra altre righe: quella saltata non c'è più nella pagina.
    servizio.lista.and.returnValue(of({ elementi: [riga(7)], totale: 60 }))
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    const t = q('esito-saltati')?.textContent ?? ''
    expect(t).toContain('12/03/2026')
    expect(t).toContain('CER 080318')
    expect(t).not.toContain('Movimento')
  })

  it('chiudere l’esito svuota le righe tenute da parte', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    servizio.azioni.and.returnValue(
      of({ riusciti: 0, falliti: [{ legameId: 'l1', codice: 'X', messaggio: 'no' }] })
    )
    servizio.lista.and.returnValue(of({ elementi: [riga(7)], totale: 60 }))
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    bottone('esito-chiudi')!.click()
    await stabilizza(fixture)
    expect(
      fixture.componentInstance.descrizioneFallito({ legameId: 'l1', codice: 'X', messaggio: 'no' })
    ).toBe('Movimento')
  })

  it('«Riallinea» dal dialog: alla chiusura la lista si rilegge', async () => {
    await crea('OPERATOR', [riga(1)])
    fixture.componentInstance.segnaRiallineato()
    servizio.lista.calls.reset()
    fixture.componentInstance.chiudiLegame()
    expect(servizio.lista).toHaveBeenCalledTimes(1)
  })

  describe('Aggiorna prezzi', () => {
    it('solo ADMIN e SUPER_ADMIN vedono il pulsante', async () => {
      for (const ruolo of ['ADMIN', 'SUPER_ADMIN']) {
        await crea(ruolo, [riga(1)])
        expect(q('aggiorna-prezzi-apri')).withContext(ruolo).not.toBeNull()
        fixture.destroy()
        TestBed.resetTestingModule()
      }
      for (const ruolo of ['OPERATOR', 'VIEWER']) {
        await crea(ruolo, [riga(1)])
        expect(q('aggiorna-prezzi-apri')).withContext(ruolo).toBeNull()
        fixture.destroy()
        TestBed.resetTestingModule()
      }
    })

    it('il pulsante apre la finestra; dopo l’applica rilegge la lista e il contatore del menu', async () => {
      await crea('ADMIN', [riga(1)])
      bottone('aggiorna-prezzi-apri')!.click()
      await stabilizza(fixture)
      expect(q('aggiorna-prezzi-dialog')).not.toBeNull()
      servizio.lista.calls.reset()
      servizio.aggiornaContatori.calls.reset()
      fixture.componentInstance.dopoAggiornaPrezzi({ aggiornati: 12, saltati: 3, daCollegare: 1 })
      await stabilizza(fixture)
      expect(servizio.lista).toHaveBeenCalled()
      expect(servizio.aggiornaContatori).toHaveBeenCalled()
      expect(fixture.componentInstance.aggiornaPrezziAperta()).toBeFalse()
    })
  })
})
