import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { validaXmlRegistro } from '../../../infrastructure/rentri/valida-xml-registro'
import { verificaFirmaXmlRegistro } from '../../../infrastructure/rentri/firma-xml-registro'
import {
  EsportazioneRegistroNonValidaError,
  costruisciEsportazioneRegistro,
  type EsportazioneCostruita,
} from './costruisci-esportazione-registro'
import {
  verificaCatenaEsportazioni,
  type EsportazioneDaVerificare,
} from './verifica-catena-esportazioni'
import { traduciAnnotazione, type AnnotazionePerRentri } from './mappa-registrazione-rentri'
import type { VoceRegistro } from './serializza-registro-xml'

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const DIGEST_EREGI = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c='
const DATA_RICHIESTA = '2026-01-02T08:00:00Z'
const EREGI =
  `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="eREGI-CS-0">` +
  '<reg:Identificativo>R1234ABCDE0</reg:Identificativo>' +
  '<reg:Operatore><reg:NumIscr>OP1234567890123</reg:NumIscr><reg:CodiceFiscale>01234567890</reg:CodiceFiscale><reg:Denominazione>Rossi &amp; Figli</reg:Denominazione></reg:Operatore>' +
  '<reg:NumIscrSito>OP1234567890123-MI0001</reg:NumIscrSito><reg:IndirizzoSito>Via Roma 1</reg:IndirizzoSito>' +
  `<reg:DataRichiesta>${DATA_RICHIESTA}</reg:DataRichiesta><reg:IdentificativoRichiesta>x</reg:IdentificativoRichiesta>` +
  '<reg:AutoreRichiesta>y</reg:AutoreRichiesta><reg:CCIAANome>z</reg:CCIAANome>' +
  '<ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
  '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
  '<ds:Reference URI="#eREGI-CS-0"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
  `<ds:DigestValue>${DIGEST_EREGI}</ds:DigestValue></ds:Reference></ds:SignedInfo>` +
  '<ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature></reg:eREGI>'

const DIR_FIXTURE_EC = path.resolve(
  __dirname,
  '../../../../../../tools/rentri-fake/test/fixture/ec'
)
const materiale = {
  certificatePem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.crt'), 'utf8'),
  privateKeyPem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.key'), 'utf8'),
}

function voci(anno: number, da: number, a: number): VoceRegistro[] {
  const risultato: VoceRegistro[] = []
  for (let p = da; p <= a; p++) {
    const annotazione: AnnotazionePerRentri = {
      movimentoId: `m-${anno}-${p}`,
      tipoAnnotazione: 'ORDINARIA',
      numero: { anno, progressivo: p },
      dataRegistrazione: '2026-03-01T10:00:00.000Z',
      verso: 'CARICO',
      codiceRentri: 'DT',
      cerCode: '15 01 01',
      descrizione: null,
      quantita: 100 + p,
      unit: 'KG',
      statoFisico: 'Solido',
      classiPericolo: null,
      operazione: null,
      predecessore: null,
      motivo: null,
      fir: null,
      riferimentiCarico: [],
    }
    const t = traduciAnnotazione(annotazione)
    if (!t.ok) throw new Error(t.motivi.join(','))
    risultato.push({
      corpo: t.corpo,
      autore: 'Mario Rossi',
      identificativoTemporale: '2026-03-01T10:00:00.000Z',
    })
  }
  return risultato
}

/** Catena di 3 esportazioni (2026: 1-3, 4-4, poi 2027: 1-2), costruita come farebbe il use case. */
async function catena(): Promise<{
  costruite: EsportazioneCostruita[]
  righe: Array<EsportazioneDaVerificare & { digestValue: string }>
}> {
  const piano = [
    { anno: 2026, da: 1, a: 3, data: '2026-04-01T00:00:00.000Z' },
    { anno: 2026, da: 4, a: 4, data: '2026-04-02T00:00:00.000Z' },
    { anno: 2027, da: 1, a: 2, data: '2027-01-15T00:00:00.000Z' },
  ]
  const costruite: EsportazioneCostruita[] = []
  const righe: Array<EsportazioneDaVerificare & { digestValue: string }> = []
  for (const p of piano) {
    const c = await costruisciEsportazioneRegistro({
      eregXml: EREGI,
      precedenti: righe.map(r => ({ digestValue: r.digestValue, dataCreazione: r.dataCreazione })),
      anno: p.anno,
      progressivoDa: p.da,
      voci: voci(p.anno, p.da, p.a),
      dataCreazione: new Date(p.data),
      materiale,
    })
    costruite.push(c)
    righe.push({
      anno: p.anno,
      progressivoDa: p.da,
      progressivoA: c.progressivoA,
      numeroRegistrazioni: c.numeroRegistrazioni,
      dataCreazione: new Date(p.data),
      digestValue: c.digestValue,
      sha256File: c.sha256File,
      xml: c.xml,
    })
  }
  return { costruite, righe }
}

