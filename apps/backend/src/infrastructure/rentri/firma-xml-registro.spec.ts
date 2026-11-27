import { spawnSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Logger } from '@nestjs/common'
import { DOMParser } from '@xmldom/xmldom'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import {
  serializzaRegistro,
  type VoceRegistro,
} from '../../application/rentri/registro/serializza-registro-xml'
import {
  traduciAnnotazione,
  type AnnotazionePerRentri,
} from '../../application/rentri/registro/mappa-registrazione-rentri'
import {
  FirmaXmlRegistroError,
  firmaXmlRegistro,
  verificaFirmaXmlRegistro,
  type MaterialeFirmaRegistro,
} from './firma-xml-registro'
import { validaXmlRegistro } from './valida-xml-registro'

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const ALG_C14N_INCLUSIVA = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ALG_EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const ALG_ENVELOPED = `${NS_DS}enveloped-signature`
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const ALG_RSA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'

const DIR_FIXTURE_EC = path.resolve(__dirname, '../../../../../tools/rentri-fake/test/fixture/ec')

function materialeEc(): MaterialeFirmaRegistro {
  return {
    certificatePem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.crt'), 'utf8'),
    privateKeyPem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.key'), 'utf8'),
  }
}

function materialeRsa(): MaterialeFirmaRegistro {
  const coppia = forge.pki.rsa.generateKeyPair(2048)
  const certificato = forge.pki.createCertificate()
  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'
  certificato.validity.notBefore = new Date(Date.now() - 60_000)
  certificato.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attributi = [{ name: 'commonName', value: 'firmatario-test-registro' }]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.sign(coppia.privateKey, forge.md.sha256.create())
  return {
    certificatePem: forge.pki.certificateToPem(certificato),
    privateKeyPem: forge.pki.privateKeyToPem(coppia.privateKey),
  }
}

/**
 * eREGI di prova con una firma VERA dell'"ente" (chiave dedicata), con la canonicalizzazione
 * richiesta: serve a verificare che la firma dell'eREGI sopravviva all'inserimento nel registro.
 */
function eregiFirmato(c14n: string, prefisso = 'reg'): string {
  const ente = materialeRsa()
  const corpoReg =
    `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="eREGI-CS-0">` +
    '<reg:Identificativo>R1234ABCDE0</reg:Identificativo>' +
    '<reg:Operatore><reg:NumIscr>OP1234567890123</reg:NumIscr><reg:CodiceFiscale>01234567890</reg:CodiceFiscale><reg:Denominazione>Rossi &amp; Figli</reg:Denominazione></reg:Operatore>' +
    '<reg:NumIscrSito>OP1234567890123-MI0001</reg:NumIscrSito><reg:IndirizzoSito>Via Roma 1</reg:IndirizzoSito>' +
    '<reg:DataRichiesta>2026-01-02T08:00:00Z</reg:DataRichiesta><reg:IdentificativoRichiesta>x</reg:IdentificativoRichiesta>' +
    '<reg:AutoreRichiesta>y</reg:AutoreRichiesta><reg:CCIAANome>z</reg:CCIAANome></reg:eREGI>'
  const corpo =
    prefisso === 'reg'
      ? corpoReg
      : corpoReg
          .replace(/(<\/?)reg:/g, `$1${prefisso}:`)
          .replace('xmlns:reg=', `xmlns:${prefisso}=`)
  const firmatore = new SignedXml({
    privateKey: ente.privateKeyPem,
    signatureAlgorithm: ALG_RSA,
    canonicalizationAlgorithm: c14n,
  })
  firmatore.addReference({
    xpath: "//*[@Id='eREGI-CS-0']",
    transforms: [ALG_ENVELOPED, c14n],
    digestAlgorithm: ALG_SHA256,
  })
  firmatore.computeSignature(corpo, {
    prefix: 'ds',
    location: { reference: "//*[@Id='eREGI-CS-0']", action: 'append' },
  })
  const xml = firmatore.getSignedXml()
  const cert = new crypto.X509Certificate(ente.certificatePem).publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string
  // Il certificato dell'ente serve al verificatore: lo si lascia accanto, non nel KeyInfo.
  chiaviEnte.set(xml, cert)
  return xml
}
const chiaviEnte = new Map<string, string>()

