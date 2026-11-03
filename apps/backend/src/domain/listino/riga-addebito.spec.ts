import { Prisma } from '@prisma/client'
import { cerCanonico } from '../waste-movement/cer-registro'
import {
  CAMPI_PER_FAMIGLIA,
  CampoRiga,
  DatiRiga,
  ETICHETTE_CAMPI_RIGA,
  chiaveRiga,
  formaCerValida,
  normalizzaRiga,
  tipologiaDaCer,
  totaleFissiAnnuo,
  validaCerProposta,
  validaRiga,
} from './riga-addebito'
import { MSG_PREZZO_SPECIALE } from './prezzo-speciale'
import { famigliaTipo } from './tipi-addebito'

const TUTTI_I_CAMPI = Object.keys(ETICHETTE_CAMPI_RIGA) as CampoRiga[]

/** Riga con tutti i campi vuoti: i test partono da qui e ne valorizzano alcuni. */
function vuota(tipo: string, over: Partial<DatiRiga> = {}): DatiRiga {
  return {
    tipo,
    cerCode: null,
    addebitoId: null,
    riferimento: null,
    descrizione: null,
    tipoQuantita: null,
    quantitaFissa: null,
    unitaMisura: '',
    prezzo: null,
    prezzoSpeciale: false,
    sconto: null,
    codiceIvaId: null,
    provvigione: null,
    tipoProvvigione: null,
    tipologiaRifiuto: null,
    statoFisico: null,
    operazione: null,
    categoriaId: null,
    centroRicavoId: null,
    applicaA: null,
    condizione: null,
    condizioniRiferite: null,
    minimoFatturabile: null,
    minimoPerCategoria: false,
    riferimentoGiorno: null,
    riferimentoMese: null,
    periodoScadenze: null,
    periodoExtraDal: null,
    periodoExtraAl: null,
    stimaAnnuaKg: null,
    cerProposta: [],
    addebitiProposti: [],
    appunti: null,
    notaUsoInterno: null,
    scaglioni: [],
    scadenze: [],
    ...over,
  }
}

const CER = cerCanonico('200301') // "20 03 01"
const CTX = { contrattoAllegato: false }

/** Una riga valida e completa per famiglia. */
const VALIDE: Record<string, DatiRiga> = {
  CER: vuota('CER', {
    cerCode: CER,
    riferimento: 'R1',
    descrizione: 'Rifiuti urbani',
    tipoQuantita: 'PESO_NETTO',
    unitaMisura: 'KG',
    prezzo: '0.12',
    sconto: '10+5',
    codiceIvaId: 'iva-1',
    provvigione: '3',
    tipoProvvigione: 'LORDO',
    tipologiaRifiuto: 'URBANO',
    statoFisico: '1',
    operazione: 'R13',
    categoriaId: 'cat-1',
    centroRicavoId: 'ccr-1',
    condizione: 2,
    minimoFatturabile: '25.00',
    minimoPerCategoria: true,
    stimaAnnuaKg: '1200.50',
    addebitiProposti: ['A0001', 'A0002'],
    appunti: 'Nota',
    notaUsoInterno: 'Interna',
  }),
  V: vuota('V', {
    addebitoId: 'add-1',
    tipoQuantita: 'VOLUME',
    unitaMisura: 'MC',
    prezzo: '10',
    codiceIvaId: 'iva-1',
    cerProposta: [`${CER}/R1`, `${CER}/*`, `${CER}/`, CER],
    stimaAnnuaKg: '10',
  }),
  F: vuota('F', {
    addebitoId: 'add-1',
    quantitaFissa: '2',
    unitaMisura: 'NR',
    prezzo: '100',
    codiceIvaId: 'iva-1',
    condizione: 1,
    periodoScadenze: 'TA',
    scadenze: [
      { ordine: 1, giorno: 15, mese: 1, anno: null },
      { ordine: 2, giorno: 15, mese: 4, anno: null },
    ],
  }),
  T: vuota('TS', {
    addebitoId: 'add-1',
    unitaMisura: 'KG',
    prezzo: '0.1',
    codiceIvaId: 'iva-1',
    condizione: 3,
  }),
  N: vuota('NM', { addebitoId: 'add-1', unitaMisura: 'NR', prezzo: '1', codiceIvaId: 'iva-1' }),
  M: vuota('MF', { addebitoId: 'add-1', unitaMisura: 'NR', prezzo: '50', codiceIvaId: 'iva-1' }),
  A: vuota('$A', { addebitoId: 'add-1', unitaMisura: 'NR', prezzo: '50', codiceIvaId: 'iva-1' }),
}

const SCAGLIONI = [
  { ordine: 1, finoA: '1000', prezzo: '0.5', sconto: null, provvigione: null, tipoCalcolo: 'A' },
  { ordine: 7, finoA: null, prezzo: '0.3', sconto: null, provvigione: null, tipoCalcolo: 'A' },
] as const

function messaggi(d: DatiRiga, ctx = CTX): string[] {
  return validaRiga(d, ctx).map(e => e.messaggio)
}

describe('CAMPI_PER_FAMIGLIA e ETICHETTE_CAMPI_RIGA (D9)', () => {
  it('ogni campo ha un etichetta italiana', () => {
    expect(TUTTI_I_CAMPI).toHaveLength(36)
    for (const c of TUTTI_I_CAMPI) expect(ETICHETTE_CAMPI_RIGA[c].length).toBeGreaterThan(1)
  })

  it('i campi per famiglia sono quelli della tabella di D9', () => {
    const f = CAMPI_PER_FAMIGLIA
    expect(f.CER).toEqual(
      expect.arrayContaining([
        'cerCode',
        'tipoQuantita',
        'tipologiaRifiuto',
        'statoFisico',
        'scaglioni',
      ])
    )
    expect(f.CER).not.toContain('addebitoId')
    expect(f.VARIABILE).toEqual(
      expect.arrayContaining(['addebitoId', 'cerProposta', 'tipoQuantita'])
    )
    expect(f.VARIABILE).not.toContain('addebitiProposti')
    expect(f.FISSO).toEqual(
      expect.arrayContaining(['quantitaFissa', 'periodoScadenze', 'scadenze', 'condizione'])
    )
    expect(f.FISSO).not.toContain('scaglioni')
    expect(f.QUANTITA_MOVIMENTI).toContain('scaglioni')
    expect(f.CONTEGGIO).toContain('scaglioni')
    expect(f.MINIMO).not.toContain('scaglioni')
    expect(f.MINIMO).not.toContain('sconto')
    expect(f.ACCONTO).not.toContain('sconto')
    expect(f.ACCONTO).not.toContain('condizione')
  })

  it('i campi comuni stanno in ogni famiglia', () => {
    for (const lista of Object.values(CAMPI_PER_FAMIGLIA)) {
      for (const c of ['tipo', 'unitaMisura', 'prezzo', 'codiceIvaId', 'riferimento'] as const) {
        expect(lista).toContain(c)
      }
    }
  })
})

describe('validaRiga: una riga valida e completa per famiglia (D9, D10)', () => {
  it.each(Object.keys(VALIDE))('famiglia %s', k => {
    expect(validaRiga(VALIDE[k], CTX)).toEqual([])
  })

  it('con il prezzo speciale a scaglioni', () => {
    const d = vuota('CER', {
      ...VALIDE.CER,
      prezzo: null,
      sconto: null,
      provvigione: null,
      tipoProvvigione: null,
      condizione: null,
      minimoFatturabile: null,
      minimoPerCategoria: false,
      prezzoSpeciale: true,
      applicaA: 'DOCUMENTO',
      scaglioni: [...SCAGLIONI],
    })
    expect(validaRiga(d, CTX)).toEqual([])
  })
})

