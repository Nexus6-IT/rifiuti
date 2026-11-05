import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  CampoXmlObbligatorioVuotoError,
  datiFatturaDaDocumento,
  decimaleXml,
  serializzaFattura,
  type DatiFatturaXml,
} from './serializza-fattura'
import type {
  DocumentoPerXml,
  FotografiaDocumento,
  RigaDocumentoCalcolata,
  RiepilogoIvaCalcolato,
} from '../tipi'

const sede = {
  indirizzo: 'Via Roma 1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  nazione: 'IT' as const,
}

const cedente: FotografiaDocumento['cedente'] = {
  denominazione: 'Cedente & Figli <SRL>',
  partitaIva: '01234567890',
  codiceFiscale: '01234567890',
  regimeFiscale: 'RF01',
  sede,
  rea: {
    ufficio: 'RM',
    numero: '123456',
    capitaleSociale: '10000',
    socioUnico: 'SU',
    statoLiquidazione: 'LN',
  },
  idTrasmittente: '01234567890',
}

const cessionario: FotografiaDocumento['cessionario'] = {
  denominazione: 'Cliente SPA',
  nome: null,
  cognome: null,
  partitaIva: '09876543210',
  codiceFiscale: null,
  sede: { ...sede, indirizzo: 'Via Milano 2', comune: 'Milano', provincia: 'MI', cap: '20100' },
}

const riga = (o: Partial<RigaDocumentoCalcolata> = {}): RigaDocumentoCalcolata => ({
  numeroLinea: 1,
  tipoRiga: 'MOVIMENTO',
  legameId: null,
  rigaLegameId: null,
  rigaAddebitoId: null,
  descrizione: 'Smaltimento',
  dataMovimento: null,
  cerCode: null,
  numeroFir: null,
  quantita: '2.5',
  unitaMisura: 'kg',
  prezzoUnitario: '10',
  sconto: null,
  importoLordo: '25.00',
  importoSconto: '0.00',
  prezzoTotale: '25.00',
  codiceIvaId: 'c22',
  aliquotaIva: '22.00',
  naturaIva: null,
  ...o,
})

const riepilogo = (o: Partial<RiepilogoIvaCalcolato> = {}): RiepilogoIvaCalcolato => ({
  aliquota: '22.00',
  natura: null,
  imponibile: '25.00',
  imposta: '5.50',
  esigibilita: 'I',
  riferimentoNormativo: null,
  ...o,
})

const dati = (o: Partial<DatiFatturaXml> = {}): DatiFatturaXml => ({
  trasmissione: {
    idPaese: 'IT',
    idCodice: '01234567890',
    progressivoInvio: '00001',
    formato: 'FPR12',
    codiceDestinatario: 'ABCDEFG',
    pecDestinatario: null,
  },
  cedente,
  cessionario,
  generali: {
    tipoDocumento: 'TD01',
    data: '2026-11-05',
    numero: '1/2026',
    bollo: null,
    importoTotale: '30.50',
    causale: [],
  },
  contratto: null,
  fattureCollegate: null,
  linee: [riga()],
  riepiloghi: [riepilogo()],
  pagamento: null,
  ...o,
})

/** Posizioni dei tag nell'ordine in cui compaiono. */
function ordine(xml: string, tag: string[]): number[] {
  return tag.map(t => xml.indexOf(`<${t}>`))
}
function cresce(n: number[]): boolean {
  return n.every((x, i) => x >= 0 && (i === 0 || x > n[i - 1]))
}

