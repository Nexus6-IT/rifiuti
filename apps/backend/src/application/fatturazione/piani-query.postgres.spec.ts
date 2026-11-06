/**
 * Regressione dei piani instabili della fatturazione (fase 4.4b1, Task 27a, I1 e I2) contro un
 * Postgres reale, collegato COME `wasteflow_app` (RLS FORCE).
 *
 * Forma scelta: soglie di TEMPO larghe, mai il testo dell'EXPLAIN. Un nested loop quadratico o una
 * conversione di 500 uuid per ogni riga non sono questione di forma del piano ma di tempo, e il
 * tempo si misura senza dipendere dal formato dell'EXPLAIN ne' dalla versione di Postgres. Le
 * soglie stanno 3-5 volte sotto il valore degenere (13 s e 5 s) e 4-10 volte sopra il valore
 * corretto (0,1-1 s): un autoanalyze che arriva a meta' non rende il test instabile, al piu' lo
 * rende vacuo (mai rosso a torto). Nessun ANALYZE dopo il caricamento (statistiche vecchie, come
 * dopo una copia in massa) e niente ALTER ROLE: il piano generico si forza con `SET LOCAL`.
 * Pulizia per id esatti, anche da un giro interrotto (id su file).
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t27a-piani-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=10`

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaScenarioVolume } from '../../test-support/fatturazione-di-test'
import {
  creaBancoT19,
  PARAMETRI_T19,
  type BancoT19,
} from '../../test-support/fatturazione-t19-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { eseguiAnteprima } from './anteprima'
import { insiemiPerDefinitiva } from './lock-fatturazione'
import { selezionaElaborazione } from './selezione-fatturazione'

const FILE_VOLUME = join(tmpdir(), 'wasteflow-fatt-t27a-piani-tenants.json')
const SOGLIA_SELEZIONE_MS = 4_000
const SOGLIA_CITATI_MS = 3_000
const SOGLIA_GENERICO_MS = 10_000

describe('Piani stabili con statistiche vecchie (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT19
  const tenantCreati: string[] = []
  let tenantId = ''
  let utenteId = ''

  const idSuFile = (): string[] => {
    try {
      const v: unknown = JSON.parse(readFileSync(FILE_VOLUME, 'utf8'))
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    const rimasti = idSuFile()
    if (rimasti.length > 0) {
      await pulisciTenantDiTest(owner, rimasti)
      writeFileSync(FILE_VOLUME, '[]')
    }
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    b = creaBancoT19({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
    b.reset()
    await owner.cERCode.upsert({
      where: { code: '20 03 01' },
      create: { code: '20 03 01', description: 'CER di test', category: '20', subcategory: '' },
      update: {},
    })
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Piani 27a SRL', country: 'IT' },
    })
    tenantId = t.id
    tenantCreati.push(t.id)
    writeFileSync(FILE_VOLUME, JSON.stringify([...idSuFile(), t.id]))
    const utente = await owner.user.create({
      data: {
        tenantId,
        keycloakId: `kc-27a-${randomUUID()}`,
        fiscalCode: `P27${partitaIvaUnica()}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Piani',
        email: `p27a-${randomUUID()}@example.test`,
        role: 'ADMIN',
      },
    })
    utenteId = utente.id
    // 500 contratti e 10.000 legami CONFERMATO, SENZA ANALYZE (statistiche vecchie).
    await creaScenarioVolume(owner, tenantId, { contratti: 500, legami: 10_000 })
    await owner.$executeRawUnsafe(
      `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
      tenantId
    )
  }, 300_000)

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    writeFileSync(FILE_VOLUME, JSON.stringify(idSuFile().filter(id => !tenantCreati.includes(id))))
    await owner.$disconnect()
    await app?.onModuleDestroy()
  }, 300_000)

  it(`I1: la selezione su 10.000 legami con statistiche vecchie resta sotto ${SOGLIA_SELEZIONE_MS} ms (nested loop quadratico: 13 s)`, async () => {
    const t0 = Date.now()
    const sel = await b.nel(tenantId, () =>
      app.$transaction(tx => selezionaElaborazione(tx, tenantId, { ...PARAMETRI_T19 }), {
        timeout: 120_000,
      })
    )
    const ms = Date.now() - t0
    expect(sel.documenti.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(SOGLIA_SELEZIONE_MS)
  }, 180_000)

  it(`I4: la selezione con il piano generico (sesta esecuzione di Prisma) resta sotto ${SOGLIA_GENERICO_MS} ms (cast dell'array per riga: 40-64 s)`, async () => {
    const t0 = Date.now()
    const sel = await b.nel(tenantId, () =>
      app.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = force_generic_plan`)
          return selezionaElaborazione(tx, tenantId, { ...PARAMETRI_T19 })
        },
        { timeout: 170_000 }
      )
    )
    const ms = Date.now() - t0
    expect(sel.documenti.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(SOGLIA_GENERICO_MS)
  }, 200_000)

  it(`I2: le righe citate con il piano generico su 500 documenti restano sotto ${SOGLIA_CITATI_MS} ms (conversione dei 500 uuid per ogni riga: 5 s)`, async () => {
    const { id } = await b.nel(tenantId, () =>
      b.servizio.avvia(tenantId, utenteId, { ...PARAMETRI_T19 })
    )
    await b.nel(tenantId, () => eseguiAnteprima(app, tenantId, id, 1))
    const documentoIds = (await b.documenti(id)).map(d => d.id)
    expect(documentoIds).toHaveLength(500)

    const t0 = Date.now()
    const insiemi = await b.nel(tenantId, () =>
      app.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = force_generic_plan`)
          return insiemiPerDefinitiva(tx, tenantId, documentoIds)
        },
        { timeout: 120_000 }
      )
    )
    const ms = Date.now() - t0
    expect(insiemi.legameIds).toHaveLength(10_000)
    expect(insiemi.rigaIds.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(SOGLIA_CITATI_MS)
  }, 300_000)
})
