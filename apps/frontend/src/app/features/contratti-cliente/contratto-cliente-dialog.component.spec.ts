import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import {
  Agente,
  Cliente,
  CodificaContratto,
  ContrattoCliente,
  PeriodoFatturazione,
} from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { RegistryService } from '../registry/registry.service'
import { ContrattoClienteDialogComponent } from './contratto-cliente-dialog.component'
import { SezionePagamentoComponent } from './sezione-pagamento.component'

const sede = (id: string, over: Partial<SedeDitta> = {}): SedeDitta => ({
  id,
  denominazione: null,
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  citta: 'Roma',
  provincia: 'RM',
  referente: null,
  email: null,
  telefono: null,
  pec: null,
  principale: false,
  attiva: true,
  ...over,
})

const DITTA: Ditta = {
  id: 'd1',
  ragioneSociale: 'Verdi Servizi S.r.l.',
  partitaIva: '12345678903',
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [
    sede('s1', { principale: true }),
    sede('s2', { via: 'Via Milano', citta: 'Milano', provincia: 'MI' }),
    sede('s3', { via: 'Via Chiusa', attiva: false }),
  ],
  ruoli: {},
}

const rif = (id: string, codice: string | null, descrizione: string) => ({
  id,
  codice,
  descrizione,
})

const COND = { id: 'c1', codice: '30FM', descrizione: '30 gg fine mese', attiva: true }
const CONTO = {
  id: 'k1',
  codice: 'BP',
  descrizione: 'Banca Popolare',
  ibanMascherato: 'IT60 **** 3456',
}
const SPESA_INC = {
  id: 'p1',
  tipo: 'INCASSO',
  codice: 'INC',
  descrizione: 'Incasso',
  importo: '2.00',
}
const SPESA_BOLLO = {
  id: 'b1',
  tipo: 'BOLLO',
  codice: 'BOL',
  descrizione: 'Bollo',
  importo: '2.00',
}
const REG = { id: 'r1', codice: 'V1', descrizione: 'Vendite', ricevuteSplit: false }
const TESTO = {
  id: 't1',
  codice: 'TF1',
  titolo: 'Testo standard',
  righe: ['Prima riga del testo', 'Seconda riga'],
  attivo: true,
}
const codifica = (id: string, codice: string, descrizione: string, genere = 'CATEGORIA') =>
  ({ id, codice, descrizione, genere, attiva: true }) as CodificaContratto

/** Cliente come lo restituisce l'elenco: con i suoi predefiniti (D4). */
const cliente = (id: string, ragione: string, over: Partial<Cliente> = {}): Cliente =>
  ({
    id,
    versione: 1,
    attivo: true,
    codice: null,
    codiceDestinatario: 'ABCDEFG',
    pecFatturazione: null,
    riferimentoAmministrazione: 'RIF1',
    iban: null,
    contoCorrenteId: 'k1',
    condizionePagamentoId: 'c1',
    esigibilitaIva: 'SCISSIONE',
    registroIvaId: 'r1',
    speseIncassoId: 'p1',
    bolloId: 'b1',
    agenteId: 'a1',
    ritenutaPercentuale: '10.00',
    ditta: {
      id: 'd-' + id,
      ragioneSociale: ragione,
      partitaIva: '12345678903',
      codiceFiscale: null,
      privato: false,
    },
    sedeFatturazione: sede('s1'),
    condizionePagamento: rif('c1', '30FM', '30 gg fine mese'),
    contoCorrente: rif('k1', 'BP', 'Banca Popolare'),
    registroIva: rif('r1', 'V1', 'Vendite'),
    speseIncasso: rif('p1', 'INC', 'Incasso'),
    bollo: rif('b1', 'BOL', 'Bollo'),
    agente: rif('a1', 'AG1', 'Rossi Provvigioni'),
    contratti: 0,
    eliminabile: true,
    ...over,
  }) as Cliente

const VERDI = cliente('cl1', 'Verdi Servizi S.r.l.')
const BIANCHI = cliente('cl2', 'Bianchi Srl', {
  codiceDestinatario: 'ZZZZZZZ',
  riferimentoAmministrazione: 'RIF-B',
  condizionePagamentoId: null,
  condizionePagamento: null,
  contoCorrenteId: null,
  contoCorrente: null,
})

const agenteNuovo: Agente = {
  id: 'a9',
  versione: 1,
  attivo: true,
  codice: null,
  note: null,
  ditta: { id: 'd9', ragioneSociale: 'Nuovo Agente', partitaIva: null, codiceFiscale: null },
  sede: sede('s9'),
  clienti: 0,
  contratti: 0,
  eliminabile: true,
}

const PERIODI: PeriodoFatturazione[] = [
  { giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 },
  { giornoInizio: 1, meseInizio: 7, giornoFine: 31, meseFine: 12 },
]

const TUTTI = [
  'numero',
  'descrizione',
  'clienteId',
  'clienteFatturazioneId',
  'sedeId',
  'categoriaId',
  'tipoId',
  'dataInizio',
  'dataFine',
  'dataStipula',
  'validitaQuantita',
  'validitaUnita',
  'condizionePagamentoId',
  'contoCorrenteId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'agenteId',
  'testoFatturazioneId',
  'codiceDestinatario',
  'riferimentoAmministrazione',
  'periodi',
] as const