describe('serializzaFattura', () => {
  it('e deterministico: stessi dati, stessa stringa byte per byte', () => {
    expect(serializzaFattura(dati())).toBe(serializzaFattura(dati()))
    expect(Buffer.from(serializzaFattura(dati()))).toEqual(Buffer.from(serializzaFattura(dati())))
  })

  it('non ha spazi non significativi fra gli elementi', () => {
    expect(serializzaFattura(dati())).not.toMatch(/>\s+</)
    expect(
      serializzaFattura(dati()).startsWith('<?xml version="1.0" encoding="UTF-8"?><p:Fattura')
    ).toBe(true)
  })

  it('DatiGeneraliDocumento rispetta l ordine dell XSD', () => {
    const xml = serializzaFattura(
      dati({
        generali: {
          tipoDocumento: 'TD01',
          data: '2026-11-05',
          numero: '1/2026',
          bollo: { importo: '2.00' },
          importoTotale: '30.50',
          causale: ['nota'],
        },
      })
    )
    expect(
      cresce(
        ordine(xml, [
          'TipoDocumento',
          'Divisa',
          'Data',
          'Numero',
          'DatiBollo',
          'ImportoTotaleDocumento',
          'Causale',
        ])
      )
    ).toBe(true)
    expect(
      cresce(
        ordine(xml, [
          'DatiTrasmissione',
          'CedentePrestatore',
          'CessionarioCommittente',
          'DatiGenerali',
          'DatiBeniServizi',
        ])
      )
    ).toBe(true)
    expect(cresce(ordine(xml, ['DatiAnagrafici', 'Sede', 'IscrizioneREA']))).toBe(true)
    expect(
      cresce(
        ordine(xml, [
          'NumeroLinea',
          'Descrizione',
          'Quantita',
          'UnitaMisura',
          'PrezzoUnitario',
          'PrezzoTotale',
          'AliquotaIVA',
        ])
      )
    ).toBe(true)
  })

  it('DatiContratto precede DatiFattureCollegate e le linee seguono DatiGenerali', () => {
    const xml = serializzaFattura(
      dati({
        contratto: { idDocumento: 'ORD1', cig: 'CIG1', cup: 'CUP1' },
        fattureCollegate: { idDocumento: '5/2026', data: '2026-10-01' },
      })
    )
    expect(
      cresce(
        ordine(xml, [
          'DatiGeneraliDocumento',
          'DatiContratto',
          'DatiFattureCollegate',
          'DatiBeniServizi',
        ])
      )
    ).toBe(true)
    expect(xml).toContain(
      '<DatiContratto><IdDocumento>ORD1</IdDocumento><CodiceCUP>CUP1</CodiceCUP><CodiceCIG>CIG1</CodiceCIG></DatiContratto>'
    )
  })

  it('PECDestinatario solo con "0000000"', () => {
    const t = dati().trasmissione
    const con = serializzaFattura(
      dati({ trasmissione: { ...t, codiceDestinatario: '0000000', pecDestinatario: 'a@pec.it' } })
    )
    const senza = serializzaFattura(
      dati({ trasmissione: { ...t, codiceDestinatario: 'ABCDEFG', pecDestinatario: 'a@pec.it' } })
    )
    expect(con).toContain('<PECDestinatario>a@pec.it</PECDestinatario>')
    expect(senza).not.toContain('PECDestinatario')
  })

  it('causale di 450 caratteri: 3 blocchi da 200, 200, 50', () => {
    const xml = serializzaFattura(
      dati({ generali: { ...dati().generali, causale: ['a'.repeat(450)] } })
    )
    const blocchi = xml.match(/<Causale>a+<\/Causale>/g) ?? []
    expect(blocchi.map(b => b.length - '<Causale></Causale>'.length)).toEqual([200, 200, 50])
  })

  it('sconto "10+5": due ScontoMaggiorazione SC 10.00 e 5.00, nell ordine', () => {
    const xml = serializzaFattura(dati({ linee: [riga({ sconto: '10+5' })] }))
    expect(xml).toContain(
      '<ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>10.00</Percentuale></ScontoMaggiorazione>' +
        '<ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>5.00</Percentuale></ScontoMaggiorazione><PrezzoTotale>'
    )
  })

  it('persona fisica: Nome e Cognome, nessuna Denominazione nel cessionario', () => {
    const xml = serializzaFattura(
      dati({
        cessionario: {
          ...cessionario,
          denominazione: null,
          nome: 'Mario',
          cognome: 'Rossi',
          partitaIva: null,
          codiceFiscale: 'RSSMRA80A01H501U',
        },
      })
    )
    const ces = xml.slice(
      xml.indexOf('<CessionarioCommittente>'),
      xml.indexOf('</CessionarioCommittente>')
    )
    expect(ces).toContain('<Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica>')
    expect(ces).not.toContain('Denominazione')
    expect(ces).not.toContain('IdFiscaleIVA')
    expect(ces).toContain('<CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>')
  })

  it('TD04: DatiFattureCollegate con numero e data dell origine', () => {
    const xml = serializzaFattura(
      dati({
        generali: { ...dati().generali, tipoDocumento: 'TD04' },
        fattureCollegate: { idDocumento: '5/2026', data: '2026-10-01' },
      })
    )
    expect(xml).toContain(
      '<DatiFattureCollegate><IdDocumento>5/2026</IdDocumento><Data>2026-10-01</Data></DatiFattureCollegate>'
    )
  })

  it('bollo: DatiBollo con BolloVirtuale SI e ImportoBollo 2.00', () => {
    const xml = serializzaFattura(
      dati({ generali: { ...dati().generali, bollo: { importo: '2' } } })
    )
    expect(xml).toContain(
      '<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>'
    )
  })

  it('split: EsigibilitaIVA S nel riepilogo', () => {
    const xml = serializzaFattura(dati({ riepiloghi: [riepilogo({ esigibilita: 'S' })] }))
    expect(xml).toContain('<EsigibilitaIVA>S</EsigibilitaIVA></DatiRiepilogo>')
  })

  it('caratteri speciali XML (&, <) escapati', () => {
    const xml = serializzaFattura(dati())
    expect(xml).toContain('<Denominazione>Cedente &amp; Figli &lt;SRL&gt;</Denominazione>')
    expect(xml).not.toContain('Figli <SRL>')
  })

  it('riga BOLLO con natura N1 e aliquota 0.00', () => {
    const xml = serializzaFattura(
      dati({
        linee: [
          riga({
            tipoRiga: 'BOLLO',
            quantita: null,
            unitaMisura: null,
            aliquotaIva: '0',
            naturaIva: 'N1',
          }),
        ],
      })
    )
    expect(xml).toContain('<AliquotaIVA>0.00</AliquotaIVA><Natura>N1</Natura>')
    expect(xml).not.toContain('<Quantita>')
  })

  it('FIR in AltriDatiGestionali con TipoDato FIR', () => {
    const xml = serializzaFattura(dati({ linee: [riga({ numeroFir: 'XYZ123/26' })] }))
    expect(xml).toContain(
      '<AltriDatiGestionali><TipoDato>FIR</TipoDato><RiferimentoTesto>XYZ123/26</RiferimentoTesto></AltriDatiGestionali></DettaglioLinee>'
    )
  })

  it('sede del cedente: Provincia solo se presente, CAP sempre', () => {
    const con = serializzaFattura(dati())
    const senza = serializzaFattura(
      dati({ cedente: { ...cedente, sede: { ...sede, provincia: null } } })
    )
    expect(con).toContain(
      '<CAP>00100</CAP><Comune>Roma</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione>'
    )
    expect(senza).toContain('<CAP>00100</CAP><Comune>Roma</Comune><Nazione>IT</Nazione>')
  })

  it('IscrizioneREA: capitale con 2 decimali (anche a 11 cifre), oppure niente', () => {
    const xml = serializzaFattura(
      dati({ cedente: { ...cedente, rea: { ...cedente.rea!, capitaleSociale: '12345678901' } } })
    )
    expect(xml).toContain(
      '<IscrizioneREA><Ufficio>RM</Ufficio><NumeroREA>123456</NumeroREA><CapitaleSociale>12345678901.00</CapitaleSociale><SocioUnico>SU</SocioUnico><StatoLiquidazione>LN</StatoLiquidazione></IscrizioneREA>'
    )
    const minima = serializzaFattura(
      dati({
        cedente: { ...cedente, rea: { ...cedente.rea!, capitaleSociale: null, socioUnico: null } },
      })
    )
    expect(minima).toContain(
      '<NumeroREA>123456</NumeroREA><StatoLiquidazione>LN</StatoLiquidazione>'
    )
    expect(serializzaFattura(dati({ cedente: { ...cedente, rea: null } }))).not.toContain(
      'IscrizioneREA'
    )
    expect(
      serializzaFattura(dati({ cedente: { ...cedente, rea: { ...cedente.rea!, ufficio: ' ' } } }))
    ).not.toContain('IscrizioneREA')
  })

  it('pagamento: condizioni e rate con IBAN', () => {
    const xml = serializzaFattura(
      dati({
        pagamento: {
          condizioni: 'TP02',
          rate: [
            {
              ordine: 1,
              modalita: 'MP05',
              dataScadenza: '2026-12-05',
              importo: '30.5',
              istituto: 'Banca X',
              iban: 'IT60X0542811101000000123456',
              abi: '05428',
              cab: '11101',
              bic: null,
            },
          ],
        },
      })
    )
    expect(xml).toContain(
      '<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-12-05</DataScadenzaPagamento><ImportoPagamento>30.50</ImportoPagamento><IstitutoFinanziario>Banca X</IstitutoFinanziario><IBAN>IT60X0542811101000000123456</IBAN><ABI>05428</ABI><CAB>11101</CAB></DettaglioPagamento></DatiPagamento>'
    )
  })

  it('i testi sono normalizzati e troncati alle lunghezze dell XSD', () => {
    const xml = serializzaFattura(
      dati({ cessionario: { ...cessionario, denominazione: 'Società “X” ' + 'a'.repeat(100) } })
    )
    const m = /<Denominazione>(.*?)<\/Denominazione>/.exec(
      xml.slice(xml.indexOf('<CessionarioCommittente>'))
    )
    expect(m?.[1]).toHaveLength(80)
    expect(m?.[1].startsWith('Società "X" ')).toBe(true)
  })
})

