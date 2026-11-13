import { generateKeyPairSync, sign, KeyObject } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { chiavePubblicaDaBase64 } from './credenziali-agente'
import { PREFISSO_FIRMA_LETTURA, leggiPayloadLettura } from './payload-lettura'

interface Contratto {
  seedHex: string
  chiavePubblicaB64: string
  prefissoDominio: string
  payloadB64: string
  firmaB64: string
}

function caricaContratto(): Contratto {
  // jest gira con cwd = apps/backend: la radice del repo sta due livelli sopra.
  const percorso = join(
    process.cwd(),
    '..',
    '..',
    'tools',
    'agente-pesa',
    'testdata',
    'contratto',
    'lettura-v1.json'
  )
  return JSON.parse(readFileSync(percorso, 'utf8')) as Contratto
}

const BASE = {
  v: 1,
  agenteId: '6f1c2f7e-3d5a-4b8e-9a41-0c2d7e5b9a10',
  strumentoId: 'a3b8d1b6-0b3b-4b3a-8a1a-5c1d2e3f4a5b',
  chiaveIdempotenza: '0b9c6f0e-8d2a-4c57-9e1b-7a3f5d2c4e68',
  sequenza: 41,
  pesoKg: '12340.00',
  unita: 'kg',
  stabile: true,
  alibiId: 'SIM-000041',
  oraStrumento: '2026-11-13T10:15:02+01:00',
  oraAgente: '2026-11-13T09:15:03.123Z',
  driver: 'SIMULATA',
  simulata: true,
  grezzo: null as string | null,
}

function firma(chiavePrivata: KeyObject, obj: unknown): { payloadB64: string; firmaB64: string } {
  const bytes = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')
  const f = sign(
    null,
    Buffer.concat([Buffer.from(PREFISSO_FIRMA_LETTURA, 'utf8'), bytes]),
    chiavePrivata
  )
  return { payloadB64: bytes.toString('base64'), firmaB64: f.toString('base64') }
}

describe('contratto Go ↔ Node (lettura-v1.json)', () => {
  it('la firma del file di contratto è valida e il payload viene letto', () => {
    const c = caricaContratto()
    expect(c.prefissoDominio).toBe(PREFISSO_FIRMA_LETTURA)
    const chiave = chiavePubblicaDaBase64(c.chiavePubblicaB64)
    expect(chiave).not.toBeNull()
    const r = leggiPayloadLettura(c.payloadB64, c.firmaB64, chiave as KeyObject)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.pesoKg).toBe('12340.00')
    expect(r.payload.sequenza).toBe(41)
    expect(r.payload.driver).toBe('SIMULATA')
    expect(r.payload.simulata).toBe(true)
    expect(r.payload.alibiId).toBe('SIM-000041')
    expect(r.payload.oraStrumento?.toISOString()).toBe('2026-11-13T09:15:02.000Z')
    expect(r.payload.oraAgente.toISOString()).toBe('2026-11-13T09:15:03.123Z')
    expect(r.bytes.toString('base64')).toBe(c.payloadB64)
  })

  it('un solo byte cambiato nel payload invalida la firma', () => {
    const c = caricaContratto()
    const chiave = chiavePubblicaDaBase64(c.chiavePubblicaB64) as KeyObject
    const bytes = Buffer.from(c.payloadB64, 'base64')
    bytes[10] ^= 1
    const r = leggiPayloadLettura(bytes.toString('base64'), c.firmaB64, chiave)
    expect(r).toMatchObject({ ok: false, codice: 'FIRMA_NON_VALIDA' })
  })
})

