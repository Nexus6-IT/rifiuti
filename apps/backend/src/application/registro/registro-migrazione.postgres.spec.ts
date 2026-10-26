import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'

/**
 * Migration M1 della Fase 2 pezzo 1 (`20261027100000_registro_per_sede`) contro un Postgres
 * reale: crea un database vuoto, applica le migration PRECEDENTI con `prisma migrate deploy`,
 * inserisce dati "vecchi" (movimenti senza registro), applica M1 con `prisma db execute` e
 * verifica backfill, vincoli, trigger e RLS. Niente `psql`: in CI non e' garantito.
 *
 * Le migration le esegue il ruolo del database di test (`wasteflow`, superuser con BYPASSRLS,
 * come in produzione): con la RLS FORCE accesa un ruolo soggetto alle policy non vedrebbe le
 * righe da migrare.
 */
const MIGRATION_M1 = '20261027100000_registro_per_sede'
const BACKEND = path.resolve(__dirname, '..', '..', '..')
const MIGRAZIONI = path.join(BACKEND, 'prisma', 'migrations')
const BASE_URL = (
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
).replace(/\/[^/?]*(\?.*)?$/, '')
const PRISMA_CLI = require.resolve('prisma/build/index.js')

function prismaCli(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('Migration M1 — registro per sede (Postgres reale)', () => {
  const nomeDb = `wasteflow_mig_${Date.now()}`
  const urlDb = `${BASE_URL}/${nomeDb}?schema=public`
  const cartellaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-registro-'))
  let admin: PrismaClient
  let db: PrismaClient
  let app: PrismaClient

  const T = {
    principale: randomUUID(), // sede principale + sede secondaria, 3 movimenti, progressivo iniziale
    senzaSede: randomUUID(), // nessuna sede, 1 movimento
    dueSedi: randomUUID(), // due sedi, nessuna principale, 1 movimento
    unaSede: randomUUID(), // una sola sede non principale, 1 movimento
    senzaMovimenti: randomUUID(), // una sede e nessun movimento
    soloProgressivo: randomUUID(), // nessun movimento, solo progressivo iniziale
    altra: randomUUID(), // azienda "altra", per i test fra tenant
  }
  const S = {
    principale: randomUUID(),
    secondaria: randomUUID(),
    dueA: randomUUID(),
    dueB: randomUUID(),
    una: randomUUID(),
    senzaMov: randomUUID(),
    altra: randomUUID(),
  }

  const q = (sql: string) => db.$executeRawUnsafe(sql)
  const sel = <R>(sql: string) => db.$queryRawUnsafe<R[]>(sql)

  async function azienda(id: string, n: number) {
    await q(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ('${id}', now(), 'MIG${n}0000000', 'Azienda ${n}')`
    )
  }
  async function sede(id: string, tenant: string, n: number, principale: boolean, nome: string) {
    await q(
      `INSERT INTO rentri_unita_locali (id, tenant_id, updated_at, num_iscr_sito, denominazione, principale)
       VALUES ('${id}', '${tenant}', now(), 'OP0001ABC00000${n}-MI0001', '${nome}', ${principale})`
    )
  }
  async function movimento(tenant: string, anno: number, numero: number) {
    await q(
      `INSERT INTO waste_movements (tenant_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
       VALUES ('${tenant}', now(), 'CARICO', '99 99 02', 1, now(), ${numero}, ${anno}, 'produzione')`
    )
  }
  async function progressivo(tenant: string, anno: number, primo: number) {
    await q(
      `INSERT INTO registro_progressivi_iniziali (tenant_id, anno, primo_progressivo, motivo, impostato_da)
       VALUES ('${tenant}', ${anno}, ${primo}, 'migrazione da altro programma', '${randomUUID()}')`
    )
  }
  const registriDi = (tenant: string) =>
    sel<{
      id: string
      unita_locale_id: string | null
      descrizione: string
      updated_at: Date | null
      codice: string
    }>(
      `SELECT id, unita_locale_id, descrizione, updated_at, codice FROM registri_rifiuti WHERE tenant_id = '${tenant}'`
    )

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: `${BASE_URL}/postgres` } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE ${nomeDb}`)

    // schema + migration precedenti a M1 + lock, in una cartella temporanea
    fs.copyFileSync(
      path.join(BACKEND, 'prisma', 'schema.prisma'),
      path.join(cartellaTmp, 'schema.prisma')
    )
    const mig = path.join(cartellaTmp, 'migrations')
    fs.mkdirSync(mig)
    fs.copyFileSync(
      path.join(MIGRAZIONI, 'migration_lock.toml'),
      path.join(mig, 'migration_lock.toml')
    )
    for (const nome of fs.readdirSync(MIGRAZIONI)) {
      if (nome === 'migration_lock.toml' || nome >= MIGRATION_M1) continue
      fs.cpSync(path.join(MIGRAZIONI, nome), path.join(mig, nome), { recursive: true })
    }
    prismaCli(['migrate', 'deploy', '--schema', path.join(cartellaTmp, 'schema.prisma')], urlDb)

    db = new PrismaClient({ datasources: { db: { url: urlDb } } })
    await db.$connect()
    app = clientComeRuolo(
      'wasteflow_app',
      process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
      urlDb
    )

    // dati "vecchi": movimenti e progressivi senza registro
    let n = 1
    for (const t of Object.values(T)) await azienda(t, n++)
    await sede(S.principale, T.principale, 1, true, 'Sede di Milano')
    await sede(S.secondaria, T.principale, 2, false, 'Sede di Torino')
    await sede(S.dueA, T.dueSedi, 3, false, 'Sede A')
    await sede(S.dueB, T.dueSedi, 4, false, 'Sede B')
    await sede(S.una, T.unaSede, 5, false, 'Sede unica')
    await sede(S.senzaMov, T.senzaMovimenti, 6, true, 'Sede vuota')
    await sede(S.altra, T.altra, 7, true, 'Sede altra azienda')
    for (const numero of [1, 2, 3]) await movimento(T.principale, 2026, numero)
    await progressivo(T.principale, 2026, 1)
    await movimento(T.senzaSede, 2026, 1)
    await movimento(T.dueSedi, 2026, 1)
    await movimento(T.unaSede, 2026, 1)
    await progressivo(T.soloProgressivo, 2026, 50)

    // M1
    prismaCli(
      [
        'db',
        'execute',
        '--file',
        path.join(MIGRAZIONI, MIGRATION_M1, 'migration.sql'),
        '--schema',
        path.join(cartellaTmp, 'schema.prisma'),
      ],
      urlDb
    )
  }, 240_000)

  afterAll(async () => {
    await app?.$disconnect()
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`)
      await admin.$disconnect()
    }
    fs.rmSync(cartellaTmp, { recursive: true, force: true })
  })

  it("migrazione: movimenti e progressivo iniziale esistenti finiscono nel registro dell'azienda, legato alla sede principale", async () => {
    const registri = await registriDi(T.principale)
    expect(registri).toHaveLength(1)
    expect(registri[0].unita_locale_id).toBe(S.principale)
    expect(registri[0].codice).toBe('CARICO_SCARICO')
    expect(registri[0].descrizione).toBe('Registro Sede di Milano')
    const mov = await sel<{ n: number }>(
      `SELECT count(*)::int AS n FROM waste_movements WHERE tenant_id = '${T.principale}' AND registro_id = '${registri[0].id}'`
    )
    expect(mov[0].n).toBe(3)
    const prog = await sel<{ registro_id: string }>(
      `SELECT registro_id FROM registro_progressivi_iniziali WHERE tenant_id = '${T.principale}'`
    )
    expect(prog[0].registro_id).toBe(registri[0].id)
  })

  it('migrazione: azienda senza sede RENTRI → registro senza sede, movimenti migrati', async () => {
    const registri = await registriDi(T.senzaSede)
    expect(registri).toHaveLength(1)
    expect(registri[0].unita_locale_id).toBeNull()
    expect(registri[0].descrizione).toBe('Registro cronologico')
    const mov = await sel<{ registro_id: string }>(
      `SELECT registro_id FROM waste_movements WHERE tenant_id = '${T.senzaSede}'`
    )
    expect(mov[0].registro_id).toBe(registri[0].id)
  })

  it('migrazione: azienda con due sedi e nessuna principale → registro senza sede, nessuna scelta indovinata', async () => {
    const registri = await registriDi(T.dueSedi)
    expect(registri).toHaveLength(1)
    expect(registri[0].unita_locale_id).toBeNull()
  })

  it('migrazione: azienda con una sola sede non principale → registro su quella sede', async () => {
    const registri = await registriDi(T.unaSede)
    expect(registri).toHaveLength(1)
    expect(registri[0].unita_locale_id).toBe(S.una)
  })

  it('migrazione: azienda senza movimenti non ottiene nessun registro', async () => {
    expect(await registriDi(T.senzaMovimenti)).toHaveLength(0)
    expect(await registriDi(T.altra)).toHaveLength(0)
  })

  it('migrazione: azienda con solo un progressivo iniziale ottiene il registro e il progressivo vi si aggancia', async () => {
    const registri = await registriDi(T.soloProgressivo)
    expect(registri).toHaveLength(1)
    const prog = await sel<{ registro_id: string }>(
      `SELECT registro_id FROM registro_progressivi_iniziali WHERE tenant_id = '${T.soloProgressivo}'`
    )
    expect(prog[0].registro_id).toBe(registri[0].id)
  })

  it('migrazione: i registri creati dal backfill hanno updated_at valorizzato', async () => {
    const r = await sel<{ n: number }>(
      `SELECT count(*)::int AS n FROM registri_rifiuti WHERE updated_at IS NULL`
    )
    expect(r[0].n).toBe(0)
    const tot = await sel<{ n: number }>(`SELECT count(*)::int AS n FROM registri_rifiuti`)
    expect(tot[0].n).toBe(5)
  })

  it('migrazione: nessun movimento ne progressivo resta senza registro dopo il backfill', async () => {
    const r = await sel<{ a: number; b: number }>(
      `SELECT (SELECT count(*)::int FROM waste_movements WHERE registro_id IS NULL) AS a,
              (SELECT count(*)::int FROM registro_progressivi_iniziali WHERE registro_id IS NULL) AS b`
    )
    expect(r[0]).toEqual({ a: 0, b: 0 })
  })

  it('migrazione: due registri della stessa azienda possono avere lo stesso progressivo; lo stesso registro no', async () => {
    // Il vecchio unico per azienda resta fino a M2 (Task 3): qui lo si toglie in una
    // transazione annullata, per provare che il NUOVO indice (registro, anno, numero) basta.
    const regA = (await registriDi(T.principale))[0].id
    const regB = randomUUID()
    await expect(
      db.$transaction(async tx => {
        await tx.$executeRawUnsafe(
          `ALTER TABLE waste_movements DROP CONSTRAINT "waste_movements_tenant_id_progressive_year_progressive_numb_key"`
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO registri_rifiuti (id, tenant_id, updated_at, unita_locale_id, descrizione) VALUES ('${regB}', '${T.principale}', now(), '${S.secondaria}', 'Registro Sede di Torino')`
        )
        // stesso numero 2026/1 in un altro registro: ammesso
        await tx.$executeRawUnsafe(
          `INSERT INTO waste_movements (tenant_id, registro_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
           VALUES ('${T.principale}', '${regB}', now(), 'CARICO', '99 99 02', 1, now(), 1, 2026, 'produzione')`
        )
        // stesso numero nello stesso registro: rifiutato
        let rifiutato = false
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO waste_movements (tenant_id, registro_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
             VALUES ('${T.principale}', '${regA}', now(), 'CARICO', '99 99 02', 1, now(), 1, 2026, 'produzione')`
          )
        } catch (e) {
          if (!/23505/.test(String(e))) throw e
          rifiutato = true
        }
        if (!rifiutato) throw new Error('lo stesso registro ha accettato un progressivo duplicato')
        throw new Error('ANNULLA')
      })
    ).rejects.toThrow('ANNULLA')
  })

  it("migrazione: un'azienda può avere un solo registro senza sede per codice", async () => {
    await expect(
      q(
        `INSERT INTO registri_rifiuti (tenant_id, updated_at, descrizione) VALUES ('${T.senzaSede}', now(), 'Secondo senza sede')`
      )
    ).rejects.toThrow(/23505/)
    // un altro codice, invece, e' ammesso (la tabella prevede altri registri)
    await q(
      `INSERT INTO registri_rifiuti (tenant_id, updated_at, descrizione, codice) VALUES ('${T.senzaSede}', now(), 'Altro codice', 'ALTRO')`
    )
    await q(`DELETE FROM registri_rifiuti WHERE tenant_id = '${T.senzaSede}' AND codice = 'ALTRO'`)
  })

  it('migrazione: un movimento non può puntare a un registro di un altro tenant (chiave esterna composta)', async () => {
    const regAltrui = (await registriDi(T.principale))[0].id
    await expect(
      q(
        `INSERT INTO waste_movements (tenant_id, registro_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
         VALUES ('${T.altra}', '${regAltrui}', now(), 'CARICO', '99 99 02', 1, now(), 9, 2026, 'produzione')`
      )
    ).rejects.toThrow(/23503/)
    await expect(
      q(
        `INSERT INTO registro_progressivi_iniziali (tenant_id, registro_id, anno, primo_progressivo, motivo, impostato_da)
         VALUES ('${T.altra}', '${regAltrui}', 2027, 1, 'x', '${randomUUID()}')`
      )
    ).rejects.toThrow(/23503/)
  })

  it('migrazione: un registro non può puntare a una sede di un altro tenant (trigger di coerenza del tenant)', async () => {
    await expect(
      q(
        `INSERT INTO registri_rifiuti (tenant_id, updated_at, unita_locale_id, descrizione) VALUES ('${T.altra}', now(), '${S.principale}', 'Registro abusivo')`
      )
    ).rejects.toThrow(/la sede del registro appartiene a un altro tenant/)
  })

  it("migrazione: il trigger di coerenza del tenant regge anche col ruolo app sotto RLS (la sede altrui e' invisibile)", async () => {
    // Il ruolo wasteflow_app (NOBYPASSRLS) esiste a livello di cluster (ops/db-ruoli.sh); nel
    // database temporaneo gli si danno i privilegi che gli darebbero i default privileges.
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO wasteflow_app`)
    await db.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wasteflow_app`
    )
    await expect(
      app.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${T.altra}', true)`)
        // la RLS nasconde la sede di T.principale: senza il controllo fail-closed passerebbe
        await tx.$executeRawUnsafe(
          `INSERT INTO registri_rifiuti (tenant_id, updated_at, unita_locale_id, descrizione) VALUES ('${T.altra}', now(), '${S.principale}', 'Registro abusivo')`
        )
      })
    ).rejects.toThrow(/la sede del registro appartiene a un altro tenant/)
    // controprova: la propria sede si accetta
    await app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${T.altra}', true)`)
      await tx.$executeRawUnsafe(
        `INSERT INTO registri_rifiuti (tenant_id, updated_at, unita_locale_id, descrizione) VALUES ('${T.altra}', now(), '${S.altra}', 'Registro proprio')`
      )
    })
    await db.$executeRawUnsafe(`DELETE FROM registri_rifiuti WHERE tenant_id = '${T.altra}'`)
  })

  it("migrazione: unita_locale_id passa da NULL a un valore ma non da una sede a un'altra (trigger)", async () => {
    const reg = (await registriDi(T.dueSedi))[0].id
    await q(`UPDATE registri_rifiuti SET unita_locale_id = '${S.dueA}' WHERE id = '${reg}'`)
    await expect(
      q(`UPDATE registri_rifiuti SET unita_locale_id = '${S.dueB}' WHERE id = '${reg}'`)
    ).rejects.toThrow(/unita_locale_id di un registro non si cambia dopo l'aggancio/)
    await expect(
      q(`UPDATE registri_rifiuti SET unita_locale_id = NULL WHERE id = '${reg}'`)
    ).rejects.toThrow(/unita_locale_id di un registro non si cambia dopo l'aggancio/)
  })

  it('migrazione: una sede con un registro non si cancella', async () => {
    await expect(q(`DELETE FROM rentri_unita_locali WHERE id = '${S.principale}'`)).rejects.toThrow(
      /23503/
    )
    // una sede senza registro si cancella
    await q(`DELETE FROM rentri_unita_locali WHERE id = '${S.senzaMov}'`)
  })

  it('migrazione: registri_rifiuti ha RLS attiva e forzata, policy di isolamento e sola lettura', async () => {
    const t = await sel<{ rls: boolean; forzata: boolean }>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class WHERE relname = 'registri_rifiuti'`
    )
    expect(t[0]).toEqual({ rls: true, forzata: true })
    const p = await sel<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'registri_rifiuti' ORDER BY policyname`
    )
    expect(p.map(x => x.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
  })
})

/**
 * Migration M2 (`20261027110000_registro_obbligatorio`): database vuoto con le migration fino a
 * M1 compresa; prima un movimento SENZA registro (M2 deve fermarsi con un messaggio chiaro e non
 * cambiare nulla), poi, sanato il dato, M2 applicata: `registro_id` obbligatorio, vecchi vincoli
 * per azienda tolti, nuovi per registro presenti.
 */
describe('Migration M2 — registro obbligatorio (Postgres reale)', () => {
  const M2 = '20261027110000_registro_obbligatorio'
  const nomeDb = `wasteflow_mig2_${Date.now()}`
  const urlDb = `${BASE_URL}/${nomeDb}?schema=public`
  const cartellaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-registro-m2-'))
  const tenant = randomUUID()
  const registro = randomUUID()
  let admin: PrismaClient
  let db: PrismaClient
  const schemaTmp = path.join(cartellaTmp, 'schema.prisma')
  const q = (sql: string) => db.$executeRawUnsafe(sql)
  const sel = <R>(sql: string) => db.$queryRawUnsafe<R[]>(sql)
  const applicaM2 = () =>
    prismaCli(
      [
        'db',
        'execute',
        '--file',
        path.join(MIGRAZIONI, M2, 'migration.sql'),
        '--schema',
        schemaTmp,
      ],
      urlDb
    )

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: `${BASE_URL}/postgres` } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE ${nomeDb}`)
    fs.copyFileSync(path.join(BACKEND, 'prisma', 'schema.prisma'), schemaTmp)
    const mig = path.join(cartellaTmp, 'migrations')
    fs.mkdirSync(mig)
    fs.copyFileSync(
      path.join(MIGRAZIONI, 'migration_lock.toml'),
      path.join(mig, 'migration_lock.toml')
    )
    for (const nome of fs.readdirSync(MIGRAZIONI)) {
      if (nome === 'migration_lock.toml' || nome >= M2) continue
      fs.cpSync(path.join(MIGRAZIONI, nome), path.join(mig, nome), { recursive: true })
    }
    prismaCli(['migrate', 'deploy', '--schema', schemaTmp], urlDb)
    db = new PrismaClient({ datasources: { db: { url: urlDb } } })
    await db.$connect()
    await q(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ('${tenant}', now(), 'MIGM2000000', 'Azienda M2')`
    )
    await q(
      `INSERT INTO registri_rifiuti (id, tenant_id, updated_at, descrizione) VALUES ('${registro}', '${tenant}', now(), 'Registro')`
    )
    const mov = (numero: number, reg: string) =>
      q(
        `INSERT INTO waste_movements (tenant_id, registro_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
         VALUES ('${tenant}', ${reg}, now(), 'CARICO', '99 99 02', 1, now(), ${numero}, 2026, 'produzione')`
      )
    await mov(1, `'${registro}'`)
    await mov(2, 'NULL') // movimento senza registro: M2 deve fermarsi
  }, 240_000)

  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`)
      await admin.$disconnect()
    }
    fs.rmSync(cartellaTmp, { recursive: true, force: true })
  })

  it('M2: M2 fallisce con un messaggio chiaro se resta un movimento senza registro', async () => {
    let messaggio = ''
    try {
      applicaM2()
    } catch (e) {
      messaggio = `${(e as Error).message}\n${String((e as { stderr?: unknown }).stderr ?? '')}`
    }
    expect(messaggio).toMatch(
      /M2 registro_obbligatorio: 1 movimenti e 0 progressivi iniziali senza registro/
    )
    // nessuna modifica a meta': la colonna e' ancora nullable
    const [c] = await sel<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'waste_movements' AND column_name = 'registro_id'`
    )
    expect(c.is_nullable).toBe('YES')
  })

  it('M2: registro_id è NOT NULL', async () => {
    await q(`UPDATE waste_movements SET registro_id = '${registro}' WHERE registro_id IS NULL`)
    applicaM2()
    const colonne = await sel<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'registro_id' AND table_name IN ('waste_movements', 'registro_progressivi_iniziali')
       ORDER BY table_name`
    )
    expect(colonne.map(c => [c.table_name, c.is_nullable])).toEqual([
      ['registro_progressivi_iniziali', 'NO'],
      ['waste_movements', 'NO'],
    ])
    await expect(
      q(
        `INSERT INTO waste_movements (tenant_id, updated_at, type, cer_code, quantity, movement_date, progressive_number, progressive_year, causale)
         VALUES ('${tenant}', now(), 'CARICO', '99 99 02', 1, now(), 9, 2026, 'produzione')`
      )
    ).rejects.toThrow(/23502/)
  })

  it('M2: il vecchio vincolo (tenant, anno, numero) non esiste più e quello per registro sì', async () => {
    const nomi = (
      await sel<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'waste_movements'`
      )
    ).map(i => i.indexname)
    expect(nomi).toContain('waste_movements_registro_id_progressive_year_progressive_nu_key')
    expect(nomi).not.toContain('waste_movements_tenant_id_progressive_year_progressive_numb_key')
    const indici = (
      await sel<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'registro_progressivi_iniziali'`
      )
    ).map(i => i.indexname)
    expect(indici).not.toContain('registro_progressivi_iniziali_tenant_id_anno_key')
    expect(indici).toContain('registro_progressivi_iniziali_registro_id_anno_key')
  })
})
