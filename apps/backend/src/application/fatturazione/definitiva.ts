// Definitiva di un'elaborazione di fatturazione (fase 4.4b1, Task 19, spec §5.4): in UNA transazione
// trasforma le bozze in documenti DEFINITIVI numerati, mette i legami in `FATTURATO` e scrive i
// marcatori. Un errore a meta' non lascia nulla: nessun numero consumato, nessun legame marcato.
//
// Ordine dei lock (spec §8, mai invertito): elaborazione FOR UPDATE -> numerazioni FOR UPDATE per
// `registro_iva_id` -> contratti, elenchi e righe di listino FOR SHARE (insiemi interi, Q20) ->
// testate e righe dei legami FOR UPDATE -> documenti in BOZZA FOR UPDATE -> marcatori INSERT.
// Non si prende MAI il lock del registro, il lock consultivo per radice o
// `impostazioni_fatturazione FOR UPDATE` (S5).
//
// Ordine di scrittura (scansione P2, trigger delle figlie): testate ancora in BOZZA -> UPDATE delle
// righe (solo `movimento_fatturato_id`) -> UPDATE delle testate a DEFINITIVO -> legami -> marcatori.
// `riga_legame_id` NON si scrive mai (Q1, seguiti 4.4a): chi risale alla riga del legame usa
// `(legame_id, riga_addebito_id)`.
//
// Ogni uscita senza commit (un esito o un errore) riporta l'elaborazione a `ANTEPRIMA_PRONTA` con
// una seconda transazione breve (`riportaAnteprimaPronta`), come il §4.11.
import { ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  ERRORI_GENERALI_BLOCCANTI,
  TETTO_DOCUMENTI_DEFINITIVA,
  type ErroreGenerale,
} from '../../domain/fatturazione/codici'
import { improntaElaborazione } from '../../domain/fatturazione/impronta'
import type { FotografiaSalvata } from '../../domain/fatturazione/tipi'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { impostaTimeoutLock, joinLineari } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  calcolaBozze,
  eViolazioneUnica,
  ElaborazioneNonTrovataError,
  type BozzaCalcolata,
} from './anteprima'
import { bloccaElaborazione, bloccaPerDefinitiva, insiemiPerDefinitiva } from './lock-fatturazione'
import {
  numeroTesto,
  riservaNumeri,
  type NumeriRiservati,
  type RichiestaNumeri,
} from './numerazione'
import {
  selezionaElaborazione,
  type FiltriElaborazione,
  type ParametriElaborazione,
  type SelezioneElaborazione,
} from './selezione-fatturazione'

/** Timeout della transazione della definitiva (spec §5.4): lunga, ma sempre limitata. */
export const OPZIONI_TRANSAZIONE_DEFINITIVA = { timeout: 120_000, maxWait: 10_000 } as const
export const LOCK_TIMEOUT_DEFINITIVA = '5s'
export const STATEMENT_TIMEOUT_DEFINITIVA = '60s'
export const MESSAGGIO_ERRORE_TECNICO_DEFINITIVA = 'Errore tecnico durante la definitiva'

export interface DifferenzeAnteprima {
  nuovi: number
  cambiati: number
  fatturatiDaAltri: number
}

export type EsitoDefinitiva =
  | { esito: 'DEFINITIVA'; documenti: number; numeri: NumeriRiservati[] }
  | { esito: 'ANTEPRIMA_SUPERATA'; differenze: DifferenzeAnteprima }
  | { esito: 'DATA_ANTERIORE_ULTIMA_FATTURA'; ultimaData: string } // Q15
  | { esito: 'CEDENTE_INCOMPLETO' } // decisione 24, emerso sotto lock
  | { esito: 'DOPPIA_FATTURAZIONE' | 'DEFINITIVE_NON_ATTIVE' }
  // Aggiunte (additive): il job non ha niente da fare (elaborazione non piu' `IN_DEFINITIVA`,
  // versione o `job_id` diversi: un altro job l'ha gia' portata avanti) e il caso, che dopo la
  // richiesta sincrona non dovrebbe presentarsi, di nessun documento definibile.
  | { esito: 'NON_ESEGUITA' }
  | { esito: 'NESSUN_DOCUMENTO_DEFINIBILE' }

/** Identita' del job che esegue: versione e `job_id` scritti da `chiediDefinitiva`. */
export interface IdentitaJobDefinitiva {
  versione: number
  jobId: string
}

/** Forma di `elaborazioni_fatturazione.esito` per gli esiti diversi da `DEFINITIVA`. */
export interface EsitoSalvato {
  codice: string
  differenze?: DifferenzeAnteprima
  ultimaData?: string
}

/** Uscita senza commit con un esito: lancia dentro la transazione, la prende `eseguiDefinitiva`. */
class UscitaDefinitiva extends Error {
  constructor(readonly esito: EsitoDefinitiva) {
    super(`Definitiva interrotta: ${esito.esito}`)
    this.name = 'UscitaDefinitiva'
  }
}