describe('validaRiga: tipo e codice (D10, allegato D17)', () => {
  it('tipo non ammesso: errore sul campo tipo e nient altro', () => {
    expect(validaRiga(vuota('XX'), CTX)).toEqual([
      { campo: 'tipo', messaggio: 'Tipo di addebito non ammesso.' },
    ])
  })

  it('CER: codice mancante, di capitolo, fuori forma', () => {
    const base = VALIDE.CER
    expect(validaRiga({ ...base, cerCode: null }, CTX)).toContainEqual({
      campo: 'cerCode',
      messaggio: 'Indica il codice CER.',
    })
    for (const brutto of ['20 03 00', '20 00 00', '2003', 'ABCDEF', '20 03 0A']) {
      expect(validaRiga({ ...base, cerCode: brutto }, CTX)).toContainEqual({
        campo: 'cerCode',
        messaggio: 'Il codice CER non è nel catalogo o indica un capitolo.',
      })
    }
    expect(validaRiga({ ...base, cerCode: '20 01 21*' }, CTX)).toEqual([])
  })

  it('CER senza addebito, non CER senza codice CER ma con addebito', () => {
    expect(validaRiga({ ...VALIDE.CER, addebitoId: 'a' }, CTX)).toContainEqual({
      campo: 'addebitoId',
      messaggio: 'Una riga CER non ha un addebito.',
    })
    expect(validaRiga({ ...VALIDE.F, addebitoId: null }, CTX)).toContainEqual({
      campo: 'addebitoId',
      messaggio: 'Indica l’addebito.',
    })
    expect(validaRiga({ ...VALIDE.F, cerCode: CER }, CTX).map(e => e.campo)).toContain('cerCode')
  })

  it('riferimento: massimo 8 caratteri, niente spazio iniziale, vuoto non ammesso', () => {
    expect(messaggi({ ...VALIDE.CER, riferimento: '123456789' })).toContain(
      'Il riferimento non può superare 8 caratteri.'
    )
    expect(messaggi({ ...VALIDE.CER, riferimento: ' R1' })).toContain(
      'Il riferimento non può iniziare con uno spazio.'
    )
    expect(messaggi({ ...VALIDE.CER, riferimento: '' })).toContain(
      'Il riferimento, se indicato, non può essere vuoto.'
    )
    expect(validaRiga({ ...VALIDE.CER, riferimento: '?' }, CTX)).toEqual([])
    expect(validaRiga({ ...VALIDE.CER, riferimento: '12345678' }, CTX)).toEqual([])
  })

  it('contratto allegato: niente CER, solo tipi T (D17)', () => {
    const ctx = { contrattoAllegato: true }
    expect(validaRiga(VALIDE.CER, ctx)).toContainEqual({
      campo: 'tipo',
      messaggio: 'In un contratto allegato non si inseriscono righe CER.',
    })
    expect(validaRiga(VALIDE.V, ctx)).toContainEqual({
      campo: 'tipo',
      messaggio: 'In un contratto allegato si inseriscono solo addebiti di tipo T.',
    })
    expect(validaRiga(VALIDE.N, ctx).map(e => e.messaggio)).toContain(
      'In un contratto allegato si inseriscono solo addebiti di tipo T.'
    )
    expect(validaRiga(VALIDE.T, ctx)).toEqual([])
    expect(validaRiga({ ...VALIDE.T, tipo: 'T123' }, ctx)).toEqual([])
  })
})

describe('validaRiga: quantità e unità di misura (E11)', () => {
  it('quantità obbligatoria per CER e V', () => {
    expect(validaRiga({ ...VALIDE.CER, tipoQuantita: null }, CTX)).toContainEqual({
      campo: 'tipoQuantita',
      messaggio: 'Indica la quantità.',
    })
    expect(messaggi({ ...VALIDE.V, tipoQuantita: null })).toContain('Indica la quantità.')
  })

  it('unità obbligatoria e di forma valida', () => {
    expect(validaRiga({ ...VALIDE.T, unitaMisura: '' }, CTX)).toContainEqual({
      campo: 'unitaMisura',
      messaggio: 'Indica l’unità di misura.',
    })
    for (const um of ['kg', 'ABCD', 'K G']) {
      expect(messaggi({ ...VALIDE.T, unitaMisura: um })).toContain(
        'L’unità di misura non è valida: al massimo tre caratteri tra lettere maiuscole, cifre e / % #.'
      )
    }
  })

  it('% e # solo per $D: su V rifiutato, su $D ammesso', () => {
    const msg = 'Le unità % e # valgono solo per le detrazioni ($D).'
    expect(messaggi({ ...VALIDE.V, unitaMisura: '%' })).toContain(msg)
    expect(messaggi({ ...VALIDE.T, unitaMisura: '#' })).toContain(msg)
    expect(validaRiga({ ...VALIDE.A, tipo: '$D', unitaMisura: '%' }, CTX)).toEqual([])
    expect(validaRiga({ ...VALIDE.A, tipo: '$D', unitaMisura: '#' }, CTX)).toEqual([])
    expect(messaggi({ ...VALIDE.A, tipo: '$A', unitaMisura: '%' })).toContain(msg)
  })

  it('K/M e K/L solo con quantità Altro', () => {
    const msg = 'Con l’unità K/M o K/L la quantità è «Altro».'
    expect(messaggi({ ...VALIDE.V, unitaMisura: 'K/M' })).toContain(msg)
    expect(messaggi({ ...VALIDE.T, unitaMisura: 'K/L' })).toContain(msg)
    expect(validaRiga({ ...VALIDE.V, tipoQuantita: 'ALTRO', unitaMisura: 'K/M' }, CTX)).toEqual([])
  })

  it('quantità a peso: KG o TON, GR solo per il peso netto', () => {
    const msg = 'Per una quantità a peso l’unità di misura è KG o TON (GR solo per il peso netto).'
    expect(messaggi({ ...VALIDE.CER, unitaMisura: 'LT' })).toContain(msg)
    expect(messaggi({ ...VALIDE.CER, tipoQuantita: 'PESO_LORDO', unitaMisura: 'GR' })).toContain(
      msg
    )
    expect(
      validaRiga({ ...VALIDE.CER, tipoQuantita: 'PESO_NETTO', unitaMisura: 'GR' }, CTX)
    ).toEqual([])
    expect(
      validaRiga({ ...VALIDE.CER, tipoQuantita: 'PESO_LORDO', unitaMisura: 'TON' }, CTX)
    ).toEqual([])
  })

  it('quantità a volume: LT o MC', () => {
    expect(messaggi({ ...VALIDE.V, unitaMisura: 'KG' })).toContain(
      'Per una quantità a volume l’unità di misura è LT o MC.'
    )
    expect(validaRiga({ ...VALIDE.V, unitaMisura: 'LT' }, CTX)).toEqual([])
  })

  it('quantità fissa: solo F, non negativa, massimo tre decimali', () => {
    expect(validaRiga({ ...VALIDE.F, quantitaFissa: '-1' }, CTX)).toContainEqual({
      campo: 'quantitaFissa',
      messaggio: 'La quantità fissa non può essere negativa.',
    })
    expect(messaggi({ ...VALIDE.F, quantitaFissa: '1.2345' })).toContain(
      'La quantità fissa è un numero con al massimo tre decimali.'
    )
    expect(validaRiga({ ...VALIDE.F, quantitaFissa: null }, CTX)).toEqual([])
    expect(validaRiga({ ...VALIDE.F, quantitaFissa: '0' }, CTX)).toEqual([])
    expect(validaRiga({ ...VALIDE.T, quantitaFissa: '1' }, CTX)).toContainEqual({
      campo: 'quantitaFissa',
      messaggio: 'Il campo Quantità fissa non vale per gli addebiti di tipo TS.',
    })
  })

  it('quantità fissa e stima annua negative: un solo errore chiaro ciascuna', () => {
    const r = validaRiga({ ...VALIDE.F, quantitaFissa: '-5', stimaAnnuaKg: null }, CTX)
    expect(r).toEqual([
      { campo: 'quantitaFissa', messaggio: 'La quantità fissa non può essere negativa.' },
    ])
    expect(validaRiga({ ...VALIDE.CER, stimaAnnuaKg: '-3' }, CTX)).toContainEqual({
      campo: 'stimaAnnuaKg',
      messaggio: 'La stima annua non può essere negativa.',
    })
  })
})