describe('costruisciEsportazioneRegistro', () => {
  it('prima esportazione: solo il Ref dell eREGI (digest e DataRichiesta), XSD valido, firma valida', async () => {
    const c = await costruisciEsportazioneRegistro({
      eregXml: EREGI,
      precedenti: [],
      anno: 2026,
      progressivoDa: 1,
      voci: voci(2026, 1, 3),
      dataCreazione: new Date('2026-04-01T00:00:00.000Z'),
      materiale,
    })
    expect(c.progressivoA).toBe(3)
    expect(c.numeroRegistrazioni).toBe(3)
    expect(c.xml).toContain(
      `<reg:Ref DigestValue="${DIGEST_EREGI}" DataCreazione="${DATA_RICHIESTA}"/>`
    )
    expect(c.xml.match(/<reg:Ref /g)).toHaveLength(1)
    expect((await validaXmlRegistro(c.xml)).valido).toBe(true)
    const firma = verificaFirmaXmlRegistro(c.xml)
    expect(firma.valida && firma.digestValue).toBe(c.digestValue)
    expect(c.sha256File).toBe(createHash('sha256').update(c.xml, 'utf8').digest('hex'))
    expect(c.certificatoSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('seconda esportazione: Ref dell eREGI e della prima, in ordine', async () => {
    const { costruite, righe } = await catena()
    const refs = [
      ...costruite[1].xml.matchAll(/<reg:Ref DigestValue="([^"]+)" DataCreazione="([^"]+)"\/>/g),
    ]
    expect(refs.map(r => [r[1], r[2]])).toEqual([
      [DIGEST_EREGI, DATA_RICHIESTA],
      [righe[0].digestValue, '2026-04-01T00:00:00.000Z'],
    ])
    const terza = [...costruite[2].xml.matchAll(/<reg:Ref DigestValue="([^"]+)"/g)].map(r => r[1])
    expect(terza).toEqual([DIGEST_EREGI, righe[0].digestValue, righe[1].digestValue])
  })

  it('l intervallo e il numero di voci devono coincidere', async () => {
    await expect(
      costruisciEsportazioneRegistro({
        eregXml: EREGI,
        precedenti: [],
        anno: 2026,
        progressivoDa: 1,
        voci: [],
        dataCreazione: new Date(),
        materiale,
      })
    ).rejects.toBeInstanceOf(EsportazioneRegistroNonValidaError)
  })

  it('una voce con il numero sbagliato blocca la costruzione (nessun file)', async () => {
    await expect(
      costruisciEsportazioneRegistro({
        eregXml: EREGI,
        precedenti: [],
        anno: 2026,
        progressivoDa: 5,
        voci: voci(2026, 1, 2),
        dataCreazione: new Date(),
        materiale,
      })
    ).rejects.toBeInstanceOf(EsportazioneRegistroNonValidaError)
  })

  it('un eREGI illeggibile blocca la costruzione', async () => {
    await expect(
      costruisciEsportazioneRegistro({
        eregXml: '<reg:eREGI xmlns:reg="urn:it:rentri:registri:1.0"/>',
        precedenti: [],
        anno: 2026,
        progressivoDa: 1,
        voci: voci(2026, 1, 1),
        dataCreazione: new Date(),
        materiale,
      })
    ).rejects.toBeInstanceOf(EsportazioneRegistroNonValidaError)
  })
})

describe('verificaCatenaEsportazioni', () => {
  it('la catena di 3 esportazioni (con cambio d anno) si ricostruisce dai soli dati salvati', async () => {
    const { righe } = await catena()
    const esito = await verificaCatenaEsportazioni(EREGI, righe)
    expect(esito).toEqual({ valida: true, errori: [] })
  })

  it('un file alterato, un anello saltato o l ordine invertito rompono la catena', async () => {
    const { righe } = await catena()
    const alterata = righe.map((r, i) =>
      i === 1 ? { ...r, xml: r.xml.replace('Mario Rossi', 'Mario Verdi') } : r
    )
    const a = await verificaCatenaEsportazioni(EREGI, alterata)
    expect(a.valida).toBe(false)
    expect(a.errori.join(' ')).toMatch(/esportazione 2/)

    const saltata = await verificaCatenaEsportazioni(EREGI, [righe[0], righe[2]])
    expect(saltata.valida).toBe(false)

    const invertita = await verificaCatenaEsportazioni(EREGI, [righe[1], righe[0], righe[2]])
    expect(invertita.valida).toBe(false)
  })

  it('un digest salvato diverso da quello della firma, o un eREGI diverso, sono rilevati', async () => {
    const { righe } = await catena()
    const digestDiverso = righe.map((r, i) =>
      i === 0 ? { ...r, digestValue: Buffer.alloc(32, 1).toString('base64') } : r
    )
    expect((await verificaCatenaEsportazioni(EREGI, digestDiverso)).valida).toBe(false)
    const altroEregi = EREGI.replace(DIGEST_EREGI, Buffer.alloc(32, 5).toString('base64'))
    expect((await verificaCatenaEsportazioni(altroEregi, righe)).valida).toBe(false)
  })
})