/** Un documento candidato alla definitiva: bozza non esclusa e senza errori (passo d). */
export interface CandidatoDefinitiva {
  id: string
  registroIvaId: string
  anno: number
  contrattoId: string
  elencoId: string | null
  clienteFatturazioneId: string
  tipoDocumento: string
  formatoTrasmissione: string
  totaleImponibile: string
  totaleIva: string
  totaleDocumento: string
  nettoAPagare: string
}

/** `DocumentoSelezionato.chiave`: `contrattoId` oppure `contrattoId:elencoId`. */
export const chiaveCandidato = (c: { contrattoId: string; elencoId: string | null }): string =>
  c.elencoId === null ? c.contrattoId : `${c.contrattoId}:${c.elencoId}`

/**
 * Le bozze che la definitiva numera: dell'elaborazione, non escluse, senza errori. Lettura
 * semplice. Chiamata dalla richiesta sincrona e dal job, che devono vedere lo stesso insieme.
 */
export async function leggiCandidati(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elaborazioneId: string
): Promise<CandidatoDefinitiva[]> {
  return tx.$queryRaw<CandidatoDefinitiva[]>`
    SELECT d.id::text AS id, d.registro_iva_id::text AS "registroIvaId", d.anno::int AS anno,
           d.contratto_id::text AS "contrattoId", d.elenco_id::text AS "elencoId",
           d.cliente_fatturazione_id::text AS "clienteFatturazioneId",
           d.tipo_documento AS "tipoDocumento", d.formato_trasmissione AS "formatoTrasmissione",
           d.totale_imponibile::text AS "totaleImponibile", d.totale_iva::text AS "totaleIva",
           d.totale_documento::text AS "totaleDocumento", d.netto_a_pagare::text AS "nettoAPagare"
    FROM documenti_fattura d
    WHERE d.tenant_id = ${tenantId}::uuid AND d.elaborazione_id = ${elaborazioneId}::uuid
      AND d.stato = 'BOZZA' AND NOT d.escluso_da_definitiva AND cardinality(d.errori) = 0
    ORDER BY d.id`
}