describe('validaRiga: prezzo, IVA, sconto, provvigione (E10, E11)', () => {
  it('prezzo obbligatorio anche zero senza prezzo speciale', () => {
    expect(validaRiga({ ...VALIDE.T, prezzo: null }, CTX)).toContainEqual({
      campo: 'prezzo',
      messaggio: 'Indica il prezzo, anche zero.',
    })
    expect(validaRiga({ ...VALIDE.T, prezzo: '0' }, CTX)).toEqual([])
  })

  it('prezzo: non negativo, al massimo sei decimali', () => {
    const msg = 'Il prezzo deve essere un numero non negativo con al massimo sei decimali.'
    for (const p of ['1.1234567', '-1', 'abc', '123456789', '1e3']) {
      expect(validaRiga({ ...VALIDE.T, prezzo: p }, CTX)).toContainEqual({
        campo: 'prezzo',
        messaggio: msg,
      })
    }
    expect(validaRiga({ ...VALIDE.T, prezzo: '1.123456' }, CTX)).toEqual([])
  })

  it('codice IVA obbligatorio', () => {
    expect(validaRiga({ ...VALIDE.T, codiceIvaId: null }, CTX)).toContainEqual({
      campo: 'codiceIvaId',
      messaggio: 'Indica il codice IVA.',
    })
  })

  it('sconto a cascata; mai per i tipi $ e M', () => {
    const msg =
      'Lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'
    for (const s of ['10++5', '100', '1+2+3+4', 'abc']) {
      expect(validaRiga({ ...VALIDE.T, sconto: s }, CTX)).toContainEqual({
        campo: 'sconto',
        messaggio: msg,
      })
    }
    const nonAmmesso = 'Per questo tipo di addebito non si indica lo sconto.'
    expect(validaRiga({ ...VALIDE.M, sconto: '5' }, CTX)).toContainEqual({
      campo: 'sconto',
      messaggio: nonAmmesso,
    })
    expect(messaggi({ ...VALIDE.A, sconto: '5' })).toContain(nonAmmesso)
    expect(messaggi({ ...VALIDE.M, tipo: 'M123', sconto: '5' })).toContain(nonAmmesso)
  })

  it('provvigione a cascata con tipo obbligatorio; mai per $D e $R', () => {
    const msg =
      'La provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'
    expect(
      validaRiga({ ...VALIDE.T, provvigione: '10++5', tipoProvvigione: 'LORDO' }, CTX)
    ).toContainEqual({
      campo: 'provvigione',
      messaggio: msg,
    })
    expect(
      validaRiga({ ...VALIDE.T, provvigione: '5', tipoProvvigione: null }, CTX)
    ).toContainEqual({
      campo: 'tipoProvvigione',
      messaggio: 'Indica su cosa si calcola la provvigione.',
    })
    const mai = 'Per questo tipo di addebito non si indica la provvigione.'
    for (const t of ['$D', '$R']) {
      expect(
        validaRiga({ ...VALIDE.A, tipo: t, provvigione: '5', tipoProvvigione: 'LORDO' }, CTX)
      ).toContainEqual({ campo: 'provvigione', messaggio: mai })
    }
    expect(validaRiga({ ...VALIDE.A, provvigione: '5', tipoProvvigione: 'LORDO' }, CTX)).toEqual([])
  })

  it('minimo fatturabile e stima non negativi, con due decimali', () => {
    expect(validaRiga({ ...VALIDE.CER, minimoFatturabile: '-1' }, CTX)).toContainEqual({
      campo: 'minimoFatturabile',
      messaggio: 'Il minimo fatturabile è un numero non negativo con al massimo due decimali.',
    })
    expect(messaggi({ ...VALIDE.CER, minimoFatturabile: '1.234' })).toContain(
      'Il minimo fatturabile è un numero non negativo con al massimo due decimali.'
    )
    expect(messaggi({ ...VALIDE.CER, stimaAnnuaKg: '1.234' })).toContain(
      'La stima annua è un numero con al massimo due decimali.'
    )
  })
})

describe('validaRiga: lunghezze e liste (D9, vincoli del database)', () => {
  it.each([
    ['descrizione', 46, 'La descrizione non può superare 45 caratteri.'],
    ['appunti', 136, 'Gli appunti non possono superare 135 caratteri.'],
    ['notaUsoInterno', 46, 'La nota per uso interno non può superare 45 caratteri.'],
    ['statoFisico', 11, 'Lo stato fisico non può superare 10 caratteri.'],
    ['operazione', 11, 'L’operazione non può superare 10 caratteri.'],
  ] as const)('%s', (campo, lunghezza, msg) => {
    expect(validaRiga({ ...VALIDE.CER, [campo]: 'x'.repeat(lunghezza) }, CTX)).toContainEqual({
      campo,
      messaggio: msg,
    })
    expect(validaRiga({ ...VALIDE.CER, [campo]: 'x'.repeat(lunghezza - 1) }, CTX)).toEqual([])
  })

  it('condizione 1-9', () => {
    for (const c of [0, 10, 1.5, Number.NaN]) {
      expect(validaRiga({ ...VALIDE.T, condizione: c }, CTX)).toContainEqual({
        campo: 'condizione',
        messaggio: 'La condizione è un numero da 1 a 9.',
      })
    }
  })

  it('tipo provvigione, tipo quantità, tipologia: valori ammessi', () => {
    expect(messaggi({ ...VALIDE.CER, tipoProvvigione: 'X' as never })).toContain(
      'Il tipo di provvigione non è ammesso.'
    )
    expect(messaggi({ ...VALIDE.CER, tipoQuantita: 'X' as never })).toContain(
      'Il tipo di quantità non è ammesso.'
    )
    expect(messaggi({ ...VALIDE.CER, tipologiaRifiuto: 'X' as never })).toContain(
      'La tipologia del rifiuto non è ammessa.'
    )
  })

  it('cerProposta e addebitiProposti: limiti', () => {
    expect(
      validaRiga({ ...VALIDE.V, cerProposta: Array.from({ length: 51 }, () => CER) }, CTX)
    ).toContainEqual({
      campo: 'cerProposta',
      messaggio: 'I codici CER proposti sono al massimo 50.',
    })
    expect(
      validaRiga({ ...VALIDE.CER, addebitiProposti: Array.from({ length: 51 }, () => 'A') }, CTX)
    ).toContainEqual({
      campo: 'addebitiProposti',
      messaggio: 'Gli addebiti proposti sono al massimo 50.',
    })
    expect(messaggi({ ...VALIDE.CER, addebitiProposti: ['ABCDEF'] })).toContain(
      'Addebito proposto 1: il codice non può superare 5 caratteri.'
    )
    expect(messaggi({ ...VALIDE.CER, addebitiProposti: [''] })).toContain(
      'Addebito proposto 1: indica il codice.'
    )
  })
})

