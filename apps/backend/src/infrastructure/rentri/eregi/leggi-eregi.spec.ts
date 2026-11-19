import { EregiNonValidoError, leggiEregi } from './leggi-eregi'

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
}

function xmlEregi(o: Opzioni = {}): string {
  const uri = o.uri ?? '#eREGI-CS-0'
  const digest = o.digest ?? 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c='
  const reference = (u: string) =>
    `<ds:Reference URI="${u}"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>`
  const firma = (n: number) =>
    `<ds:Signature><ds:SignedInfo>${reference(uri)}${o.dueReference ? reference('#altro') : ''}</ds:SignedInfo><ds:SignatureValue>AAAA${n}</ds:SignatureValue></ds:Signature>`
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
  return `${o.prologo ?? '<?xml version="1.0" encoding="UTF-8"?>'}<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="${o.id ?? 'eREGI-CS-0'}">${corpo}${firme}</reg:eREGI>`
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
    const xml = xmlEregi({ digest: '  abc=  ' })
      .replace(/reg:/g, 'r:')
      .replace('xmlns:reg=', 'xmlns:r=')
    expect(leggiEregi(xml).digest).toBe('abc=')
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
})