/** Interruttore delle definitive: lettura semplice, nessun lock (S5, scansione P33). Senza riga = spento. */
export async function definitiveAttive(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<boolean> {
  const [r] = await tx.$queryRaw<{ attive: boolean }[]>`
    SELECT definitive_attive AS attive FROM impostazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid`
  return r?.attive === true
}

/**
 * Data piu' recente, fra le numerazioni delle coppie (registro, anno) dei candidati, che supera la
 * data del documento. Lettura senza lock: la riserva dei numeri la ricontrolla sotto lock (Q15).
 */
export async function ultimaDataSuperiore(
  tx: Prisma.TransactionClient,
  tenantId: string,
  candidati: readonly CandidatoDefinitiva[],
  dataDocumento: string
): Promise<string | null> {
  if (candidati.length === 0) return null
  const registri = [...new Set(candidati.map(c => c.registroIvaId))]
  const anno = Number(dataDocumento.slice(0, 4))
  const [r] = await tx.$queryRaw<{ ultima: string | null }[]>`
    SELECT max(ultima_data)::text AS ultima FROM numerazioni_fattura
    WHERE tenant_id = ${tenantId}::uuid AND anno = ${anno}::smallint
      AND registro_iva_id = ANY(${registri}::uuid[])
      AND ultima_data > ${dataDocumento}::date`
  return r?.ultima ?? null
}

/** Primo degli errori generali bloccanti (decisione 24) presente fra quelli salvati, nell'ordine fisso. */
export function primoErroreBloccante(salvati: readonly string[]): ErroreGenerale | null {
  return ERRORI_GENERALI_BLOCCANTI.find(c => salvati.includes(c)) ?? null
}

// ---------------------------------------------------------------------------------------------
// Uscita senza commit: la seconda transazione breve
// ---------------------------------------------------------------------------------------------

function esitoDaSalvare(e: EsitoDefinitiva): EsitoSalvato | null {
  switch (e.esito) {
    case 'DEFINITIVA':
    case 'NON_ESEGUITA':
      return null
    case 'ANTEPRIMA_SUPERATA':
      return { codice: e.esito, differenze: e.differenze }
    case 'DATA_ANTERIORE_ULTIMA_FATTURA':
      return { codice: e.esito, ultimaData: e.ultimaData }
    default:
      return { codice: e.esito }
  }
}

/**
 * Riporta l'elaborazione da `IN_DEFINITIVA` a `ANTEPRIMA_PRONTA` scrivendo `esito` oppure
 * `errore_tecnico` (spec §4.11). Solo se e' ancora `IN_DEFINITIVA` con quella versione (e quel
 * `job_id`, se dato): un altro job che l'ha gia' portata avanti non si tocca. Le bozze non si
 * toccano: sono intatte perche' la transazione della definitiva e' stata annullata.
 */
export async function riportaAnteprimaPronta(
  prisma: PrismaService,
  tenantId: string,
  elaborazioneId: string,
  identita: { versione: number; jobId?: string | null },
  scrittura: { esito: EsitoSalvato | null; erroreTecnico: string | null }
): Promise<void> {
  await nelContestoTenant(tenantId, () =>
    prisma.$transaction(async tx => {
      await impostaTimeoutLock(tx)
      await tx.$executeRaw`
        UPDATE elaborazioni_fatturazione
        SET stato = 'ANTEPRIMA_PRONTA',
            esito = ${scrittura.esito === null ? null : JSON.stringify(scrittura.esito)}::jsonb,
            errore_tecnico = ${scrittura.erroreTecnico === null ? null : scrittura.erroreTecnico.slice(0, 200)},
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid
          AND stato = 'IN_DEFINITIVA' AND versione = ${identita.versione}::int
          ${identita.jobId == null ? Prisma.empty : Prisma.sql`AND job_id = ${identita.jobId}`}`
    })
  )
}

// ---------------------------------------------------------------------------------------------
// Il job
// ---------------------------------------------------------------------------------------------

/**
 * Job della definitiva (spec §5.4). Il chiamante e' nel contesto del tenant (il job lo apre, un
 * test lo apre da se'). Restituisce l'esito; gli esiti diversi da `DEFINITIVA` e `NON_ESEGUITA`
 * hanno gia' riportato l'elaborazione a `ANTEPRIMA_PRONTA` (con `esito`). Un errore tecnico la
 * riporta a `ANTEPRIMA_PRONTA` con `errore_tecnico` e rilancia: lo segnala il chiamante.
 * `ElaborazioneNonTrovataError` se l'elaborazione non e' del tenant (la RLS non la mostra).
 *
 * `job`: versione e `job_id` del job; se omessi vale quello salvato. Un job con un `job_id` o una
 * versione diversi da quelli salvati esce senza scrivere (`NON_ESEGUITA`).
 */
export async function eseguiDefinitiva(
  prisma: PrismaService,
  tenantId: string,
  elaborazioneId: string,
  utenteId: string | null,
  job?: IdentitaJobDefinitiva
): Promise<EsitoDefinitiva> {
  return nelContestoTenant(tenantId, async () => {
    // Versione e `job_id` effettivi del job, per la seconda transazione.
    let identita: { versione: number; jobId: string | null } | null = null
    try {
      return await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_DEFINITIVA}'`)
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_DEFINITIVA}'`
        )
        return definitivaInTransazione(tx, tenantId, elaborazioneId, utenteId, job, i => {
          identita = i
        })
      }, OPZIONI_TRANSAZIONE_DEFINITIVA)
    } catch (err) {
      if (err instanceof NotFoundException) throw new ElaborazioneNonTrovataError()
      const salvata = identita as { versione: number; jobId: string | null } | null
      if (err instanceof UscitaDefinitiva) {
        if (salvata !== null) {
          await riportaAnteprimaPronta(prisma, tenantId, elaborazioneId, salvata, {
            esito: esitoDaSalvare(err.esito),
            erroreTecnico: null,
          })
        }
        return err.esito
      }
      if (salvata !== null) {
        await riportaAnteprimaPronta(prisma, tenantId, elaborazioneId, salvata, {
          esito: null,
          erroreTecnico: MESSAGGIO_ERRORE_TECNICO_DEFINITIVA,
        }).catch(() => undefined)
      }
      throw err
    }
  })
}

interface ElaborazioneLetta {
  jobId: string | null
  impronta: string | null
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  filtri: FiltriElaborazione | null
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  includiArretrati: boolean
  prontaIl: string | null
}

interface RigaSalvata {
  id: string
  documentoId: string
  numeroLinea: number
  tipoRiga: string
  legameId: string | null
  rigaAddebitoId: string | null
  prezzoTotale: string
}

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)
const uguali = (a: string, b: string): boolean => D(a).equals(D(b))
const dataIt = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const distinti = <T>(l: readonly T[]): T[] => [...new Set(l)]

function inBlocchi<T>(l: readonly T[], n: number): T[][] {
  const blocchi: T[][] = []
  for (let i = 0; i < l.length; i += n) blocchi.push(l.slice(i, i + n))
  return blocchi
}

/**
 * Esegue `fn` con il nested loop spento (query `JOIN unnest` su liste grandi) e lo RIPRISTINA
 * appena finita (scansione P46): le letture che seguono ritrovano il planner com'era. Se `fn`
 * fallisce la transazione e' abortita e il rollback ripristina da solo il `SET LOCAL`.
 */
export async function conJoinLineari<R>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<R>
): Promise<R> {
  const [{ v }] = await tx.$queryRaw<
    { v: string }[]
  >`SELECT current_setting('enable_nestloop') AS v`
  await joinLineari(tx)
  const risultato = await fn()
  await tx.$queryRaw`SELECT set_config('enable_nestloop', ${v}, true)`
  return risultato
}