describe('validaRiga: prezzo speciale (D12, via Task 16a)', () => {
  const speciale = (over: Partial<DatiRiga> = {}): DatiRiga =>
    vuota('CER', {
      ...VALIDE.CER,
      prezzo: null,
      sconto: null,
      provvigione: null,
      tipoProvvigione: null,
      condizione: null,
      minimoFatturabile: null,
      minimoPerCategoria: false,
      prezzoSpeciale: true,
      applicaA: 'DOCUMENTO',
      scaglioni: [...SCAGLIONI],
      ...over,
    })

  it('applicaA obbligatorio, con l errore sul campo giusto', () => {
    expect(validaRiga(speciale({ applicaA: null }), CTX)).toContainEqual({
      campo: 'applicaA',
      messaggio: 'Indica a cosa si applica il prezzo speciale.',
    })
  })

  it('il minimo con il prezzo speciale e il prezzo speciale con condizione', () => {
    expect(validaRiga(speciale({ minimoFatturabile: '5' }), CTX)).toContainEqual({
      campo: 'minimoFatturabile',
      messaggio: 'Con il prezzo speciale non si indica il minimo fatturabile.',
    })
    expect(validaRiga(speciale({ condizione: 2 }), CTX)).toContainEqual({
      campo: 'condizione',
      messaggio: 'Il prezzo speciale non si usa negli addebiti condizionati.',
    })
  })

  it('le fasce sbagliate danno errori sul campo scaglioni, senza doppioni', () => {
    const r = validaRiga(speciale({ scaglioni: [] }), CTX)
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(e => e.campo === 'scaglioni')).toBe(true)
    expect(new Set(r.map(e => e.messaggio)).size).toBe(r.length)
  })

  it('conguaglio senza data: errore sul riferimento; condizioni con cifre ripetute', () => {
    expect(validaRiga(speciale({ applicaA: 'CONGUAGLIO_365' }), CTX)).toContainEqual({
      campo: 'riferimentoGiorno',
      messaggio: 'Per il conguaglio indica la data (giorno e mese).',
    })
    expect(
      validaRiga(speciale({ condizioniRiferite: '11C', scaglioni: [...SCAGLIONI] }), CTX).map(
        e => e.campo
      )
    ).toContain('condizioniRiferite')
  })

  it('provvigione nella fascia senza tipo: errore sul tipo provvigione', () => {
    const fasce = [{ ...SCAGLIONI[0], provvigione: '5' }, { ...SCAGLIONI[1] }]
    expect(validaRiga(speciale({ scaglioni: fasce }), CTX)).toContainEqual({
      campo: 'tipoProvvigione',
      messaggio: 'Indica su cosa si calcola la provvigione.',
    })
  })

  it('senza prezzo speciale non ci sono fasce, applicaA o riferimento', () => {
    const msg = 'I dati del prezzo speciale si indicano solo con il prezzo speciale.'
    expect(validaRiga({ ...VALIDE.CER, scaglioni: [...SCAGLIONI] }, CTX)).toContainEqual({
      campo: 'scaglioni',
      messaggio: msg,
    })
    expect(validaRiga({ ...VALIDE.CER, applicaA: 'DOCUMENTO' }, CTX)).toContainEqual({
      campo: 'applicaA',
      messaggio: msg,
    })
    expect(
      validaRiga({ ...VALIDE.CER, riferimentoGiorno: 1, riferimentoMese: 1 }, CTX)
    ).toContainEqual({
      campo: 'riferimentoGiorno',
      messaggio: msg,
    })
  })

  it('prezzo assente con il prezzo speciale è valido', () => {
    expect(validaRiga(speciale(), CTX)).toEqual([])
  })
})

describe('validaRiga: scadenze dei fissi (D14, via Task 18)', () => {
  it('data non valida: errore sul campo scadenze', () => {
    const d = {
      ...VALIDE.F,
      scadenze: [{ ordine: 1, giorno: 31, mese: 4, anno: null }],
    }
    expect(validaRiga(d, CTX)).toContainEqual({
      campo: 'scadenze',
      messaggio: 'Scadenza 1: data non valida.',
    })
  })

  it('periodo extra obbligatorio con XA, XD, YC; vietato negli altri casi', () => {
    for (const p of ['XA', 'XD', 'YC'] as const) {
      const r = validaRiga({ ...VALIDE.F, periodoScadenze: p }, CTX)
      expect(r).toContainEqual({
        campo: 'periodoExtraDal',
        messaggio: 'Per una scadenza extra indica il periodo dal … al ….',
      })
    }
    expect(
      validaRiga(
        {
          ...VALIDE.F,
          periodoScadenze: 'XA',
          periodoExtraDal: '2026-01-01',
          periodoExtraAl: '2026-03-31',
        },
        CTX
      )
    ).toEqual([])
    expect(
      validaRiga(
        { ...VALIDE.F, periodoExtraDal: '2026-01-01', periodoExtraAl: '2026-03-31' },
        CTX
      ).map(e => e.campo)
    ).toContain('periodoExtraDal')
  })

  it('fine del periodo extra prima dell inizio', () => {
    const r = validaRiga(
      {
        ...VALIDE.F,
        periodoScadenze: 'XA',
        periodoExtraDal: '2026-05-01',
        periodoExtraAl: '2026-04-01',
      },
      CTX
    )
    expect(r.length).toBe(1)
    expect(r[0].campo).toBe('periodoExtraDal')
  })

  it('periodo non ammesso', () => {
    expect(validaRiga({ ...VALIDE.F, periodoScadenze: 'ZZ' as never }, CTX)).toContainEqual({
      campo: 'periodoScadenze',
      messaggio: 'Il periodo delle scadenze non è ammesso.',
    })
  })

  it('scadenze senza periodo: ammesse (scelta documentata, E19)', () => {
    // Il piano (D9, D14) e il vincolo del database tengono il periodo facoltativo; senza periodo
    // la scadenza resta valida ma non ha competenza (periodoCompetenza richiede un periodo).
    expect(validaRiga({ ...VALIDE.F, periodoScadenze: null }, CTX)).toEqual([])
  })

  it('scadenze fuori da F: errore (il database lo vieta)', () => {
    expect(
      validaRiga({ ...VALIDE.T, scadenze: [{ ordine: 1, giorno: 1, mese: 1, anno: null }] }, CTX)
    ).toContainEqual({
      campo: 'scadenze',
      messaggio: 'Il campo Scadenze non vale per gli addebiti di tipo TS.',
    })
  })
})

