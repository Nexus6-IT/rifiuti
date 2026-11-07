/**
 * Regressione dei piani dell'export (fase 4.4b2, Task 24, giro 3) contro un Postgres reale,
 * COME `wasteflow_app`. In CI il database e' nuovo e le statistiche sono assenti o vecchie
 * subito dopo gli insert: il planner stima tabelle vuote e sceglie nested loop. Qui le
 * statistiche si rendono volutamente vecchie (autovacuum spento sulle tabelle del volume,
 * `pg_statistic` svuotata e `reltuples` a zero), poi l'export gira 6 volte di fila col piano
 * custom e una volta col piano generico forzato. Soglie di TEMPO larghe, mai il testo
 * dell'EXPLAIN (modello `piani-query.postgres.spec.ts`). Pulizia per id esatti.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL += `&application_name=fatt-t24c-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaScenarioFatturazione } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { assicuraCatalogoCer } from '../../test-support/listino-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { XmlDocumentoService } from './xml-documento.service'
import { ExportService, TETTO_DOCUMENTI_CSV } from './export.service'

const TABELLE = [
  'documenti_fattura',
  'righe_documento_fattura',
  'riepiloghi_iva_documento',
  'rate_documento_fattura',
]
const ESECUZIONI = 6
/** Totale delle 6 esecuzioni; in locale col piano buono ~3-4 s, i nested loop superano 60 s. */
const SOGLIA_MS = 30_000