/** Confronto fra una bozza salvata e il suo ricalcolo: `null` se uguali, altrimenti il motivo. */
function motivoDifferenza(
  c: CandidatoDefinitiva,
  b: BozzaCalcolata | undefined,
  righe: readonly RigaSalvata[]
): string | null {
  if (b === undefined) return 'documento assente dalla selezione'
  if (b.selezionato.registroIvaId !== c.registroIvaId) return 'registro IVA diverso'
  if (b.calcolato.errori.length > 0) return 'il ricalcolo ha errori'
  if (b.calcolato.tipoDocumento !== c.tipoDocumento) return 'tipo documento diverso'
  if (b.calcolato.formatoTrasmissione !== c.formatoTrasmissione) return 'formato diverso'
  if (
    !uguali(b.calcolato.totaleImponibile, c.totaleImponibile) ||
    !uguali(b.calcolato.totaleIva, c.totaleIva) ||
    !uguali(b.calcolato.totaleDocumento, c.totaleDocumento) ||
    !uguali(b.calcolato.nettoAPagare, c.nettoAPagare)
  ) {
    return 'importi diversi'
  }
  if (b.calcolato.righe.length !== righe.length) return 'numero di righe diverso'
  const perLinea = new Map(righe.map(r => [r.numeroLinea, r]))
  for (const r of b.calcolato.righe) {
    const salvata = perLinea.get(r.numeroLinea)
    if (
      salvata === undefined ||
      salvata.tipoRiga !== r.tipoRiga ||
      salvata.legameId !== r.legameId ||
      salvata.rigaAddebitoId !== r.rigaAddebitoId ||
      !uguali(salvata.prezzoTotale, r.prezzoTotale)
    ) {
      return `riga ${r.numeroLinea} diversa`
    }
  }
  return null
}

