import type { Prisma } from '@prisma/client'
import { controlliMud, type MudEsitoControllo } from './aggregazione/mud-controlli'

// Unica scrittura di `MUDReport.reportData` (integrazioni, esportazioni, presentazione,
// annullamenti). Il JSON si aggiorna con un read-modify-write: senza il lock per tenant e
// anno due transaction concorrenti leggerebbero lo stesso `precedente` e l'ultima
// cancellerebbe la chiave dell'altra; con il record assente due `upsert` fallirebbero con
// P2002. Va chiamata DENTRO una `prisma.$transaction` del chiamante: il lock vale fino al
// commit.

export type ReportDataJson = Record<string, unknown>

/** Versione del calcolo con cui si generano file e riepilogo nuovi (D10). */
export const VERSIONE_CALCOLO_MUD = 2

/**
 * Versione del calcolo salvata in `reportData` (o in una voce di `esportazioni`): un intero 1 o
 * 2; assente, di tipo diverso o fuori dall'elenco vale 1, il calcolo di prima di F2-8 (D10).
 */
export function versioneCalcoloSalvata(valore: unknown): 1 | 2 {
  return valore === 2 ? 2 : 1
}

export interface RecordMudReport {
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'ARCHIVED'
  submittedAt: Date | null
  submittedBy: string | null
}

export interface ScritturaReportData {
  reportData: ReportDataJson
  campi?: Partial<RecordMudReport>
}

function isRecord(v: unknown): v is ReportDataJson {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function aggiornaReportData(
  tx: Prisma.TransactionClient,
  tenantId: string,
  year: number,
  muta: (precedente: ReportDataJson, record: RecordMudReport | null) => ScritturaReportData | null
): Promise<{ precedente: ReportDataJson; record: RecordMudReport | null; scritto: boolean }> {
  const chiaveLock = 'mud-report|' + tenantId + '|' + year
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveLock}))`

  const where = { tenantId_year: { tenantId, year } }
  const letto = await tx.mUDReport.findUnique({
    where,
    select: { status: true, submittedAt: true, submittedBy: true, reportData: true },
  })
  const record: RecordMudReport | null = letto
    ? { status: letto.status, submittedAt: letto.submittedAt, submittedBy: letto.submittedBy }
    : null
  const precedente: ReportDataJson = isRecord(letto?.reportData) ? letto.reportData : {}

  const esito = muta(precedente, record)
  if (esito === null) return { precedente, record, scritto: false }

  const reportData = esito.reportData as Prisma.InputJsonValue
  await tx.mUDReport.upsert({
    where,
    create: {
      tenantId,
      year,
      status: esito.campi?.status ?? 'DRAFT',
      submittedAt: esito.campi?.submittedAt ?? null,
      submittedBy: esito.campi?.submittedBy ?? null,
      reportData,
    },
    update: { reportData, ...esito.campi },
  })
  return { precedente, record, scritto: true }
}

/**
 * Motivo dell'annullamento di una presentazione (A-W-04): una segnatura sbagliata (il MUD non
 * era stato presentato davvero) o una dichiarazione già presentata da sostituire con un file
 * nuovo, che allora porta «annulla e sostituisce».
 */
export const MOTIVI_ANNULLAMENTO = ['SEGNATURA_ERRATA', 'DICHIARAZIONE_DA_SOSTITUIRE'] as const
export type MotivoAnnullamento = (typeof MOTIVI_ANNULLAMENTO)[number]

/** Comunicazione che un nuovo file annulla e sostituisce, con i progressivi già presentati. */
export interface ComunicazioneSostituita {
  data: Date
  /** Progressivi delle unità locali della presentazione sostituita (mai vuoto) */
  progressivi: number[]
}

/**
 * Progressivi salvati con una voce di esportazione, una presentazione o un annullamento: interi
 * positivi, ordinati e senza doppioni. Assenti, vuoti o di forma inattesa valgono {1}: il
 * pacchetto unico di oggi, o una presentazione registrata senza file o con il calcolo v1 (G2).
 */
export function progressiviSalvati(valore: unknown): number[] {
  if (!Array.isArray(valore)) return [1]
  const validi = valore.filter((v): v is number => Number.isInteger(v) && v > 0)
  if (validi.length === 0 || validi.length !== valore.length) return [1]
  return [...new Set(validi)].sort((a, b) => a - b)
}

/**
 * Vero se il file non sostituisce esattamente le unità locali già presentate: contiene
 * progressivi fuori dall'insieme sostituito, oppure non ne contiene uno dei sostituiti.
 */
export function sostituzioneNonCoincide(
  sostituiti: readonly number[],
  nelFile: readonly number[]
): boolean {
  return nelFile.some(p => !sostituiti.includes(p)) || sostituiti.some(p => !nelFile.includes(p))
}

/**
 * Comunicazione che un nuovo file annulla e sostituisce (A-W-04), o `null` se il file è una
 * prima dichiarazione: il `submittedAt` del MUD se è presentato; altrimenti quello
 * dell'annullamento più recente fatto per sostituire la dichiarazione. Gli annullamenti per
 * segnatura errata si saltano: quella segnatura non era una presentazione, quindi non cancella
 * una dichiarazione da sostituire annullata prima (S1 → DA_SOSTITUIRE → S2 → ERRATA: S1 è
 * ancora agli atti e il file la deve sostituire). I progressivi sono quelli presentati (G2).
 */
export function comunicazioneSostituita(
  record: (Pick<RecordMudReport, 'status' | 'submittedAt'> & { reportData?: unknown }) | null
): ComunicazioneSostituita | null {
  if (!record) return null
  const reportData = isRecord(record.reportData) ? record.reportData : {}
  if (record.status === 'SUBMITTED') {
    return record.submittedAt
      ? {
          data: record.submittedAt,
          progressivi: progressiviSalvati(reportData.progressiviUnitaLocale),
        }
      : null
  }
  const annullamenti = Array.isArray(reportData.annullamenti) ? reportData.annullamenti : []
  for (let i = annullamenti.length - 1; i >= 0; i--) {
    const voce: unknown = annullamenti[i]
    if (!isRecord(voce) || voce.motivo !== 'DICHIARAZIONE_DA_SOSTITUIRE') continue
    const data = typeof voce.submittedAt === 'string' ? new Date(voce.submittedAt) : null
    return data && !Number.isNaN(data.getTime())
      ? { data, progressivi: progressiviSalvati(voce.progressiviUnitaLocale) }
      : null
  }
  return null
}

/** Solo la data della comunicazione che un nuovo file sostituisce (vedi `comunicazioneSostituita`). */
export function dataComunicazioneSostituita(
  record: (Pick<RecordMudReport, 'status' | 'submittedAt'> & { reportData?: unknown }) | null
): Date | null {
  return comunicazioneSostituita(record)?.data ?? null
}

/**
 * Avviso del file sostitutivo (G2): presente se il file sostituisce una dichiarazione ma le sue
 * unità locali non coincidono con quelle presentate. Unica condizione, usata dall'export e dai
 * controlli del riepilogo, così l'avviso mostrato è quello che l'export chiede di confermare.
 */
export function avvisoSostitutiva(
  sostituita: ComunicazioneSostituita | null,
  progressiviFile: readonly number[]
): MudEsitoControllo | null {
  if (!sostituita || !sostituzioneNonCoincide(sostituita.progressivi, progressiviFile)) return null
  return controlliMud.sostitutivaPiuDichiarazioni(sostituita.progressivi)
}
