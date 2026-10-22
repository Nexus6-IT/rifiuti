import type { Prisma } from '@prisma/client'

// Unica scrittura di `MUDReport.reportData` (integrazioni, esportazioni, presentazione,
// annullamenti). Il JSON si aggiorna con un read-modify-write: senza il lock per tenant e
// anno due transaction concorrenti leggerebbero lo stesso `precedente` e l'ultima
// cancellerebbe la chiave dell'altra; con il record assente due `upsert` fallirebbero con
// P2002. Va chiamata DENTRO una `prisma.$transaction` del chiamante: il lock vale fino al
// commit.

export type ReportDataJson = Record<string, unknown>

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