describe('decimaleXml', () => {
  it('almeno min e al massimo max decimali', () => {
    expect(decimaleXml('1.500', 2, 8)).toBe('1.50')
    expect(decimaleXml('1.123456789', 2, 8)).toBe('1.12345679')
    expect(decimaleXml('10', 2, 2)).toBe('10.00')
    expect(decimaleXml('-0.001', 2, 2)).toBe('0.00')
  })
})

describe('datiFatturaDaDocumento', () => {
  const fotografia: FotografiaDocumento = {
    cedente,
    cessionario,
    pagamento: null,
    conto: null,
    testoFatturazione: ['Testo'],
    cig: 'CIG1',
    cup: null,
    idDocumento: 'ORD1',
  }
  const doc = (o: Partial<DocumentoPerXml['testata']> = {}): DocumentoPerXml => ({
    testata: {
      tipoDocumento: 'TD01',
      formatoTrasmissione: 'FPR12',
      codiceDestinatario: 'ABCDEFG',
      pecDestinatario: null,
      dataDocumento: '2026-11-05',
      numeroTesto: '1/2026',
      totaleDocumento: '32.50',
      bolloDovuto: true,
      importoBollo: '2.00',
      esigibilita: 'I',
      condizioniPagamento: null,
      origine: null,
      ...o,
    },
    righe: [riga()],
    riepiloghi: [riepilogo()],
    rate: [],
    fotografia,
  })

  it('mappa testata e fotografia; il bollo vale importoBolloAl', () => {
    const d = datiFatturaDaDocumento(doc(), '0000A')
    expect(d.trasmissione).toEqual({
      idPaese: 'IT',
      idCodice: '01234567890',
      progressivoInvio: '0000A',
      formato: 'FPR12',
      codiceDestinatario: 'ABCDEFG',
      pecDestinatario: null,
    })
    expect(d.generali.bollo).toEqual({ importo: '2.00' })
    expect(d.generali.causale).toEqual(['Testo'])
    expect(d.contratto).toEqual({ idDocumento: 'ORD1', cig: 'CIG1', cup: null })
    expect(d.pagamento).toBeNull()
    expect(d.fattureCollegate).toBeNull()
  })

  it('TD04 porta l origine; senza bollo dovuto niente DatiBollo', () => {
    const d = datiFatturaDaDocumento(
      doc({
        tipoDocumento: 'TD04',
        bolloDovuto: false,
        importoBollo: null,
        origine: { numeroTesto: '5/2026', dataDocumento: '2026-10-01' },
      }),
      '0000B'
    )
    expect(d.fattureCollegate).toEqual({ idDocumento: '5/2026', data: '2026-10-01' })
    expect(d.generali.bollo).toBeNull()
  })

  it('serializza un documento intero senza errori', () => {
    const xml = serializzaFattura(datiFatturaDaDocumento(doc(), '0000A'))
    expect(xml).toContain('<ProgressivoInvio>0000A</ProgressivoInvio>')
    expect(xml.endsWith('</p:FatturaElettronica>')).toBe(true)
  })
})

