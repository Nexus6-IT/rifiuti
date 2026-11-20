import { createHash } from 'crypto'
import { DOMParser } from '@xmldom/xmldom'
import { validaXmlRegistro } from '../../../infrastructure/rentri/valida-xml-registro'
import {
  XmlRegistroNonSerializzabileError,
  serializzaMovimento,
  serializzaRegistro,
  type GruppoRegistrazioni,
  type VoceRegistro,
} from './serializza-registro-xml'
import {
  traduciAnnotazione,
  type AnnotazionePerRentri,
  type DatiFirPerRegistro,
} from './mappa-registrazione-rentri'

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const AUTORE = 'Mario Rossi'
const TS = '2026-03-01T10:00:00.000Z'

/** eREGI di prova con una firma completa per l'XSD (valori fittizi). */
const EREGI =
  `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="eREGI-CS-0">` +
  '<reg:Identificativo>R1234ABCDE0</reg:Identificativo>' +
  '<reg:Operatore><reg:NumIscr>OP1234567890123</reg:NumIscr><reg:CodiceFiscale>01234567890</reg:CodiceFiscale><reg:Denominazione>Rossi &amp; Figli</reg:Denominazione></reg:Operatore>' +
  '<reg:NumIscrSito>OP1234567890123-MI0001</reg:NumIscrSito><reg:IndirizzoSito>Via Roma 1</reg:IndirizzoSito>' +
  '<reg:DataRichiesta>2026-01-02T08:00:00Z</reg:DataRichiesta><reg:IdentificativoRichiesta>x</reg:IdentificativoRichiesta>' +
  '<reg:AutoreRichiesta>y</reg:AutoreRichiesta><reg:CCIAANome>z</reg:CCIAANome>' +
  '<ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
  '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
  '<ds:Reference URI="#eREGI-CS-0"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
  '<ds:DigestValue>q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c=</ds:DigestValue></ds:Reference></ds:SignedInfo>' +
  '<ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature></reg:eREGI>'
const EREGI_CON_PROLOGO = `${String.fromCharCode(0xfeff)}<?xml version="1.0" encoding="UTF-8"?>\n${EREGI}\n`

const INDIRIZZO = {
  citta: { comune_id: '058091' },
  indirizzo: 'Via Roma',
  civico: '1',
  cap: '00100',
}

function fir(extra: Partial<DatiFirPerRegistro> = {}): DatiFirPerRegistro {
  return {
    numeroFir: 'FIR/2026/0001',
    dataInizioTrasporto: '2026-03-02T08:00:00.000Z',
    dataFineTrasporto: '2026-03-02T12:00:00.000Z',
    pesoVerificatoDestinoKg: 95,
    provenienza: 'U',
    produttore: {
      denominazione: 'Produttore Srl',
      codiceFiscale: '01234567890',
      indirizzo: INDIRIZZO,
    },
    trasportatore: {
      denominazione: 'Trasporti Srl',
      codiceFiscale: '09876543210',
      numeroIscrizioneAlbo: 'MI/123456',
    },
    destinatario: {
      denominazione: 'Impianto Srl',
      codiceFiscale: '11223344556',
      numeroAutorizzazione: 'AUT-77',
    },
    ...extra,
  }
}

function annotazione(extra: Partial<AnnotazionePerRentri> = {}): AnnotazionePerRentri {
  return {
    movimentoId: 'mov-1',
    tipoAnnotazione: 'ORDINARIA',
    numero: { anno: 2026, progressivo: 7 },
    dataRegistrazione: TS,
    verso: 'CARICO',
    codiceRentri: 'DT',
    cerCode: '15 01 01',
    descrizione: null,
    quantita: 100,
    unit: 'KG',
    statoFisico: 'Solido',
    classiPericolo: null,
    operazione: null,
    predecessore: null,
    motivo: null,
    fir: null,
    riferimentiCarico: [],
    ...extra,
  }
}

