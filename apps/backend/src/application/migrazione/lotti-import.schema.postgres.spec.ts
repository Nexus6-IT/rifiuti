/**
 * Fase 3 (3.1), Task 2: `lotti_import` contro un Postgres reale. Il proprietario (`wasteflow`)
 * prepara le aziende; le operazioni sotto prova girano COME `wasteflow_app` / `wasteflow_sistema`
 * nel contesto dell'azienda (RLS FORCE e privilegi veri). La pulizia cancella SOLO le aziende create
 * qui, per id esatto (la cascata porta via i lotti).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

const HASH = 'a'.repeat(64)

describe('Fase 3 (3.1): lotti_import (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'
  )
  const tenantCreati: string[] = []
  let n = 0
  const seme = 7_000_000 + (Date.now() % 2_000_000)

  async function azienda(): Promise<string> {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 19),
          ragioneSociale: 'Import SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    return t
  }

  const campi = (t: string, o: Record<string, string> = {}): Record<string, string> => ({
    tenant_id: t,
    import_source: 'WINWASTE',
    archivio: 'WW00012026',
    ambito: 'ANAGRAFICHE',
    formato_staging: 'winwaste-staging/1',
    hash_staging: HASH,
    updated_at: new Date().toISOString(),
    ...o,
  })

  const insertSql = (c: Record<string, string>) =>
    `INSERT INTO lotti_import (${Object.keys(c).join(', ')}) VALUES (${Object.values(c)
      .map(v => `'${v}'`)
      .join(', ')}) RETURNING id::text AS id`

  const comeApp = <T>(tenantId: string, sql: string, cl: PrismaClient = app) =>
    cl.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      return tx.$queryRawUnsafe<T[]>(sql)
    })

  afterAll(async () => {
    for (const t of tenantCreati) await owner.tenant.delete({ where: { id: t } })
    await owner.$disconnect()
    await app.$disconnect()
    await sistema.$disconnect()
  })

  it('un lotto si inserisce nella propria azienda, con i valori di default', async () => {
    const a = await azienda()
    const [{ id }] = await comeApp<{ id: string }>(a, insertSql(campi(a)))
    const [r] = await comeApp<{ stato: string; conteggi: unknown; concluso_il: Date | null }>(
      a,
      `SELECT stato::text AS stato, conteggi, concluso_il FROM lotti_import WHERE id = '${id}'`
    )
    expect(r.stato).toBe('IN_CORSO')
    expect(r.conteggi).toEqual({})
    expect(r.concluso_il).toBeNull()
  })

  it("l'azienda B non vede i lotti di A, e non puo' inserire con il tenant di A", async () => {
    const a = await azienda()
    const b = await azienda()
    await comeApp(a, insertSql(campi(a)))
    const viste = await comeApp<{ id: string }>(b, `SELECT id::text AS id FROM lotti_import`)
    expect(viste).toEqual([])
    await expect(comeApp(b, insertSql(campi(a)))).rejects.toThrow(/row-level security|42501/i)
  })

  it('DELETE e TRUNCATE sono rifiutati a wasteflow_app e wasteflow_sistema', async () => {
    const a = await azienda()
    await comeApp(a, insertSql(campi(a)))
    for (const c of [app, sistema]) {
      await expect(comeApp(a, `DELETE FROM lotti_import`, c)).rejects.toThrow(
        /42501|permission denied/i
      )
      await expect(c.$executeRawUnsafe(`TRUNCATE lotti_import`)).rejects.toThrow(
        /42501|permission denied/i
      )
    }
  })

  it('un solo IN_CORSO per azienda, archivio e ambito; ammesso dopo COMPLETATO', async () => {
    const a = await azienda()
    const [{ id }] = await comeApp<{ id: string }>(a, insertSql(campi(a)))
    await expect(comeApp(a, insertSql(campi(a)))).rejects.toThrow(/lotti_import_in_corso_key|23505/)
    // altro ambito e altro archivio: ammessi
    await comeApp(a, insertSql(campi(a, { ambito: 'REGISTRO' })))
    await comeApp(a, insertSql(campi(a, { archivio: 'WW00012027' })))
    await comeApp(a, `UPDATE lotti_import SET stato = 'COMPLETATO' WHERE id = '${id}'`)
    await comeApp(a, insertSql(campi(a)))
    // altra azienda, stessi valori: ammesso
    const b = await azienda()
    await comeApp(b, insertSql(campi(b)))
  })

  it('un lotto concluso non si modifica piu e non torna IN_CORSO; da IN_CORSO si conclude', async () => {
    const a = await azienda()
    const [{ id }] = await comeApp<{ id: string }>(a, insertSql(campi(a)))
    await comeApp(a, `UPDATE lotti_import SET conteggi = '{"lette":1}' WHERE id = '${id}'`)
    await comeApp(a, `UPDATE lotti_import SET stato = 'COMPLETATO' WHERE id = '${id}'`)
    await expect(
      comeApp(a, `UPDATE lotti_import SET stato = 'IN_CORSO' WHERE id = '${id}'`)
    ).rejects.toThrow(/gia' concluso|23000/)
    await expect(
      comeApp(a, `UPDATE lotti_import SET conteggi = '{"lette":9}' WHERE id = '${id}'`)
    ).rejects.toThrow(/gia' concluso|23000/)
    await expect(
      comeApp(a, `UPDATE lotti_import SET stato = 'ANNULLATO' WHERE id = '${id}'`)
    ).rejects.toThrow(/gia' concluso|23000/)
  })

  it('archivio fuori formato rifiutato', async () => {
    const a = await azienda()
    for (const archivio of ['WW0001202', 'WW000120266', 'ww00012026', 'XX00012026', 'WW0001202A']) {
      await expect(comeApp(a, insertSql(campi(a, { archivio })))).rejects.toThrow(
        /lotti_import_archivio_check|23514|value too long/
      )
    }
  })

  it('hash_staging non esadecimale minuscolo di 64 rifiutato', async () => {
    const a = await azienda()
    for (const hash_staging of ['a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
      await expect(comeApp(a, insertSql(campi(a, { hash_staging })))).rejects.toThrow(
        /lotti_import_hash_staging_check|23514|value too long/
      )
    }
  })

  it('import_source fuori elenco rifiutato', async () => {
    const a = await azienda()
    await expect(comeApp(a, insertSql(campi(a, { import_source: 'ALTRO' })))).rejects.toThrow(
      /lotti_import_import_source_check|23514/
    )
  })

  it('la cascata da tenants (proprietario) riesce con lotti presenti', async () => {
    const a = await azienda()
    await comeApp(a, insertSql(campi(a)))
    await owner.tenant.delete({ where: { id: a } })
    tenantCreati.splice(tenantCreati.indexOf(a), 1)
    const [r] = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM lotti_import WHERE tenant_id = '${a}'`
    )
    expect(Number(r.n)).toBe(0)
  })
})