describe('ExportService — piani con statistiche vecchie', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ExportService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let tenantId = ''
  let utenteId = ''
  let documentoIds: string[] = []

  const nel = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId }, async () => await fn())
  const crea = (db: PrismaService) =>
    new ExportService(
      db,
      new DocumentiFatturaService(db),
      new XmlDocumentoService(db, new DocumentiFatturaService(db))
    )
  const esporta = (
    s: ExportService,
    selezione: Parameters<ExportService['esporta']>[2]['selezione']
  ) => nel(() => s.esporta(tenantId, utenteId, { formato: 'CSV', selezione }))

  async function rendiVecchieLeStatistiche() {
    await owner.$executeRawUnsafe(
      `DELETE FROM pg_statistic WHERE starelid IN (${TABELLE.map(t => `'${t}'::regclass`).join(',')})`
    )
    await owner.$executeRawUnsafe(
      `UPDATE pg_class SET reltuples = 0, relpages = 0 WHERE oid IN (${TABELLE.map(t => `'${t}'::regclass`).join(',')})`
    )
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = crea(app)
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
    for (const t of TABELLE)
      await owner.$executeRawUnsafe(`ALTER TABLE ${t} SET (autovacuum_enabled = false)`)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Piani Export SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    tenantId = t.id
    const sc = await creaScenarioFatturazione(owner, tenantId, { legami: 1, registri: 1 })
    utenteId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `keycloak-pia-${randomUUID()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `pia-${randomUUID()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    const [reg] = await owner.registroIva.findMany({ where: { tenantId } })
    await owner.$executeRawUnsafe(
      `INSERT INTO documenti_fattura
         (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
          cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
          esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
          fotografia, updated_at)
       SELECT $1::uuid, 'BOZZA', 'TD01', $2::uuid, 2026, DATE '2026-01-01' + (g % 300), $3::uuid,
              $3::uuid, $4::uuid, DATE '2026-01-01', DATE '2026-12-31', 'FPR12', 'IMMEDIATA',
              300, 66, 366, 366,
              jsonb_build_object('cessionario', jsonb_build_object('partitaIva', '01234567890')),
              now()
       FROM generate_series(1, $5::int) g`,
      tenantId,
      reg.id,
      sc.clienteId,
      sc.contrattoId,
      TETTO_DOCUMENTI_CSV
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO righe_documento_fattura
         (tenant_id, documento_id, numero_linea, tipo_riga, descrizione, quantita, unita_misura,
          prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale, codice_iva_id,
          aliquota_iva, updated_at)
       SELECT d.tenant_id, d.id, l, 'FISSO', 'Canone ' || l, 1, 'N', 100, 100, 0, 100, $2::uuid, 22, now()
       FROM documenti_fattura d CROSS JOIN generate_series(1, 3) l WHERE d.tenant_id = $1::uuid`,
      tenantId,
      sc.codiceIvaId
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
       SELECT tenant_id, id, 22, 300, 66, 'IMMEDIATA', now() FROM documenti_fattura WHERE tenant_id = $1::uuid`,
      tenantId
    )
    await owner.$executeRawUnsafe(
      `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
       SELECT tenant_id, id, 1, 'MP05', DATE '2026-04-30', 366, now() FROM documenti_fattura WHERE tenant_id = $1::uuid`,
      tenantId
    )
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura d
          SET stato = 'DEFINITIVO', numero = x.rn, numero_testo = x.rn::text, definito_il = now(), updated_at = now()
         FROM (SELECT id, row_number() OVER (ORDER BY id)::int AS rn FROM documenti_fattura WHERE tenant_id = $1::uuid) x
        WHERE d.id = x.id AND d.tenant_id = $1::uuid`,
      tenantId
    )
    documentoIds = (
      await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM documenti_fattura WHERE tenant_id = $1::uuid`,
        tenantId
      )
    ).map(r => r.id)
  }, 300_000)

  afterAll(async () => {
    await owner
      .$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      .catch(() => undefined)
    for (const t of TABELLE) {
      await owner
        .$executeRawUnsafe(`ALTER TABLE ${t} RESET (autovacuum_enabled)`)
        .catch(() => undefined)
    }
    await pulisciTenantDiTest(owner, tenantCreati)
    // Statistiche rifatte: le suite successive non devono partire con pg_statistic vuota.
    for (const t of TABELLE) {
      await owner.$executeRawUnsafe(`ANALYZE ${t}`).catch(() => undefined)
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  }, 120_000)

  async function seiVolte(
    s: ExportService,
    selezione: Parameters<ExportService['esporta']>[2]['selezione']
  ) {
    const tempi: number[] = []
    for (let i = 0; i < ESECUZIONI; i++) {
      await rendiVecchieLeStatistiche()
      const t0 = Date.now()
      const r = await esporta(s, selezione)
      tempi.push(Date.now() - t0)
      expect(r.contenuto.length).toBeGreaterThan(1000)
    }
    // eslint-disable-next-line no-console
    console.log(`[T24c] ${JSON.stringify(Object.keys(selezione))} tempi ms: ${tempi.join(', ')}`)
    return tempi.reduce((a, t) => a + t, 0)
  }

  it(`piano custom, statistiche vecchie, filtro per anno, ${ESECUZIONI} volte: totale sotto ${SOGLIA_MS} ms`, async () => {
    expect(await seiVolte(servizio, { anno: 2026 })).toBeLessThan(SOGLIA_MS)
  }, 400_000)

  it(`piano custom, statistiche vecchie, 5000 documentoIds, ${ESECUZIONI} volte: totale sotto ${SOGLIA_MS} ms`, async () => {
    expect(await seiVolte(servizio, { documentoIds })).toBeLessThan(SOGLIA_MS)
  }, 400_000)

  it(`force_generic_plan, statistiche vecchie: filtro per anno e 5000 documentoIds sotto ${SOGLIA_MS} ms`, async () => {
    await owner.$executeRawUnsafe(
      `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
    )
    const generico = creaPrismaServiceApplicativo()
    try {
      const s = crea(generico)
      let tot = 0
      for (const selezione of [{ anno: 2026 }, { documentoIds }]) {
        await rendiVecchieLeStatistiche()
        const t0 = Date.now()
        await esporta(s, selezione)
        const ms = Date.now() - t0
        // eslint-disable-next-line no-console
        console.log(`[T24c] generico ${JSON.stringify(Object.keys(selezione))}: ${ms} ms`)
        tot += ms
      }
      expect(tot).toBeLessThan(SOGLIA_MS)
    } finally {
      await owner.$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      await generico.$disconnect()
    }
  }, 400_000)
})