describe('serializzaFattura: campi Basic Latin', () => {
  it('IdDocumento, UnitaMisura, Numero e NumeroREA passano da Basic Latin', () => {
    const xml = serializzaFattura(
      dati({
        generali: { ...dati().generali, numero: '1/2026-à' },
        contratto: { idDocumento: 'Det. n° 45', cig: null, cup: null },
        fattureCollegate: { idDocumento: 'N° 5', data: '2026-10-01' },
        linee: [riga({ unitaMisura: 'm³' })],
        cedente: { ...cedente, rea: { ...cedente.rea!, numero: 'RM-123°' } },
      })
    )
    expect(xml).toContain('<Numero>1/2026-a</Numero>')
    expect(xml).toContain('<IdDocumento>Det. n. 45</IdDocumento>')
    expect(xml).toContain('<IdDocumento>N. 5</IdDocumento>')
    expect(xml).toContain('<UnitaMisura>m3</UnitaMisura>')
    expect(xml).toContain('<NumeroREA>RM-123.</NumeroREA>')
  })

  it('i campi Latin-1 conservano le lettere accentate', () => {
    const xml = serializzaFattura(
      dati({ cessionario: { ...cessionario, denominazione: 'Müller Łódź' } })
    )
    expect(xml).toContain('<Denominazione>Müller Lódz</Denominazione>')
  })
})