function corpo(a: AnnotazionePerRentri): Record<string, unknown> {
  const r = traduciAnnotazione(a)
  if (!r.ok) throw new Error(`traduzione fallita: ${r.motivi.join(' | ')}`)
  return r.corpo
}

/** Registro minimo con le sole voci date (progressivi 1..n). */
function registro(voci: VoceRegistro[], extra: Partial<GruppoRegistrazioni> = {}): string {
  return serializzaRegistro({
    eregXml: EREGI,
    riferimenti: [
      {
        digestValue: 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c=',
        dataCreazione: '2026-01-02T08:00:00Z',
      },
    ],
    registrazioni: [
      {
        anno: 2026,
        progressivoDa: 1,
        progressivoA: voci.length,
        dataCreazione: '2026-04-01T00:00:00.000Z',
        voci,
        ...extra,
      },
    ],
  })
}

function voce(a: AnnotazionePerRentri, progressivo = 1, anno = 2026): VoceRegistro {
  return {
    corpo: corpo({ ...a, numero: { anno, progressivo } }),
    autore: AUTORE,
    identificativoTemporale: TS,
  }
}

/** Le 6 forme di causale + rettifica + annullamento + riferimenti: ognuna con un caso. */
const CASI: Record<string, AnnotazionePerRentri> = {
  DT: annotazione(),
  NP: annotazione({ codiceRentri: 'NP', cerCode: '20 01 08' }),
  RE: annotazione({ codiceRentri: 'RE', unit: 'T', quantita: 1.5 }),
  I: annotazione({
    codiceRentri: 'I',
    verso: 'SCARICO',
    operazione: 'R13',
    cerCode: '17 09 04',
  }),
  'T*': annotazione({ codiceRentri: 'T*', fir: fir() }),
  aT: annotazione({
    codiceRentri: 'aT',
    verso: 'SCARICO',
    operazione: 'D15',
    fir: fir(),
    riferimentiCarico: [
      { anno: 2026, progressivo: 1 },
      { anno: 2025, progressivo: 99 },
    ],
  }),
  pericoloso: annotazione({
    cerCode: '16 01 11*',
    classiPericolo: 'HP4, HP14',
    statoFisico: 'Liquido',
  }),
  eer99: annotazione({ cerCode: '19 12 99', descrizione: 'Miscela <varia> & "altro"' }),
  rettifica: annotazione({
    tipoAnnotazione: 'RETTIFICA',
    predecessore: { anno: 2026, progressivo: 3 },
    motivo: "Errore di peso: l'originale era 90 kg",
  }),
  annullamento: annotazione({
    tipoAnnotazione: 'ANNULLAMENTO',
    predecessore: { anno: 2026, progressivo: 3 },
    motivo: 'Registrata due volte',
  }),
}