describe('validaRiga: errori e dati ricevuti', () => {
  it('nessun messaggio riporta il valore ricevuto', () => {
    const segreto = 'ZZ9-VALORE-SEGRETO'
    const brutta = vuota('CER', {
      cerCode: segreto,
      riferimento: ` ${segreto}`,
      tipoQuantita: segreto as never,
      unitaMisura: segreto,
      prezzo: segreto,
      sconto: segreto,
      provvigione: segreto,
      tipoProvvigione: segreto as never,
      tipologiaRifiuto: segreto as never,
      minimoFatturabile: segreto,
      stimaAnnuaKg: segreto,
      cerProposta: [segreto],
      addebitiProposti: [segreto],
      descrizione: segreto.repeat(5),
      condizione: 99,
      statoFisico: segreto,
      scadenze: [{ ordine: 1, giorno: 99, mese: 99, anno: 9999 }],
    })
    const r = validaRiga(brutta, CTX)
    expect(r.length).toBeGreaterThan(8)
    for (const e of r) expect(e.messaggio).not.toContain(segreto)
  })

  it('un errore per ogni regola, nell ordine dei campi di D10', () => {
    const ordine = validaRiga(vuota('CER', { unitaMisura: '', tipoQuantita: null }), CTX).map(
      e => e.campo
    )
    // cerCode prima di tipoQuantita prima di unitaMisura prima di prezzo prima di codiceIvaId
    const posizione = (c: CampoRiga): number => ordine.indexOf(c)
    expect(posizione('cerCode')).toBeLessThan(posizione('tipoQuantita'))
    expect(posizione('tipoQuantita')).toBeLessThan(posizione('unitaMisura'))
    expect(posizione('unitaMisura')).toBeLessThan(posizione('prezzo'))
    expect(posizione('prezzo')).toBeLessThan(posizione('codiceIvaId'))
  })
})

