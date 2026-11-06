/**
 * Volume della lista degli scostamenti (fase 4.4b1, Task 21, Q32) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS FORCE): 200.000 movimenti e 200.000 legami in un solo tenant,
 * 60 documenti definitivi e 40 scostamenti aperti. La pagina deve stare sotto 1 s e le sue query
 * non devono leggere i movimenti con una scansione sequenziale (le righe dei documenti sono
 * 60: la sequenziale su una tabella cosi piccola e il piano giusto). Fixture a blocchi (col
 * proprietario), pulizia solo per id esatti; le aziende di volume rimaste da un giro interrotto
 * si ripuliscono dai loro id, scritti su file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t21-vol-${process.pid}`
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
import { creaDocumentoDiTest, creaScenarioVolume } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import {
  ScostamentiService,
  sqlPaginaScostamenti,
  sqlRigheDellaPagina,
  sqlMovimentiPerId,
  sqlTotaleScostamenti,
} from './scostamenti.service'

const FILE_VOLUME = join(tmpdir(), 'wasteflow-fatt-t21-volume-tenants.json')
const MOVIMENTI = 200_000
const DOCUMENTI = 60
const SCOSTAMENTI = 40
const BLOCCO_FATTURATO = 5_000

describe(`Scostamenti — volume: ${MOVIMENTI} movimenti nel tenant`, () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ScostamentiService
  const tenantCreati: string[] = []
  let tenantId = ''
  let legamiScostati: string[] = []

  const idSuFile = (): string[] => {
    try {
      const v: unknown = JSON.parse(readFileSync(FILE_VOLUME, 'utf8'))
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  const analizza = async (): Promise<void> => {
    for (const tabella of [
      'waste_movements',
      'legami_movimento',
      'righe_legame_movimento',
      'documenti_fattura',
      'righe_documento_fattura',
    ]) {
      await owner.$executeRawUnsafe(`ANALYZE ${tabella}`)
    }
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new ScostamentiService(app)
    const rimasti = idSuFile()
    if (rimasti.length > 0) {
      await pulisciTenantDiTest(owner, rimasti)
      writeFileSync(FILE_VOLUME, '[]')
    }

    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Volume scostamenti SRL',
        country: 'IT',
      },
    })
    tenantId = t.id
    tenantCreati.push(t.id)
    writeFileSync(FILE_VOLUME, JSON.stringify([...idSuFile(), t.id]))

    const volume = await creaScenarioVolume(owner, t.id, { contratti: 500, legami: MOVIMENTI })
    // Statistiche vere PRIMA di creare i documenti (come in produzione): senza, un piano scelto
    // sulle statistiche di una tabella a meta' caricamento puo' girare per ore.
    await analizza()
    // I primi DOCUMENTI legami stanno su contratti diversi: un documento ciascuno, in date diverse.
    const fatturati = volume.legamiIds.slice(0, DOCUMENTI)
    let primoDocumento = ''
    for (const [i, legameId] of fatturati.entries()) {
      const { documentoId } = await creaDocumentoDiTest(owner, t.id, {
        stato: 'DEFINITIVO',
        registroIvaId: volume.registroIvaId,
        anno: 2026,
        dataDocumento: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
        legamiIds: [legameId],
      })
      if (i === 0) primoDocumento = documentoId
    }
    // I4: in esercizio quasi tutti i legami finiscono FATTURATO e ci restano. Gli altri 199.940 si
    // portano a FATTURATO (a blocchi, col proprietario) sul primo documento: nessuno ha scostamento.
    const resto = volume.legamiIds.slice(DOCUMENTI)
    for (let da = 0; da < resto.length; da += BLOCCO_FATTURATO) {
      await owner.$executeRawUnsafe(
        `UPDATE legami_movimento
         SET stato = 'FATTURATO', fatturato_il = now(), documento_id = $3::uuid,
             riferimento_fattura = '1', updated_at = now()
         WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
        t.id,
        resto.slice(da, da + BLOCCO_FATTURATO),
        primoDocumento
      )
    }
    legamiScostati = fatturati.slice(0, SCOSTAMENTI)
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento SET scostamento_dopo_fattura = true, scostamento_il = now()
       WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
      t.id,
      legamiScostati
    )
    await analizza()
  }, 900_000)

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    writeFileSync(FILE_VOLUME, JSON.stringify(idSuFile().filter(id => !tenantCreati.includes(id))))
    await owner.$disconnect()
    await app?.$disconnect()
  }, 900_000)

  const nel = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId }, async () => await fn())

  it(`${MOVIMENTI} movimenti nel tenant: il tenant ne ha davvero tanti, quasi tutti FATTURATO`, async () => {
    const [r] = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM waste_movements WHERE tenant_id = $1::uuid`,
      tenantId
    )
    expect(r.n).toBe(MOVIMENTI)
    const [f] = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM legami_movimento WHERE tenant_id = $1::uuid AND stato = 'FATTURATO'`,
      tenantId
    )
    expect(f.n).toBe(MOVIMENTI)
  })

  it('una pagina da 25 sta sotto 1 s e riporta solo gli scostamenti aperti', async () => {
    const t0 = Date.now()
    const p = await nel(() => servizio.lista(tenantId, { pagina: 1, dimensione: 25 }))
    const ms = Date.now() - t0
    console.log(`lista: pagina da 25 + totale in ${ms} ms`)
    expect(ms).toBeLessThan(1000)
    expect(p.totale).toBe(SCOSTAMENTI)
    expect(p.elementi).toHaveLength(25)
    const seconda = await nel(() => servizio.lista(tenantId, { pagina: 2, dimensione: 25 }))
    expect(seconda.elementi).toHaveLength(SCOSTAMENTI - 25)
    const visti = new Set([...p.elementi, ...seconda.elementi].map(e => e.legameId))
    expect([...visti].sort()).toEqual([...legamiScostati].sort())
  })

  it('EXPLAIN delle query della pagina: nessuna Seq Scan su waste_movements', async () => {
    const ids = legamiScostati.slice(0, 25)
    const documenti = (
      await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT documento_id::text AS id FROM legami_movimento WHERE id = ANY($1::uuid[])`,
        ids
      )
    ).map(r => r.id)
    const vigenti = (
      await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT movimento_vigente_id::text AS id FROM legami_movimento WHERE id = ANY($1::uuid[])`,
        ids
      )
    ).map(r => r.id)
    const query: [string, Prisma.Sql][] = [
      ['pagina', sqlPaginaScostamenti(tenantId, undefined, 25, 0)],
      ['totale', sqlTotaleScostamenti(tenantId, undefined)],
      ['teste', sqlMovimentiPerId(tenantId, vigenti)],
      ['righe', sqlRigheDellaPagina(tenantId, ids, documenti)],
    ]
    for (const [nome, sql] of query) {
      const piano = await nel(() =>
        app.$transaction(async tx => {
          const righe = await tx.$queryRawUnsafe<Record<string, string>[]>(
            `EXPLAIN (ANALYZE) ${sql.text}`,
            ...sql.values
          )
          return righe.map(r => Object.values(r)[0]).join('\n')
        })
      )
      console.log(`${nome}: ${/Execution Time: .*/.exec(piano)?.[0] ?? '?'}`)
      expect({ nome, piano }).toEqual({
        nome,
        piano: expect.not.stringMatching(/Seq Scan on waste_movements/),
      })
    }
  })
})
