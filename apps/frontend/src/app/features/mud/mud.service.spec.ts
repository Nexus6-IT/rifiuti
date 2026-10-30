import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import {
  CorpoIntegrazioniMud,
  IntegrazioniMud,
  MudControllo,
  MudMovimentoSegnalato,
  MudService,
  RiepilogoAvvisi,
  StatoPresentazioneMud,
  codiceDellAzienda,
  codiciAvvisi,
  corpoIntegrazioni,
  intervalloPesoSpecifico,
  pesoSpecificoPlausibile,
  puoGenerareConAvvisi,
  righeIntegrazioni,
  testoConferma,
  AVVISO_VOCE_SENZA_SEDE,
  AVVISO_VOCE_GIACENZA_NON_USATA,
  etichettaGiacenza,
} from './mud.service'
import { environment } from '../../../environments/environment'

const API_URL = `${environment.apiUrl}/mud`

const riepilogo = (r: Partial<RiepilogoAvvisi> = {}): RiepilogoAvvisi => ({
  kgInMeno: 0,
  kgInPiu: 0,
  movimentiNonQuantificati: 0,
  voci: [],
  testo: '',
  cambianoQuantita: false,
  ...r,
})

const STATO: StatoPresentazioneMud = {
  year: 2025,
  status: 'DRAFT',
  submittedAt: null,
  datiModificatiDopoPresentazione: false,
  fileTracciato: null,
  esportazioni: [],
  prossimoFileSostituisce: null,
  versioneCalcolo: null,
  versioneCalcoloAttuale: 2,
}

describe('MudService', () => {
  let service: MudService
  let httpMock: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MudService],
    })

    service = TestBed.inject(MudService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    httpMock.verify()
  })

  it('downloadExport fa GET su /mud/export con anno e avvisi confermati separati da virgola', () => {
    service.downloadExport(2025, ['A', 'B']).subscribe()

    const req = httpMock.expectOne(r => r.url === `${API_URL}/export`)
    expect(req.request.method).toBe('GET')
    expect(req.request.responseType).toBe('blob')
    expect(req.request.params.get('year')).toBe('2025')
    expect(req.request.params.get('avvisiConfermati')).toBe('A,B')
    req.flush(new Blob(['XX;']))
  })

  it('downloadExport senza avvisi non manda il parametro avvisiConfermati', () => {
    service.downloadExport(2025, []).subscribe()

    const req = httpMock.expectOne(r => r.url === `${API_URL}/export`)
    expect(req.request.params.get('year')).toBe('2025')
    expect(req.request.params.has('avvisiConfermati')).toBeFalse()
    req.flush(new Blob(['XX;']))
  })

  it('getPresentazione fa GET su /mud/:year/presentazione', done => {
    service.getPresentazione(2025).subscribe(res => {
      expect(res).toEqual(STATO)
      done()
    })

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('GET')
    req.flush(STATO)
  })

  it('segnaPresentato fa POST con data ed esportazione scelta, senza avvisi confermati', () => {
    service.segnaPresentato(2025, '2026-06-30', '2026-04-02T08:00:00.000Z').subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({
      dataPresentazione: '2026-06-30',
      esportazioneGenerataIl: '2026-04-02T08:00:00.000Z',
    })
    req.flush(STATO)
  })

  it('segnaPresentato senza data né esportazione manda un corpo vuoto', () => {
    service.segnaPresentato(2025).subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({})
    req.flush(STATO)
  })

  it('annullaPresentazione fa DELETE con il motivo nel corpo', () => {
    service.annullaPresentazione(2025, 'DICHIARAZIONE_DA_SOSTITUIRE').subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('DELETE')
    expect(req.request.body).toEqual({ motivo: 'DICHIARAZIONE_DA_SOSTITUIRE' })
    req.flush(STATO)
  })

  it('getObbligo fa GET su /mud/obbligo', done => {
    const obbligo = {
      mudNonDovuto: false,
      motivo: null,
      impostatoIl: null,
      impostatoDa: null,
      puoModificare: true,
    }
    service.getObbligo().subscribe(res => {
      expect(res).toEqual(obbligo)
      done()
    })

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.method).toBe('GET')
    req.flush(obbligo)
  })

  it('impostaObbligo fa PUT con flag e motivo', () => {
    service.impostaObbligo(true, 'Meno di 10 dipendenti').subscribe()

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' })
    req.flush({})
  })

  it('impostaObbligo senza motivo non manda il campo', () => {
    service.impostaObbligo(false, null).subscribe()

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.body).toEqual({ mudNonDovuto: false })
    req.flush({})
  })
})