describe('normalizzaRiga (R36, R37)', () => {
  const inviati = (g: Record<string, unknown>): ReadonlySet<string> => new Set(Object.keys(g))

  it('porta una riga CER dal corpo grezzo ai dati, con il CER nella forma del catalogo (R35)', () => {
    const g = {
      tipo: ' cer ',
      cerCode: '200301',
      riferimento: '',
      descrizione: '  Urbani  ',
      tipoQuantita: 'PESO_NETTO',
      unitaMisura: ' kg ',
      prezzo: '0,12',
      sconto: '10 + 5,5',
      codiceIvaId: 'iva-1',
    }
    const { dati, errori } = normalizzaRiga(g, inviati(g))
    expect(errori).toEqual([])
    expect(dati.tipo).toBe('CER')
    expect(dati.cerCode).toBe('20 03 01')
    expect(dati.riferimento).toBeNull()
    expect(dati.descrizione).toBe('Urbani')
    expect(dati.unitaMisura).toBe('KG')
    expect(dati.prezzo).toBe('0.12')
    expect(dati.sconto).toBe('10+5.5')
    expect(validaRiga(dati, CTX)).toEqual([])
  })

  it('cambio di tipo F -> V: il campo della famiglia precedente, non inviato, si svuota senza errore (T21 m1)', () => {
    // Nel PATCH `inviati` contiene solo le chiavi cambiate: la quantita' fissa e' rimasta uguale
    // ma non vale piu' per il tipo V, quindi e' un valore ereditato dalla riga di prima e non una
    // scelta dell'utente. Se invece la manda con un valore e la cambia, e' un errore sul campo.
    const g = { tipo: 'V', quantitaFissa: '2', tipoQuantita: 'PESO_NETTO', unitaMisura: 'KG' }
    const { dati, errori } = normalizzaRiga(g, new Set(['tipo']))
    expect(errori).toEqual([])
    expect(dati.quantitaFissa).toBeNull()
    const inviata = normalizzaRiga(g, new Set(['tipo', 'quantitaFissa']))
    expect(inviata.errori).toEqual([expect.objectContaining({ campo: 'quantitaFissa' })])
  })

  it('il CER con asterisco e le cifre sparse passano da cerCanonico', () => {
    const g = { tipo: 'CER', cerCode: '200121*' }
    expect(normalizzaRiga(g, inviati(g)).dati.cerCode).toBe('20 01 21*')
  })

  it('la tipologia è proposta dal CER se non indicata, e vale quella indicata', () => {
    const g1 = { tipo: 'CER', cerCode: '20 03 01' }
    expect(normalizzaRiga(g1, inviati(g1)).dati.tipologiaRifiuto).toBe('URBANO')
    const g2 = { tipo: 'CER', cerCode: '17 04 05' }
    expect(normalizzaRiga(g2, inviati(g2)).dati.tipologiaRifiuto).toBe('SPECIALE')
    const g3 = { tipo: 'CER', cerCode: '17 04 05', tipologiaRifiuto: 'SPECIALE_PERICOLOSO' }
    expect(normalizzaRiga(g3, inviati(g3)).dati.tipologiaRifiuto).toBe('SPECIALE_PERICOLOSO')
  })

  it('il periodo extra vuoto vale non inviato (R37)', () => {
    const g = {
      tipo: 'F',
      addebitoId: 'a',
      unitaMisura: 'NR',
      prezzo: '1',
      codiceIvaId: 'i',
      periodoScadenze: 'TA',
      periodoExtraDal: '',
      periodoExtraAl: '',
    }
    const { dati, errori } = normalizzaRiga(g, inviati(g))
    expect(errori).toEqual([])
    expect(dati.periodoExtraDal).toBeNull()
    expect(dati.periodoExtraAl).toBeNull()
    expect(validaRiga(dati, CTX)).toEqual([])
  })

  it('il periodo extra con una Date o una data con orario', () => {
    const g = {
      tipo: 'F',
      periodoScadenze: 'XA',
      periodoExtraDal: new Date('2026-01-01T00:00:00Z'),
      periodoExtraAl: '2026-03-31T00:00:00.000Z',
    }
    const { dati } = normalizzaRiga(g, inviati(g))
    expect(dati.periodoExtraDal).toBe('2026-01-01')
    expect(dati.periodoExtraAl).toBe('2026-03-31')
  })

  it('fuori famiglia: non inviato o inviato vuoto è null senza errore', () => {
    const g = {
      tipo: 'TS',
      addebitoId: 'a',
      quantitaFissa: '',
      tipoQuantita: null,
      cerProposta: [],
      scadenze: [],
      periodoScadenze: '',
      scaglioni: [],
      minimoPerCategoria: false,
      statoFisico: '',
    }
    const r = normalizzaRiga({ ...g, cerCode: 'non inviato ma presente' }, inviati(g))
    expect(r.errori).toEqual([])
    expect(r.dati.quantitaFissa).toBeNull()
    expect(r.dati.tipoQuantita).toBeNull()
    expect(r.dati.cerProposta).toEqual([])
    expect(r.dati.scadenze).toEqual([])
    expect(r.dati.periodoScadenze).toBeNull()
    expect(r.dati.cerCode).toBeNull()
    expect(r.dati.statoFisico).toBeNull()
  })

  it('fuori famiglia inviato con un valore: errore sul campo, dato azzerato', () => {
    const g = {
      tipo: 'NM',
      addebitoId: 'a',
      quantitaFissa: '5',
      cerProposta: [`${CER}/R1`],
      scadenze: [{ ordine: 1, giorno: 1, mese: 1, anno: null }],
      minimoPerCategoria: true,
      prezzoSpeciale: true,
      periodoExtraDal: '2026-01-01',
    }
    const { dati, errori } = normalizzaRiga(g, inviati(g))
    expect(errori).toEqual(
      expect.arrayContaining([
        {
          campo: 'quantitaFissa',
          messaggio: 'Il campo Quantità fissa non vale per gli addebiti di tipo NM.',
        },
        {
          campo: 'cerProposta',
          messaggio: 'Il campo CER proposti non vale per gli addebiti di tipo NM.',
        },
        { campo: 'scadenze', messaggio: 'Il campo Scadenze non vale per gli addebiti di tipo NM.' },
        {
          campo: 'minimoPerCategoria',
          messaggio: 'Il campo Minimo per categoria non vale per gli addebiti di tipo NM.',
        },
        {
          campo: 'periodoExtraDal',
          messaggio: 'Il campo Periodo extra dal non vale per gli addebiti di tipo NM.',
        },
      ])
    )
    // NM ammette il prezzo speciale: nessun errore su quel campo
    expect(errori.map(e => e.campo)).not.toContain('prezzoSpeciale')
    expect(dati.quantitaFissa).toBeNull()
    expect(dati.cerProposta).toEqual([])
    expect(dati.scadenze).toEqual([])
    expect(dati.minimoPerCategoria).toBe(false)
    expect(dati.periodoExtraDal).toBeNull()
  })

  it('lo sconto su un tipo $ o M ha il messaggio di D10', () => {
    const g = { tipo: '$A', addebitoId: 'a', sconto: '10' }
    expect(normalizzaRiga(g, inviati(g)).errori).toEqual([
      { campo: 'sconto', messaggio: 'Per questo tipo di addebito non si indica lo sconto.' },
    ])
  })

  it('con prezzoSpeciale falso le fasce non inviate diventano vuote, inviate non vuote sono un errore (R37)', () => {
    const g1 = { tipo: 'CER', cerCode: '20 03 01', prezzoSpeciale: false }
    expect(normalizzaRiga(g1, inviati(g1)).dati.scaglioni).toEqual([])
    const g2 = {
      tipo: 'CER',
      cerCode: '20 03 01',
      prezzoSpeciale: false,
      scaglioni: [{ ordine: 1, finoA: '10', prezzo: '1', tipoCalcolo: 'A' }],
    }
    const { dati, errori } = normalizzaRiga(g2, inviati(g2))
    expect(errori).toEqual([])
    // la regola "solo con il prezzo speciale" la dà validaRiga sui dati normalizzati
    expect(
      validaRiga(
        { ...dati, tipoQuantita: 'PESO_NETTO', unitaMisura: 'KG', prezzo: '1', codiceIvaId: 'i' },
        CTX
      )
    ).toContainEqual({
      campo: 'scaglioni',
      messaggio: 'I dati del prezzo speciale si indicano solo con il prezzo speciale.',
    })
  })

  it('con prezzoSpeciale falso anche applicaA e riferimento non inviati si svuotano', () => {
    const g = {
      tipo: 'CER',
      prezzoSpeciale: false,
      applicaA: 'DOCUMENTO',
      condizioniRiferite: '1C',
      riferimentoGiorno: 1,
      riferimentoMese: 1,
    }
    const { dati } = normalizzaRiga(g, new Set(['prezzoSpeciale']))
    expect(dati.applicaA).toBeNull()
    expect(dati.condizioniRiferite).toBeNull()
    expect(dati.riferimentoGiorno).toBeNull()
    expect(dati.riferimentoMese).toBeNull()
  })

  it('fasce e scadenze: numeri come stringhe, ordinate per ordine, anno vuoto = ogni anno', () => {
    const g = {
      tipo: 'F',
      scadenze: [
        { ordine: '2', giorno: '15', mese: '4', anno: '' },
        { ordine: 1, giorno: 15, mese: 1, anno: null },
      ],
    }
    const { dati } = normalizzaRiga(g, inviati(g))
    expect(dati.scadenze).toEqual([
      { ordine: 1, giorno: 15, mese: 1, anno: null },
      { ordine: 2, giorno: 15, mese: 4, anno: null },
    ])
    const g2 = {
      tipo: 'TS',
      prezzoSpeciale: true,
      scaglioni: [
        { ordine: 7, finoA: '', prezzo: '0,3', sconto: '', provvigione: ' ', tipoCalcolo: 'a' },
        { ordine: 1, finoA: '1000,5', prezzo: 1, tipoCalcolo: 'A' },
      ],
    }
    const n = normalizzaRiga(g2, inviati(g2)).dati
    expect(n.scaglioni[0]).toEqual({
      ordine: 1,
      finoA: '1000.5',
      prezzo: '1',
      sconto: null,
      provvigione: null,
      tipoCalcolo: 'A',
    })
    expect(n.scaglioni[1]).toEqual({
      ordine: 7,
      finoA: null,
      prezzo: '0.3',
      sconto: null,
      provvigione: null,
      tipoCalcolo: 'A',
    })
  })

  it('numeri JSON e valori di tipo sbagliato non rompono la normalizzazione', () => {
    const g = {
      tipo: 'F',
      quantitaFissa: 2,
      prezzo: 10.5,
      condizione: '3',
      riferimentoGiorno: '',
      cerProposta: 'non una lista',
    }
    const { dati } = normalizzaRiga(g, inviati(g))
    expect(dati.quantitaFissa).toBe('2')
    expect(dati.prezzo).toBe('10.5')
    expect(dati.condizione).toBe(3)
    expect(dati.cerProposta).toEqual([])
  })

  it('tipo non valido: i dati restano e validaRiga dà l errore del tipo', () => {
    const g = { tipo: 'QQ', prezzo: '1' }
    const { dati, errori } = normalizzaRiga(g, inviati(g))
    expect(errori).toEqual([])
    expect(dati.prezzo).toBe('1')
    expect(validaRiga(dati, CTX)).toEqual([
      { campo: 'tipo', messaggio: 'Tipo di addebito non ammesso.' },
    ])
  })

  it('cerProposta e addebitiProposti: elementi con il CER canonico', () => {
    const g = { tipo: 'V', cerProposta: ['200301/R1', ' 200121*/* ', '170405/', '200301'] }
    expect(normalizzaRiga(g, inviati(g)).dati.cerProposta).toEqual([
      '20 03 01/R1',
      '20 01 21*/*',
      '17 04 05/',
      '20 03 01',
    ])
  })
})

describe('tipologiaDaCer e formaCerValida (R35)', () => {
  it('capitolo 20 urbano, asterisco pericoloso', () => {
    expect(tipologiaDaCer(cerCanonico('200301'))).toBe('URBANO')
    expect(tipologiaDaCer('20 01 21*')).toBe('URBANO_PERICOLOSO')
    expect(tipologiaDaCer('17 04 05')).toBe('SPECIALE')
    expect(tipologiaDaCer('17 06 01*')).toBe('SPECIALE_PERICOLOSO')
  })

  it('forma del catalogo', () => {
    expect(formaCerValida('20 03 01')).toBe(true)
    expect(formaCerValida('20 01 21*')).toBe(true)
    expect(formaCerValida('200301')).toBe(true)
    expect(formaCerValida('20 03 00')).toBe(false)
    expect(formaCerValida('20 00 00')).toBe(false)
    expect(formaCerValida('20 03')).toBe(false)
    expect(formaCerValida('')).toBe(false)
    expect(formaCerValida('AB CD EF')).toBe(false)
    expect(formaCerValida('20 03 01 02')).toBe(false)
  })
})