describe('serializzaFattura: campi obbligatori vuoti dopo la normalizzazione', () => {
  const lancia = (d: DatiFatturaXml, campo: string) => {
    let errore: unknown
    try {
      serializzaFattura(d)
    } catch (e) {
      errore = e
    }
    expect(errore).toBeInstanceOf(CampoXmlObbligatorioVuotoError)
    expect((errore as CampoXmlObbligatorioVuotoError).campo).toBe(campo)
  }

  it('Descrizione di sole emoji', () => {
    lancia(dati({ linee: [riga({ descrizione: '😀😀' })] }), 'Descrizione')
  })
  it('denominazione del cedente di soli CJK', () => {
    lancia(dati({ cedente: { ...cedente, denominazione: '世界' } }), 'Denominazione')
  })
  it('persona fisica senza nome ne denominazione', () => {
    lancia(dati({ cessionario: { ...cessionario, denominazione: null } }), 'Nome')
  })
  it('indirizzo vuoto', () => {
    lancia(
      dati({ cessionario: { ...cessionario, sede: { ...sede, indirizzo: '  ' } } }),
      'Indirizzo'
    )
  })
  it('numero del documento vuoto', () => {
    lancia(dati({ generali: { ...dati().generali, numero: '😀' } }), 'Numero')
  })
  it('cessionario senza partita IVA ne codice fiscale', () => {
    lancia(dati({ cessionario: { ...cessionario, partitaIva: null } }), 'IdFiscaleIVA')
  })
  it('ufficio REA che non e una sigla di due lettere', () => {
    lancia(dati({ cedente: { ...cedente, rea: { ...cedente.rea!, ufficio: 'Roma' } } }), 'Ufficio')
  })
})

