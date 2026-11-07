/**
 * Piano della lista degli scostamenti (4.4c, Task 29, seguito del Task 21) contro un Postgres
 * reale, COME `wasteflow_app`. Con l'indice parziale `legami_movimento_scostati_idx` le query
 * della pagina e del totale non scandiscono in sequenza `legami_movimento`: la tabella e` di tutte
 * le aziende, una Seq Scan la leggerebbe tutta a ogni chiamata. Il CI ha un database nuovo, senza
 * statistiche: il test gira con `pg_statistic` svuotata, `reltuples` a zero e poi anche con
 * `force_generic_plan`. Non guarda i tempi ma il testo del piano (nome dell'indice). Pulizia per
 * id esatti; `ANALYZE` in afterAll.
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=fatt-t29p-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaDocumentoDiTest, creaScenarioVolume } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { sqlPaginaScostamenti, sqlTotaleScostamenti } from './scostamenti.service'

const LEGAMI = 20_000
const DOCUMENTI = 5
const SCOSTAMENTI = 20
const TABELLE = ['legami_movimento', 'documenti_fattura']

describe('Scostamenti — piano con l`indice parziale e statistiche vecchie', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let tenantId = ''

  const nel = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId }, async () => await fn())

  async function rendiVecchieLeStatistiche() {
    const elenco = TABELLE.map(t => `'${t}'::regclass`).join(',')
    await owner.$executeRawUnsafe(`DELETE FROM pg_statistic WHERE starelid IN (${elenco})`)
    await owner.$executeRawUnsafe(
      `UPDATE pg_class SET reltuples = 0, relpages = 0 WHERE oid IN (${elenco})`
    )
  }

  async function piano(sql: Prisma.Sql): Promise<string> {
    return nel(() =>
      app.$transaction(async tx => {
        const righe = await tx.$queryRawUnsafe<Record<string, string>[]>(
          `EXPLAIN ${sql.text}`,
          ...sql.values
        )
        return righe.map(r => Object.values(r)[0]).join('\n')
      })
    )
  }

  async function verifica() {
    const query: [string, Prisma.Sql][] = [
      ['pagina', sqlPaginaScostamenti(tenantId, undefined, 25, 0)],
      ['totale', sqlTotaleScostamenti(tenantId, undefined)],
    ]
    for (const [nome, sql] of query) {
      await rendiVecchieLeStatistiche()
      const p = await piano(sql)
      expect({ nome, p }).toEqual({
        nome,
        p: expect.stringContaining('legami_movimento_scostati_idx'),
      })
      expect({ nome, p }).toEqual({
        nome,
        p: expect.not.stringMatching(/Seq Scan on legami_movimento/),
      })
    }
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    for (const t of TABELLE)
      await owner.$executeRawUnsafe(`ALTER TABLE ${t} SET (autovacuum_enabled = false)`)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Piani scostamenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    tenantId = t.id
    const volume = await creaScenarioVolume(owner, tenantId, { contratti: 200, legami: LEGAMI })
    const fatturati = volume.legamiIds.slice(0, DOCUMENTI)
    let primo = ''
    for (const [i, legameId] of fatturati.entries()) {
      const { documentoId } = await creaDocumentoDiTest(owner, tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: volume.registroIvaId,
        anno: 2026,
        dataDocumento: `2026-04-${String(i + 1).padStart(2, '0')}`,
        legamiIds: [legameId],
      })
      if (i === 0) primo = documentoId
    }
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento
       SET stato = 'FATTURATO', fatturato_il = now(), documento_id = $3::uuid,
           riferimento_fattura = '1', updated_at = now()
       WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      tenantId,
      volume.legamiIds.slice(DOCUMENTI),
      primo
    )
    // I legami scostati sono 20 sui documenti veri (uno per documento, poi sul primo).
    const scostati = [...fatturati, ...volume.legamiIds.slice(DOCUMENTI, SCOSTAMENTI)]
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento SET scostamento_dopo_fattura = true, scostamento_il = now()
       WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      tenantId,
      scostati
    )
  }, 900_000)

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
    for (const t of TABELLE) await owner.$executeRawUnsafe(`ANALYZE ${t}`).catch(() => undefined)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 900_000)

  it('statistiche vecchie, piano custom: pagina e totale usano l`indice parziale', async () => {
    await verifica()
  }, 300_000)

  it('statistiche vecchie, force_generic_plan: pagina e totale usano l`indice parziale', async () => {
    await owner.$executeRawUnsafe(
      `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
    )
    const generico = creaPrismaServiceApplicativo()
    const salvato = app
    app = generico
    try {
      await verifica()
    } finally {
      app = salvato
      await owner.$executeRawUnsafe(`ALTER ROLE wasteflow_app RESET plan_cache_mode`)
      await generico.$disconnect()
    }
  }, 300_000)
})
