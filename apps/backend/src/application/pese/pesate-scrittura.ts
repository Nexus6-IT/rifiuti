// Scrittura delle pesate di un accesso: regole D7, impronta D5, idempotenza e alibi D9.
// Lavora dentro la transazione del chiamante, che DEVE aver gia' preso i lock di
// `blocchi-accesso.ts` (advisory sull'accesso, e FOR UPDATE se chiude): qui si scrive soltanto.
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { improntaPesata } from '../../domain/pese/impronta-pesata'
import { validaPesataManuale } from '../../domain/pese/regole-pesata'
import type { FontePesataDominio, ModoPesaturaDominio } from '../../domain/pese/tipi'
import type { AllegatoSalvato, AllegatiPesaService } from './allegati-pesa.service'
import type { FileCaricato, PesataManualeDati } from './accessi-pesa.tipi'
import { AlibiGiaUsatoError, RegolaPesataError } from './errori-pese'
import type { StrumentoVista } from './strumenti-pesa.service'

/** Il fuso orario deve essere scritto: "02:30" da solo e' ambiguo nella notte del cambio ora. */
const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export function leggiOraStrumento(s: string | null | undefined): Date | null {
  if (s === null || s === undefined || s === '') return null
  const d = ISO_CON_OFFSET.test(s) ? new Date(s) : null
  if (!d || Number.isNaN(d.getTime())) {
    throw new RegolaPesataError([
      "L'ora dello strumento non è valida: indica data, ora e fuso orario.",
    ])
  }
  return d
}

/**
 * Coerenza fonte/modo/ordine (la impongono anche il CHECK `pesate_coerenza_check` e il trigger
 * `pesate_controlli`): qui si risponde 422 in italiano prima di arrivare al database.
 */
export function verificaCoerenzaFonteModo(
  modo: ModoPesaturaDominio,
  ordine: number,
  fonte: FontePesataDominio
): void {
  const incoerente = (m: string) => {
    throw new RegolaPesataError([m])
  }
  if (ordine !== 1 && ordine !== 2) incoerente('Una pesata può essere la prima o la seconda.')
  if (modo === 'SINGOLA' && ordine !== 1) {
    incoerente('Un accesso a pesata singola ha una sola pesata.')
  }
  if (modo === 'SINGOLA' && fonte === 'TARA_ANAGRAFICA') {
    incoerente('La tara dichiarata non è ammessa in una pesata singola.')
  }
  if (modo === 'DOPPIA' && fonte === 'TARA_ANAGRAFICA') {
    incoerente('La tara dichiarata non è ammessa in una doppia pesata.')
  }
  if (modo === 'TARA_ANAGRAFICA') {
    if (ordine === 1 && fonte === 'TARA_ANAGRAFICA') {
      incoerente('La prima pesata con tara dichiarata deve essere una pesata del mezzo carico.')
    }
    if (ordine === 2 && fonte !== 'TARA_ANAGRAFICA') {
      incoerente('La seconda pesata con tara dichiarata è la tara dell’automezzo.')
    }
  }
  if (fonte === 'TARA_ANAGRAFICA' && ordine !== 2) {
    incoerente('La tara dichiarata può essere solo la seconda pesata.')
  }
}

export interface ContestoPesata {
  tenantId: string
  utenteId: string
  accessoId: string
  ordine: 1 | 2
  modo: ModoPesaturaDominio
  chiaveIdempotenza: string
  adesso: Date
  /** Strumento registrato gia' letto dal chiamante (null se la pesata usa uno strumento esterno). */
  strumento: StrumentoVista | null
  /** Ora strumento della prima pesata (solo seconda pesata). */
  oraPrimaPesata?: Date | null
  allegati: AllegatiPesaService
}

export interface PesataScritta {
  id: string
  ordine: 1 | 2
  fonte: FontePesataDominio
  pesoKg: number
  stabile: boolean
  oraStrumento: Date | null
  oraRicezione: Date
  taraAggiornataIl: Date | null
  automezzoId: string | null
  avvisi: string[]
}