describe('validaCerProposta (R35, D9)', () => {
  it('forme ammesse: CER, CER/RIF, CER/*, CER/', () => {
    expect(
      validaCerProposta([`${CER}`, `${CER}/R1`, `${CER}/*`, `${CER}/`, '20 01 21*/AB'])
    ).toEqual([])
  })

  it('elemento fuori forma, CER di capitolo, riferimento lungo, elemento oltre 20 caratteri', () => {
    expect(validaCerProposta(['x'])).toEqual([
      'CER proposto 1: il codice CER non è nel catalogo o indica un capitolo.',
    ])
    expect(validaCerProposta([CER, '20 03 00/R1'])).toEqual([
      'CER proposto 2: il codice CER non è nel catalogo o indica un capitolo.',
    ])
    expect(validaCerProposta([`${CER}/123456789`])).toEqual([
      'CER proposto 1: il riferimento non può superare 8 caratteri.',
    ])
    expect(validaCerProposta([`${CER}/${'x'.repeat(30)}`]).length).toBeGreaterThan(0)
    expect(validaCerProposta([''])).toEqual([
      'CER proposto 1: il codice CER non è nel catalogo o indica un capitolo.',
    ])
  })

  it('al massimo 50 elementi', () => {
    expect(validaCerProposta(Array.from({ length: 51 }, () => CER))).toContain(
      'I codici CER proposti sono al massimo 50.'
    )
    expect(validaCerProposta(Array.from({ length: 50 }, () => CER))).toEqual([])
  })
})

describe('chiaveRiga (D11)', () => {
  it('righe uguali per tipo, codice e riferimento hanno la stessa chiave', () => {
    const a = chiaveRiga({ tipo: 'CER', cerCode: '20 03 01', addebitoId: null, riferimento: null })
    expect(
      chiaveRiga({ tipo: 'CER', cerCode: '200301', addebitoId: null, riferimento: null })
    ).toBe(a)
    expect(
      chiaveRiga({ tipo: 'CER', cerCode: '20 03 01', addebitoId: null, riferimento: 'R1' })
    ).not.toBe(a)
    expect(chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'x', riferimento: null })).not.toBe(
      chiaveRiga({ tipo: 'F', cerCode: null, addebitoId: 'x', riferimento: null })
    )
    expect(chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'x', riferimento: null })).not.toBe(
      chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'y', riferimento: null })
    )
  })

  it('il riferimento vuoto e null coincidono, i separatori non creano falsi uguali', () => {
    expect(chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'a', riferimento: null })).toBe(
      chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'a', riferimento: '' })
    )
    expect(chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'a|b', riferimento: 'c' })).not.toBe(
      chiaveRiga({ tipo: 'V', cerCode: null, addebitoId: 'a', riferimento: 'b|c' })
    )
  })
})

describe('totaleFissiAnnuo (TOTFISSI)', () => {
  const ogni = { anno: null }
  it('somma quantità x prezzo per ogni scadenza ogni anno dei soli fissi', () => {
    expect(
      totaleFissiAnnuo([
        { tipo: 'F', quantitaFissa: '2', prezzo: '10', scadenze: [ogni, ogni, ogni] },
        { tipo: 'F', quantitaFissa: null, prezzo: '5.5', scadenze: [ogni] },
        { tipo: 'V', quantitaFissa: null, prezzo: '100', scadenze: [ogni] },
      ])
    ).toBe('65.50')
  })

  it('le scadenze con un anno esplicito non contano', () => {
    expect(
      totaleFissiAnnuo([
        { tipo: 'F', quantitaFissa: '1', prezzo: '10', scadenze: [ogni, { anno: 2026 }] },
      ])
    ).toBe('10.00')
  })

  it('quantità zero non fattura, prezzo mancante vale zero, nessuna riga 0.00', () => {
    expect(
      totaleFissiAnnuo([
        { tipo: 'F', quantitaFissa: '0', prezzo: '10', scadenze: [ogni] },
        { tipo: 'F', quantitaFissa: '1', prezzo: null, scadenze: [ogni] },
      ])
    ).toBe('0.00')
    expect(totaleFissiAnnuo([])).toBe('0.00')
  })

  it('somma esatta e un solo arrotondamento finale, come riempitavola (I4)', () => {
    expect(
      totaleFissiAnnuo([
        { tipo: 'F', quantitaFissa: '3', prezzo: '0.335', scadenze: [ogni, ogni, ogni] },
      ])
    ).toBe('3.02') // somma esatta 3,015 arrotondata una volta (non 3 x 1,01 = 3,03), come WinWaste
    expect(
      totaleFissiAnnuo([
        { tipo: 'F', quantitaFissa: '1', prezzo: '0.1', scadenze: [ogni, ogni, ogni] },
      ])
    ).toBe('0.30')
  })
})

describe('coerenza con i tipi di addebito', () => {
  it('ogni famiglia di tipo ha i suoi campi', () => {
    for (const t of ['CER', 'V', 'F', 'TS', 'T123', 'NM', 'MF', 'M123', '$A', '$D', '$R']) {
      expect(CAMPI_PER_FAMIGLIA[famigliaTipo(t)].length).toBeGreaterThan(5)
    }
  })
})

