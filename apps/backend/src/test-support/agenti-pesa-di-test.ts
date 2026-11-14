/**
 * Supporto ai test dell'agente di pesa (4.8b): coppie di chiavi Ed25519, letture firmate nel formato
 * del contratto (`wasteflow-lettura-pesa-v1`) e preparazione di aziende, agenti e strumenti COL
 * PROPRIETARIO del database (solo per i test Postgres: mai usato dall'applicazione).
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'crypto'
import type { KeyObject } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { hashSegreto, improntaChiave } from '../domain/pese/agenti/credenziali-agente'
import { PREFISSO_FIRMA_LETTURA } from '../domain/pese/agenti/payload-lettura'
import { partitaIvaValida } from './anagrafiche-di-test'

// Le letture di prova usano il driver `D800-MP`, che il backend di produzione NON ammette (solo
// SIMULATA): qui lo si abilita per i test che passano dall'ingresso delle letture.
process.env.PESE_DRIVER_AMMESSI ??= 'D800-MP'

export interface CoppiaChiavi {
  privata: KeyObject
  /** 32 byte grezzi in base64 standard (quello che l'agente invia all'abbinamento) */
  pubblicaB64: string
}

export function coppiaChiavi(): CoppiaChiavi {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return { privata: privateKey, pubblicaB64: der.subarray(der.length - 32).toString('base64') }
}