/** Verifica la firma dell'eREGI (la prima `ds:Signature` del documento) nel contesto del registro. */
function eregiVerificabile(registroXml: string, eregiXml: string): boolean {
  const documento = new DOMParser().parseFromString(registroXml, 'text/xml')
  const eregi = documento.getElementsByTagNameNS(NS_REG, 'eREGI')[0]
  const firma = eregi.getElementsByTagNameNS(NS_DS, 'Signature')[0]
  const verificatore = new SignedXml({
    publicCert: chiaviEnte.get(eregiXml),
  })
  verificatore.loadSignature(firma as unknown as Node)
  try {
    return verificatore.checkSignature(registroXml)
  } catch {
    return false
  }
}

const TS = '2026-03-01T10:00:00.000Z'
function voce(): VoceRegistro {
  const a: AnnotazionePerRentri = {
    movimentoId: 'mov-1',
    tipoAnnotazione: 'ORDINARIA',
    numero: { anno: 2026, progressivo: 1 },
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
  }
  const r = traduciAnnotazione(a)
  if (!r.ok) throw new Error(r.motivi.join(' | '))
  return { corpo: r.corpo, autore: 'Mario Rossi', identificativoTemporale: TS }
}

function registroNonFirmato(eregXml: string): string {
  return serializzaRegistro({
    eregXml,
    riferimenti: [
      { digestValue: 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c=', dataCreazione: TS },
    ],
    registrazioni: [
      {
        anno: 2026,
        progressivoDa: 1,
        progressivoA: 1,
        dataCreazione: '2026-04-01T00:00:00.000Z',
        voci: [voce()],
      },
    ],
  })
}

function sostituisci(xml: string, da: string, a: string): string {
  expect(xml).toContain(da)
  return xml.replace(da, a)
}

describe('firmaXmlRegistro (XMLDSig enveloped, eREGI E5)', () => {
  const eregi = eregiFirmato(ALG_EXC_C14N)
  const nonFirmato = registroNonFirmato(eregi)
  let rsa: MaterialeFirmaRegistro
  let ec: MaterialeFirmaRegistro

  beforeAll(() => {
    rsa = materialeRsa()
    ec = materialeEc()
  })

  describe.each([
    ['EC P-256 (ecdsa-sha256)', () => ec, 'ecdsa-sha256'],
    ['RSA (rsa-sha256)', () => rsa, 'rsa-sha256'],
  ])('chiave %s', (_nome, materiale, algoritmoAtteso) => {
    it("l'algoritmo deriva dalla chiave e la firma e' verificabile", () => {
      const { xml, digestValue } = firmaXmlRegistro(nonFirmato, materiale())
      expect(xml).toContain(`xmldsig-more#${algoritmoAtteso}`)
      expect(xml).toContain(`<ds:DigestValue>${digestValue}</ds:DigestValue>`)
      const esito = verificaFirmaXmlRegistro(xml)
      expect(esito).toMatchObject({ valida: true, digestValue })
    })

    it('una virgola cambiata fa fallire la verifica', () => {
      const { xml } = firmaXmlRegistro(nonFirmato, materiale())
      const alterato = sostituisci(xml, '<mov:Quantita>', '<mov:Quantita>1')
      expect(verificaFirmaXmlRegistro(alterato)).toMatchObject({ valida: false })
      const altraData = sostituisci(xml, 'ProgressivoDa="1"', 'ProgressivoDa="2"')
      expect(verificaFirmaXmlRegistro(altraData)).toMatchObject({ valida: false })
    })

    it('un SignatureValue alterato fa fallire la verifica', () => {
      const { xml } = firmaXmlRegistro(nonFirmato, materiale())
      const alterato = xml.replace(
        /(<ds:SignatureValue>)(.)/,
        (_m, a, c) => `${a}${c === 'A' ? 'B' : 'A'}`
      )
      expect(verificaFirmaXmlRegistro(alterato)).toMatchObject({ valida: false })
    })

    it('un verificatore indipendente (xmlsec1) accetta la firma e rifiuta quella alterata', () => {
      if (spawnSync('xmlsec1', ['--version']).status !== 0) {
        // In CI (`.gitea/workflows/ci.yml`) xmlsec1 e' installato e obbligatorio: niente salto silenzioso.
        if (process.env.XMLSEC1_OBBLIGATORIO === '1') {
          throw new Error('xmlsec1 non installato ma XMLSEC1_OBBLIGATORIO=1')
        }
        // eslint-disable-next-line no-console
        console.warn('xmlsec1 non installato: prova con verificatore indipendente saltata')
        return
      }
      const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-registro-'))
      try {
        const { xml } = firmaXmlRegistro(nonFirmato, materiale())
        const chiamaXmlsec = (contenuto: string): number => {
          const file = path.join(cartella, 'registro.xml')
          fs.writeFileSync(file, contenuto)
          return (
            spawnSync('xmlsec1', [
              '--verify',
              '--insecure',
              '--id-attr:Id',
              `${NS_DS}:Signature`,
              '--node-id',
              'FirmaRegistro',
              file,
            ]).status ?? -1
          )
        }
        expect(chiamaXmlsec(xml)).toBe(0)
        expect(chiamaXmlsec(sostituisci(xml, '<mov:Quantita>', '<mov:Quantita>1'))).not.toBe(0)
      } finally {
        fs.rmSync(cartella, { recursive: true, force: true })
      }
    })

    it('il registro firmato passa ancora l’XSD', async () => {
      const { xml } = firmaXmlRegistro(nonFirmato, materiale())
      expect(await validaXmlRegistro(xml)).toMatchObject({ valido: true })
    })
  })

  it("l'eREGI inserito resta identico byte per byte e la sua firma resta valida dopo la firma del registro", () => {
    expect(eregiVerificabile(nonFirmato, eregi)).toBe(true)
    const { xml } = firmaXmlRegistro(nonFirmato, ec)
    expect(xml).toContain(eregi)
    // Tutto cio' che precede la firma di radice coincide col documento non firmato.
    expect(xml.startsWith(nonFirmato.slice(0, nonFirmato.length - '</reg:Registro>'.length))).toBe(
      true
    )
    expect(eregiVerificabile(xml, eregi)).toBe(true)
  })

  it('M5: un eREGI firmato con C14N inclusiva (prefisso reg) resta valido dentro il registro, anche dopo la firma', () => {
    // La radice dichiara solo `reg`: `mov` e `xsi` stanno su `reg:Registrazioni`, cosi' la C14N
    // inclusiva dell'eREGI in contesto eredita gli stessi namespace che ha da solo.
    const inclusiva = eregiFirmato(ALG_C14N_INCLUSIVA)
    const registro = registroNonFirmato(inclusiva)
    expect(eregiVerificabile(inclusiva, inclusiva)).toBe(true)
    expect(eregiVerificabile(registro, inclusiva)).toBe(true)
    expect(eregiVerificabile(firmaXmlRegistro(registro, ec).xml, inclusiva)).toBe(true)
  })

  it('M5 residuo: con C14N inclusiva e un prefisso diverso da reg la firma dell eREGI in contesto si rompe', () => {
    // Caratterizzazione, non un requisito: `xmlns:reg` della radice entra nella forma canonica.
    // Da chiudere con la prova sul demo (Q6): serve sapere prefisso e C14N dell'eREGI reale.
    const inclusiva = eregiFirmato(ALG_C14N_INCLUSIVA, 'r')
    expect(eregiVerificabile(inclusiva, inclusiva)).toBe(true)
    expect(eregiVerificabile(registroNonFirmato(inclusiva), inclusiva)).toBe(false)
  })

  it('rifiuta un registro gia firmato, una radice sbagliata, un DOCTYPE e un XML rotto', () => {
    const { xml } = firmaXmlRegistro(nonFirmato, ec)
    expect(() => firmaXmlRegistro(xml, ec)).toThrow(FirmaXmlRegistroError)
    expect(() => firmaXmlRegistro('<a xmlns="x"></a>', ec)).toThrow(/reg:Registro/)
    expect(() => firmaXmlRegistro('<!DOCTYPE x [<!ENTITY e "y">]><reg:Registro/>', ec)).toThrow(
      /DOCTYPE/
    )
    expect(() => firmaXmlRegistro('<reg:Registro', ec)).toThrow(FirmaXmlRegistroError)
  })

  it('rifiuta una chiave non supportata o non corrispondente al certificato', () => {
    const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
    expect(() =>
      firmaXmlRegistro(nonFirmato, {
        certificatePem: ec.certificatePem,
        privateKeyPem: p384.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      })
    ).toThrow(/non supportato/)
    expect(() =>
      firmaXmlRegistro(nonFirmato, {
        certificatePem: ec.certificatePem,
        privateKeyPem: rsa.privateKeyPem,
      })
    ).toThrow(/non corrisponde/)
  })

  it('la verifica non lancia mai: assenza di firma e firma doppia sono esiti', () => {
    expect(verificaFirmaXmlRegistro(nonFirmato)).toEqual({ valida: false, motivo: 'firma assente' })
    expect(verificaFirmaXmlRegistro('non xml')).toMatchObject({ valida: false })
  })

  it('una firma con Reference diverso da URI="" non e accettata (la firma non copre il documento)', () => {
    const { xml } = firmaXmlRegistro(nonFirmato, ec)
    const finta = xml.replace('<ds:Reference URI="">', '<ds:Reference URI="#eREGI-CS-0">')
    expect(verificaFirmaXmlRegistro(finta)).toMatchObject({ valida: false })
  })

  describe('nessuna chiave o PEM nei log e negli errori', () => {
    it('ne la firma ne i rifiuti scrivono sul logger, sulla console o su stdout/stderr', () => {
      const scritture: string[] = []
      const registra = (...args: unknown[]) => {
        scritture.push(args.map(String).join(' '))
      }
      const spie = [
        jest.spyOn(Logger.prototype, 'log').mockImplementation(registra),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(registra),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(registra),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(registra),
        jest.spyOn(Logger.prototype, 'verbose').mockImplementation(registra),
        jest.spyOn(console, 'log').mockImplementation(registra),
        jest.spyOn(console, 'warn').mockImplementation(registra),
        jest.spyOn(console, 'error').mockImplementation(registra),
        jest.spyOn(console, 'debug').mockImplementation(registra),
        jest.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
          registra(c)
          return true
        }),
        jest.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
          registra(c)
          return true
        }),
      ]
      const messaggiErrore: string[] = []
      try {
        firmaXmlRegistro(nonFirmato, ec)
        for (const tentativo of [
          () =>
            firmaXmlRegistro(nonFirmato, {
              certificatePem: ec.certificatePem,
              privateKeyPem: rsa.privateKeyPem,
            }),
          () =>
            firmaXmlRegistro(nonFirmato, { certificatePem: 'x', privateKeyPem: ec.privateKeyPem }),
          () =>
            firmaXmlRegistro(nonFirmato, { certificatePem: ec.certificatePem, privateKeyPem: 'x' }),
          () => firmaXmlRegistro('<reg:Registro', ec),
        ]) {
          try {
            tentativo()
          } catch (e) {
            messaggiErrore.push((e as Error).message)
          }
        }
      } finally {
        spie.forEach(s => s.mockRestore())
      }
      const corpoChiave = ec.privateKeyPem.replace(/-----[^-]+-----|\s+/g, '')
      const tutto = [...scritture, ...messaggiErrore].join('\n')
      expect(messaggiErrore.length).toBe(4)
      expect(tutto).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE/)
      expect(tutto).not.toContain(corpoChiave.slice(0, 40))
    })
  })
})