describe('codiciAvvisi', () => {
  it('restituisce i codici distinti degli avvisi in ordine alfabetico, senza i bloccanti', () => {
    const controlli: MudControllo[] = [
      { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO', messaggio: 'a' },
      { codice: 'CAUSALE_ESCLUSA', gravita: 'AVVISO', messaggio: 'b' },
      { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO', messaggio: 'c' },
      { codice: 'DESTINATARIO_SENZA_CF', gravita: 'BLOCCANTE', messaggio: 'd' },
    ]

    expect(codiciAvvisi(controlli)).toEqual(['CAUSALE_ESCLUSA', 'SCARICO_SENZA_FIR'])
  })
})

describe('testoConferma', () => {
  it('con soli kg in meno', () => {
    expect(testoConferma(riepilogo({ kgInMeno: 350 }), 'generare il file')).toBe(
      'Confermo di generare il file con 350 kg in meno rispetto al registro.'
    )
  })

  it('con kg in meno e in più, in formato italiano con il raggruppamento', () => {
    expect(
      testoConferma(riepilogo({ kgInMeno: 1234.5, kgInPiu: 36 }), 'segnare il MUD come presentato')
    ).toBe(
      'Confermo di segnare il MUD come presentato con 1.234,5 kg in meno e 36 kg in più rispetto al registro.'
    )
  })

  it('senza differenze di quantità', () => {
    expect(testoConferma(riepilogo(), 'generare il file')).toBe(
      'Ho letto gli avvisi e confermo di generare il file.'
    )
  })
})

describe('puoGenerareConAvvisi', () => {
  // Stessa regola della 403 del backend (riepilogaAvvisi.cambianoQuantita, Task 5): la pagina
  // non la ricalcola, legge il flag del riepilogo
  it('chiunque, se gli avvisi non cambiano le quantità', () => {
    expect(puoGenerareConAvvisi(riepilogo({ cambianoQuantita: false }), 'VIEWER')).toBeTrue()
  })

  it('solo un amministratore effettivo, se gli avvisi cambiano le quantità', () => {
    const r = riepilogo({ cambianoQuantita: true })
    expect(puoGenerareConAvvisi(r, 'VIEWER')).toBeFalse()
    expect(puoGenerareConAvvisi(r, 'OPERATOR')).toBeFalse()
    expect(puoGenerareConAvvisi(r, 'ADMIN')).toBeTrue()
    expect(puoGenerareConAvvisi(r, 'SUPER_ADMIN')).toBeTrue()
  })
})

function integrazioniVuote(): IntegrazioniMud {
  return {
    destinatari: {},
    destinatariMovimento: {},
    trasportatori: {},
    pesiSpecifici: {},
    destinazioniGiacenza: {},
    aggiornateIl: null,
    aggiornateDa: null,
  }
}

const bloccante = (
  integrazione: MudControllo['integrazione'],
  movimenti: MudMovimentoSegnalato[] = []
): MudControllo => ({ codice: 'X', gravita: 'BLOCCANTE', messaggio: 'm', integrazione, movimenti })

describe('MudService integrazioni', () => {
  let service: MudService
  let httpMock: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MudService],
    })
    service = TestBed.inject(MudService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => httpMock.verify())

  it('getIntegrazioni fa GET su /mud/:year/integrazioni', done => {
    const letto = { ...integrazioniVuote(), codiciAzienda: ['01234567897'] }
    service.getIntegrazioni(2025).subscribe(i => {
      expect(i).toEqual(letto)
      done()
    })
    const req = httpMock.expectOne(`${API_URL}/2025/integrazioni`)
    expect(req.request.method).toBe('GET')
    req.flush(letto)
  })

  it('salvaIntegrazioni fa PUT con il corpo passato', () => {
    const corpo: CorpoIntegrazioniMud = {
      destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' }],
      destinatariMovimento: [
        { anno: 2025, numero: 5, ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      ],
      trasportatori: [{ ragioneSociale: 'Trasporti Srl', codiceFiscale: '12345678903' }],
      pesiSpecifici: [{ cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.1 }],
      destinazioniGiacenza: [{ cerCode: '170405', unitaLocaleId: null, destinazione: 'D' }],
    }
    service.salvaIntegrazioni(2025, corpo).subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/integrazioni`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual(corpo)
    req.flush(integrazioniVuote())
  })
})

// Ruling A15: replica degli intervalli del backend (INTERVALLI_PESO_SPECIFICO in
// apps/backend/src/application/mud/aggregazione/mud-integrazioni.ts), stessi valori del suo spec.
describe('intervalloPesoSpecifico (replica del backend)', () => {
  it('stessi intervalli e alias del backend', () => {
    expect(intervalloPesoSpecifico('litri')).toEqual({ min: 0.1, max: 3 })
    expect(intervalloPesoSpecifico('L')).toEqual({ min: 0.1, max: 3 })
    expect(intervalloPesoSpecifico(' lt ')).toEqual({ min: 0.1, max: 3 })
    expect(intervalloPesoSpecifico('litro')).toEqual({ min: 0.1, max: 3 })
    expect(intervalloPesoSpecifico('mc')).toEqual({ min: 10, max: 3000 })
    expect(intervalloPesoSpecifico('M3')).toEqual({ min: 10, max: 3000 })
    expect(intervalloPesoSpecifico('metri cubi')).toEqual({ min: 10, max: 3000 })
    expect(intervalloPesoSpecifico('PZ')).toBeNull()
  })

  it('plausibilità: estremi compresi; senza intervallo serve sempre la conferma', () => {
    expect(pesoSpecificoPlausibile('M3', 1200)).toBeTrue()
    expect(pesoSpecificoPlausibile('M3', 10)).toBeTrue()
    expect(pesoSpecificoPlausibile('M3', 3000)).toBeTrue()
    expect(pesoSpecificoPlausibile('M3', 1.2)).toBeFalse() // t/m³ al posto di kg/m³
    expect(pesoSpecificoPlausibile('LITRI', 1200)).toBeFalse()
    expect(pesoSpecificoPlausibile('PZ', 5)).toBeFalse()
  })
})

describe('codiceDellAzienda', () => {
  it('confronta il codice normalizzato: maiuscolo, senza spazi e senza il prefisso IT', () => {
    const codici = ['01234567897', 'RSSMRA80A01H501U']
    expect(codiceDellAzienda('IT 01234567897', codici)).toBeTrue()
    expect(codiceDellAzienda('rssmra80a01h501u', codici)).toBeTrue()
    expect(codiceDellAzienda('12345678903', codici)).toBeFalse()
    expect(codiceDellAzienda('', codici)).toBeFalse()
  })
})

const INTEGRAZIONE_A: Extract<MudControllo['integrazione'], { tipo: 'DESTINATARIO_MOVIMENTO' }> = {
  tipo: 'DESTINATARIO_MOVIMENTO',
  chiave: '2025/5@reg-A',
  numero: 5,
  anno: 2025,
  registroId: 'reg-A',
}

describe('righeIntegrazioni', () => {
  it('una riga per ogni bloccante con integrazione, con la chiave del backend', () => {
    const righe = righeIntegrazioni(
      [
        bloccante({
          tipo: 'CF_DESTINATARIO',
          chiave: 'ECOLOGIA SRL',
          ragioneSociale: 'Ecologia Srl',
        }),
        bloccante({
          tipo: 'DESTINATARIO_MOVIMENTO',
          chiave: '2025/5@reg-A',
          numero: 5,
          anno: 2025,
          registroId: 'reg-A',
        }),
        bloccante({
          tipo: 'CF_TRASPORTATORE',
          chiave: 'TRASPORTI SRL',
          ragioneSociale: 'Trasporti Srl',
        }),
        { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO', messaggio: 'avviso' },
      ],
      integrazioniVuote()
    )
    expect(righe.map(r => [r.tipo, r.chiave, r.etichetta])).toEqual([
      ['CF_DESTINATARIO', 'ECOLOGIA SRL', 'Ecologia Srl'],
      ['DESTINATARIO_MOVIMENTO', '2025/5@reg-A', 'Movimento n. 5/2025'],
      ['CF_TRASPORTATORE', 'TRASPORTI SRL', 'Trasporti Srl (trasportatore)'],
    ])
    expect([righe[1].anno, righe[1].numero, righe[1].registroId]).toEqual([2025, 5, 'reg-A'])
  })

  it('peso specifico: etichetta col CER e totale dei movimenti del bloccante nell unità', () => {
    const mov = (quantita: number): MudMovimentoSegnalato => ({
      numero: 1,
      anno: 2025,
      cerCode: '17 04 05',
      quantita,
      unita: 'litri',
      kg: null,
      incluso: false,
    })
    const [riga] = righeIntegrazioni(
      [
        bloccante(
          { tipo: 'PESO_SPECIFICO', chiave: '170405|LITRI', cerCode: '170405', unita: 'LITRI' },
          [mov(10), mov(5.5)]
        ),
      ],
      integrazioniVuote()
    )
    expect(riga.etichetta).toBe('CER 170405 – LITRI')
    expect(riga.totaleUnita).toBe(15.5)
    expect(riga.kgPerUnita).toBeNull()
  })

  it('le voci già salvate compaiono anche senza bloccante, con i valori salvati', () => {
    const righe = righeIntegrazioni([], {
      ...integrazioniVuote(),
      destinatari: {
        'RECYCLING GMBH': {
          ragioneSociale: 'Recycling GmbH',
          codiceFiscale: '',
          nazione: 'Germania',
        },
      },
      destinatariMovimento: {
        '2024/11@reg-B': { ragioneSociale: 'Altro Impianto', codiceFiscale: '12345678903' },
        '2024/12': {
          ragioneSociale: 'Impianto Nord',
          codiceFiscale: '01234567897',
          confermatoPropriaAzienda: true,
        },
      },
      pesiSpecifici: {
        '200304|M3': {
          cerCode: '200304',
          unita: 'M3',
          kgPerUnita: 1.2,
          confermatoFuoriIntervallo: true,
        },
      },
    })
    expect(righe.map(r => r.etichetta)).toEqual([
      'Recycling GmbH',
      'Movimento n. 11/2024',
      'Movimento n. 12/2024',
      'CER 200304 – M3',
    ])
    expect(righe[0].estero).toBeTrue()
    expect(righe[0].nazione).toBe('Germania')
    // chiave con il registro: anno, numero e registro si leggono dalla chiave del backend
    expect(righe[1].chiave).toBe('2024/11@reg-B')
    expect([righe[1].anno, righe[1].numero, righe[1].registroId]).toEqual([2024, 11, 'reg-B'])
    // chiave vecchia (prima dei registri per sede): nessun registro, si rimanda senza
    expect(righe[2].chiave).toBe('2024/12')
    expect([righe[2].anno, righe[2].numero, righe[2].registroId]).toEqual([2024, 12, undefined])
    expect(righe[2].ragioneSociale).toBe('Impianto Nord')
    expect(righe[2].confermaPropriaAzienda).toBeTrue()
    expect(righe[3].kgPerUnita).toBe(1.2)
    expect(righe[3].confermaFuoriIntervallo).toBeTrue()
    expect(righe[3].totaleUnita).toBeNull()
  })

  it('un bloccante e la voce salvata con la stessa chiave danno una sola riga', () => {
    const integrazione: MudControllo['integrazione'] = {
      tipo: 'CF_DESTINATARIO',
      chiave: 'ECOLOGIA SRL',
      ragioneSociale: 'Ecologia Srl',
    }
    const righe = righeIntegrazioni([bloccante(integrazione), bloccante(integrazione)], {
      ...integrazioniVuote(),
      destinatari: { 'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '1' } },
    })
    expect(righe.length).toBe(1)
    expect(righe[0].codiceFiscale).toBe('1')
  })
})

describe('corpoIntegrazioni', () => {
  const codici = ['01234567897']
  const righe = () =>
    righeIntegrazioni(
      [
        bloccante({ tipo: 'CF_DESTINATARIO', chiave: 'A SRL', ragioneSociale: 'A Srl' }),
        bloccante({ tipo: 'CF_DESTINATARIO', chiave: 'B GMBH', ragioneSociale: 'B GmbH' }),
        bloccante({ tipo: 'CF_DESTINATARIO', chiave: 'C SRL', ragioneSociale: 'C Srl' }),
        bloccante({
          tipo: 'DESTINATARIO_MOVIMENTO',
          chiave: '2025/5@reg-A',
          numero: 5,
          anno: 2025,
          registroId: 'reg-A',
        }),
        bloccante({ tipo: 'CF_TRASPORTATORE', chiave: 'T SRL', ragioneSociale: 'T Srl' }),
        bloccante({
          tipo: 'PESO_SPECIFICO',
          chiave: '170405|LITRI',
          cerCode: '170405',
          unita: 'LITRI',
        }),
        bloccante({ tipo: 'PESO_SPECIFICO', chiave: '200304|M3', cerCode: '200304', unita: 'M3' }),
        bloccante({ tipo: 'PESO_SPECIFICO', chiave: '150106|PZ', cerCode: '150106', unita: 'PZ' }),
      ],
      integrazioniVuote()
    )

  it('manda solo le righe compilate, con nazione, conferme e anno e numero del movimento', () => {
    const r = righe()
    r[0].codiceFiscale = ' it01234567897 ' // propria azienda, confermata
    r[0].confermaPropriaAzienda = true
    r[1].estero = true
    r[1].nazione = ' Germania '
    r[1].codiceFiscale = 'ignorato'
    // r[2] vuota: non si manda
    r[3].ragioneSociale = ' Ecologia Srl '
    r[3].codiceFiscale = '12345678903'
    r[4].codiceFiscale = '01234567897' // trasportatore: nessuna conferma
    r[5].kgPerUnita = 1.1 // nell'intervallo
    r[5].confermaFuoriIntervallo = true // non serve: non si manda
    r[6].kgPerUnita = 1.2 // fuori intervallo, confermato
    r[6].confermaFuoriIntervallo = true
    // r[7] senza valore: non si manda

    expect(corpoIntegrazioni(r, codici)).toEqual({
      destinatari: [
        { ragioneSociale: 'A Srl', codiceFiscale: '01234567897', confermaPropriaAzienda: true },
        { ragioneSociale: 'B GmbH', codiceFiscale: '', nazione: 'Germania' },
      ],
      destinatariMovimento: [
        {
          anno: 2025,
          numero: 5,
          registroId: 'reg-A',
          ragioneSociale: 'Ecologia Srl',
          codiceFiscale: '12345678903',
        },
      ],
      trasportatori: [{ ragioneSociale: 'T Srl', codiceFiscale: '01234567897' }],
      pesiSpecifici: [
        { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.1 },
        { cerCode: '200304', unita: 'M3', kgPerUnita: 1.2, confermaFuoriIntervallo: true },
      ],
      destinazioniGiacenza: [],
    })
  })

  it('MUD: due movimenti con lo stesso anno/numero in registri diversi sono due righe distinte', () => {
    const r = righeIntegrazioni(
      [
        bloccante({ ...INTEGRAZIONE_A }),
        bloccante({
          ...INTEGRAZIONE_A,
          chiave: '2025/5@reg-B',
          registroId: 'reg-B',
        }),
      ],
      integrazioniVuote()
    )
    expect(r.map(x => x.chiave)).toEqual(['2025/5@reg-A', '2025/5@reg-B'])
    r[0].ragioneSociale = 'Uno Srl'
    r[0].codiceFiscale = '12345678903'
    r[1].ragioneSociale = 'Due Srl'
    r[1].codiceFiscale = '12345678903'
    expect(corpoIntegrazioni(r, []).destinatariMovimento.map(v => v.registroId)).toEqual([
      'reg-A',
      'reg-B',
    ])
  })

  it('MUD: con più registri l’etichetta del movimento include la sede, con un registro solo resta identica', () => {
    const bloccanti = [
      bloccante(INTEGRAZIONE_A),
      bloccante({ ...INTEGRAZIONE_A, chiave: '2025/5@reg-B', registroId: 'reg-B' }),
    ]
    const uno = righeIntegrazioni(bloccanti, integrazioniVuote())
    expect(uno.map(r => r.etichetta)).toEqual(['Movimento n. 5/2025', 'Movimento n. 5/2025'])

    const due = righeIntegrazioni(bloccanti, {
      ...integrazioniVuote(),
      registri: { 'reg-A': 'Sede A', 'reg-B': 'Sede B' },
    })
    expect(due.map(r => r.etichetta)).toEqual([
      'Movimento n. 5/2025 (Sede A)',
      'Movimento n. 5/2025 (Sede B)',
    ])
  })

  it('una voce salvata con registro, senza bloccante, mostra la sede', () => {
    const r = righeIntegrazioni([], {
      ...integrazioniVuote(),
      registri: { 'reg-A': 'Sede A', 'reg-B': 'Sede B' },
      destinatariMovimento: {
        '2025/5@reg-B': { ragioneSociale: 'Due Srl', codiceFiscale: '12345678903' },
      },
    })
    expect(r.map(x => [x.etichetta, x.avviso])).toEqual([
      ['Movimento n. 5/2025 (Sede B)', undefined],
    ])
  })

  it('una voce salvata senza registroId con più registri è segnalata come non più usata', () => {
    const salvata = {
      '2024/12': { ragioneSociale: 'Impianto Nord', codiceFiscale: '12345678903' },
    }
    const con = righeIntegrazioni([], {
      ...integrazioniVuote(),
      registri: { 'reg-A': 'Sede A', 'reg-B': 'Sede B' },
      destinatariMovimento: salvata,
    })
    expect(con[0].avviso).toBe(AVVISO_VOCE_SENZA_SEDE)

    // con un registro solo la voce vecchia vale ancora: nessun avviso
    const senza = righeIntegrazioni([], { ...integrazioniVuote(), destinatariMovimento: salvata })
    expect(senza[0].avviso).toBeUndefined()
  })

  it('una voce salvata con la chiave vecchia si rimanda senza registroId', () => {
    const r = righeIntegrazioni([], {
      ...integrazioniVuote(),
      destinatariMovimento: {
        '2024/12': { ragioneSociale: 'Impianto Nord', codiceFiscale: '12345678903' },
      },
    })
    expect(corpoIntegrazioni(r, []).destinatariMovimento).toEqual([
      { anno: 2024, numero: 12, ragioneSociale: 'Impianto Nord', codiceFiscale: '12345678903' },
    ])
  })

  it('la conferma della propria azienda non si manda se il codice non è quello dell azienda', () => {
    const r = righe()
    r[0].codiceFiscale = '12345678903'
    r[0].confermaPropriaAzienda = true
    expect(corpoIntegrazioni(r, codici).destinatari).toEqual([
      { ragioneSociale: 'A Srl', codiceFiscale: '12345678903' },
    ])
  })
})

describe('etichettaGiacenza', () => {
  it('etichetta della riga uguale a quella del backend', () => {
    // stesso testo di `etichettaGiacenza` in apps/backend/.../mud-controlli.ts (M5)
    expect(etichettaGiacenza('170405')).toBe('Giacenza CER 170405')
  })
})

describe('destinazioni delle giacenze', () => {
  const SEDE_A = 'sede-a'
  const SEDE_B = 'sede-b'
  const avvisoGiacenza = (unitaLocaleId: string | null): MudControllo => ({
    codice: 'GIACENZA_DESTINAZIONE_NON_INDICATA',
    gravita: 'AVVISO',
    messaggio: 'm',
    integrazione: {
      tipo: 'DESTINAZIONE_GIACENZA',
      chiave: `${unitaLocaleId ?? 'AZIENDA'}|170405`,
      cerCode: '170405',
      unitaLocaleId,
      sede: 'Nord',
    },
  })

  it('la riga nasce da un avviso e con più sedi porta la sede fra parentesi', () => {
    const [una] = righeIntegrazioni([avvisoGiacenza(SEDE_A)], {
      ...integrazioniVuote(),
      unitaLocali: { [SEDE_A]: 'Nord' },
    })
    expect(una.etichetta).toBe('Giacenza CER 170405')
    const [due] = righeIntegrazioni([avvisoGiacenza(SEDE_A)], {
      ...integrazioniVuote(),
      unitaLocali: { [SEDE_A]: 'Nord', [SEDE_B]: 'Sud' },
    })
    expect(due.etichetta).toBe('Giacenza CER 170405 (Nord)')
    expect(due.tipo).toBe('DESTINAZIONE_GIACENZA')
  })

  it('il corpo del PUT porta la scelta; senza scelta la voce non si manda', () => {
    const r = righeIntegrazioni([avvisoGiacenza(SEDE_A)], integrazioniVuote())
    expect(corpoIntegrazioni(r, []).destinazioniGiacenza).toEqual([])
    r[0].destinazione = 'R'
    expect(corpoIntegrazioni(r, []).destinazioniGiacenza).toEqual([
      { cerCode: '170405', unitaLocaleId: SEDE_A, destinazione: 'R' },
    ])
  })

  it('una voce salvata precompila la riga del suo avviso', () => {
    const [r] = righeIntegrazioni([avvisoGiacenza(SEDE_A)], {
      ...integrazioniVuote(),
      destinazioniGiacenza: {
        [`${SEDE_A}|170405`]: { cerCode: '170405', unitaLocaleId: SEDE_A, destinazione: 'D' },
      },
    })
    expect(r.destinazione).toBe('D')
    expect(r.avviso).toBeUndefined()
  })

  it('voce di giacenza non più usata con l avviso, ma ancora rimandata nel PUT', () => {
    const salvate: IntegrazioniMud = {
      ...integrazioniVuote(),
      destinazioniGiacenza: {
        [`${SEDE_A}|170405`]: { cerCode: '170405', unitaLocaleId: SEDE_A, destinazione: 'R' },
      },
    }
    const dichiarazione = (id: string | null, giacenzaRecuperoKg: number) => ({
      codice: '1',
      unitaLocale: { id, denominazione: 'x', numIscrSito: null },
      totali: {
        prodottoKg: 0,
        recuperoKg: 0,
        smaltimentoKg: 0,
        giacenzaRecuperoKg,
        giacenzaSmaltimentoKg: 0,
        movimenti: 0,
      },
      perCer: [
        {
          cerCode: '17 04 05*',
          pericoloso: true,
          prodottoKg: 0,
          recuperoKg: 0,
          smaltimentoKg: 0,
          giacenzaRecuperoKg,
          giacenzaSmaltimentoKg: 0,
          movimenti: 0,
        },
      ],
    })
    // la giacenza ora è in un'altra dichiarazione
    const r = righeIntegrazioni([], salvate, [dichiarazione(SEDE_B, 50)])
    expect(r[0].avviso).toBe(AVVISO_VOCE_GIACENZA_NON_USATA)
    expect(corpoIntegrazioni(r, []).destinazioniGiacenza).toHaveSize(1)
    // la voce che sta ancora funzionando (l'avviso è sparito perché indicata) non è segnalata
    const ok = righeIntegrazioni([], salvate, [dichiarazione(SEDE_A, 50)])
    expect(ok[0].avviso).toBeUndefined()
  })
})