describe('serializzaMovimento', () => {
  it("DT minimo: golden compatto, ordine dell'XSD", () => {
    const xml = serializzaMovimento(corpo(CASI.DT), AUTORE, TS)
    expect(xml).toBe(
      '<reg:Movimento><mov:Autore>Mario Rossi</mov:Autore>' +
        '<mov:IdentificativoTemporale>2026-03-01T10:00:00.000Z</mov:IdentificativoTemporale>' +
        '<mov:Riferimenti><mov:NumeroRegistrazione><mov:Anno>2026</mov:Anno><mov:Progressivo>7</mov:Progressivo></mov:NumeroRegistrazione>' +
        '<mov:DataOraRegistrazione>2026-03-01T10:00:00.000Z</mov:DataOraRegistrazione>' +
        '<mov:CausaleOperazione>DT</mov:CausaleOperazione></mov:Riferimenti>' +
        '<mov:Rifiuto><mov:CodiceEer>150101</mov:CodiceEer><mov:StatoFisico>S</mov:StatoFisico>' +
        '<mov:Quantita><mov:Valore>100</mov:Valore><mov:UnitaMisura>kg</mov:UnitaMisura></mov:Quantita></mov:Rifiuto></reg:Movimento>'
    )
  })

  it('annullamento: golden', () => {
    const xml = serializzaMovimento(corpo(CASI.annullamento), AUTORE, TS)
    expect(xml).toBe(
      '<reg:AnnullamentoMovimento><mov:Autore>Mario Rossi</mov:Autore>' +
        '<mov:IdentificativoTemporale>2026-03-01T10:00:00.000Z</mov:IdentificativoTemporale>' +
        '<mov:NumeroRegistrazione><mov:Anno>2026</mov:Anno><mov:Progressivo>7</mov:Progressivo></mov:NumeroRegistrazione>' +
        '<mov:DataOraRegistrazione>2026-03-01T10:00:00.000Z</mov:DataOraRegistrazione>' +
        '<mov:NumeroRegistrazioneAnnullata><mov:Anno>2026</mov:Anno><mov:Progressivo>3</mov:Progressivo></mov:NumeroRegistrazioneAnnullata>' +
        '<mov:Annotazioni>Registrata due volte</mov:Annotazioni></reg:AnnullamentoMovimento>'
    )
  })

  it('aT con esito, FIR, riferimenti di carico: golden dei blocchi', () => {
    const xml = serializzaMovimento(corpo(CASI.aT), AUTORE, TS)
    expect(xml).toContain(
      '<mov:RiferimentoOperazione><mov:IdentificativoMovimento><mov:Anno>2026</mov:Anno><mov:Progressivo>1</mov:Progressivo></mov:IdentificativoMovimento>' +
        '<mov:IdentificativoMovimento><mov:Anno>2025</mov:Anno><mov:Progressivo>99</mov:Progressivo></mov:IdentificativoMovimento></mov:RiferimentoOperazione>'
    )
    expect(xml).toContain('<mov:DestinatoAttivita>D15</mov:DestinatoAttivita>')
    expect(xml).toContain(
      '<mov:IntegrazioneFir><mov:NumeroFir>FIR/2026/0001</mov:NumeroFir><mov:DataInizioTrasporto>2026-03-02T08:00:00.000Z</mov:DataInizioTrasporto></mov:IntegrazioneFir>' +
        '<mov:Esito><mov:DataFineTrasporto>2026-03-02T12:00:00.000Z</mov:DataFineTrasporto><mov:PesoVerificatoDestino>95</mov:PesoVerificatoDestino></mov:Esito>'
    )
    expect(xml).toContain(
      '<mov:Trasportatore><mov:Denominazione>Trasporti Srl</mov:Denominazione><mov:CodiceFiscale>09876543210</mov:CodiceFiscale><mov:NumIscrizioneAlbo>MI/123456</mov:NumIscrizioneAlbo></mov:Trasportatore>' +
        '<mov:Destinatario><mov:Denominazione>Impianto Srl</mov:Denominazione><mov:CodiceFiscale>11223344556</mov:CodiceFiscale><mov:NumAutorizzazione>AUT-77</mov:NumAutorizzazione></mov:Destinatario>'
    )
  })

  it("T*: produttore con indirizzo tipizzato (IndirizzoBase e' astratto)", () => {
    const xml = serializzaMovimento(corpo(CASI['T*']), AUTORE, TS)
    expect(xml).toContain(
      '<mov:Produttore><mov:Denominazione>Produttore Srl</mov:Denominazione><mov:CodiceFiscale>01234567890</mov:CodiceFiscale>' +
        '<mov:Indirizzo xsi:type="mov:IndirizzoItaliano"><mov:Indirizzo>Via Roma</mov:Indirizzo><mov:Civico>1</mov:Civico><mov:Cap>00100</mov:Cap><mov:Citta ComuneId="058091"/></mov:Indirizzo></mov:Produttore>'
    )
  })

  it('rettifica: NumeroRegistrazioneRettifica prima della causale, Annotazioni in coda', () => {
    const xml = serializzaMovimento(corpo(CASI.rettifica), AUTORE, TS)
    expect(xml).toContain(
      '</mov:DataOraRegistrazione><mov:NumeroRegistrazioneRettifica><mov:Anno>2026</mov:Anno><mov:Progressivo>3</mov:Progressivo></mov:NumeroRegistrazioneRettifica><mov:CausaleOperazione>'
    )
    expect(
      xml.endsWith(
        '<mov:Annotazioni>Errore di peso: l&apos;originale era 90 kg</mov:Annotazioni></reg:Movimento>'
      )
    ).toBe(true)
  })

  it('pericolosi e EER 99: HP in ordine, descrizione con escape completo', () => {
    const p = serializzaMovimento(corpo(CASI.pericoloso), AUTORE, TS)
    expect(p).toContain(
      '<mov:CodiceEer>160111</mov:CodiceEer><mov:CaratteristichePericolo><mov:CaratteristicaPericolo>HP04</mov:CaratteristicaPericolo><mov:CaratteristicaPericolo>HP14</mov:CaratteristicaPericolo></mov:CaratteristichePericolo><mov:StatoFisico>L</mov:StatoFisico>'
    )
    const e = serializzaMovimento(corpo(CASI.eer99), AUTORE, TS)
    expect(e).toContain(
      '<mov:DescrizioneEer>Miscela &lt;varia&gt; &amp; &quot;altro&quot;</mov:DescrizioneEer>'
    )
  })

  it('quantita decimali in notazione posizionale, mai con esponente', () => {
    const c = corpo(CASI.DT) as { rifiuto: { quantita: { valore: number } } }
    c.rifiuto.quantita.valore = 0.0001
    expect(serializzaMovimento(c, AUTORE, TS)).toContain('<mov:Valore>0.0001</mov:Valore>')
    c.rifiuto.quantita.valore = 1e-7
    expect(serializzaMovimento(c, AUTORE, TS)).toContain('<mov:Valore>0.0000001</mov:Valore>')
    c.rifiuto.quantita.valore = 1234.5678
    expect(serializzaMovimento(c, AUTORE, TS)).toContain('<mov:Valore>1234.5678</mov:Valore>')
  })

  it('escape di autore e testi, \\r preservato come riferimento di carattere', () => {
    const xml = serializzaMovimento(corpo(CASI.annullamento), 'A&B <"c">', TS)
    expect(xml).toContain('<mov:Autore>A&amp;B &lt;&quot;c&quot;&gt;</mov:Autore>')
    const c = { ...corpo(CASI.annullamento), annotazioni: 'riga1\r\nriga2' }
    expect(serializzaMovimento(c, AUTORE, TS)).toContain('riga1&#13;\nriga2')
  })

  it("fail-closed: proprieta' sconosciuta, carattere non XML, data non ISO, campo mancante", () => {
    expect(() => serializzaMovimento({ ...corpo(CASI.DT), nuovo: 1 }, AUTORE, TS)).toThrow(
      XmlRegistroNonSerializzabileError
    )
    expect(() => serializzaMovimento(corpo(CASI.DT), 'Mario\u0000', TS)).toThrow(
      /caratteri non ammessi/
    )
    expect(() => serializzaMovimento(corpo(CASI.DT), 'Mario\uD800', TS)).toThrow(
      /caratteri non ammessi/
    )
    expect(() => serializzaMovimento(corpo(CASI.DT), AUTORE, '01/03/2026')).toThrow(/data ISO/)
    expect(() => serializzaMovimento({ riferimenti: {} }, AUTORE, TS)).toThrow(
      XmlRegistroNonSerializzabileError
    )
  })

  it('il messaggio di errore non riporta il contenuto del dato', () => {
    try {
      serializzaMovimento(corpo(CASI.DT), 'SEGRETO\u0001', TS)
      fail('atteso errore')
    } catch (e) {
      expect((e as Error).message).not.toContain('SEGRETO')
    }
  })
})

