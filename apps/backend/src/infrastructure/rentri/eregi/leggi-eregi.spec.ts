import { EregiNonValidoError, LUNGHEZZA_MASSIMA_EREGI, leggiEregi } from './leggi-eregi'

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'

interface Opzioni {
  id?: string
  uri?: string
  digest?: string
  identificativo?: string
  dataRichiesta?: string
  numIscrSito?: string
  senzaFirma?: boolean
  dueReference?: boolean
  dueFirme?: boolean
  prologo?: string
  firmaAnnidata?: boolean
  /** Due `ds:SignedInfo` nella stessa firma: il Reference sta nel primo o nel secondo. */
  dueSignedInfo?: 'riferimentoNelPrimo' | 'riferimentoNelSecondo'
  /** `null` = nessun `ds:DigestMethod`. */
  digestMethod?: string | null
  idDuplicato?: boolean
  dopoRadice?: string
}

const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const DIGEST_VALIDO = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c='

function xmlEregi(o: Opzioni = {}): string {
  const uri = o.uri ?? '#eREGI-CS-0'
  const digest = o.digest ?? DIGEST_VALIDO
  const reference = (u: string) =>
    `<ds:Reference URI="${u}">${o.digestMethod === null ? '' : `<ds:DigestMethod Algorithm="${o.digestMethod ?? SHA256}"/>`}<ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>`
  const signedInfo =
    o.dueSignedInfo === 'riferimentoNelPrimo'
      ? `<ds:SignedInfo>${reference(uri)}</ds:SignedInfo><ds:SignedInfo></ds:SignedInfo>`
      : o.dueSignedInfo === 'riferimentoNelSecondo'
        ? `<ds:SignedInfo></ds:SignedInfo><ds:SignedInfo>${reference(uri)}</ds:SignedInfo>`
        : `<ds:SignedInfo>${reference(uri)}${o.dueReference ? reference('#altro') : ''}</ds:SignedInfo>`
  const firma = (n: number) =>
    `<ds:Signature>${signedInfo}<ds:SignatureValue>AAAA${n}</ds:SignatureValue></ds:Signature>`
  const corpo =
    `<reg:Identificativo>${o.identificativo ?? 'R1234ABCDE0'}</reg:Identificativo>` +
    `<reg:Operatore><reg:NumIscr>MI1</reg:NumIscr><reg:CodiceFiscale>RSSMRA80A01F205X</reg:CodiceFiscale><reg:Denominazione>X</reg:Denominazione></reg:Operatore>` +
    (o.numIscrSito === ''
      ? ''
      : `<reg:NumIscrSito>${o.numIscrSito ?? 'OP1234ABC123456-MI0001'}</reg:NumIscrSito>`) +
    `<reg:IndirizzoSito>Via 1</reg:IndirizzoSito>` +
    (o.dataRichiesta === ''
      ? ''
      : `<reg:DataRichiesta>${o.dataRichiesta ?? '2026-11-19T10:00:00Z'}</reg:DataRichiesta>`) +
    `<reg:IdentificativoRichiesta>x</reg:IdentificativoRichiesta><reg:AutoreRichiesta>y</reg:AutoreRichiesta><reg:CCIAANome>z</reg:CCIAANome>`
  const firme = o.senzaFirma
    ? ''
    : o.firmaAnnidata
      ? `<reg:Extra>${firma(1)}</reg:Extra>`
      : firma(1) + (o.dueFirme ? firma(2) : '')
  return `${o.prologo ?? '<?xml version="1.0" encoding="UTF-8"?>'}<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="${o.id ?? 'eREGI-CS-0'}">${corpo}${o.idDuplicato ? '<reg:Extra Id="eREGI-CS-0"/>' : ''}${firme}</reg:eREGI>${o.dopoRadice ?? ''}`
}