describe('correzioni della review (I1-I3, M1-M3, M6, M10)', () => {
  const inviati = (g: Record<string, unknown>): ReadonlySet<string> => new Set(Object.keys(g))
  const fasce = [...SCAGLIONI]

  it('I1: applicaA fuori enum è un errore sul campo, non un 500', () => {
    const d = vuota('CER', {
      ...VALIDE.CER,
      prezzo: null,
      sconto: null,
      provvigione: null,
      tipoProvvigione: null,
      condizione: null,
      minimoFatturabile: null,
      minimoPerCategoria: false,
      prezzoSpeciale: true,
      applicaA: 'FOO' as never,
      scaglioni: fasce,
    })
    expect(validaRiga(d, CTX)).toContainEqual({
      campo: 'applicaA',
      messaggio: 'Il valore di «si applica a» non è ammesso.',
    })
    expect(validaRiga({ ...VALIDE.T, applicaA: 'FOO' as never }, CTX).map(e => e.campo)).toContain(
      'applicaA'
    )
  })

  it('I2: la tipologia segue il CER del catalogo (con asterisco), non quello scritto', () => {
    const g = { tipo: 'CER', cerCode: '200121' }
    expect(normalizzaRiga(g, inviati(g)).dati.tipologiaRifiuto).toBe('URBANO')
    const r = normalizzaRiga(g, inviati(g), { cerCatalogo: '20 01 21*' })
    expect(r.dati.tipologiaRifiuto).toBe('URBANO_PERICOLOSO')
  })

  it('I2: nel PATCH che cambia il CER la tipologia si ricalcola, se non è indicata', () => {
    const prima = {
      tipo: 'CER',
      cerCode: '17 04 05',
      tipologiaRifiuto: 'SPECIALE',
    }
    // il patch cambia il CER, la tipologia di prima resta in g ma non e' tra gli inviati
    const patch = { ...prima, cerCode: '17 06 01*' }
    expect(normalizzaRiga(patch, new Set(['cerCode'])).dati.tipologiaRifiuto).toBe(
      'SPECIALE_PERICOLOSO'
    )
    // il patch non tocca il CER: la tipologia di prima resta
    expect(normalizzaRiga(prima, new Set(['descrizione'])).dati.tipologiaRifiuto).toBe('SPECIALE')
    // il patch indica la tipologia: vale quella
    expect(
      normalizzaRiga(
        { ...patch, tipologiaRifiuto: 'SPECIALE' },
        new Set(['cerCode', 'tipologiaRifiuto'])
      ).dati.tipologiaRifiuto
    ).toBe('SPECIALE')
  })

  it('I3: i Decimal della riga letta dal database passano senza diventare NaN', () => {
    const letta = {
      ...VALIDE.CER,
      prezzo: new Prisma.Decimal('0.12'),
      stimaAnnuaKg: new Prisma.Decimal('1200.50'),
      minimoFatturabile: new Prisma.Decimal('25'),
      quantitaFissa: undefined,
    }
    const { dati, errori } = normalizzaRiga(letta, new Set(['descrizione']))
    expect(errori).toEqual([])
    expect(dati.prezzo).toBe('0.12')
    expect(dati.stimaAnnuaKg).toBe('1200.5')
    expect(dati.minimoFatturabile).toBe('25')
    expect(validaRiga(dati, CTX)).toEqual([])
  })

  it('I3: anche nelle fasce e con un oggetto con toFixed', () => {
    const g = {
      tipo: 'TS',
      prezzoSpeciale: true,
      scaglioni: [
        {
          ordine: 1,
          finoA: new Prisma.Decimal('1000'),
          prezzo: { toFixed: () => '0.5' },
          tipoCalcolo: 'A',
        },
      ],
    }
    const n = normalizzaRiga(g, inviati(g)).dati.scaglioni[0]
    expect(n.finoA).toBe('1000')
    expect(n.prezzo).toBe('0.5')
  })

  it('M1: gli spazi finali del riferimento si tolgono, quelli iniziali restano un errore', () => {
    const g = { tipo: 'CER', cerCode: '20 03 01', riferimento: 'R1  ' }
    expect(normalizzaRiga(g, inviati(g)).dati.riferimento).toBe('R1')
    const v = { tipo: 'CER', cerCode: '20 03 01', riferimento: '   ' }
    expect(normalizzaRiga(v, inviati(v)).dati.riferimento).toBeNull()
    const l = { tipo: 'CER', cerCode: '20 03 01', riferimento: ' R1' }
    expect(normalizzaRiga(l, inviati(l)).dati.riferimento).toBe(' R1')
  })

  it('M2: ogni messaggio di validaPrezzoSpeciale ha un campo, tranne sconto e provvigione', () => {
    const speciale = (over: Partial<DatiRiga>): DatiRiga =>
      vuota('CER', {
        ...VALIDE.CER,
        prezzo: null,
        sconto: null,
        provvigione: null,
        tipoProvvigione: null,
        condizione: null,
        minimoFatturabile: null,
        minimoPerCategoria: false,
        prezzoSpeciale: true,
        applicaA: 'DOCUMENTO',
        scaglioni: fasce,
        ...over,
      })
    const casi: Partial<DatiRiga>[] = [
      { applicaA: null },
      { condizione: 2 },
      { unitaMisura: 'HR', tipoQuantita: 'ALTRO' },
      { sconto: '5' },
      { minimoFatturabile: '5' },
      { unitaMisura: 'K/M', tipoQuantita: 'ALTRO', applicaA: 'PERIODO' },
      { condizioniRiferite: '11C' },
      { condizioniRiferite: '1C', applicaA: 'GIORNO' },
      { applicaA: 'CONGUAGLIO_365' },
      { riferimentoGiorno: 1, riferimentoMese: 1 },
      { applicaA: 'PROGRESSIVO_DA_DATA', riferimentoGiorno: 1, riferimentoMese: null },
      { applicaA: 'PROGRESSIVO_DA_DATA', riferimentoGiorno: 31, riferimentoMese: 2 },
      { scaglioni: [{ ...fasce[0], provvigione: '5' }, fasce[1]] },
    ]
    const visti = new Set<string>()
    for (const c of casi) {
      for (const err of validaRiga(speciale(c), CTX)) {
        visti.add(err.messaggio)
        if (err.messaggio.includes('lo sconto e la provvigione si indicano nelle fasce')) {
          expect(err.campo).toBeNull()
        } else {
          expect(err.campo).not.toBeNull()
        }
      }
    }
    for (const m of Object.values(MSG_PREZZO_SPECIALE)) expect(visti).toContain(m)
  })

  it('M3: lo stesso errore sullo stesso campo compare una volta sola', () => {
    const d = vuota('CER', {
      ...VALIDE.CER,
      prezzo: null,
      sconto: null,
      condizione: null,
      minimoFatturabile: null,
      minimoPerCategoria: false,
      prezzoSpeciale: true,
      applicaA: 'DOCUMENTO',
      provvigione: '5',
      tipoProvvigione: null,
      scaglioni: [{ ...fasce[0], provvigione: '5' }, fasce[1]],
    })
    const r = validaRiga(d, CTX).filter(e => e.campo === 'tipoProvvigione')
    expect(r).toHaveLength(1)
  })

  it('m1: il flag minimo per categoria resta ammesso con il prezzo speciale (WinWaste blocca solo l importo, ADDEBCON.cs:8723)', () => {
    const d = vuota('CER', {
      ...VALIDE.CER,
      prezzo: null,
      sconto: null,
      provvigione: null,
      tipoProvvigione: null,
      condizione: null,
      minimoFatturabile: null,
      minimoPerCategoria: true,
      prezzoSpeciale: true,
      applicaA: 'DOCUMENTO',
      scaglioni: fasce,
    })
    expect(validaRiga(d, CTX)).toEqual([])
    // l'importo del minimo resta vietato
    expect(validaRiga({ ...d, minimoFatturabile: '5' }, CTX).map(e => e.campo)).toEqual([
      'minimoFatturabile',
    ])
  })

  it('m2: il CER del catalogo vale solo se ha le stesse cifre del CER scritto', () => {
    const g = { tipo: 'CER', cerCode: '200121' }
    const ok = normalizzaRiga(g, inviati(g), { cerCatalogo: '20 01 21*' }).dati
    expect(ok.cerCode).toBe('20 01 21*')
    expect(ok.tipologiaRifiuto).toBe('URBANO_PERICOLOSO')
    const altro = normalizzaRiga(g, inviati(g), { cerCatalogo: '17 04 05' }).dati
    expect(altro.cerCode).toBe('20 01 21')
    expect(altro.tipologiaRifiuto).toBe('URBANO')
  })

  it('m4: applicaA fuori elenco senza prezzo speciale dà un solo errore', () => {
    const r = validaRiga({ ...VALIDE.CER, applicaA: 'FOO' as never }, CTX)
    expect(r.filter(e => e.campo === 'applicaA')).toHaveLength(1)
  })

  it('M10: CER proposto con riferimento che comincia con uno spazio', () => {
    expect(validaCerProposta([`${CER}/ R1`])).toEqual([
      'CER proposto 1: il riferimento non può iniziare con uno spazio.',
    ])
  })
})
