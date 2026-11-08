import { createHash } from 'crypto'
import * as fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import { join } from 'path'
import { REGIMI_FISCALI } from '../../domain/fatturazione/costanti-fiscali'
import type { RigaDocumentoCalcolata, RiepilogoIvaCalcolato } from '../../domain/fatturazione/tipi'
import {
  serializzaFattura,
  type DatiFatturaXml,
} from '../../domain/fatturazione/xml/serializza-fattura'
import { validateXML } from 'xmllint-wasm'
import { validaFatturaPA, validaFatturePA } from './valida-xsd'

jest.mock('xmllint-wasm', () => {
  const reale = jest.requireActual('xmllint-wasm')
  return { ...reale, validateXML: jest.fn(reale.validateXML) }
})

const DIR_XSD = join(__dirname, 'xsd')
const XSD_FATTURA = 'Schema_VFPR12_v1.2.3.xsd'
const XSD_DSIG = 'xmldsig-core-schema.xsd'

interface Opzioni {
  versione?: 'FPR12' | 'FPA12'
  tipo?: string
  pec?: string | null
  descrizione?: string
  esigibilita?: 'I' | 'D' | 'S'
  naturaRiga?: string
  cessionarioPersonaFisica?: boolean
  bollo?: boolean
  contratto?: boolean
  fattureCollegate?: boolean
  righe?: number
}

const sede = {
  indirizzo: 'Via Roma 1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  nazione: 'IT' as const,
}

/** Fattura prodotta dal serializzatore vero (Task 15), con scostamenti mirati. */
function costruisciFattura(o: Opzioni = {}): string {
  const versione = o.versione ?? 'FPR12'
  const natura = o.naturaRiga ?? null
  const n = o.righe ?? 1
  const righe: RigaDocumentoCalcolata[] = Array.from({ length: n }, (_, i) => ({
    numeroLinea: i + 1,
    tipoRiga: 'MOVIMENTO',
    legameId: null,
    rigaLegameId: null,
    rigaAddebitoId: null,
    descrizione: i === 0 && o.descrizione ? o.descrizione : `Prestazione ${i + 1}`,
    dataMovimento: null,
    cerCode: null,
    numeroFir: null,
    quantita: '1',
    unitaMisura: 'kg',
    prezzoUnitario: '10',
    sconto: null,
    importoLordo: '10.00',
    importoSconto: '0.00',
    prezzoTotale: '10.00',
    codiceIvaId: 'c',
    aliquotaIva: natura ? '0.00' : '22.00',
    naturaIva: natura,
  }))
  const riepilogo: RiepilogoIvaCalcolato = {
    aliquota: natura ? '0.00' : '22.00',
    natura,
    imponibile: (n * 10).toFixed(2),
    imposta: natura ? '0.00' : (n * 2.2).toFixed(2),
    esigibilita: o.esigibilita ?? 'I',
    riferimentoNormativo: natura ? 'Art. 15 DPR 633/72' : null,
  }
  const dati: DatiFatturaXml = {
    trasmissione: {
      idPaese: 'IT',
      idCodice: '01234567890',
      progressivoInvio: '00001',
      formato: versione,
      codiceDestinatario: versione === 'FPA12' ? 'UFABCD' : '0000000',
      pecDestinatario: o.pec ?? null,
    },
    cedente: {
      denominazione: 'Cedente Srl',
      partitaIva: '01234567890',
      codiceFiscale: '01234567890',
      regimeFiscale: 'RF01',
      sede,
      rea: null,
      idTrasmittente: '01234567890',
    },
    cessionario: o.cessionarioPersonaFisica
      ? {
          denominazione: null,
          nome: 'Mario',
          cognome: 'Rossi',
          partitaIva: null,
          codiceFiscale: 'RSSMRA80A01H501U',
          sede,
        }
      : {
          denominazione: 'Cliente Spa',
          nome: null,
          cognome: null,
          partitaIva: '09876543210',
          codiceFiscale: null,
          sede,
        },
    generali: {
      tipoDocumento: o.tipo ?? 'TD01',
      data: '2026-11-07',
      numero: '1/2026',
      bollo: o.bollo ? { importo: '2.00' } : null,
      importoTotale: (n * 12.2).toFixed(2),
      causale: [],
    },
    contratto: o.contratto
      ? { idDocumento: 'ORD-77', cig: '8123456789', cup: 'B11B20000010001' }
      : null,
    fattureCollegate: o.fattureCollegate ? { idDocumento: '1/2026', data: '2026-10-31' } : null,
    linee: righe,
    riepiloghi: [riepilogo],
    pagamento: null,
  }
  return serializzaFattura(dati)
}