const testoPulito = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/** Pesata MANUALE: regole D7 (errori 422, avvisi riportati), alibi, allegato facoltativo. */
export async function inserisciPesataManuale(
  tx: Prisma.TransactionClient,
  ctx: ContestoPesata,
  dati: PesataManualeDati,
  allegato?: FileCaricato
): Promise<PesataScritta> {
  verificaCoerenzaFonteModo(ctx.modo, ctx.ordine, 'MANUALE')
  const errori: string[] = []
  const strumentoEsterno = testoPulito(dati.strumentoEsterno)
  const alibiId = testoPulito(dati.alibiId)
  const motivo = dati.motivo?.trim() ?? ''

  if (dati.stabileDichiarato !== true) {
    errori.push('Confermare che il display indicava un peso stabile.')
  }
  if (!motivo) errori.push('Il motivo della pesata manuale è obbligatorio.')
  else if (motivo.length > 500) errori.push('Il motivo può avere al massimo 500 caratteri.')
  const haStrumento = ctx.strumento !== null
  if (haStrumento === (strumentoEsterno !== null)) {
    errori.push(
      haStrumento
        ? 'Indicare lo strumento registrato oppure descriverne uno esterno, non entrambi.'
        : 'Indicare lo strumento di pesa oppure descriverne uno esterno.'
    )
  }
  if (strumentoEsterno && strumentoEsterno.length > 200) {
    errori.push('La descrizione dello strumento può avere al massimo 200 caratteri.')
  }
  if (alibiId && alibiId.length > 40) {
    errori.push('La memoria alibi può avere al massimo 40 caratteri.')
  }
  const oraStrumento = leggiOraStrumento(dati.oraStrumento)

  const regole = validaPesataManuale({
    pesoKg: dati.pesoKg,
    oraStrumento,
    adesso: ctx.adesso,
    strumento: ctx.strumento,
    oraPrimaPesata: ctx.oraPrimaPesata ?? null,
  })
  errori.push(...regole.errori)
  if (errori.length > 0) throw new RegolaPesataError(errori)
  const avvisi = [...regole.avvisi]

  // Alibi: unico per strumento registrato (anche in un accesso annullato: la pesata resta).
  if (alibiId && ctx.strumento) {
    const uso = await tx.pesata.findFirst({
      where: { tenantId: ctx.tenantId, strumentoId: ctx.strumento.id, alibiId },
      select: { id: true },
    })
    if (uso) throw new AlibiGiaUsatoError()
  } else if (alibiId && strumentoEsterno) {
    const uso = await tx.pesata.findFirst({
      where: { tenantId: ctx.tenantId, strumentoEsterno, alibiId },
      select: { id: true },
    })
    if (uso) avvisi.push(AVVISO_ALIBI_ESTERNO)
  }

  let salvato: AllegatoSalvato | null = null
  if (allegato) salvato = await ctx.allegati.salva(tx, ctx.tenantId, ctx.utenteId, allegato)

  const stabile = true
  const impronta = improntaPesata({
    tenantId: ctx.tenantId,
    accessoId: ctx.accessoId,
    ordine: ctx.ordine,
    fonte: 'MANUALE',
    strumentoId: ctx.strumento?.id ?? null,
    strumentoEsterno,
    alibiId,
    pesoKg: dati.pesoKg,
    stabile,
    oraStrumento,
    oraRicezione: ctx.adesso,
    operatoreId: ctx.utenteId,
    allegatoSha256: salvato?.sha256 ?? null,
    chiaveIdempotenza: ctx.chiaveIdempotenza,
  })
  const riga = await tx.pesata.create({
    data: {
      tenantId: ctx.tenantId,
      accessoId: ctx.accessoId,
      ordine: ctx.ordine,
      fonte: 'MANUALE',
      strumentoId: ctx.strumento?.id ?? null,
      strumentoEsterno,
      alibiId,
      pesoKg: dati.pesoKg,
      stabile,
      oraStrumento,
      oraRicezione: ctx.adesso,
      operatoreId: ctx.utenteId,
      motivoManuale: motivo,
      allegatoId: salvato?.id ?? null,
      chiaveIdempotenza: ctx.chiaveIdempotenza,
      impronta,
    },
  })
  return {
    id: riga.id,
    ordine: ctx.ordine,
    fonte: 'MANUALE',
    pesoKg: dati.pesoKg,
    stabile,
    oraStrumento,
    oraRicezione: ctx.adesso,
    taraAggiornataIl: null,
    automezzoId: null,
    avvisi,
  }
}