describe('serializzaRegistro', () => {
  it('eREGI inserito verbatim byte per byte (tolti solo BOM, dichiarazione e spazi esterni)', () => {
    const xml = serializzaRegistro({
      eregXml: EREGI_CON_PROLOGO,
      riferimenti: [],
      registrazioni: [
        {
          anno: 2026,
          progressivoDa: 1,
          progressivoA: 1,
          dataCreazione: '2026-04-01T00:00:00.000Z',
          voci: [voce(CASI.DT)],
        },
      ],
    })
    const inizio = xml.indexOf('<reg:eREGI')
    expect(xml.slice(inizio, inizio + EREGI.length)).toBe(EREGI)
    expect(
      createHash('sha256')
        .update(xml.slice(inizio, inizio + EREGI.length))
        .digest('hex')
    ).toBe(createHash('sha256').update(EREGI).digest('hex'))
    expect(xml.slice(inizio + EREGI.length)).toMatch(/^<reg:Registrazioni /)
  })

  it("struttura e golden dell'intestazione: catena di riferimenti in ordine, attributi", () => {
    const xml = serializzaRegistro({
      eregXml: EREGI,
      riferimenti: [
        { digestValue: 'AAAA', dataCreazione: '2026-01-02T08:00:00Z' },
        { digestValue: 'BBBB', dataCreazione: '2026-02-01T00:00:00.000Z' },
      ],
      registrazioni: [
        {
          anno: 2026,
          progressivoDa: 8,
          progressivoA: 9,
          dataCreazione: '2026-04-01T00:00:00.000Z',
          voci: [voce(CASI.DT, 8), voce(CASI.NP, 9)],
        },
      ],
    })
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?><reg:Registro xmlns:reg="urn:it:rentri:registri:1.0"><reg:eREGI'
      )
    ).toBe(true)
    expect(xml).toContain(
      '</reg:eREGI><reg:RiferimentiPrecedenti><reg:Ref DigestValue="AAAA" DataCreazione="2026-01-02T08:00:00Z"/><reg:Ref DigestValue="BBBB" DataCreazione="2026-02-01T00:00:00.000Z"/></reg:RiferimentiPrecedenti>' +
        '<reg:Registrazioni xmlns:mov="urn:it:rentri:movimenti:1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Anno="2026" ProgressivoDa="8" ProgressivoA="9" NumeroRegistrazioni="2" DataCreazione="2026-04-01T00:00:00.000Z"><reg:Movimento>'
    )
    expect(xml.endsWith('</reg:Registrazioni></reg:Registro>')).toBe(true)
  })

  it("senza riferimenti, RiferimentiPrecedenti e' omesso", () => {
    const xml = serializzaRegistro({
      eregXml: EREGI,
      riferimenti: [],
      registrazioni: [
        { anno: 2026, progressivoDa: 1, progressivoA: 1, dataCreazione: TS, voci: [voce(CASI.DT)] },
      ],
    })
    expect(xml).not.toContain('RiferimentiPrecedenti')
  })

  it("e' XML ben formato (parser indipendente) con escape corretto di tutti i testi", () => {
    const xml = registro([voce(CASI.eer99, 1), voce(CASI.annullamento, 2)])
    const errori: string[] = []
    new DOMParser({ onError: (_l: string, m: string) => errori.push(m) }).parseFromString(
      xml,
      'text/xml'
    )
    expect(errori).toEqual([])
  })

  it("cambio d'anno: due gruppi Registrazioni", () => {
    const xml = serializzaRegistro({
      eregXml: EREGI,
      riferimenti: [],
      registrazioni: [
        {
          anno: 2025,
          progressivoDa: 40,
          progressivoA: 40,
          dataCreazione: TS,
          voci: [voce(CASI.DT, 40, 2025)],
        },
        { anno: 2026, progressivoDa: 1, progressivoA: 1, dataCreazione: TS, voci: [voce(CASI.NP)] },
      ],
    })
    expect(xml.match(/<reg:Registrazioni /g)).toHaveLength(2)
  })

  it("fail-closed: eREGI con DOCTYPE, non eREGI, voci incoerenti con l'intervallo, digest non base64", () => {
    const base = {
      riferimenti: [],
      registrazioni: [
        { anno: 2026, progressivoDa: 1, progressivoA: 1, dataCreazione: TS, voci: [voce(CASI.DT)] },
      ],
    }
    expect(() =>
      serializzaRegistro({ ...base, eregXml: `<!DOCTYPE x [<!ENTITY a "b">]>${EREGI}` })
    ).toThrow(/DOCTYPE/)
    expect(() => serializzaRegistro({ ...base, eregXml: '<altro/>' })).toThrow(/forma attesa/)
    expect(() =>
      serializzaRegistro({
        eregXml: EREGI,
        riferimenti: [],
        registrazioni: [{ ...base.registrazioni[0], progressivoA: 3 }],
      })
    ).toThrow(/intervallo/)
    expect(() =>
      serializzaRegistro({
        ...base,
        eregXml: EREGI,
        riferimenti: [{ digestValue: '"><x/>', dataCreazione: TS }],
      })
    ).toThrow(/base64/)
    expect(() => serializzaRegistro({ ...base, eregXml: EREGI, registrazioni: [] })).toThrow(
      /nessuna registrazione/
    )
  })

  describe('coerenza fra intestazione del gruppo e voci (I1)', () => {
    const gr = (g: Partial<GruppoRegistrazioni>[]) =>
      serializzaRegistro({
        eregXml: EREGI,
        riferimenti: [],
        registrazioni: g.map(x => ({
          anno: 2026,
          progressivoDa: 1,
          progressivoA: 1,
          dataCreazione: TS,
          voci: [voce(CASI.DT)],
          ...x,
        })),
      })

    it('anno della voce diverso da quello del gruppo: errore', () => {
      expect(() => gr([{ anno: 2025, progressivoDa: 40, progressivoA: 40 }])).toThrow(
        /numeri delle voci/
      )
    })
    it('progressivo saltato: errore', () => {
      expect(() => gr([{ progressivoA: 2, voci: [voce(CASI.DT, 1), voce(CASI.NP, 3)] }])).toThrow(
        /numeri delle voci/
      )
    })
    it('voci in ordine invertito: errore', () => {
      expect(() => gr([{ progressivoA: 2, voci: [voce(CASI.DT, 2), voce(CASI.NP, 1)] }])).toThrow(
        /numeri delle voci/
      )
    })
    it("annullamento: il numero si legge dal corpo dell'annullamento", () => {
      expect(() => gr([{ voci: [voce(CASI.annullamento, 5)] }])).toThrow(/numeri delle voci/)
      expect(
        gr([{ progressivoDa: 5, progressivoA: 5, voci: [voce(CASI.annullamento, 5)] }])
      ).toContain('ProgressivoDa="5"')
    })
    it('gruppi sovrapposti o con anno non crescente: errore', () => {
      expect(() => gr([{ voci: [voce(CASI.DT, 1)] }, { voci: [voce(CASI.NP, 1)] }])).toThrow(
        /ordine/
      )
      expect(() =>
        gr([
          { anno: 2026, voci: [voce(CASI.DT, 1)] },
          { anno: 2025, voci: [voce(CASI.NP, 1, 2025)] },
        ])
      ).toThrow(/ordine/)
    })
    it('stesso anno, gruppi contigui in ordine: ammessi', () => {
      expect(() =>
        gr([
          { progressivoDa: 1, progressivoA: 1, voci: [voce(CASI.DT, 1)] },
          { progressivoDa: 2, progressivoA: 2, voci: [voce(CASI.NP, 2)] },
        ])
      ).not.toThrow()
    })
  })

  describe('rifiuti di valori e date (M1-M4)', () => {
    it('M1: valore troppo piccolo o negativo: errore, mai 0', () => {
      const c = corpo(CASI.DT) as { rifiuto: { quantita: { valore: number } } }
      c.rifiuto.quantita.valore = 1e-11
      expect(() => serializzaMovimento(c, AUTORE, TS)).toThrow(XmlRegistroNonSerializzabileError)
      c.rifiuto.quantita.valore = -1e-11
      expect(() => serializzaMovimento(c, AUTORE, TS)).toThrow(XmlRegistroNonSerializzabileError)
    })
    it('M2: data senza fuso rifiutata, con offset ammessa', () => {
      expect(() => serializzaMovimento(corpo(CASI.DT), AUTORE, '2026-03-01T10:00:00')).toThrow(
        /data ISO/
      )
      expect(() =>
        serializzaMovimento(corpo(CASI.DT), AUTORE, '2026-03-01T10:00:00+01:00')
      ).not.toThrow()
    })
    it('M4: tab, a capo e \\r in un attributo diventano riferimenti di carattere', () => {
      const c = corpo(CASI['T*']) as { produttore: { indirizzo: { citta: { comune_id: string } } } }
      c.produttore.indirizzo.citta.comune_id = 'a\tb\nc\rd'
      expect(serializzaMovimento(c, AUTORE, TS)).toContain('ComuneId="a&#9;b&#10;c&#13;d"')
    })
  })

  describe('golden delle altre causali (M6)', () => {
    it('NP, RE (T -> kg), I (R13)', () => {
      expect(serializzaMovimento(corpo(CASI.NP), AUTORE, TS)).toContain(
        '<mov:CausaleOperazione>NP</mov:CausaleOperazione>'
      )
      const re = serializzaMovimento(corpo(CASI.RE), AUTORE, TS)
      expect(re).toContain('<mov:CausaleOperazione>RE</mov:CausaleOperazione>')
      expect(re).toContain(
        '<mov:Quantita><mov:Valore>1500</mov:Valore><mov:UnitaMisura>kg</mov:UnitaMisura></mov:Quantita>'
      )
      const i = serializzaMovimento(corpo(CASI.I), AUTORE, TS)
      expect(i).toContain('<mov:CausaleOperazione>I</mov:CausaleOperazione>')
      expect(i).toContain('<mov:DestinatoAttivita>R13</mov:DestinatoAttivita>')
    })
  })

  describe('validazione XSD', () => {
    it.each(Object.keys(CASI))("caso %s passa l'XSD", async nome => {
      const esito = await validaXmlRegistro(registro([voce(CASI[nome])]))
      expect(esito.errori).toEqual([])
      expect(esito.valido).toBe(true)
    })

    it("registro di 50 annotazioni miste passa l'XSD", async () => {
      const nomi = Object.keys(CASI)
      const voci: VoceRegistro[] = []
      for (let i = 0; i < 50; i++) {
        const base = CASI[nomi[i % nomi.length]]
        voci.push(voce(base, i + 1))
      }
      const xml = registro(voci)
      const esito = await validaXmlRegistro(xml)
      expect(esito.errori).toEqual([])
      expect(xml.match(/<reg:(Movimento|AnnullamentoMovimento)>/g)).toHaveLength(50)
    })

    it("l'XSD segnala davvero: un elemento fuori ordine e' respinto", async () => {
      const xml = registro([voce(CASI.DT)]).replace(
        /(<mov:Autore>[^<]*<\/mov:Autore>)(<mov:IdentificativoTemporale>[^<]*<\/mov:IdentificativoTemporale>)/,
        '$2$1'
      )
      const esito = await validaXmlRegistro(xml)
      expect(esito.valido).toBe(false)
      expect(esito.errori.join(' ')).not.toContain('Mario')
    })

    it("un eREGI alterato fuori schema e' respinto", async () => {
      const xml = serializzaRegistro({
        eregXml: EREGI.replace('R1234ABCDE0', 'minuscolo'),
        riferimenti: [],
        registrazioni: [
          {
            anno: 2026,
            progressivoDa: 1,
            progressivoA: 1,
            dataCreazione: TS,
            voci: [voce(CASI.DT)],
          },
        ],
      })
      expect((await validaXmlRegistro(xml)).valido).toBe(false)
    })
  })
})