const sha256 = (f: string): string =>
  createHash('sha256')
    .update(fs.readFileSync(join(DIR_XSD, f)))
    .digest('hex')

describe('XSD FatturaPA: file e costanti', () => {
  const versioni = fs.readFileSync(join(DIR_XSD, 'VERSIONI.md'), 'utf8')

  it.each([XSD_FATTURA, XSD_DSIG])('sha256 di %s uguale a VERSIONI.md', f => {
    expect(versioni).toContain(sha256(f))
  })

  it("REGIMI_FISCALI uguale all'enumerazione RegimeFiscaleType dell'XSD copiato", () => {
    const xsd = fs.readFileSync(join(DIR_XSD, XSD_FATTURA), 'utf8')
    const blocco =
      /<xs:simpleType name="RegimeFiscaleType">([\s\S]*?)<\/xs:simpleType>/.exec(xsd)?.[1] ?? ''
    const valori = [...blocco.matchAll(/<xs:enumeration value="(RF\d{2})"/g)].map(m => m[1])
    expect(valori.length).toBeGreaterThan(10)
    expect([...REGIMI_FISCALI].sort()).toEqual([...valori].sort())
  })

  it('il file di esempio su disco è valido', async () => {
    const xml = fs.readFileSync(join(__dirname, 'esempi', 'fpr12-td01-minima.xml'), 'utf8')
    expect(await validaFatturaPA(xml)).toEqual({ valido: true, errori: [] })
  })
})

describe('validaFatturaPA: fatture valide (prodotte dal serializzatore)', () => {
  const casi: Array<[string, Opzioni]> = [
    ['FPR12 TD24 (differita)', { tipo: 'TD24' }],
    ['FPA12 con CIG, CUP e IdDocumento', { versione: 'FPA12', contratto: true }],
    ['TD04 con DatiFattureCollegate', { tipo: 'TD04', fattureCollegate: true }],
    ['split payment (esigibilità S)', { esigibilita: 'S' }],
    ['bollo virtuale con natura N1', { bollo: true, naturaRiga: 'N1' }],
    ['cessionario persona fisica', { cessionarioPersonaFisica: true }],
    ['300 righe', { righe: 300 }],
    [
      'testi fuori Latin-1 normalizzati dal serializzatore',
      { descrizione: 'Società “Rossi” – 10 € Łódź àèìòù' },
    ],
  ]
  it.each(casi)('%s', async (_nome, opzioni) => {
    const esito = await validaFatturaPA(costruisciFattura(opzioni))
    expect(esito.errori).toEqual([])
    expect(esito.valido).toBe(true)
  })

  it('testo con carattere fuori Latin-1 (Ł) iniettato a mano: rifiutato', async () => {
    const xml = costruisciFattura().replace('Prestazione 1', 'Łódź')
    const esito = await validaFatturaPA(xml)
    expect(esito.valido).toBe(false)
    expect(esito.errori.join('\n')).toContain('Descrizione')
  })
})