/** Differenze contate sui legami (Q11): vedi il commento in testa a `contaDifferenze`. */
async function contaDifferenze(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elaborazioneId: string,
  prontaIl: string | null,
  selezione: SelezioneElaborazione,
  calcolati: ReadonlyMap<string, BozzaCalcolata>,
  candidati: readonly CandidatoDefinitiva[],
  righeSalvate: ReadonlyMap<string, RigaSalvata[]>
): Promise<DifferenzeAnteprima> {
  // Legami citati dalle righe di TUTTE le bozze dell'elaborazione (anche escluse o con errori).
  const nelleBozze = new Set(
    (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT r.legame_id::text AS id
        FROM righe_documento_fattura r
        JOIN documenti_fattura d ON d.id = r.documento_id AND d.tenant_id = r.tenant_id
        WHERE d.tenant_id = ${tenantId}::uuid AND d.elaborazione_id = ${elaborazioneId}::uuid
          AND d.stato = 'BOZZA' AND r.legame_id IS NOT NULL`
    ).map(r => r.id)
  )
  const nellaSelezione = new Set(
    selezione.documenti.flatMap(d => d.input.legami.map(l => l.legameId))
  )

  // nuovi: nella nuova selezione, assenti dalle righe delle bozze.
  const nuoviIds = [...nellaSelezione].filter(id => !nelleBozze.has(id))
  const nuovi = nuoviIds.length

  // fatturatiDaAltri: legami delle bozze non piu' CONFERMATO o con `fatturato_il`.
  const fatturati = new Set(
    (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM legami_movimento
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${[...nelleBozze]}::uuid[])
          AND (stato <> 'CONFERMATO' OR fatturato_il IS NOT NULL)`
    ).map(r => r.id)
  )

  // cambiati: legami presenti in entrambe con `updated_at` successivo a `prontaIl`...
  const comuni = [...nelleBozze].filter(id => nellaSelezione.has(id))
  const legamiCambiati = new Set<string>()
  if (prontaIl !== null && comuni.length > 0) {
    const r = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM legami_movimento
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${comuni}::uuid[])
        AND updated_at > (${prontaIl}::timestamptz AT TIME ZONE 'UTC')`
    for (const x of r) legamiCambiati.add(x.id)
  }
  // ...piu' i documenti il cui ricalcolo differisce per un'altra voce dell'impronta (contratto,
  // listino, IVA, marcatori, clienti, condizioni, spese, conti, cedente). Un documento che ha un
  // legame nuovo, cambiato o fatturato da altri e' gia' spiegato da quel legame: non si conta due
  // volte.
  const spiegati = new Set([...nuoviIds, ...legamiCambiati, ...fatturati])
  let documentiDiversi = 0
  for (const c of candidati) {
    const righe = righeSalvate.get(c.id) ?? []
    const nuovo = calcolati.get(chiaveCandidato(c))
    const legamiDelDocumento = [
      ...righe.flatMap(r => (r.legameId === null ? [] : [r.legameId])),
      ...(nuovo?.selezionato.input.legami.map(l => l.legameId) ?? []),
    ]
    if (legamiDelDocumento.some(id => spiegati.has(id))) continue
    if (motivoDifferenza(c, nuovo, righe) !== null) documentiDiversi++
  }
  const fatturatiDaAltri = fatturati.size
  return { nuovi, cambiati: legamiCambiati.size + documentiDiversi, fatturatiDaAltri }
}

/**
 * Corpo della definitiva, dentro la transazione (spec §5.4, passi 1-9 del brief). Restituisce
 * `DEFINITIVA` o `NON_ESEGUITA`; ogni altra uscita lancia `UscitaDefinitiva` (rollback).
 */
async function definitivaInTransazione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  elaborazioneId: string,
  utenteId: string | null,
  job: IdentitaJobDefinitiva | undefined,
  registraIdentita: (i: { versione: number; jobId: string | null }) => void
): Promise<EsitoDefinitiva> {
  // 1. Elaborazione FOR UPDATE: deve essere IN_DEFINITIVA con la versione e il job_id scritti da
  // `chiediDefinitiva`, altrimenti il job non ha niente da fare e non scrive.
  const bloccata = await bloccaElaborazione(tx, tenantId, elaborazioneId)
  const [e] = await tx.$queryRaw<ElaborazioneLetta[]>`
    SELECT job_id AS "jobId", impronta, periodo_dal::text AS "periodoDal",
           periodo_al::text AS "periodoAl", data_documento::text AS "dataDocumento", filtri,
           raggruppamento::text AS raggruppamento, includi_arretrati AS "includiArretrati",
           riepilogo->>'prontaIl' AS "prontaIl"
    FROM elaborazioni_fatturazione
    WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid`
  if (bloccata.stato !== 'IN_DEFINITIVA') return { esito: 'NON_ESEGUITA' }
  if (job !== undefined && (job.versione !== bloccata.versione || job.jobId !== e.jobId)) {
    return { esito: 'NON_ESEGUITA' }
  }
  registraIdentita({ versione: bloccata.versione, jobId: e.jobId })

  // Interruttore delle definitive, riletto: lettura semplice, nessun lock (S5).
  if (!(await definitiveAttive(tx, tenantId))) {
    throw new UscitaDefinitiva({ esito: 'DEFINITIVE_NON_ATTIVE' })
  }

  // 2. Candidati: bozze non escluse e senza errori (non cambiano: `escludi` vuole ANTEPRIMA_PRONTA).
  const candidati = await leggiCandidati(tx, tenantId, elaborazioneId)
  if (candidati.length === 0) throw new UscitaDefinitiva({ esito: 'NESSUN_DOCUMENTO_DEFINIBILE' })
  if (candidati.length > TETTO_DOCUMENTI_DEFINITIVA) {
    throw new Error('Definitiva: troppi documenti per una sola transazione.')
  }
  const anno = Number(e.dataDocumento.slice(0, 4))

  // 3. Numeri: una richiesta per registro (le numerazioni FOR UPDATE vengono prima dei contratti).
  // I numeri si assegnano al passo 7; qui si prenotano `quanti` numeri consecutivi per registro.
  const perRegistro = new Map<string, number>()
  for (const c of candidati)
    perRegistro.set(c.registroIvaId, (perRegistro.get(c.registroIvaId) ?? 0) + 1)
  const richieste: RichiestaNumeri[] = [...perRegistro.keys()].sort().map(registroIvaId => ({
    registroIvaId,
    anno,
    quanti: perRegistro.get(registroIvaId) as number,
    dataDocumento: e.dataDocumento,
  }))
  let riservati: NumeriRiservati[]
  try {
    riservati = await riservaNumeri(tx, tenantId, richieste)
  } catch (err) {
    if (err instanceof ConflictException) {
      const r = err.getResponse() as { error?: string; details?: { ultimaData?: string } }
      if (
        r.error === 'DATA_ANTERIORE_ULTIMA_FATTURA' &&
        typeof r.details?.ultimaData === 'string'
      ) {
        throw new UscitaDefinitiva({
          esito: 'DATA_ANTERIORE_ULTIMA_FATTURA',
          ultimaData: r.details.ultimaData,
        })
      }
    }
    throw err
  }

  // 4. Insiemi (lettura) e lock FOR SHARE / FOR UPDATE sugli insiemi interi (Q20).
  const insiemi = await insiemiPerDefinitiva(
    tx,
    tenantId,
    candidati.map(c => c.id)
  )
  await bloccaPerDefinitiva(tx, tenantId, insiemi)

  // 5. Selezione sotto lock: cedente, poi impronta.
  const parametri: ParametriElaborazione = {
    periodoDal: e.periodoDal,
    periodoAl: e.periodoAl,
    dataDocumento: e.dataDocumento,
    raggruppamento: e.raggruppamento,
    includiArretrati: e.includiArretrati,
    filtri: e.filtri ?? {},
  }
  const selezione = await selezionaElaborazione(tx, tenantId, parametri)
  if (selezione.erroriGenerali.some(g => g.codice === 'CEDENTE_INCOMPLETO')) {
    throw new UscitaDefinitiva({ esito: 'CEDENTE_INCOMPLETO' })
  }

  // 6 (anticipato per le differenze). Ricalcolo puro e righe salvate dei candidati.
  const { bozze } = calcolaBozze(selezione.documenti)
  const calcolati = new Map(bozze.map(b => [b.selezionato.chiave, b]))
  const righeSalvate = new Map<string, RigaSalvata[]>()
  const salvate = await conJoinLineari(
    tx,
    () =>
      tx.$queryRaw<RigaSalvata[]>`
      SELECT r.id::text AS id, r.documento_id::text AS "documentoId", r.numero_linea AS "numeroLinea",
             r.tipo_riga::text AS "tipoRiga", r.legame_id::text AS "legameId",
             r.riga_addebito_id::text AS "rigaAddebitoId", r.prezzo_totale::text AS "prezzoTotale"
      FROM righe_documento_fattura r
      JOIN unnest(${candidati.map(c => c.id)}::uuid[]) AS chiesti(chiesto) ON chiesto = r.documento_id
      WHERE r.tenant_id = ${tenantId}::uuid`
  )
  for (const r of salvate) {
    const l = righeSalvate.get(r.documentoId) ?? []
    l.push(r)
    righeSalvate.set(r.documentoId, l)
  }

  if (improntaElaborazione(selezione.versioni) !== e.impronta) {
    const differenze = await contaDifferenze(
      tx,
      tenantId,
      elaborazioneId,
      e.prontaIl,
      selezione,
      calcolati,
      candidati,
      righeSalvate
    )
    throw new UscitaDefinitiva({ esito: 'ANTEPRIMA_SUPERATA', differenze })
  }

  // 6. Con l'impronta uguale il ricalcolo DEVE dare le stesse bozze: altrimenti e' un difetto.
  for (const c of candidati) {
    const motivo = motivoDifferenza(
      c,
      calcolati.get(chiaveCandidato(c)),
      righeSalvate.get(c.id) ?? []
    )
    if (motivo !== null) {
      throw new Error(`Definitiva: il ricalcolo non coincide con la bozza (${motivo}).`)
    }
  }

  // 7. Ordine deterministico: registro, ragione sociale del cliente di fatturazione, id del
  // cliente, numero del contratto, codice dell'elenco. Numeri da..a in quell'ordine, per registro.
  const elenchiDaLeggere = distinti(
    candidati.flatMap(c => (c.elencoId === null ? [] : [c.elencoId]))
  )
  const codiceElenco = new Map<string, string>()
  if (elenchiDaLeggere.length > 0) {
    const righeElenchi = await tx.$queryRaw<{ id: string; codice: string }[]>`
      SELECT id::text AS id, codice FROM elenchi_addebiti
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${elenchiDaLeggere}::uuid[])`
    for (const r of righeElenchi) codiceElenco.set(r.id, r.codice)
  }
  const collator = new Intl.Collator('it')
  const confronta = (a: string, b: string): number =>
    collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
  const ordinati = [...candidati].sort((x, y) => {
    const bx = calcolati.get(chiaveCandidato(x)) as BozzaCalcolata
    const by = calcolati.get(chiaveCandidato(y)) as BozzaCalcolata
    return (
      confronta(x.registroIvaId, y.registroIvaId) ||
      confronta(bx.selezionato.denominazione, by.selezionato.denominazione) ||
      confronta(x.clienteFatturazioneId, y.clienteFatturazioneId) ||
      confronta(bx.selezionato.contrattoNumero, by.selezionato.contrattoNumero) ||
      confronta(
        codiceElenco.get(x.elencoId ?? '') ?? '',
        codiceElenco.get(y.elencoId ?? '') ?? ''
      ) ||
      confronta(x.id, y.id)
    )
  })
  const riservatiPer = new Map(riservati.map(r => [r.registroIvaId, r]))
  const prossimo = new Map(riservati.map(r => [r.registroIvaId, r.da]))
  const assegnati = ordinati.map(c => {
    const r = riservatiPer.get(c.registroIvaId) as NumeriRiservati
    const numero = prossimo.get(c.registroIvaId) as number
    prossimo.set(c.registroIvaId, numero + 1)
    return { candidato: c, numero, numeroTesto: numeroTesto(numero, r.suffisso) }
  })
  for (const r of riservati) {
    if (prossimo.get(r.registroIvaId) !== r.a + 1) {
      throw new Error('Definitiva: i numeri assegnati non coprono la riserva.')
    }
  }

  // 8. Scritture. Prima le testate in BOZZA FOR UPDATE (ultimo passo dell'ordine dei lock): il
  // trigger delle figlie legge lo stato senza lock.
  const documentoIds = ordinati.map(c => c.id).sort()
  await tx.$queryRaw`
    SELECT id::text AS id FROM documenti_fattura
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${documentoIds}::uuid[]) AND stato = 'BOZZA'
    ORDER BY id FOR UPDATE`

  // 8a. Righe: solo `movimento_fatturato_id` (= `movimento_vigente_id` del legame); `riga_legame_id`
  // resta NULL (Q1). Le testate sono ancora in BOZZA.
  const legameIds = distinti(salvate.flatMap(r => (r.legameId === null ? [] : [r.legameId]))).sort()
  const movimentoDi = new Map<string, string>()
  if (legameIds.length > 0) {
    const legami = await conJoinLineari(
      tx,
      () =>
        tx.$queryRaw<
          { id: string; movimentoVigenteId: string; stato: string; fatturato: boolean }[]
        >`
        SELECT l.id::text AS id, l.movimento_vigente_id::text AS "movimentoVigenteId",
               l.stato::text AS stato, (l.fatturato_il IS NOT NULL) AS fatturato
        FROM legami_movimento l
        JOIN unnest(${legameIds}::uuid[]) AS chiesti(chiesto) ON chiesto = l.id
        WHERE l.tenant_id = ${tenantId}::uuid`
    )
    if (
      legami.length !== legameIds.length ||
      legami.some(l => l.stato !== 'CONFERMATO' || l.fatturato)
    ) {
      // Sotto lock e con l'impronta uguale non puo' succedere.
      throw new Error('Definitiva: un legame non e piu confermato.')
    }
    for (const l of legami) movimentoDi.set(l.id, l.movimentoVigenteId)
  }
  const righeConLegame = salvate.filter(r => r.legameId !== null)
  if (righeConLegame.length > 0) {
    await conJoinLineari(tx, async () => {
      for (const blocco of inBlocchi(righeConLegame, 5_000)) {
        await tx.$executeRaw`
          UPDATE righe_documento_fattura r
          SET movimento_fatturato_id = u.movimento, updated_at = now()
          FROM unnest(${blocco.map(x => x.id)}::uuid[],
                      ${blocco.map(x => movimentoDi.get(x.legameId as string) as string)}::uuid[])
               AS u(id, movimento)
          WHERE r.tenant_id = ${tenantId}::uuid AND r.id = u.id`
      }
    })
  }

  // 8b. Testate: DEFINITIVO, numero, numero_testo, fotografia con segnalazioni {errori: [], avvisi}
  // (Q16), avvisi riletti dal ricalcolo, definito_*. Un UPDATE solo.
  const fotografie = ordinati.map(c => {
    const b = calcolati.get(chiaveCandidato(c)) as BozzaCalcolata
    const f: FotografiaSalvata = {
      ...b.selezionato.fotografia,
      segnalazioni: { errori: [], avvisi: b.calcolato.avvisi },
    }
    return JSON.stringify(f)
  })
  const avvisiPer = ordinati.map(c =>
    distinti(
      (calcolati.get(chiaveCandidato(c)) as BozzaCalcolata).calcolato.avvisi.map(a => a.codice)
    ).join(',')
  )
  const promosse = await conJoinLineari(
    tx,
    () =>
      tx.$executeRaw`
      UPDATE documenti_fattura d
      SET stato = 'DEFINITIVO', numero = u.numero, numero_testo = u.numero_testo,
          fotografia = u.fotografia::jsonb,
          avvisi = CASE WHEN u.avvisi = '' THEN ARRAY[]::text[] ELSE string_to_array(u.avvisi, ',') END,
          definito_da = ${utenteId}::uuid, definito_il = now(), versione = d.versione + 1,
          updated_at = now()
      FROM unnest(${ordinati.map(c => c.id)}::uuid[], ${assegnati.map(a => a.numero)}::int[],
                  ${assegnati.map(a => a.numeroTesto)}::text[], ${fotografie}::text[],
                  ${avvisiPer}::text[])
           AS u(id, numero, numero_testo, fotografia, avvisi)
      WHERE d.tenant_id = ${tenantId}::uuid AND d.id = u.id AND d.stato = 'BOZZA'`
  )
  if (promosse !== ordinati.length) {
    throw new Error('Definitiva: promozione incompleta delle bozze.')
  }

  // 8c. Legami: FATTURATO, fatturato_il, documento_id, riferimento_fattura «<numero_testo> del
  // gg/mm/aaaa». Un legame sta in un solo documento.
  const documentoDelLegame = new Map<string, string>()
  const numeroTestoDi = new Map(assegnati.map(a => [a.candidato.id, a.numeroTesto]))
  for (const c of ordinati) {
    const b = calcolati.get(chiaveCandidato(c)) as BozzaCalcolata
    for (const r of b.calcolato.righe) {
      if (r.legameId === null) continue
      const prima = documentoDelLegame.get(r.legameId)
      if (prima !== undefined && prima !== c.id) {
        throw new Error('Definitiva: un legame compare in due documenti.')
      }
      documentoDelLegame.set(r.legameId, c.id)
    }
  }
  if (documentoDelLegame.size !== legameIds.length) {
    throw new Error('Definitiva: i legami del ricalcolo non coincidono con quelli delle bozze.')
  }
  const legamiOrdinati = [...documentoDelLegame.keys()].sort()
  if (legamiOrdinati.length > 0) {
    const marcati = await conJoinLineari(
      tx,
      () =>
        tx.$executeRaw`
        UPDATE legami_movimento l
        SET stato = 'FATTURATO', fatturato_il = now(), documento_id = u.documento,
            riferimento_fattura = u.riferimento, versione = l.versione + 1, updated_at = now()
        FROM unnest(${legamiOrdinati}::uuid[],
                    ${legamiOrdinati.map(id => documentoDelLegame.get(id) as string)}::uuid[],
                    ${legamiOrdinati.map(
                      id =>
                        `${numeroTestoDi.get(documentoDelLegame.get(id) as string) as string} del ${dataIt(e.dataDocumento)}`
                    )}::text[])
             AS u(id, documento, riferimento)
        WHERE l.tenant_id = ${tenantId}::uuid AND l.id = u.id AND l.stato = 'CONFERMATO'`
    )
    if (marcati !== legamiOrdinati.length) {
      throw new Error('Definitiva: marcatura incompleta dei legami.')
    }
  }

  // 8d. Marcatori: tipo e chiave dal ricalcolo (passo 6), abbinati alle righe SALVATE per
  // `numero_linea` (Q43). Una violazione dell'unico e' doppia fatturazione: rollback totale.
  const rigaSalvataId = new Map(salvate.map(r => [`${r.documentoId}#${r.numeroLinea}`, r.id]))
  const marcatori: {
    rigaAddebitoId: string
    tipo: string
    chiave: string
    documentoId: string
    rigaDocumentoId: string
  }[] = []
  for (const c of ordinati) {
    const b = calcolati.get(chiaveCandidato(c)) as BozzaCalcolata
    for (const r of b.calcolato.righe) {
      if (r.marcatore === undefined) continue
      const rigaDocumentoId = rigaSalvataId.get(`${c.id}#${r.numeroLinea}`)
      if (rigaDocumentoId === undefined || r.rigaAddebitoId === null) {
        throw new Error('Definitiva: marcatore senza riga salvata.')
      }
      marcatori.push({
        rigaAddebitoId: r.rigaAddebitoId,
        tipo: r.marcatore.tipo,
        chiave: r.marcatore.chiaveCompetenza,
        documentoId: c.id,
        rigaDocumentoId,
      })
    }
  }
  marcatori.sort(
    (a, b) =>
      confronta(a.rigaAddebitoId, b.rigaAddebitoId) ||
      confronta(a.tipo, b.tipo) ||
      confronta(a.chiave, b.chiave)
  )
  if (marcatori.length > 0) {
    try {
      await tx.$executeRaw`
        INSERT INTO marcatori_addebiti_fatturati
          (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
        SELECT ${tenantId}::uuid, m.riga, m.tipo::tipo_marcatore_addebito, m.chiave, m.documento,
               m.riga_documento
        FROM unnest(${marcatori.map(m => m.rigaAddebitoId)}::uuid[], ${marcatori.map(m => m.tipo)}::text[],
                    ${marcatori.map(m => m.chiave)}::text[], ${marcatori.map(m => m.documentoId)}::uuid[],
                    ${marcatori.map(m => m.rigaDocumentoId)}::uuid[])
             AS m(riga, tipo, chiave, documento, riga_documento)`
    } catch (err) {
      if (eViolazioneUnica(err)) throw new UscitaDefinitiva({ esito: 'DOPPIA_FATTURAZIONE' })
      throw err
    }
  }

  // 9. Elaborazione DEFINITIVA e audit: una riga per documento (id, numero, totale) e una per
  // l'elaborazione. Solo id, numeri e importi.
  await tx.$executeRaw`
    UPDATE elaborazioni_fatturazione
    SET stato = 'DEFINITIVA', definita_da = ${utenteId}::uuid, definita_il = now(),
        esito = NULL, errore_tecnico = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND id = ${elaborazioneId}::uuid`
  for (const blocco of inBlocchi(assegnati, 500)) {
    await tx.activityLog.createMany({
      data: blocco.map(a => ({
        tenantId,
        userId: utenteId,
        action: 'DOCUMENTO_FATTURA_DEFINITIVO',
        description: 'Documento di fatturazione reso definitivo',
        metadata: {
          documentoId: a.candidato.id,
          elaborazioneId,
          numero: a.numeroTesto,
          totale: a.candidato.totaleDocumento,
        } as Prisma.InputJsonValue,
      })),
    })
  }
  await tx.activityLog.create({
    data: {
      tenantId,
      userId: utenteId,
      action: 'ELABORAZIONE_FATTURAZIONE_DEFINITIVA',
      description: 'Elaborazione di fatturazione resa definitiva',
      metadata: {
        elaborazioneId,
        documenti: assegnati.length,
        numeri: riservati.map(r => ({
          registroIvaId: r.registroIvaId,
          anno: r.anno,
          da: r.da,
          a: r.a,
        })),
      } as Prisma.InputJsonValue,
    },
  })

  return { esito: 'DEFINITIVA', documenti: assegnati.length, numeri: riservati }
}