describe('serializzaFattura: facoltativi e maiuscole', () => {
  it('Provincia che non e di due lettere si omette (non si tronca)', () => {
    const xml = serializzaFattura(
      dati({ cedente: { ...cedente, sede: { ...sede, provincia: 'Roma' } } })
    )
    expect(xml).not.toContain('<Provincia>RO</Provincia>')
    expect(xml).toContain('<Comune>Roma</Comune><Nazione>IT</Nazione>')
  })
  it('codice fiscale in maiuscolo', () => {
    const xml = serializzaFattura(
      dati({ cedente: { ...cedente, codiceFiscale: 'rssmra80a01h501u' } })
    )
    expect(xml).toContain('<CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>')
  })
  it('sconto con piu di 2 decimali: errore, non arrotondamento', () => {
    expect(() => serializzaFattura(dati({ linee: [riga({ sconto: '12.345' })] }))).toThrow(
      /2 decimali/
    )
  })
})

describe('datiFatturaDaDocumento: importo del bollo salvato', () => {
  it('usa testata.importoBollo, non il ricalcolo', () => {
    const f: FotografiaDocumento = {
      cedente,
      cessionario,
      pagamento: null,
      conto: null,
      testoFatturazione: [],
      cig: null,
      cup: null,
      idDocumento: null,
    }
    const d = datiFatturaDaDocumento(
      {
        testata: {
          tipoDocumento: 'TD01',
          formatoTrasmissione: 'FPR12',
          codiceDestinatario: 'ABCDEFG',
          pecDestinatario: null,
          dataDocumento: '2026-11-05',
          numeroTesto: '1/2026',
          totaleDocumento: '30.50',
          bolloDovuto: true,
          importoBollo: '2.50',
          esigibilita: 'I',
          condizioniPagamento: null,
          origine: null,
        },
        righe: [riga()],
        riepiloghi: [riepilogo()],
        rate: [],
        fotografia: f,
      },
      '00001'
    )
    expect(d.generali.bollo).toEqual({ importo: '2.50' })
  })
})

// Validazione con l'XSD ufficiale 1.2.3. Gli XSD non sono nel repository (li porta il Task 16):
// il test gira solo se `xmllint` c'e e `FATTURAPA_XSD` indica lo schema (con xmldsig in locale).
const XSD = process.env.FATTURAPA_XSD
function haXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const puoValidare = XSD !== undefined && existsSync(XSD) && haXmllint()

;(puoValidare ? describe : describe.skip)('serializzaFattura: validazione xmllint sull XSD', () => {
  const valida = (xml: string) =>
    execFileSync('xmllint', ['--noout', '--schema', XSD as string, '-'], {
      input: xml,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

  const casi: Array<[string, DatiFatturaXml]> = [
    ['base', dati()],
    [
      'campi Basic Latin con Latin-1',
      dati({
        generali: { ...dati().generali, numero: '1/2026-à' },
        contratto: { idDocumento: 'Det. n° 45', cig: 'Z1A2B3C4D5', cup: 'J11B22000123456' },
        linee: [riga({ unitaMisura: 'm³', numeroFir: 'RTCFX 123/26' })],
        cedente: { ...cedente, rea: { ...cedente.rea!, numero: 'RM-123°' } },
      }),
    ],
    [
      'testi estremi',
      dati({
        cessionario: {
          ...cessionario,
          denominazione: 'Müller & Figli <Łódź> “x” 😀 世界 ' + 'z'.repeat(100),
        },
        generali: { ...dati().generali, causale: ['a & b '.repeat(100), 'seconda riga'] },
        linee: [
          riga({ descrizione: 'd'.repeat(1100), prezzoUnitario: '0.123456789', sconto: '10+5' }),
        ],
      }),
    ],
    [
      'persona fisica con PEC e bollo',
      dati({
        trasmissione: {
          ...dati().trasmissione,
          codiceDestinatario: '0000000',
          pecDestinatario: 'a@pec.it',
        },
        cessionario: {
          ...cessionario,
          denominazione: null,
          nome: 'François',
          cognome: "D'Angelo",
          partitaIva: null,
          codiceFiscale: 'rssmra80a01h501u',
        },
        generali: { ...dati().generali, bollo: { importo: '2.00' } },
        cedente: { ...cedente, sede: { ...sede, provincia: 'Roma' } },
      }),
    ],
  ]

  it.each(casi)('valida: %s', (_nome, d) => {
    expect(() => valida(serializzaFattura(d))).not.toThrow()
  })
})
