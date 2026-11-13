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
import {
  ORE_AVVISO_LETTURA_VECCHIA,
  ORE_VALIDITA_LETTURA,
  avvisiLettura,
} from '../../domain/pese/agenti/regole-lettura'
import {
  AlibiGiaUsatoError,
  LetturaNonTrovataError,
  RegolaPesataError,
  StatoAccessoNonValidoError,
} from './errori-pese'
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
 * con `SELECT ... FOR NO KEY UPDATE` (lo stesso lock che il chiamante ha gia' preso con `bloccaAutomezzo` PRIMA di creare l'accesso: `FOR UPDATE` qui andrebbe in deadlock col KEY SHARE delle FK; e' mutabile: il ruolo applicativo ha UPDATE): una modifica
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
    WHERE id = ${automezzoId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR NO KEY UPDATE`
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

export const MSG_LETTURA_GIA_USATA = 'Questa lettura è già stata usata in un\u2019altra pesata.'
export const MSG_ACCESSO_SIMULATO = 'Accesso con pesate simulate: non si usa nei documenti.'
const MS_ORA = 60 * 60 * 1000

export interface ContestoPesataDaLettura {
  tenantId: string
  utenteId: string
  accessoId: string
  /** registro (sede) dell'accesso: lo strumento della lettura deve essere di quella sede o senza sede */
  registroId: string
  ordine: 1 | 2
  modo: ModoPesaturaDominio
  chiaveIdempotenza: string
  adesso: Date
  /** Solo seconda pesata: la prima, per verificare che la lettura sia successiva. */
  prima?: { letturaId: string | null; oraStrumento: Date | null } | null
}

/**
 * Pesata da una lettura firmata dell'agente (D12): STRUMENTO, o SIMULATA se la lettura lo e'.
 * Peso, alibi, ora e firma si COPIANO dalla lettura (il trigger `pesate_da_lettura` impone che
 * coincidano: la RIGA della pesata non si modifica). Una rettifica del peso resta ammessa, e' una riga a
 * parte nelle rettifiche con avviso «peso dello strumento rettificato a mano» (review B4-B7, I3). Il chiamante tiene gia'
 * i lock dell'accesso; qui si prende `lettura-pesa|<id>` e l'unico `pesate_lettura_id_key` e' la
 * rete. Mai `FOR SHARE`/`FOR UPDATE` su `letture_pesa` (D4).
 */
export async function inserisciPesataDaLettura(
  tx: Prisma.TransactionClient,
  ctx: ContestoPesataDaLettura,
  letturaId: string
): Promise<PesataScritta> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lettura-pesa|${letturaId}`}))`
  const lettura = await tx.letturaPesa.findFirst({
    where: { id: letturaId, tenantId: ctx.tenantId },
  })
  if (!lettura) throw new LetturaNonTrovataError()
  const usata = await tx.pesata.findFirst({
    where: { tenantId: ctx.tenantId, letturaId },
    select: { id: true },
  })
  if (usata) throw new StatoAccessoNonValidoError(MSG_LETTURA_GIA_USATA)

  const strumento = await tx.strumentoPesa.findFirst({
    where: { id: lettura.strumentoId, tenantId: ctx.tenantId },
    select: { attivo: true, registroId: true },
  })
  if (!strumento) throw new RegolaPesataError(['Lo strumento della lettura non esiste più.'])
  if (!strumento.attivo) throw new RegolaPesataError(['Lo strumento non è attivo.'])
  if (strumento.registroId && strumento.registroId !== ctx.registroId) {
    throw new RegolaPesataError(['Lo strumento appartiene a un’altra sede.'])
  }

  const eta = ctx.adesso.getTime() - lettura.oraAgente.getTime()
  if (eta > ORE_VALIDITA_LETTURA * MS_ORA) {
    throw new RegolaPesataError([
      `La lettura è più vecchia di ${ORE_VALIDITA_LETTURA} ore: non si può più usare. Ripetere la pesata.`,
    ])
  }
  const azienda = await tx.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { peseSimulazioneAmmessa: true },
  })
  if (lettura.simulata && !azienda?.peseSimulazioneAmmessa) {
    throw new RegolaPesataError([
      'Lettura simulata: la simulazione non è ammessa per questa azienda.',
    ])
  }

  if (ctx.ordine === 2 && ctx.prima) {
    const primaLettura = ctx.prima.letturaId
      ? await tx.letturaPesa.findFirst({
          where: { id: ctx.prima.letturaId, tenantId: ctx.tenantId },
          select: { oraAgente: true, oraStrumento: true },
        })
      : null
    const oraAgentePrima = primaLettura?.oraAgente ?? null
    const oraStrumentoPrima = primaLettura?.oraStrumento ?? ctx.prima.oraStrumento
    // Prima MANUALE con un'ora dello strumento digitata: la lettura (che ha sempre `oraAgente`)
    // non puo' essere piu' vecchia (review B4-B7, M5).
    const oraManualePrima = primaLettura ? null : ctx.prima.oraStrumento
    if (
      (oraManualePrima && lettura.oraAgente.getTime() <= oraManualePrima.getTime()) ||
      (oraAgentePrima && lettura.oraAgente.getTime() <= oraAgentePrima.getTime()) ||
      (oraStrumentoPrima &&
        lettura.oraStrumento &&
        lettura.oraStrumento.getTime() <= oraStrumentoPrima.getTime())
    ) {
      throw new RegolaPesataError(['La seconda lettura deve essere successiva alla prima.'])
    }
  }

  const fonte: FontePesataDominio = lettura.simulata ? 'SIMULATA' : 'STRUMENTO'
  verificaCoerenzaFonteModo(ctx.modo, ctx.ordine, fonte)

  const pesoKg = lettura.pesoKg.toFixed(2)
  const impronta = improntaPesata({
    tenantId: ctx.tenantId,
    accessoId: ctx.accessoId,
    ordine: ctx.ordine,
    fonte,
    strumentoId: lettura.strumentoId,
    alibiId: lettura.alibiId,
    pesoKg,
    stabile: lettura.stabile,
    oraStrumento: lettura.oraStrumento,
    oraRicezione: lettura.oraRicezione,
    operatoreId: ctx.utenteId,
    chiaveIdempotenza: ctx.chiaveIdempotenza,
    letturaId: lettura.id,
    firmaAgente: lettura.firma,
  })
  const riga = await tx.pesata.create({
    data: {
      tenantId: ctx.tenantId,
      accessoId: ctx.accessoId,
      ordine: ctx.ordine,
      fonte,
      strumentoId: lettura.strumentoId,
      alibiId: lettura.alibiId,
      pesoKg,
      stabile: lettura.stabile,
      oraStrumento: lettura.oraStrumento,
      oraRicezione: lettura.oraRicezione,
      operatoreId: ctx.utenteId,
      chiaveIdempotenza: ctx.chiaveIdempotenza,
      firmaAgente: lettura.firma,
      letturaId: lettura.id,
      impronta,
    },
  })
  const avvisi = avvisiLettura({
    oraAgente: lettura.oraAgente,
    oraStrumento: lettura.oraStrumento,
    oraRicezione: lettura.oraRicezione,
    simulata: lettura.simulata,
  })
  if (eta > ORE_AVVISO_LETTURA_VECCHIA * MS_ORA) {
    avvisi.push(`Lettura di ${Math.round(eta / MS_ORA)} ore fa.`)
  }
  return {
    id: riga.id,
    ordine: ctx.ordine,
    fonte,
    pesoKg: Number(pesoKg),
    stabile: lettura.stabile,
    oraStrumento: lettura.oraStrumento,
    oraRicezione: lettura.oraRicezione,
    taraAggiornataIl: null,
    automezzoId: null,
    avvisi,
  }
}