/** Coppia di chiavi dal seed del file di contratto (stesso seed del test Go). */
export function coppiaChiaviDaSeed(seedHex: string): CoppiaChiavi {
  const prefissoPkcs8 = Buffer.from('302e020100300506032b657004220420', 'hex')
  const privata = createPrivateKey({
    key: Buffer.concat([prefissoPkcs8, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
  const der = createPublicKey(privata).export({ format: 'der', type: 'spki' })
  return { privata, pubblicaB64: der.subarray(der.length - 32).toString('base64') }
}

export interface PayloadDiProva {
  v: number
  agenteId: string
  strumentoId: string
  chiaveIdempotenza: string
  sequenza: number
  pesoKg: string
  unita: string
  stabile: boolean
  alibiId: string | null
  oraStrumento: string | null
  oraAgente: string
  driver: string
  simulata: boolean
  grezzo: string | null
}

export function payloadDiProva(
  base: Pick<PayloadDiProva, 'agenteId' | 'strumentoId'>,
  extra: Partial<PayloadDiProva> = {}
): PayloadDiProva {
  return {
    v: 1,
    chiaveIdempotenza: randomUUID(),
    sequenza: 1,
    pesoKg: '12340.00',
    unita: 'kg',
    stabile: true,
    alibiId: null,
    oraStrumento: null,
    oraAgente: new Date().toISOString(),
    driver: 'D800-MP',
    simulata: false,
    grezzo: null,
    ...base,
    ...extra,
  }
}

/** `{ payload, firma }` in base64 come li invia l'agente: firma su `PREFISSO + byte del payload`. */
export function firmaLetturaDiProva(
  privata: KeyObject,
  payload: object | string
): { payload: string; firma: string } {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
  const firma = sign(
    null,
    Buffer.concat([Buffer.from(PREFISSO_FIRMA_LETTURA, 'utf8'), bytes]),
    privata
  )
  return { payload: bytes.toString('base64'), firma: firma.toString('base64') }
}

let contatore = 0
const seme = 9_000_000 + Math.floor(Math.random() * 900_000)

export interface AziendaPesaDiProva {
  tenantId: string
  utenteId: string
  registroId: string
}

export async function creaAziendaPesaDiProva(
  owner: PrismaClient,
  opzioni: { simulazione?: boolean } = {}
): Promise<AziendaPesaDiProva> {
  contatore++
  const t = await owner.tenant.create({
    data: {
      partitaIva: partitaIvaValida(seme + contatore * 37),
      ragioneSociale: 'Agente Pesa SRL',
      country: 'IT',
      peseSimulazioneAmmessa: opzioni.simulazione ?? false,
    },
  })
  const u = await owner.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `kc-ag-${seme}-${contatore}`,
      fiscalCode: `AG${seme}${contatore}`.slice(0, 16),
      firstName: 'Prova',
      lastName: 'Agente',
      email: `ag-${seme}-${contatore}@example.test`,
      role: 'ADMIN',
    },
  })
  const r = await owner.registroRifiuti.create({
    data: { tenantId: t.id, descrizione: 'Registro A', codice: 'A' },
  })
  return { tenantId: t.id, utenteId: u.id, registroId: r.id }
}

export interface AgenteDiProva {
  id: string
  token: string
  chiavi: CoppiaChiavi
}

/** Agente ATTIVO con token e chiave reali (il token in chiaro serve alle prove HTTP). */
export async function creaAgenteAttivoDiProva(
  owner: PrismaClient,
  a: AziendaPesaDiProva,
  opzioni: { registroId?: string | null; chiavi?: CoppiaChiavi; id?: string } = {}
): Promise<AgenteDiProva> {
  const chiavi = opzioni.chiavi ?? coppiaChiavi()
  const token = `wfpa_${Buffer.from(randomUUID() + randomUUID())
    .toString('base64url')
    .slice(0, 43)}`
  const r = await owner.agentePesa.create({
    data: {
      ...(opzioni.id ? { id: opzioni.id } : {}),
      tenantId: a.tenantId,
      registroId: opzioni.registroId === undefined ? a.registroId : opzioni.registroId,
      descrizione: 'PC della pesa',
      stato: 'ATTIVO',
      tokenSha256: hashSegreto(token),
      chiavePubblica: chiavi.pubblicaB64,
      improntaChiave: improntaChiave(chiavi.pubblicaB64),
      abbinatoIl: new Date(),
      creatoDa: a.utenteId,
    },
  })
  return { id: r.id, token, chiavi }
}

export async function creaAgenteInAttesaDiProva(
  owner: PrismaClient,
  a: AziendaPesaDiProva,
  codiceNormalizzato: string,
  scadeIl: Date = new Date(Date.now() + 15 * 60_000)
): Promise<string> {
  const r = await owner.agentePesa.create({
    data: {
      tenantId: a.tenantId,
      registroId: a.registroId,
      descrizione: 'PC in attesa',
      stato: 'IN_ATTESA',
      codiceSha256: hashSegreto(codiceNormalizzato),
      codiceScadeIl: scadeIl,
      creatoDa: a.utenteId,
    },
  })
  return r.id
}

export async function creaStrumentoDiProva(
  owner: PrismaClient,
  a: AziendaPesaDiProva,
  opzioni: {
    agenteId?: string | null
    portataMaxKg?: number | null
    attivo?: boolean
    registroId?: string | null
    id?: string
  } = {}
): Promise<string> {
  contatore++
  const r = await owner.strumentoPesa.create({
    data: {
      ...(opzioni.id ? { id: opzioni.id } : {}),
      tenantId: a.tenantId,
      registroId: opzioni.registroId === undefined ? a.registroId : opzioni.registroId,
      descrizione: `Pesa ${contatore}`,
      matricola: `M-${seme}-${contatore}`,
      portataMaxKg: opzioni.portataMaxKg === undefined ? 60000 : opzioni.portataMaxKg,
      attivo: opzioni.attivo ?? true,
      agenteId: opzioni.agenteId ?? null,
      creatoDa: a.utenteId,
    },
  })
  return r.id
}

/**
 * Lettura gia' accettata (come la scriverebbe l'ingresso): payload firmato davvero con la chiave
 * dell'agente, inserita COL PROPRIETARIO. Restituisce l'id della riga.
 */
export async function creaLetturaDiProva(
  owner: PrismaClient,
  agente: AgenteDiProva,
  tenantId: string,
  strumentoId: string,
  opzioni: {
    sequenza?: number
    pesoKg?: string
    alibiId?: string | null
    oraAgente?: Date
    oraStrumento?: Date | null
    simulata?: boolean
  } = {}
): Promise<string> {
  contatore++
  const simulata = opzioni.simulata ?? false
  const oraAgente = opzioni.oraAgente ?? new Date(Date.now() - 60_000)
  const p = payloadDiProva(
    { agenteId: agente.id, strumentoId },
    {
      sequenza: opzioni.sequenza ?? contatore,
      pesoKg: opzioni.pesoKg ?? '12340.00',
      alibiId: opzioni.alibiId === undefined ? null : opzioni.alibiId,
      oraAgente: oraAgente.toISOString(),
      oraStrumento: opzioni.oraStrumento ? opzioni.oraStrumento.toISOString() : null,
      driver: simulata ? 'SIMULATA' : 'D800-MP',
      simulata,
    }
  )
  const f = firmaLetturaDiProva(agente.chiavi.privata, p)
  const r = await owner.letturaPesa.create({
    data: {
      tenantId,
      agenteId: agente.id,
      strumentoId,
      chiaveIdempotenza: p.chiaveIdempotenza,
      sequenza: BigInt(p.sequenza),
      pesoKg: p.pesoKg,
      stabile: true,
      alibiId: p.alibiId,
      oraStrumento: opzioni.oraStrumento ?? null,
      oraAgente,
      oraRicezione: new Date(oraAgente.getTime() + 1_000),
      driver: p.driver,
      simulata,
      payload: Buffer.from(f.payload, 'base64').toString('utf8'),
      firma: f.firma,
    },
    select: { id: true },
  })
  return r.id
}