const contratto = (over: Partial<ContrattoCliente> = {}): ContrattoCliente =>
  ({
    id: 'ct1',
    stato: 'BOZZA',
    versione: 3,
    numero: 'CC-2026-001',
    descrizione: 'Raccolta rifiuti 2026',
    clienteId: 'cl1',
    clienteFatturazioneId: null,
    sedeId: 's1',
    categoriaId: 'cat1',
    tipoId: null,
    dataInizio: '2026-01-01',
    dataFine: '2026-12-31',
    dataStipula: null,
    validitaQuantita: 12,
    validitaUnita: 'M',
    contrattoPrincipaleId: null,
    condizionePagamentoId: 'c1',
    contoCorrenteId: null,
    speseIncassoId: null,
    bolloId: null,
    registroIvaId: 'r1',
    esigibilitaIva: 'IMMEDIATA',
    ritenutaPercentuale: '10.00',
    agenteId: null,
    testoFatturazioneId: 't1',
    codiceDestinatario: 'ABCDEFG',
    riferimentoAmministrazione: null,
    periodi: PERIODI,
    cliente: {
      id: 'cl1',
      ragioneSociale: 'Verdi Servizi S.r.l.',
      partitaIva: '12345678903',
      attivo: true,
    },
    clienteFatturazione: null,
    sede: { id: 's1', descrizione: 'Via Roma 1, Roma (RM)' },
    categoria: rif('cat1', '001', 'Rifiuti urbani'),
    tipo: null,
    condizionePagamento: rif('c1', '30FM', '30 gg fine mese'),
    contoCorrente: null,
    speseIncasso: null,
    bollo: null,
    registroIva: rif('r1', 'V1', 'Vendite'),
    agente: null,
    testoFatturazione: rif('t1', 'TF1', 'Testo standard'),
    contoCorrenteEffettivo: rif('k1', 'BP', 'Banca Popolare'),
    modificabili: [...TUTTI],
    transizioni: ['ATTIVO'],
    eliminabile: true,
    rinnovabile: false,
    ...over,
  }) as unknown as ContrattoCliente