describe('leggiPayloadLettura', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const altra = generateKeyPairSync('ed25519')

  const esito = (obj: unknown) => {
    const { payloadB64, firmaB64 } = firma(privateKey, obj)
    return leggiPayloadLettura(payloadB64, firmaB64, publicKey)
  }

  it('accetta un payload valido con grezzo e oraStrumento null', () => {
    const r = esito({
      ...BASE,
      oraStrumento: null,
      grezzo: Buffer.from('ST,GS').toString('base64'),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.oraStrumento).toBeNull()
      expect(r.payload.pesoCentesimi).toBe(1234000)
    }
  })

  it('accetta alibiId null e un driver reale con simulata false', () => {
    const r = esito({ ...BASE, alibiId: null, driver: 'D800-MP', simulata: false })
    expect(r.ok).toBe(true)
  })

  it('firma di un’altra chiave → FIRMA_NON_VALIDA', () => {
    const { payloadB64, firmaB64 } = firma(altra.privateKey, BASE)
    expect(leggiPayloadLettura(payloadB64, firmaB64, publicKey)).toMatchObject({
      ok: false,
      codice: 'FIRMA_NON_VALIDA',
    })
  })

  it('firma non base64 o di lunghezza sbagliata → FIRMA_NON_VALIDA', () => {
    const { payloadB64 } = firma(privateKey, BASE)
    expect(leggiPayloadLettura(payloadB64, '!!!', publicKey)).toMatchObject({
      codice: 'FIRMA_NON_VALIDA',
    })
    expect(
      leggiPayloadLettura(payloadB64, Buffer.alloc(10).toString('base64'), publicKey)
    ).toMatchObject({ codice: 'FIRMA_NON_VALIDA' })
  })

  it('la firma si verifica PRIMA di leggere il JSON: JSON rotto ma firmato → PAYLOAD_NON_VALIDO, non firmato → FIRMA_NON_VALIDA', () => {
    const firmato = firma(privateKey, '{non json')
    expect(leggiPayloadLettura(firmato.payloadB64, firmato.firmaB64, publicKey)).toMatchObject({
      codice: 'PAYLOAD_NON_VALIDO',
    })
    const noFirma = firma(altra.privateKey, '{non json')
    expect(leggiPayloadLettura(noFirma.payloadB64, noFirma.firmaB64, publicKey)).toMatchObject({
      codice: 'FIRMA_NON_VALIDA',
    })
  })

  it('payload firmato con un BOM UTF-8 iniziale → PAYLOAD_NON_VALIDO (i byte conservati devono coincidere con quelli letti)', () => {
    const firmato = firma(privateKey, '\ufeff' + JSON.stringify(BASE))
    expect(leggiPayloadLettura(firmato.payloadB64, firmato.firmaB64, publicKey)).toMatchObject({
      ok: false,
      codice: 'PAYLOAD_NON_VALIDO',
    })
  })

  it('payload oltre 2048 byte → PAYLOAD_NON_VALIDO prima di verificare', () => {
    const grande = Buffer.alloc(2049, 0x61).toString('base64')
    const { firmaB64 } = firma(privateKey, BASE)
    expect(leggiPayloadLettura(grande, firmaB64, publicKey)).toMatchObject({
      ok: false,
      codice: 'PAYLOAD_NON_VALIDO',
    })
  })

  it('base64 del payload non valido → PAYLOAD_NON_VALIDO', () => {
    const { firmaB64 } = firma(privateKey, BASE)
    expect(leggiPayloadLettura('@@@', firmaB64, publicKey)).toMatchObject({
      codice: 'PAYLOAD_NON_VALIDO',
    })
  })

  const casiNonValidi: Array<[string, Record<string, unknown>]> = [
    ['chiave in più', { ...BASE, extra: 1 }],
    ['chiave mancante', (({ unita: _u, ...resto }) => resto)(BASE)],
    ['v: 2', { ...BASE, v: 2 }],
    ['pesoKg con un decimale', { ...BASE, pesoKg: '12340.5' }],
    ['pesoKg numero', { ...BASE, pesoKg: 12340 }],
    ['pesoKg con virgola', { ...BASE, pesoKg: '12340,00' }],
    ['pesoKg con 9 cifre intere', { ...BASE, pesoKg: '123456789.00' }],
    ['unita t', { ...BASE, unita: 't' }],
    ['oraAgente senza offset', { ...BASE, oraAgente: '2026-11-13T09:15:03.123' }],
    ['oraStrumento senza offset', { ...BASE, oraStrumento: '2026-11-13T10:15:02' }],
    ['oraAgente con giorno inesistente', { ...BASE, oraAgente: '2026-02-31T09:15:03Z' }],
    ['simulata incoerente col driver (true)', { ...BASE, driver: 'D800-MP', simulata: true }],
    ['simulata incoerente col driver (false)', { ...BASE, simulata: false }],
    ['driver minuscolo', { ...BASE, driver: 'simulata', simulata: false }],
    ['agenteId non uuid', { ...BASE, agenteId: 'abc' }],
    [
      'chiaveIdempotenza non v4',
      { ...BASE, chiaveIdempotenza: '0b9c6f0e-8d2a-1c57-9e1b-7a3f5d2c4e68' },
    ],
    ['sequenza 0', { ...BASE, sequenza: 0 }],
    ['sequenza frazionaria', { ...BASE, sequenza: 1.5 }],
    ['sequenza stringa', { ...BASE, sequenza: '41' }],
    ['stabile non booleano', { ...BASE, stabile: 'true' }],
    ['alibiId vuoto', { ...BASE, alibiId: '   ' }],
    ['alibiId di 41 caratteri', { ...BASE, alibiId: 'A'.repeat(41) }],
    ['alibiId con carattere di controllo', { ...BASE, alibiId: 'A\u0001B' }],
    ['grezzo non base64', { ...BASE, grezzo: '***' }],
    ['grezzo oltre 256 byte', { ...BASE, grezzo: Buffer.alloc(257).toString('base64') }],
  ]

  it.each(casiNonValidi)('%s → PAYLOAD_NON_VALIDO', (_nome, obj) => {
    expect(esito(obj)).toMatchObject({ ok: false, codice: 'PAYLOAD_NON_VALIDO' })
  })

  it('un payload che non è un oggetto (array, null) → PAYLOAD_NON_VALIDO', () => {
    expect(esito('[1,2]')).toMatchObject({ codice: 'PAYLOAD_NON_VALIDO' })
    expect(esito('null')).toMatchObject({ codice: 'PAYLOAD_NON_VALIDO' })
  })
})
