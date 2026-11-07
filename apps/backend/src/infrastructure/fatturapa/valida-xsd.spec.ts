import { createHash } from 'crypto'
import * as fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import { join } from 'path'
import { REGIMI_FISCALI } from '../../domain/fatturazione/costanti-fiscali'
import { validaFatturaPA } from './valida-xsd'

const DIR_XSD = join(__dirname, 'xsd')
const XSD_FATTURA = 'Schema_VFPR12_v1.2.3.xsd'
const XSD_DSIG = 'xmldsig-core-schema.xsd'

interface Opzioni {
  versione?: 'FPR12' | 'FPA12'
  tipo?: string
  codiceDestinatario?: string | null
  pec?: string | null
  numero?: string
  totale?: string
  descrizione?: string
  esigibilita?: 'I' | 'D' | 'S'
  naturaRiga?: string
  cessionarioPersonaFisica?: boolean
  bollo?: boolean
  contratto?: boolean
  fattureCollegate?: boolean
  ddt?: boolean
  righe?: number
  fuoriOrdine?: boolean
}

/** Costruisce una fattura nel rispetto dell'ordine delle sequenze dell'XSD, con scostamenti mirati. */
function costruisciFattura(o: Opzioni = {}): string {
  const versione = o.versione ?? 'FPR12'
  const codDest =
    o.codiceDestinatario === undefined
      ? versione === 'FPA12'
        ? 'UFABCD'
        : '0000000'
      : o.codiceDestinatario
  const righe = o.righe ?? 1
  const natura = o.naturaRiga
  const esig = o.esigibilita ?? 'I'
  const linee = Array.from(
    { length: righe },
    (_, i) =>
      `<DettaglioLinee><NumeroLinea>${i + 1}</NumeroLinea><Descrizione>${i === 0 && o.descrizione ? o.descrizione : `Prestazione ${i + 1}`}</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>10.00</PrezzoUnitario><PrezzoTotale>10.00</PrezzoTotale><AliquotaIVA>${natura ? '0.00' : '22.00'}</AliquotaIVA>${natura ? `<Natura>${natura}</Natura>` : ''}</DettaglioLinee>`
  ).join('')
  const trasmissione = o.fuoriOrdine
    ? `<ProgressivoInvio>00001</ProgressivoInvio><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente>`
    : `<IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente><ProgressivoInvio>00001</ProgressivoInvio>`
  const cessionario = o.cessionarioPersonaFisica
    ? `<DatiAnagrafici><CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale><Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica></DatiAnagrafici>`
    : `<DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>09876543210</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Cliente Spa</Denominazione></Anagrafica></DatiAnagrafici>`
  const bollo = o.bollo
    ? `<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>`
    : ''
  const contratto = o.contratto
    ? `<DatiOrdineAcquisto><IdDocumento>ORD-77</IdDocumento><CodiceCUP>B11B20000010001</CodiceCUP><CodiceCIG>8123456789</CodiceCIG></DatiOrdineAcquisto>`
    : ''
  const collegate = o.fattureCollegate
    ? `<DatiFattureCollegate><IdDocumento>1/2026</IdDocumento><Data>2026-10-31</Data></DatiFattureCollegate>`
    : ''
  const ddt = o.ddt
    ? `<DatiDDT><NumeroDDT>DDT-9</NumeroDDT><DataDDT>2026-10-30</DataDDT></DatiDDT>`
    : ''
  const riepilogo = `<DatiRiepilogo><AliquotaIVA>${natura ? '0.00' : '22.00'}</AliquotaIVA>${natura ? `<Natura>${natura}</Natura>` : ''}<ImponibileImporto>${(righe * 10).toFixed(2)}</ImponibileImporto><Imposta>${natura ? '0.00' : (righe * 2.2).toFixed(2)}</Imposta><EsigibilitaIVA>${esig}</EsigibilitaIVA>${natura ? '<RiferimentoNormativo>Art. 15 DPR 633/72</RiferimentoNormativo>' : ''}</DatiRiepilogo>`
  return `<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="${versione}"><FatturaElettronicaHeader><DatiTrasmissione>${trasmissione}<FormatoTrasmissione>${versione}</FormatoTrasmissione>${codDest === null ? '' : `<CodiceDestinatario>${codDest}</CodiceDestinatario>`}${o.pec ? `<PECDestinatario>${o.pec}</PECDestinatario>` : ''}</DatiTrasmissione><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Cedente Srl</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>Via Roma 1</Indirizzo><CAP>00100</CAP><Comune>Roma</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore><CessionarioCommittente>${cessionario}<Sede><Indirizzo>Via Milano 2</Indirizzo><CAP>20100</CAP><Comune>Milano</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${o.tipo ?? 'TD01'}</TipoDocumento><Divisa>EUR</Divisa><Data>2026-11-07</Data><Numero>${o.numero ?? '1/2026'}</Numero>${bollo}<ImportoTotaleDocumento>${o.totale ?? (righe * 12.2).toFixed(2)}</ImportoTotaleDocumento></DatiGeneraliDocumento>${contratto}${collegate}${ddt}</DatiGenerali><DatiBeniServizi>${linee}${riepilogo}</DatiBeniServizi><DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><ImportoPagamento>${(righe * 12.2).toFixed(2)}</ImportoPagamento></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody></p:FatturaElettronica>`
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

describe('validaFatturaPA: fatture valide', () => {
  const casi: Array<[string, Opzioni]> = [
    ['FPR12 TD24 (differita) con DDT', { tipo: 'TD24', ddt: true }],
    ['FPA12 con CIG, CUP e IdDocumento', { versione: 'FPA12', contratto: true }],
    ['TD04 con DatiFattureCollegate', { tipo: 'TD04', fattureCollegate: true }],
    ['split payment (esigibilità S)', { esigibilita: 'S' }],
    ['bollo virtuale con natura N1', { bollo: true, naturaRiga: 'N1', totale: '12.20' }],
    [
      'cessionario persona fisica',
      {
        cessionarioPersonaFisica: true,
        codiceDestinatario: '0000000',
        pec: 'mario@pec.example.it',
      },
    ],
    ['300 righe', { righe: 300 }],
    [
      'testi con caratteri Latin-1 (già normalizzati)',
      { descrizione: 'Società "normalizzata" è àèìòù ñ ç' },
    ],
  ]
  it.each(casi)('%s', async (_nome, opzioni) => {
    const esito = await validaFatturaPA(costruisciFattura(opzioni))
    expect(esito.errori).toEqual([])
    expect(esito.valido).toBe(true)
  })

  it('testo con carattere fuori Latin-1 (Ł): rifiutato, per questo serve il normalizzatore', async () => {
    const esito = await validaFatturaPA(costruisciFattura({ descrizione: 'Łódź' }))
    expect(esito.valido).toBe(false)
    expect(esito.errori.join('\n')).toContain('Descrizione')
  })
})

describe('validaFatturaPA: controprove', () => {
  const casi: Array<[string, Opzioni, string]> = [
    [
      'manca CodiceDestinatario',
      { codiceDestinatario: null },
      'CodiceDestinatario|PECDestinatario|DatiTrasmissione',
    ],
    ['Numero vuoto', { numero: '' }, 'Numero'],
    ['ImportoTotaleDocumento con la virgola', { totale: '122,00' }, 'ImportoTotaleDocumento'],
    ['Natura inesistente (N9)', { naturaRiga: 'N9' }, 'Natura'],
    ['elemento fuori ordine', { fuoriOrdine: true }, 'ProgressivoInvio|IdTrasmittente'],
  ]
  it.each(casi)('%s', async (_nome, opzioni, atteso) => {
    const esito = await validaFatturaPA(costruisciFattura(opzioni))
    expect(esito.valido).toBe(false)
    expect(esito.errori.length).toBeGreaterThan(0)
    expect(esito.errori.join('\n')).toMatch(new RegExp(atteso))
  })

  it("la natura generica N2 passa l'XSD: la rifiuta il controllo di business (NATURE_NON_AMMESSE), non lo schema", async () => {
    const esito = await validaFatturaPA(costruisciFattura({ naturaRiga: 'N2' }))
    expect(esito.valido).toBe(true)
  })

  it('XML non ben formato: non valido, senza eccezioni', async () => {
    const esito = await validaFatturaPA('<a><b></a>')
    expect(esito.valido).toBe(false)
    expect(esito.errori.length).toBeGreaterThan(0)
  })

  it("i messaggi d'errore non contengono i valori dei campi", async () => {
    const segreti = ['SEGRETO-DENOMINAZIONE-XYZ', 'SEGRETO-NUMERO-QRS']
    const xml = costruisciFattura({
      numero: 'SEGRETO-NUMERO-QRS'.padEnd(40, 'x'),
      totale: '1,5 SEGRETO-DENOMINAZIONE-XYZ',
    })
    const esito = await validaFatturaPA(xml)
    expect(esito.valido).toBe(false)
    const testo = esito.errori.join('\n')
    for (const s of segreti) expect(testo).not.toContain(s)
    expect(testo).not.toContain("'")
    expect(testo).not.toMatch(/\d{2}\/2026|1,5/)
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