/**
 * Chiave di idempotenza della pesata 2 generata dal sistema (tara dichiarata): deterministica a
 * partire da quella della richiesta, perche' la chiave e' unica per azienda e la pesata 1 usa gia'
 * l'originale. Forma di UUID (versione 5).
 */
export function chiaveDerivata(chiave: string, ordine: number): string {
  const h = createHash('sha256').update(`pesata|${chiave}|${ordine}`).digest('hex')
  const variante = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const AVVISO_ALIBI_ESTERNO =
  'Memoria alibi già usata con la stessa descrizione dello strumento.'

/**
 * Pesata 2 con la tara dichiarata dell'automezzo. L'automezzo si legge QUI, nella transazione,
 * con `SELECT ... FOR UPDATE` (e' mutabile: il ruolo applicativo ha UPDATE): una modifica
 * concorrente della tara aspetta il commit, quindi peso e `tara_aggiornata_il` copiati sono
 * esattamente quelli del momento in cui l'accesso si chiude. L'automezzo e' quello dell'accesso.
 */
export async function inserisciPesataTaraAnagrafica(
  tx: Prisma.TransactionClient,
  ctx: Omit<ContestoPesata, 'strumento' | 'allegati' | 'ordine'>,
  automezzoId: string
): Promise<PesataScritta> {
  verificaCoerenzaFonteModo(ctx.modo, 2, 'TARA_ANAGRAFICA')
  const righe = await tx.$queryRaw<
    { tara_kg: Prisma.Decimal | null; tara_aggiornata_il: Date | null }[]
  >`SELECT tara_kg, tara_aggiornata_il FROM automezzi
    WHERE id = ${automezzoId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`
  const mezzo = righe[0]
  if (!mezzo || mezzo.tara_kg === null || mezzo.tara_aggiornata_il === null) {
    throw new RegolaPesataError(["L'automezzo non ha una tara registrata."])
  }
  const pesoKg = new Prisma.Decimal(mezzo.tara_kg).toFixed(2)
  const taraAggiornataIl = new Date(mezzo.tara_aggiornata_il)
  const impronta = improntaPesata({
    tenantId: ctx.tenantId,
    accessoId: ctx.accessoId,
    ordine: 2,
    fonte: 'TARA_ANAGRAFICA',
    pesoKg,
    stabile: true,
    oraRicezione: ctx.adesso,
    operatoreId: ctx.utenteId,
    automezzoId,
    taraAggiornataIl,
    chiaveIdempotenza: chiaveDerivata(ctx.chiaveIdempotenza, 2),
  })
  const riga = await tx.pesata.create({
    data: {
      tenantId: ctx.tenantId,
      accessoId: ctx.accessoId,
      ordine: 2,
      fonte: 'TARA_ANAGRAFICA',
      pesoKg,
      stabile: true,
      oraRicezione: ctx.adesso,
      operatoreId: ctx.utenteId,
      automezzoId,
      taraAggiornataIl,
      chiaveIdempotenza: chiaveDerivata(ctx.chiaveIdempotenza, 2),
      impronta,
    },
  })
  return {
    id: riga.id,
    ordine: 2,
    fonte: 'TARA_ANAGRAFICA',
    pesoKg: Number(pesoKg),
    stabile: true,
    oraStrumento: null,
    oraRicezione: ctx.adesso,
    taraAggiornataIl,
    automezzoId,
    avvisi: [],
  }
}