describe('leggiEregi', () => {
  it('estrae digest, data richiesta, identificativo e numIscrSito', () => {
    expect(leggiEregi(xmlEregi())).toEqual({
      digest: 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c=',
      dataRichiesta: '2026-11-19T10:00:00Z',
      identificativo: 'R1234ABCDE0',
      numIscrSito: 'OP1234ABC123456-MI0001',
    })
  })

  it('accetta un prefisso diverso e spazi attorno ai valori', () => {
    const xml = xmlEregi({ digest: '  ' + DIGEST_VALIDO + '  ' })
      .replace(/reg:/g, 'r:')
      .replace('xmlns:reg=', 'xmlns:r=')
    expect(leggiEregi(xml).digest).toBe(DIGEST_VALIDO)
  })

  const rifiutati: Array<[string, Opzioni | string]> = [
    ['senza firma', { senzaFirma: true }],
    ['Reference con URI diverso', { uri: '#altro' }],
    ['Reference con URI vuoto', { uri: '' }],
    ['due Reference', { dueReference: true }],
    ['due firme', { dueFirme: true }],
    ['firma non figlia diretta della radice', { firmaAnnidata: true }],
    ['DigestValue vuoto', { digest: '   ' }],
    ['DigestValue non base64', { digest: 'non base64 !' }],
    ['DigestValue di un solo carattere', { digest: 'A' }],
    ['DigestValue con lunghezza non multipla di 4', { digest: DIGEST_VALIDO.slice(0, 43) }],
    ['DigestValue che non decodifica a 32 byte', { digest: 'AAAA' }],
    ['due SignedInfo, Reference nel primo', { dueSignedInfo: 'riferimentoNelPrimo' }],
    ['due SignedInfo, Reference nel secondo', { dueSignedInfo: 'riferimentoNelSecondo' }],
    ['piu elementi con Id eREGI-CS-0', { idDuplicato: true }],
    ['DigestMethod assente', { digestMethod: null }],
    ['DigestMethod sha1', { digestMethod: 'http://www.w3.org/2000/09/xmldsig#sha1' }],
    ['DigestMethod sha512', { digestMethod: 'http://www.w3.org/2001/04/xmlenc#sha512' }],
    ['testo dopo la radice', { dopoRadice: 'spazzatura' }],
    ['seconda radice', { dopoRadice: '<altro/>' }],
    ['data inesistente 31 febbraio', { dataRichiesta: '2026-02-31T10:00:00Z' }],
    ['ora fuori intervallo', { dataRichiesta: '2026-02-10T25:00:00Z' }],
    ['Id diverso da eREGI-CS-0', { id: 'eREGI-CS-1' }],
    ['identificativo malformato', { identificativo: 'X123' }],
    ['DataRichiesta assente', { dataRichiesta: '' }],
    ['DataRichiesta non e una data', { dataRichiesta: 'ieri' }],
    ['NumIscrSito assente', { numIscrSito: '' }],
    ['non XML', 'questo non e xml'],
    ['stringa vuota', ''],
    ['XML malformato', '<reg:eREGI xmlns:reg="urn:it:rentri:registri:1.0"><reg:Identificativo>'],
    ['radice sbagliata', '<Registro xmlns="urn:it:rentri:registri:1.0"/>'],
    ['namespace della radice sbagliato', xmlEregi().replace(NS_REG, 'urn:altro')],
    [
      '< non escapato in un attributo',
      xmlEregi().replace('Id="eREGI-CS-0"', 'Id="eREGI-CS-0" a="<"'),
    ],
    [
      'attributo duplicato',
      xmlEregi().replace('Id="eREGI-CS-0"', 'Id="eREGI-CS-0" Id="eREGI-CS-0"'),
    ],
    [
      'entita non dichiarata',
      xmlEregi().replace('<reg:IndirizzoSito>Via 1', '<reg:IndirizzoSito>&foo;'),
    ],
  ]
  it.each(rifiutati)('fail-closed: %s', (_nome, input) => {
    const xml = typeof input === 'string' ? input : xmlEregi(input)
    expect(() => leggiEregi(xml)).toThrow(EregiNonValidoError)
  })

  describe('protezione da XXE e DOCTYPE', () => {
    it('rifiuta un DOCTYPE con entita esterna senza leggerla', () => {
      const xml = xmlEregi({
        prologo:
          '<?xml version="1.0"?><!DOCTYPE reg:eREGI [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
      }).replace('<reg:Identificativo>R1234ABCDE0', '<reg:Identificativo>&xxe;R1234ABCDE0')
      const errore = (() => {
        try {
          leggiEregi(xml)
        } catch (e) {
          return e as Error
        }
        return undefined
      })()
      expect(errore).toBeInstanceOf(EregiNonValidoError)
      expect(errore?.message).toContain('DOCTYPE')
      expect(errore?.message).not.toContain('root:')
    })

    it.each([
      ['DOCTYPE semplice', '<!DOCTYPE reg:eREGI>'],
      ['DOCTYPE minuscolo', '<!doctype reg:eREGI>'],
      [
        'entita interna (billion laughs)',
        '<!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>',
      ],
    ])('rifiuta %s', (_n, dtd) => {
      expect(() => leggiEregi(xmlEregi({ prologo: `<?xml version="1.0"?>${dtd}` }))).toThrow(
        EregiNonValidoError
      )
    })

    it('rifiuta DOCTYPE anche dopo un commento o spazi nel prologo', () => {
      expect(() =>
        leggiEregi(xmlEregi({ prologo: '<?xml version="1.0"?>\n<!-- c -->\n  <!DOCTYPE a>' }))
      ).toThrow(EregiNonValidoError)
    })
  })

  describe('tetto di lunghezza', () => {
    it('rifiuta un input oltre il tetto senza parsarlo', () => {
      const xml = xmlEregi({ dopoRadice: '<!-- -->'.padEnd(LUNGHEZZA_MASSIMA_EREGI, ' ') })
      expect(xml.length).toBeGreaterThan(LUNGHEZZA_MASSIMA_EREGI)
      const errore = (() => {
        try {
          leggiEregi(xml)
        } catch (e) {
          return e as Error
        }
        return undefined
      })()
      expect(errore).toBeInstanceOf(EregiNonValidoError)
      expect(errore?.message).toContain('lunghezza')
    })

    it('il tetto e 5 MB e un eREGI normale e molto sotto', () => {
      expect(LUNGHEZZA_MASSIMA_EREGI).toBe(5 * 1024 * 1024)
      expect(xmlEregi().length).toBeLessThan(LUNGHEZZA_MASSIMA_EREGI / 100)
    })

    it('un input appena sotto il tetto e ancora valutato', () => {
      const base = xmlEregi({ dopoRadice: '' })
      const riempimento = ' '.repeat(LUNGHEZZA_MASSIMA_EREGI - base.length)
      expect(leggiEregi(xmlEregi({ dopoRadice: riempimento })).identificativo).toBe('R1234ABCDE0')
    })
  })
})