describe('validaFatturaPA: controprove', () => {
  const casi: Array<[string, (x: string) => string, string]> = [
    [
      'manca CodiceDestinatario',
      x => x.replace(/<CodiceDestinatario>[^<]*<\/CodiceDestinatario>/, ''),
      'CodiceDestinatario|PECDestinatario|DatiTrasmissione',
    ],
    ['Numero vuoto', x => x.replace('<Numero>1/2026</Numero>', '<Numero></Numero>'), 'Numero'],
    [
      'ImportoTotaleDocumento con la virgola',
      x => x.replace(/<ImportoTotaleDocumento>(\d+)\.(\d+)</, '<ImportoTotaleDocumento>$1,$2<'),
      'ImportoTotaleDocumento',
    ],
    [
      'Natura inesistente (N9)',
      x => x.replace(/<Natura>N1<\/Natura>/g, '<Natura>N9</Natura>'),
      'Natura',
    ],
    [
      'elemento fuori ordine',
      x =>
        x.replace(
          /(<IdTrasmittente>.*?<\/IdTrasmittente>)(<ProgressivoInvio>.*?<\/ProgressivoInvio>)/,
          '$2$1'
        ),
      'ProgressivoInvio|IdTrasmittente',
    ],
  ]
  it.each(casi)('%s', async (_nome, altera, atteso) => {
    const base = costruisciFattura({ naturaRiga: 'N1' })
    const xml = altera(base)
    expect(xml).not.toBe(base)
    const esito = await validaFatturaPA(xml)
    expect(esito.valido).toBe(false)
    expect(esito.errori.join('\n')).toMatch(new RegExp(atteso))
  })

  it("la natura generica N2 passa l'XSD: la rifiuta il controllo di business (NATURE_NON_AMMESSE), non lo schema", async () => {
    const xml = costruisciFattura({ naturaRiga: 'N1' }).replace(/<Natura>N1</g, '<Natura>N2<')
    expect((await validaFatturaPA(xml)).valido).toBe(true)
  })

  it('XML non ben formato: non valido, senza eccezioni', async () => {
    const esito = await validaFatturaPA('<a><b></a>')
    expect(esito.valido).toBe(false)
    expect(esito.errori.length).toBeGreaterThan(0)
  })

  it("i messaggi d'errore non contengono i valori dei campi", async () => {
    const xml = costruisciFattura()
      .replace(
        '<Numero>1/2026</Numero>',
        `<Numero>${'SEGRETO-NUMERO-QRS'.padEnd(40, 'x')}</Numero>`
      )
      .replace(/<ImportoTotaleDocumento>[^<]*</, '<ImportoTotaleDocumento>1,5 SEGRETO-IMPORTO<')
    const esito = await validaFatturaPA(xml)
    expect(esito.valido).toBe(false)
    const testo = esito.errori.join('\n')
    expect(testo).not.toMatch(/SEGRETO|1,5/)
    expect(testo).not.toContain("'")
  })
})