describe('ContrattoClienteDialogComponent', () => {
  let fixture: ComponentFixture<ContrattoClienteDialogComponent>
  let contratti: Record<'get' | 'crea' | 'modifica' | 'prossimoNumero', jasmine.Spy>
  let clientiRuolo: { list: jasmine.Spy; get: jasmine.Spy }
  let agenti: { list: jasmine.Spy }
  let codifiche: { list: jasmine.Spy }
  let registry: jasmine.SpyObj<RegistryService>
  let salvati: ContrattoCliente[]
  let visibilita: boolean[]

  async function apri(c: ContrattoCliente | null = null) {
    fixture = TestBed.createComponent(ContrattoClienteDialogComponent)
    salvati = []
    visibilita = []
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentRef.setInput('contratto', c)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  /** Apre il dialog in modifica: la lettura restituisce `c`. */
  const apriCon = (c: ContrattoCliente) => {
    contratti.get.and.returnValue(of(c))
    return apri(c)
  }
  const valore = (id: string) => q<HTMLInputElement | HTMLSelectElement>(id)!.value
  function scegli(id: string, v: string) {
    const sel = q<HTMLSelectElement>(id)!
    sel.value = v
    sel.dispatchEvent(new Event('change'))
  }
  const sub = (selettore: string, dentro = 'app-sezione-pagamento') =>
    fixture.debugElement
      .query(e => e.name === dentro)
      .queryAll(e => e.name === selettore)
      .map(e => e.componentInstance)
  const scelta = (nome: string) =>
    fixture.debugElement.query(
      e => e.name === 'app-scelta-cliente' && e.componentInstance.prefisso === nome
    ).componentInstance
  /** L'operatore cerca e sceglie un cliente dall'autocomplete. */
  async function scegliCliente(prefisso: string, c: Cliente) {
    const s = scelta(prefisso)
    s.cerca({ query: c.ditta.ragioneSociale })
    s.seleziona(s.suggerimenti().find((o: { id: string }) => o.id === c.id))
    await stabilizza(fixture)
  }
  const form = () => fixture.componentInstance.form
  const ruolo = (role: string) =>
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })

  beforeEach(() => {
    contratti = {
      get: jasmine.createSpy('get').and.returnValue(of(contratto())),
      crea: jasmine.createSpy('crea'),
      modifica: jasmine.createSpy('modifica'),
      prossimoNumero: jasmine.createSpy('prossimoNumero').and.returnValue(of('CC-2026-007')),
    }
    clientiRuolo = {
      list: jasmine
        .createSpy('listClienti')
        .and.returnValue(of({ elementi: [VERDI, BIANCHI], totale: 2 })),
      get: jasmine.createSpy('getCliente').and.returnValue(of(VERDI)),
    }
    agenti = { list: jasmine.createSpy('list').and.returnValue(of({ elementi: [], totale: 0 })) }
    codifiche = {
      list: jasmine
        .createSpy('codifiche')
        .and.callFake((genere: string) =>
          of(
            genere === 'CATEGORIA'
              ? [codifica('cat1', '001', 'Rifiuti urbani'), codifica('cat2', '002', 'Speciali')]
              : [codifica('tip1', '001', 'Annuale', 'TIPO')]
          )
        ),
    }
    const tab = {
      condizioni: { list: jasmine.createSpy('c').and.returnValue(of([COND])) },
      conti: { list: jasmine.createSpy('k').and.returnValue(of([CONTO])) },
      spese: {
        list: jasmine
          .createSpy('s')
          .and.callFake((f: { tipo: string }) =>
            of(f.tipo === 'BOLLO' ? [SPESA_BOLLO] : [SPESA_INC])
          ),
      },
      registri: { list: jasmine.createSpy('r').and.returnValue(of([REG])) },
      testi: { list: jasmine.createSpy('t').and.returnValue(of([TESTO])) },
      codifiche,
    }
    registry = jasmine.createSpyObj('RegistryService', ['cercaDitta', 'getDitta'])
    registry.getDitta.and.returnValue(of(DITTA))
    TestBed.configureTestingModule({
      imports: [ContrattoClienteDialogComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        {
          provide: ClientiService,
          useValue: { contratti, clienti: clientiRuolo, agenti },
        },
        { provide: TabelleFatturazioneService, useValue: tab },
        { provide: RegistryService, useValue: registry },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('dati generali', () => {
    it('nuovo: numero proposto da prossimoNumero e stato Bozza', async () => {
      await apri()
      expect(valore('contratto-dlg-numero')).toBe('CC-2026-007')
      expect(q('contratto-dlg-stato')!.textContent).toContain('Bozza')
    })

    it('il numero proposto non sovrascrive quello già digitato', async () => {
      const risposta = new Subject<string>()
      contratti.prossimoNumero.and.returnValue(risposta)
      await apri()
      scrivi('contratto-dlg-numero', 'MIO-1')
      risposta.next('CC-2026-007')
      await stabilizza(fixture)
      expect(valore('contratto-dlg-numero')).toBe('MIO-1')
    })

    it('cliente: autocomplete con testo e soloAttivi', async () => {
      await apri()
      const s = scelta('contratto-dlg-cliente')
      s.cerca({ query: ' verdi ' })
      expect(clientiRuolo.list).toHaveBeenCalledWith({
        pagina: 1,
        dimensione: 20,
        soloAttivi: true,
        testo: 'verdi',
      })
      expect(s.suggerimenti().map((o: { etichetta: string }) => o.etichetta)).toEqual([
        'Verdi Servizi S.r.l. (12345678903)',
        'Bianchi Srl (12345678903)',
      ])
    })

    it('"Nuovo cliente" apre app-cliente-dialog e il cliente salvato finisce nel campo', async () => {
      await apri()
      bottone('contratto-dlg-nuovo-cliente')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-cliente-dialog', 'app-sezione-dati-generali')[0]
      expect(dlg.visible).toBeTrue()
      dlg.salvato.emit(BIANCHI)
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(form().controls.clienteId.value).toBe('cl2')
      expect(scelta('contratto-dlg-cliente').modello.etichetta).toContain('Bianchi Srl')
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(bottone('contratto-dlg-nuovo-cliente'))
    })

    it('cliente di fatturazione: stesso autocomplete, escluso il cliente del contratto', async () => {
      await apri()
      await scegliCliente('contratto-dlg-cliente', VERDI)
      const f = scelta('contratto-dlg-fatturazione')
      f.cerca({ query: '' })
      expect(f.suggerimenti().map((o: { id: string }) => o.id)).toEqual(['cl2'])
      f.seleziona(f.suggerimenti()[0])
      await stabilizza(fixture)
      expect(form().controls.clienteFatturazioneId.value).toBe('cl2')
    })

    it('"Nuovo cliente" accanto alla fatturazione porta il cliente nel suo campo', async () => {
      await apri()
      bottone('contratto-dlg-nuovo-fatturazione')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-cliente-dialog', 'app-sezione-dati-generali')[0]
      dlg.salvato.emit(BIANCHI)
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(form().controls.clienteFatturazioneId.value).toBe('cl2')
      expect(form().controls.clienteId.value).toBe('')
    })

    it('sede di servizio: solo le sedi attive della ditta del cliente', async () => {
      await apri()
      expect(registry.getDitta).not.toHaveBeenCalled()
      await scegliCliente('contratto-dlg-cliente', VERDI)
      expect(registry.getDitta).toHaveBeenCalledWith('d-cl1')
      const testi = Array.from(q<HTMLSelectElement>('contratto-dlg-sede')!.options).map(o =>
        o.text.trim()
      )
      expect(testi).toEqual(['—', 'Via Roma 1, Roma (RM)', 'Via Milano 1, Milano (MI)'])
    })

    it('cambiando cliente la sede scelta si svuota', async () => {
      await apri()
      await scegliCliente('contratto-dlg-cliente', VERDI)
      scegli('contratto-dlg-sede', 's2')
      await scegliCliente('contratto-dlg-cliente', BIANCHI)
      expect(form().controls.sedeId.value).toBe('')
    })

    it('categoria e tipo: "Nuova" in modalità rapida, la voce salvata finisce nel campo', async () => {
      await apri()
      for (const [bt, genere, nuova, campo, ctrl] of [
        [
          'contratto-dlg-nuova-categoria',
          'CATEGORIA',
          codifica('cat9', '003', 'Nuova cat'),
          'categoriaId',
          0,
        ],
        [
          'contratto-dlg-nuovo-tipo',
          'TIPO',
          codifica('tip9', '002', 'Nuovo tipo', 'TIPO'),
          'tipoId',
          1,
        ],
      ] as const) {
        expect(bottone(bt)!.textContent).toContain(
          bt.includes('categoria') ? 'Nuova categoria' : 'Nuovo tipo'
        )
        bottone(bt)!.click()
        await stabilizza(fixture)
        const dlg = sub('app-codifica-dialog', 'app-sezione-dati-generali')[ctrl]
        expect(dlg.visible).toBeTrue()
        expect(dlg.genere).toBe(genere)
        expect(dlg.rapida).toBeTrue()
        dlg.salvato.emit(nuova)
        dlg.visibleChange.emit(false)
        await stabilizza(fixture)
        expect(form().controls[campo].value).toBe(nuova.id)
        await new Promise(r => setTimeout(r))
        expect(document.activeElement).toBe(bottone(bt))
      }
    })

    it('categoria e tipo: Esc nel sub-dialog non chiude il contratto', async () => {
      await apri()
      scrivi('contratto-dlg-descrizione', 'in corso')
      bottone('contratto-dlg-nuova-categoria')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
      expect(form().controls.descrizione.value).toBe('in corso')
      sub('app-codifica-dialog', 'app-sezione-dati-generali')[0].visibleChange.emit(false)
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([false])
    })

    it('Esc nel dialog del cliente aperto in linea non chiude il contratto', async () => {
      await apri()
      bottone('contratto-dlg-nuovo-cliente')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
    })

    it("date come YYYY-MM-DD, validità: l'indicatore compare se manca la metà", async () => {
      await apri()
      expect(q('contratto-dlg-validita-avviso')).toBeNull()
      scrivi('contratto-dlg-validita-quantita', '12')
      await stabilizza(fixture)
      expect(q('contratto-dlg-validita-avviso')).toBeTruthy()
      scegli('contratto-dlg-validita-unita', 'M')
      await stabilizza(fixture)
      expect(q('contratto-dlg-validita-avviso')).toBeNull()
      scrivi('contratto-dlg-data-inizio', '2026-03-01')
      expect(form().controls.dataInizio.value).toBe('2026-03-01')
    })
  })

  describe('pagamento e fatturazione', () => {
    it('scelto il cliente, i predefiniti si precompilano dai suoi valori (D4)', async () => {
      await apri()
      await scegliCliente('contratto-dlg-cliente', VERDI)
      expect(valore('contratto-dlg-condizione')).toBe('c1')
      expect(valore('contratto-dlg-spese')).toBe('p1')
      expect(valore('contratto-dlg-bollo')).toBe('b1')
      expect(valore('contratto-dlg-registro')).toBe('r1')
      expect(valore('contratto-dlg-esigibilita')).toBe('SCISSIONE')
      expect(valore('contratto-dlg-ritenuta')).toBe('10.00')
      expect(valore('contratto-dlg-codice-dest')).toBe('ABCDEFG')
      expect(valore('contratto-dlg-rif-amm')).toBe('RIF1')
      expect(form().controls.agenteId.value).toBe('a1')
    })

    it("un campo toccato dall'operatore non si sovrascrive", async () => {
      await apri()
      scegli('contratto-dlg-registro', '')
      scrivi('contratto-dlg-ritenuta', '4')
      await scegliCliente('contratto-dlg-cliente', VERDI)
      expect(valore('contratto-dlg-registro')).toBe('')
      expect(valore('contratto-dlg-ritenuta')).toBe('4')
      expect(valore('contratto-dlg-condizione')).toBe('c1')
    })

    it('R35: con un cliente di fatturazione codice e riferimento SDI vengono da lui', async () => {
      await apri()
      await scegliCliente('contratto-dlg-cliente', VERDI)
      await scegliCliente('contratto-dlg-fatturazione', BIANCHI)
      expect(valore('contratto-dlg-codice-dest')).toBe('ZZZZZZZ')
      expect(valore('contratto-dlg-rif-amm')).toBe('RIF-B')
      expect(valore('contratto-dlg-condizione')).toBe('c1')
    })

    it('il conto resta vuoto e mostra "dal cliente: <descrizione>"', async () => {
      await apri()
      expect(q<HTMLSelectElement>('contratto-dlg-conto')!.options[0].text).toBe('—')
      await scegliCliente('contratto-dlg-cliente', VERDI)
      expect(valore('contratto-dlg-conto')).toBe('')
      expect(q<HTMLSelectElement>('contratto-dlg-conto')!.options[0].text).toBe(
        'dal cliente: Banca Popolare'
      )
    })

    it('testo di fatturazione: le righe compaiono sotto il campo', async () => {
      await apri()
      expect(q('contratto-dlg-testo-righe')).toBeNull()
      scegli('contratto-dlg-testo', 't1')
      await stabilizza(fixture)
      expect(q('contratto-dlg-testo-righe')!.textContent).toContain('Prima riga del testo')
      expect(q('contratto-dlg-testo-righe')!.textContent).toContain('Seconda riga')
    })

    const casi = [
      {
        nome: 'condizione',
        bottone: 'contratto-dlg-nuova-condizione',
        etichetta: 'Nuova condizione',
        selettore: 'app-condizione-pagamento-dialog',
        indice: 0,
        campo: 'contratto-dlg-condizione',
        nuovo: { ...COND, id: 'cN', codice: 'NUOVA' },
      },
      {
        nome: 'conto',
        bottone: 'contratto-dlg-nuovo-conto',
        etichetta: 'Nuovo conto',
        selettore: 'app-conto-corrente-dialog',
        indice: 0,
        campo: 'contratto-dlg-conto',
        nuovo: { ...CONTO, id: 'kN', codice: 'NUOVO' },
      },
      {
        nome: 'spese di incasso',
        bottone: 'contratto-dlg-nuove-spese',
        etichetta: 'Nuova spesa di incasso',
        selettore: 'app-spesa-accessoria-dialog',
        indice: 0,
        tipo: 'INCASSO',
        campo: 'contratto-dlg-spese',
        nuovo: { ...SPESA_INC, id: 'pN', codice: 'NUOVA' },
      },
      {
        nome: 'bollo',
        bottone: 'contratto-dlg-nuovo-bollo',
        etichetta: 'Nuovo bollo',
        selettore: 'app-spesa-accessoria-dialog',
        indice: 1,
        tipo: 'BOLLO',
        campo: 'contratto-dlg-bollo',
        nuovo: { ...SPESA_BOLLO, id: 'bN', codice: 'NUOVO' },
      },
      {
        nome: 'registro',
        bottone: 'contratto-dlg-nuovo-registro',
        etichetta: 'Nuovo registro',
        selettore: 'app-registro-iva-dialog',
        indice: 0,
        campo: 'contratto-dlg-registro',
        nuovo: { ...REG, id: 'rN', codice: 'NUOVO' },
      },
      {
        nome: 'testo di fatturazione',
        bottone: 'contratto-dlg-nuovo-testo',
        etichetta: 'Nuovo testo',
        selettore: 'app-testo-fatturazione-dialog',
        indice: 0,
        campo: 'contratto-dlg-testo',
        nuovo: { ...TESTO, id: 'tN', codice: 'NUOVO' },
      },
    ]
    for (const c of casi) {
      describe(`aggiunta in linea: ${c.nome}`, () => {
        it(`"${c.etichetta}" apre il sub-dialog e la voce salvata finisce nel campo`, async () => {
          await apri()
          expect(bottone(c.bottone)!.textContent).toContain(c.etichetta)
          expect(sub(c.selettore)[c.indice].visible).toBeFalse()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          const dlg = sub(c.selettore)[c.indice]
          expect(dlg.visible).toBeTrue()
          if (c.tipo) expect(dlg.tipo).toBe(c.tipo)
          dlg.salvato.emit(c.nuovo)
          dlg.visibleChange.emit(false)
          await stabilizza(fixture)
          expect(valore(c.campo)).toBe(c.nuovo.id)
          expect(sub(c.selettore)[c.indice].visible).toBeFalse()
        })

        it('Esc nel sub-dialog non chiude il contratto e non perde il form', async () => {
          await apri()
          scrivi('contratto-dlg-descrizione', 'in corso')
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([])
          expect(form().controls.descrizione.value).toBe('in corso')
          sub(c.selettore)[c.indice].visibleChange.emit(false)
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([false])
        })

        it(`chiuso il sub-dialog, il focus torna al pulsante "${c.etichetta}"`, async () => {
          await apri()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          sub(c.selettore)[c.indice].visibleChange.emit(false)
          await stabilizza(fixture)
          await new Promise(r => setTimeout(r))
          expect(document.activeElement).toBe(bottone(c.bottone))
        })
      })
    }

    it('agente: "Nuovo agente" apre il dialog e la scelta finisce nel campo', async () => {
      await apri()
      bottone('contratto-dlg-nuovo-agente')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-agente-dialog')[0]
      expect(dlg.visible).toBeTrue()
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
      dlg.salvato.emit(agenteNuovo)
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(form().controls.agenteId.value).toBe('a9')
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(bottone('contratto-dlg-nuovo-agente'))
    })

    it('un registro delle ricevute split creato in linea non viene scelto', async () => {
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri()
      bottone('contratto-dlg-nuovo-registro')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-registro-iva-dialog')[0]
      dlg.salvato.emit({ ...REG, id: 'rS', ricevuteSplit: true })
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(valore('contratto-dlg-registro')).toBe('')
      expect(spia).toHaveBeenCalled()
    })
  })

  describe('Nuovo cliente in linea', () => {
    for (const [nome, bt, campo] of [
      ['cliente', 'contratto-dlg-nuovo-cliente', 'clienteId'],
      ['cliente di fatturazione', 'contratto-dlg-nuovo-fatturazione', 'clienteFatturazioneId'],
    ] as const) {
      it(`${nome}: Esc chiude solo il sub-dialog, poi il focus torna a "Nuovo cliente"`, async () => {
        await apri()
        scrivi('contratto-dlg-descrizione', 'in corso')
        bottone(bt)!.click()
        await stabilizza(fixture)
        fixture.componentInstance.alCambioVisibilita(false)
        expect(visibilita).toEqual([])
        expect(form().controls.descrizione.value).toBe('in corso')
        const dlg = sub('app-cliente-dialog', 'app-sezione-dati-generali')[0]
        dlg.visibleChange.emit(false)
        await stabilizza(fixture)
        await new Promise(r => setTimeout(r))
        expect(document.activeElement).toBe(bottone(bt))
        expect(form().controls[campo].value).toBe('')
        fixture.componentInstance.alCambioVisibilita(false)
        expect(visibilita).toEqual([false])
      })
    }
  })

  describe('periodi', () => {
    it('i periodi del contratto compaiono e una modifica finisce nel form', async () => {
      await apri(contratto())
      expect(valore('periodi-gf-0')).toBe('30')
      bottone('periodi-aggiungi')!.click()
      await stabilizza(fixture)
      expect(form().controls.periodi.value.length).toBe(3)
    })
  })

  describe('periodi digitati nel dialog', () => {
    it('si digitano due cifre senza perdere il focus; il valore entra alla conferma', async () => {
      await apri(contratto())
      const campo = q<HTMLInputElement>('periodi-gf-0')!
      campo.focus()
      campo.value = '1'
      campo.dispatchEvent(new Event('input', { bubbles: true }))
      await stabilizza(fixture)
      campo.value = '15'
      campo.dispatchEvent(new Event('input', { bubbles: true }))
      await stabilizza(fixture)
      expect(form().controls.periodi.value[0].giornoFine).toBe(30)
      expect(q('periodi-gf-0')).toBe(campo)
      expect(document.activeElement).toBe(campo)
      campo.dispatchEvent(new Event('change', { bubbles: true }))
      await stabilizza(fixture)
      expect(form().controls.periodi.value[0].giornoFine).toBe(15)
      expect(q('periodi-gf-0')).toBe(campo)
      expect(campo.value).toBe('15')
    })

    it('un campo svuotato resta vuoto finché non si conferma', async () => {
      await apri(contratto())
      const campo = q<HTMLInputElement>('periodi-gf-0')!
      campo.value = ''
      campo.dispatchEvent(new Event('input', { bubbles: true }))
      await stabilizza(fixture)
      expect(q<HTMLInputElement>('periodi-gf-0')!.value).toBe('')
      expect(form().controls.periodi.value[0].giornoFine).toBe(30)
    })
  })

  describe('letture del cliente e durata', () => {
    it('la lettura in ritardo del cliente precedente non riporta la sua ditta', async () => {
      const tardiva = new Subject<Cliente>()
      clientiRuolo.get.and.returnValue(tardiva)
      await apriCon(contratto())
      await scegliCliente('contratto-dlg-cliente', BIANCHI)
      expect(fixture.componentInstance.dittaId()).toBe('d-cl2')
      tardiva.next(VERDI)
      await stabilizza(fixture)
      expect(fixture.componentInstance.dittaId()).toBe('d-cl2')
      expect(registry.getDitta.calls.mostRecent().args[0]).toBe('d-cl2')
    })

    for (const durata of ['2x', 'abc', '1,5']) {
      it(`durata non numerica "${durata}": non salva e lo dice`, async () => {
        await apri()
        await scegliCliente('contratto-dlg-cliente', VERDI)
        scrivi('contratto-dlg-validita-quantita', durata)
        await stabilizza(fixture)
        fixture.componentInstance.salva()
        await stabilizza(fixture)
        expect(contratti.crea).not.toHaveBeenCalled()
        expect(q('contratto-dlg-errore')!.textContent).toContain(
          'La durata della validità deve essere un numero intero.'
        )
      })
    }
  })

  describe('modifica', () => {
    it('legge il contratto e precompila il form (date come YYYY-MM-DD)', async () => {
      await apri(contratto())
      expect(contratti.get).toHaveBeenCalledOnceWith('ct1')
      expect(valore('contratto-dlg-numero')).toBe('CC-2026-001')
      expect(valore('contratto-dlg-data-inizio')).toBe('2026-01-01')
      expect(valore('contratto-dlg-condizione')).toBe('c1')
      expect(scelta('contratto-dlg-cliente').modello.etichetta).toContain('Verdi Servizi')
      expect(contratti.prossimoNumero).not.toHaveBeenCalled()
    })

    it('Salva è disattivato finché la lettura non ha avuto successo', async () => {
      const risposta = new Subject<ContrattoCliente>()
      contratti.get.and.returnValue(risposta)
      await apri(contratto())
      expect(bottone('contratto-dlg-salva')!.disabled).toBeTrue()
      risposta.next(contratto())
      await stabilizza(fixture)
      expect(bottone('contratto-dlg-salva')!.disabled).toBeFalse()
    })

    it('lettura fallita: messaggio del backend e nessun salvataggio', async () => {
      contratti.get.and.returnValue(
        throwError(() => ({ status: 404, error: { message: 'Contratto non trovato.' } }))
      )
      await apri(contratto())
      expect(q('contratto-dlg-errore')!.textContent).toContain('Contratto non trovato.')
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
    })

    it('riaprendo, la risposta in ritardo della lettura precedente non sovrascrive', async () => {
      const prima = new Subject<ContrattoCliente>()
      contratti.get.and.returnValues(prima, of(contratto({ numero: 'CC-ATTUALE' })))
      await apri(contratto())
      fixture.componentRef.setInput('visible', false)
      await stabilizza(fixture)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      expect(valore('contratto-dlg-numero')).toBe('CC-ATTUALE')
      prima.next(contratto({ numero: 'CC-VECCHIO' }))
      await stabilizza(fixture)
      expect(valore('contratto-dlg-numero')).toBe('CC-ATTUALE')
    })

    it('salva mandando solo i campi cambiati, periodi come elenco intero, più la versione', async () => {
      contratti.modifica.and.returnValue(of(contratto()))
      await apri(contratto())
      scrivi('contratto-dlg-descrizione', 'Nuova descrizione')
      scrivi('contratto-dlg-ritenuta', '10')
      bottone('periodi-aggiungi')!.click()
      await stabilizza(fixture)
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.modifica).toHaveBeenCalledOnceWith('ct1', {
        descrizione: 'Nuova descrizione',
        periodi: [...PERIODI, { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 12 }],
        versione: 3,
      })
      expect(salvati.length).toBe(1)
      expect(visibilita).toContain(false)
    })

    it('un campo svuotato parte come null', async () => {
      contratti.modifica.and.returnValue(of(contratto()))
      await apri(contratto())
      scegli('contratto-dlg-categoria', '')
      scrivi('contratto-dlg-data-fine', '')
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.modifica).toHaveBeenCalledOnceWith('ct1', {
        categoriaId: null,
        dataFine: null,
        versione: 3,
      })
    })

    it('nessun cambiamento: nessuna chiamata e avviso', async () => {
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri(contratto())
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.modifica).not.toHaveBeenCalled()
      expect(spia).toHaveBeenCalledWith(
        jasmine.objectContaining({ detail: 'Nessuna modifica da salvare.' })
      )
    })

    it('conto del contratto vuoto: "dal cliente" con il conto effettivo', async () => {
      await apri(contratto())
      expect(q<HTMLSelectElement>('contratto-dlg-conto')!.options[0].text).toBe(
        'dal cliente: Banca Popolare'
      )
    })

    it('400: messaggi del backend, dialog aperto', async () => {
      contratti.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            error: 'CONTRATTO_CLIENTE_NON_VALIDO',
            message: ['La data di fine non può precedere la data di inizio.'],
          },
        }))
      )
      await apri(contratto())
      scrivi('contratto-dlg-descrizione', 'x')
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('contratto-dlg-errore')!.textContent).toContain('La data di fine non può precedere')
      expect(visibilita).not.toContain(false)
    })

    it('409 MODIFICATO_NEL_FRATTEMPO: toast ed emette salvato per ricaricare', async () => {
      contratti.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            error: 'CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO',
            message: 'Modificato da un collega.',
          },
        }))
      )
      const spia = spyOn(TestBed.inject(MessageService), 'add')
      await apri(contratto())
      scrivi('contratto-dlg-descrizione', 'x')
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(spia).toHaveBeenCalledWith(
        jasmine.objectContaining({ severity: 'error', detail: 'Modificato da un collega.' })
      )
      expect(salvati.length).toBe(1)
      expect(visibilita).toContain(false)
    })

    it('409 diverso (numero duplicato): messaggio nel dialog, resta aperto', async () => {
      contratti.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            error: 'CONTRATTO_CLIENTE_NUMERO_DUPLICATO',
            message: 'Il numero è già in uso.',
          },
        }))
      )
      await apri(contratto())
      scrivi('contratto-dlg-numero', 'CC-2026-002')
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('contratto-dlg-errore')!.textContent).toContain('Il numero è già in uso.')
      expect(salvati).toEqual([])
    })

    it('contratto attivo: numero, cliente e data di inizio disabilitati', async () => {
      const modificabili = TUTTI.filter(c => !['numero', 'clienteId', 'dataInizio'].includes(c))
      await apriCon(contratto({ stato: 'ATTIVO', modificabili: [...modificabili] }))
      expect(q<HTMLInputElement>('contratto-dlg-numero')!.disabled).toBeTrue()
      expect(q<HTMLInputElement>('contratto-dlg-data-inizio')!.disabled).toBeTrue()
      expect(
        q<HTMLInputElement>('contratto-dlg-cliente')!.querySelector('input')!.disabled
      ).toBeTrue()
      expect(q<HTMLInputElement>('contratto-dlg-descrizione')!.disabled).toBeFalse()
      expect(q('contratto-dlg-nuovo-cliente')).toBeNull()
      expect(q('contratto-dlg-nuovo-fatturazione')).toBeTruthy()
      expect(q('contratto-dlg-stato')!.textContent).toContain('Attivo')
    })

    it('un campo bloccato non finisce nella modifica', async () => {
      contratti.modifica.and.returnValue(of(contratto()))
      await apriCon(contratto({ stato: 'ATTIVO', modificabili: TUTTI.filter(c => c !== 'numero') }))
      scrivi('contratto-dlg-descrizione', 'x')
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.modifica.calls.mostRecent().args[1]).toEqual({
        descrizione: 'x',
        versione: 3,
      })
    })

    it('nessun "Nuovo …" accanto a un campo bloccato', async () => {
      await apriCon(
        contratto({
          stato: 'ATTIVO',
          modificabili: TUTTI.filter(
            c =>
              !['condizionePagamentoId', 'agenteId', 'categoriaId', 'testoFatturazioneId'].includes(
                c
              )
          ),
        })
      )
      for (const id of [
        'contratto-dlg-nuova-condizione',
        'contratto-dlg-nuovo-agente',
        'contratto-dlg-nuova-categoria',
        'contratto-dlg-nuovo-testo',
      ])
        expect(q(id)).toBeNull()
      expect(q('contratto-dlg-nuovo-conto')).toBeTruthy()
      expect(
        fixture.debugElement
          .query(By.directive(SezionePagamentoComponent))
          .componentInstance.libero('agenteId')
      ).toBeFalse()
    })

    it('contratto annullato: tutto disabilitato', async () => {
      await apriCon(contratto({ stato: 'ANNULLATO', modificabili: [] }))
      expect(q<HTMLInputElement>('contratto-dlg-descrizione')!.disabled).toBeTrue()
      expect(q('periodi-aggiungi')).toBeNull()
    })
  })

  describe('nuovo: salvataggio', () => {
    async function compila() {
      await scegliCliente('contratto-dlg-cliente', VERDI)
      scrivi('contratto-dlg-descrizione', '  Servizio  ')
      scrivi('contratto-dlg-data-inizio', '2026-03-01')
      await stabilizza(fixture)
    }

    it('manda numero, descrizione, cliente e inizio; i predefiniti non toccati non partono', async () => {
      contratti.crea.and.returnValue(of(contratto()))
      await apri()
      await compila()
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.crea).toHaveBeenCalledOnceWith({
        numero: 'CC-2026-007',
        descrizione: 'Servizio',
        clienteId: 'cl1',
        dataInizio: '2026-03-01',
      })
      expect(salvati.length).toBe(1)
      expect(visibilita).toContain(false)
    })

    it("un predefinito modificato dall'operatore parte, anche se svuotato", async () => {
      contratti.crea.and.returnValue(of(contratto()))
      await apri()
      await compila()
      scrivi('contratto-dlg-ritenuta', '4')
      scegli('contratto-dlg-registro', '')
      scrivi('contratto-dlg-codice-dest', 'zzzzzzz')
      await stabilizza(fixture)
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.crea.calls.mostRecent().args[0]).toEqual({
        numero: 'CC-2026-007',
        descrizione: 'Servizio',
        clienteId: 'cl1',
        dataInizio: '2026-03-01',
        ritenutaPercentuale: '4',
        registroIvaId: null,
        codiceDestinatario: 'ZZZZZZZ',
      })
    })

    it('periodi, sede, testo e date facoltative partono se valorizzati', async () => {
      contratti.crea.and.returnValue(of(contratto()))
      await apri()
      await compila()
      scegli('contratto-dlg-sede', 's2')
      scegli('contratto-dlg-testo', 't1')
      scrivi('contratto-dlg-data-fine', '2026-12-31')
      scrivi('contratto-dlg-validita-quantita', '12')
      scegli('contratto-dlg-validita-unita', 'M')
      bottone('periodi-freq-SEMESTRALE')!.click()
      await stabilizza(fixture)
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(contratti.crea.calls.mostRecent().args[0]).toEqual({
        numero: 'CC-2026-007',
        descrizione: 'Servizio',
        clienteId: 'cl1',
        dataInizio: '2026-03-01',
        dataFine: '2026-12-31',
        sedeId: 's2',
        testoFatturazioneId: 't1',
        validitaQuantita: 12,
        validitaUnita: 'M',
        periodi: [
          { giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 },
          { giornoInizio: 1, meseInizio: 7, giornoFine: 31, meseFine: 12 },
        ],
      })
    })

    it('400: i messaggi del backend (anche un elenco) restano nel dialog', async () => {
      contratti.crea.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            message: [
              'Inserisci una descrizione per questo contratto.',
              'Periodo 1: data non valida.',
            ],
          },
        }))
      )
      await apri()
      bottone('contratto-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('contratto-dlg-errore')!.textContent).toContain(
        'Inserisci una descrizione per questo contratto. Periodo 1: data non valida.'
      )
      expect(visibilita).not.toContain(false)
    })

    it('doppio clic: una sola chiamata', async () => {
      contratti.crea.and.returnValue(new Subject<unknown>())
      await apri()
      fixture.componentInstance.salva()
      fixture.componentInstance.salva()
      expect(contratti.crea).toHaveBeenCalledTimes(1)
    })

    it('chiudendo il dialog il form si azzera', async () => {
      await apri()
      scrivi('contratto-dlg-descrizione', 'x')
      fixture.componentInstance.chiudi()
      expect(form().controls.descrizione.value).toBe('')
      expect(form().controls.periodi.value).toEqual([])
    })
  })

  describe('VIEWER', () => {
    it('non vede nessun pulsante di scrittura e il form è disabilitato', async () => {
      ruolo('VIEWER')
      await apri(contratto())
      expect(q('contratto-dlg-salva')).toBeNull()
      for (const id of [
        'contratto-dlg-nuovo-cliente',
        'contratto-dlg-nuovo-fatturazione',
        'contratto-dlg-nuova-categoria',
        'contratto-dlg-nuovo-tipo',
        'contratto-dlg-nuova-condizione',
        'contratto-dlg-nuovo-conto',
        'contratto-dlg-nuove-spese',
        'contratto-dlg-nuovo-bollo',
        'contratto-dlg-nuovo-registro',
        'contratto-dlg-nuovo-agente',
        'contratto-dlg-nuovo-testo',
        'periodi-aggiungi',
        'periodi-freq-MENSILE',
      ])
        expect(q(id)).withContext(id).toBeNull()
      expect(q<HTMLInputElement>('contratto-dlg-descrizione')!.disabled).toBeTrue()
      expect(q<HTMLInputElement>('periodi-gi-0')!.disabled).toBeTrue()
      expect(fixture.componentInstance.puoSalvare()).toBeFalse()
    })
  })
})