describe('validaFatturePA (lotto)', () => {
  it('esito per ogni XML, nello stesso ordine, con errori attribuiti al file giusto', async () => {
    const buono = costruisciFattura()
    const rotto = buono.replace('<Numero>1/2026</Numero>', '<Numero></Numero>')
    const esiti = await validaFatturePA([buono, rotto, buono])
    expect(esiti.map(e => e.valido)).toEqual([true, false, true])
    expect(esiti[1].errori.join('\n')).toContain('Numero')
    expect(esiti[0].errori).toEqual([])
  })

  it('un XML non ben formato dentro il lotto: il lotto intero e non valido (si fallisce chiusi), mai un esito valido', async () => {
    const buono = costruisciFattura()
    const malformato = buono.replace('</p:FatturaElettronica>', '')
    const esiti = await validaFatturePA([buono, malformato, buono])
    expect(esiti).toHaveLength(3)
    expect(esiti[1].valido).toBe(false)
    expect(esiti[1].errori.length).toBeGreaterThan(0)
    // Scelta prudente del Task 16: l'errore di parsing non ha una posizione attribuibile a un file,
    // quindi NESSUN file del lotto risulta valido (nessuna emissione parziale su un lotto sospetto).
    expect(esiti.map(e => e.valido)).toEqual([false, false, false])
    expect((await validaFatturaPA(malformato)).valido).toBe(false)
  })

  it('lotto tutto non valido con errori propri di ogni file: ogni esito è attribuibile al suo file', async () => {
    const buono = costruisciFattura()
    const rotto = buono.replace('<Numero>1/2026</Numero>', '<Numero></Numero>')
    const esiti = await validaFatturePA([rotto, rotto])
    expect(esiti.map(e => e.valido)).toEqual([false, false])
    expect(esiti.map(e => e.attribuibile)).toEqual([true, true])
  })

  it('errore generale senza file (XML malformato): gli esiti non sono attribuibili', async () => {
    const buono = costruisciFattura()
    const malformato = buono.replace('</p:FatturaElettronica>', '')
    const esiti = await validaFatturePA([buono, malformato, buono])
    expect(esiti.every(e => !e.valido)).toBe(true)
    expect(esiti[0].attribuibile).toBe(false)
    expect(esiti[2].attribuibile).toBe(false)
  })

  it('lista vuota: nessun esito', async () => {
    expect(await validaFatturePA([])).toEqual([])
  })

  it('stesso esito di validaFatturaPA singola', async () => {
    const rotto = costruisciFattura().replace('<Numero>1/2026</Numero>', '<Numero></Numero>')
    expect((await validaFatturePA([rotto]))[0]).toMatchObject(await validaFatturaPA(rotto))
  })
})

describe('schema passato a xmllint', () => {
  it('schemaLocation di xmldsig riscritto sul file locale, nessun riferimento http rimasto', async () => {
    const mock = validateXML as unknown as jest.Mock
    mock.mockClear()
    await validaFatturaPA(costruisciFattura())
    const opzioni = mock.mock.calls[0][0] as {
      schema: Array<{ contents: string }>
      preload: Array<{ fileName: string; contents: string }>
    }
    const schema = opzioni.schema[0].contents
    expect(schema).toContain(`schemaLocation="${XSD_DSIG}"`)
    expect(/schemaLocation="https?:/.test(schema)).toBe(false)
    expect(opzioni.preload.map(f => f.fileName)).toContain(XSD_DSIG)
    for (const f of opzioni.preload) expect(/schemaLocation="https?:/.test(f.contents)).toBe(false)
  })
})

describe('validaFatturaPA: nessun accesso alla rete', () => {
  it('con la rete che fallisce la validazione riesce e nessuna primitiva di rete è chiamata', async () => {
    const boom = jest.fn(() => {
      throw new Error('accesso alla rete vietato')
    })
    const spie = [
      jest.spyOn(http, 'request').mockImplementation(boom as never),
      jest.spyOn(http, 'get').mockImplementation(boom as never),
      jest.spyOn(https, 'request').mockImplementation(boom as never),
      jest.spyOn(https, 'get').mockImplementation(boom as never),
      jest.spyOn(net, 'connect').mockImplementation(boom as never),
      jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(boom as never),
    ]
    const g = globalThis as { fetch?: unknown }
    const fetchOriginale = g.fetch
    g.fetch = boom
    try {
      const esito = await validaFatturaPA(costruisciFattura({ versione: 'FPA12', contratto: true }))
      expect(esito.valido).toBe(true)
      for (const s of spie) expect(s).not.toHaveBeenCalled()
      expect(boom).not.toHaveBeenCalled()
    } finally {
      g.fetch = fetchOriginale
      for (const s of spie) s.mockRestore()
    }
  })

  it("lo schemaLocation di xmldsig nell'XSD ufficiale è un URL: la validazione lo usa in forma locale", () => {
    const xsd = fs.readFileSync(join(DIR_XSD, XSD_FATTURA), 'utf8')
    expect(xsd).toMatch(/schemaLocation="http:\/\/www\.w3\.org\/[^"]*xmldsig-core-schema\.xsd"/)
  })
})
