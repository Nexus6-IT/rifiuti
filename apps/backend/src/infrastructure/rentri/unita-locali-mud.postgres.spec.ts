import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { urlComeRuolo } from '../database/client-come-ruolo'
import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from '../persistence/prisma.service'
import { RentriUnitaLocaleService } from './rentri-unita-locale.service'

/**
 * Migration `20261031130000_unita_locali_mud` (Fase 2 pezzo 8, D4/D5/D21) contro un Postgres reale:
 * crea un database vuoto, applica le migration PRECEDENTI con `prisma migrate deploy`, inserisce
 * sedi "vecchie" (senza codice MUD), applica la nuova con `prisma db execute` e verifica backfill,
 * trigger, indice unico e CHECK. I test del trigger passano anche dal ruolo `wasteflow_app` dentro
 * il `TenantContext` (RLS ENABLE+FORCE) e dal servizio vero.
 *
 * Le migration le esegue il ruolo del database di test (`wasteflow`, superuser con BYPASSRLS,
 * come in produzione): il backfill non e' soggetto a FORCE ROW LEVEL SECURITY.
 */
const MIGRATION = '20261031130000_unita_locali_mud'
const BACKEND = path.resolve(__dirname, '..', '..', '..')
const MIGRAZIONI = path.join(BACKEND, 'prisma', 'migrations')
const URL_ORIGINALE =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
const BASE_URL = URL_ORIGINALE.replace(/\/[^/?]*(\?.*)?$/, '')
const PRISMA_CLI = require.resolve('prisma/build/index.js')

function prismaCli(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('Migration unita_locali_mud — codice MUD e anagrafica delle sedi (Postgres reale)', () => {
  const nomeDb = `wasteflow_ulmud_${Date.now()}`
  const urlDb = `${BASE_URL}/${nomeDb}?schema=public`
  const cartellaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-ulmud-'))
  let admin: PrismaClient
  let db: PrismaClient
  let app: PrismaService
  let servizio: RentriUnitaLocaleService

  const T = {
    vecchia: randomUUID(), // 3 sedi create prima della migration, la principale è la più recente
    altra: randomUUID(), // 2 sedi create prima della migration
    batch: randomUUID(), // createMany
    sync: randomUUID(), // upsertFromRentri
    esplicito: randomUUID(), // progressivo esplicito
    unico: randomUUID(), // vincolo di unicità
    check: randomUUID(), // CHECK
    cambio: randomUUID(), // cambio della principale
    lock: randomUUID(), // inserimenti concorrenti
  }
  const S = {
    vPrincipale: randomUUID(),
    vPrima: randomUUID(),
    vSeconda: randomUUID(),
    aPrincipale: randomUUID(),
    aSeconda: randomUUID(),
  }

  const q = (sql: string) => db.$executeRawUnsafe(sql)
  const sel = <R>(sql: string) => db.$queryRawUnsafe<R[]>(sql)
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(id: string, n: number) {
    await q(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ('${id}', now(), 'ULM${n}0000000', 'Azienda ${n}')`
    )
  }
  let contatore = 0
  const iscrizione = () => `OP0001ABC${String(++contatore).padStart(6, '0')}-MI0001`
  async function sedeVecchia(
    id: string,
    tenant: string,
    principale: boolean,
    creataIl: string,
    nome: string
  ) {
    await q(
      `INSERT INTO rentri_unita_locali (id, tenant_id, created_at, updated_at, num_iscr_sito, denominazione, principale)
       VALUES ('${id}', '${tenant}', '${creataIl}', now(), '${iscrizione()}', '${nome}', ${principale})`
    )
  }
  const progressiviDi = async (tenant: string) =>
    Object.fromEntries(
      (
        await sel<{ id: string; denominazione: string; progressivo_mud: number }>(
          `SELECT id, denominazione, progressivo_mud FROM rentri_unita_locali WHERE tenant_id = '${tenant}'`
        )
      ).map(r => [r.denominazione, r.progressivo_mud])
    ) as Record<string, number>

  beforeAll(async () => {
    expect(URL_ORIGINALE).toMatch(/@(127\.0\.0\.1|localhost):(55432|55436)\/wasteflow_ci\b/)
    admin = new PrismaClient({ datasources: { db: { url: `${BASE_URL}/postgres` } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE ${nomeDb}`)

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
      if (nome === 'migration_lock.toml' || nome >= MIGRATION) continue
      fs.cpSync(path.join(MIGRAZIONI, nome), path.join(mig, nome), { recursive: true })
    }
    prismaCli(['migrate', 'deploy', '--schema', path.join(cartellaTmp, 'schema.prisma')], urlDb)

    db = new PrismaClient({ datasources: { db: { url: urlDb } } })
    await db.$connect()

    // dati "vecchi": sedi senza codice MUD (la colonna non esiste ancora)
    let n = 1
    for (const t of Object.values(T)) await azienda(t, n++)
    await sedeVecchia(S.vSeconda, T.vecchia, false, '2026-03-01', 'Seconda')
    await sedeVecchia(S.vPrima, T.vecchia, false, '2026-01-01', 'Prima')
    await sedeVecchia(S.vPrincipale, T.vecchia, true, '2026-05-01', 'Principale')
    await sedeVecchia(S.aSeconda, T.altra, false, '2026-02-01', 'Altra seconda')
    await sedeVecchia(S.aPrincipale, T.altra, true, '2026-04-01', 'Altra principale')

    prismaCli(
      [
        'db',
        'execute',
        '--file',
        path.join(MIGRAZIONI, MIGRATION, 'migration.sql'),
        '--schema',
        path.join(cartellaTmp, 'schema.prisma'),
      ],
      urlDb
    )

    // wasteflow_app esiste a livello di cluster (ops/db-ruoli.sh); nel database temporaneo servono i privilegi
    await q(`GRANT USAGE ON SCHEMA public TO wasteflow_app`)
    await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wasteflow_app`)

    // il servizio dell'applicazione, collegato COME wasteflow_app al database temporaneo
    process.env.DATABASE_URL = urlComeRuolo(
      'wasteflow_app',
      process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
      urlDb
    )
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [ruolo] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(ruolo.u).toBe('wasteflow_app')
    servizio = new RentriUnitaLocaleService(app)
  }, 240_000)

  afterAll(async () => {
    process.env.DATABASE_URL = URL_ORIGINALE
    await app?.onModuleDestroy()
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`)
      await admin.$disconnect()
    }
    fs.rmSync(cartellaTmp, { recursive: true, force: true })
  })

  it('backfill: la principale prende 1, le altre seguono per data di creazione', async () => {
    expect(await progressiviDi(T.vecchia)).toEqual({ Principale: 1, Prima: 2, Seconda: 3 })
  })

  it('backfill: i progressivi ripartono da 1 per ogni azienda', async () => {
    expect(await progressiviDi(T.altra)).toEqual({ 'Altra principale': 1, 'Altra seconda': 2 })
  })

  it("trigger: una sede nuova prende il massimo dell'azienda più 1", async () => {
    // come proprietario
    await sedeVecchia(randomUUID(), T.vecchia, false, '2026-06-01', 'Quarta')
    expect((await progressiviDi(T.vecchia)).Quarta).toBe(4)
    // come wasteflow_app dentro il TenantContext
    const creata = await nelTenant(T.vecchia, () =>
      servizio.create(T.vecchia, { numIscrSito: iscrizione(), denominazione: 'Quinta' })
    )
    expect(creata.progressivoMud).toBe(5)
    // un'altra azienda non influisce
    const altra = await nelTenant(T.altra, () =>
      servizio.create(T.altra, { numIscrSito: iscrizione(), denominazione: 'Altra terza' })
    )
    expect(altra.progressivoMud).toBe(3)
  })

  it('trigger: createMany di tre sedi dà tre progressivi consecutivi', async () => {
    await db.rentriUnitaLocale.createMany({
      data: ['A', 'B', 'C'].map(nome => ({
        tenantId: T.batch,
        numIscrSito: iscrizione(),
        denominazione: nome,
        principale: nome === 'A',
      })),
    })
    expect(await progressiviDi(T.batch)).toEqual({ A: 1, B: 2, C: 3 })
  })

  it('trigger: upsertFromRentri assegna i progressivi alle sedi nuove e non tocca le esistenti', async () => {
    const [uno, due] = [iscrizione(), iscrizione()]
    await nelTenant(T.sync, () =>
      servizio.upsertFromRentri(T.sync, [
        { numIscrSito: uno, denominazione: 'Uno', attiva: true },
        { numIscrSito: due, denominazione: 'Due', attiva: true },
      ])
    )
    expect(await progressiviDi(T.sync)).toEqual({ Uno: 1, Due: 2 })

    const tre = iscrizione()
    await nelTenant(T.sync, () =>
      servizio.upsertFromRentri(T.sync, [
        { numIscrSito: uno, denominazione: 'Uno rinominata', attiva: true },
        { numIscrSito: tre, denominazione: 'Tre', attiva: true },
      ])
    )
    expect(await progressiviDi(T.sync)).toEqual({ 'Uno rinominata': 1, Due: 2, Tre: 3 })
  })

  it('trigger: un progressivo esplicito non viene sovrascritto', async () => {
    await db.rentriUnitaLocale.create({
      data: {
        tenantId: T.esplicito,
        numIscrSito: iscrizione(),
        denominazione: 'Esplicita',
        progressivoMud: 7,
      },
    })
    expect((await progressiviDi(T.esplicito)).Esplicita).toBe(7)
    await db.rentriUnitaLocale.create({
      data: { tenantId: T.esplicito, numIscrSito: iscrizione(), denominazione: 'Dopo' },
    })
    expect((await progressiviDi(T.esplicito)).Dopo).toBe(8)
  })

  it('unico: due sedi della stessa azienda con lo stesso progressivo → violazione', async () => {
    await db.rentriUnitaLocale.create({
      data: {
        tenantId: T.unico,
        numIscrSito: iscrizione(),
        denominazione: 'Prima',
        progressivoMud: 5,
      },
    })
    await expect(
      db.rentriUnitaLocale.create({
        data: {
          tenantId: T.unico,
          numIscrSito: iscrizione(),
          denominazione: 'Doppia',
          progressivoMud: 5,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' })
    // la stessa numerazione in un'altra azienda è ammessa
    await db.rentriUnitaLocale.create({
      data: {
        tenantId: T.check,
        numIscrSito: iscrizione(),
        denominazione: 'Altra',
        progressivoMud: 5,
      },
    })
  })

  it('CHECK: CAP, provincia, addetti negativi, progressivo 0 respinti', async () => {
    const id = randomUUID()
    await sedeVecchia(id, T.check, false, '2026-01-01', 'Controlli')
    const prova = (set: string) =>
      db.$executeRawUnsafe(`UPDATE rentri_unita_locali SET ${set} WHERE id = '${id}'`)
    await expect(prova(`cap = '2012'`)).rejects.toThrow(/rentri_unita_locali_cap_check/)
    await expect(prova(`cap = '2012A'`)).rejects.toThrow(/rentri_unita_locali_cap_check/)
    await expect(prova(`provincia = 'mi'`)).rejects.toThrow(/rentri_unita_locali_provincia_check/)
    await expect(prova(`provincia = 'MIL'`)).rejects.toThrow()
    await expect(prova(`numero_addetti = -1`)).rejects.toThrow(
      /rentri_unita_locali_numero_addetti_check/
    )
    await expect(prova(`progressivo_mud = 0`)).rejects.toThrow(
      /rentri_unita_locali_progressivo_mud_check/
    )
    // valori validi e NULL passano
    await prova(`cap = '20121', provincia = 'MI', numero_addetti = 0`)
    await prova(`cap = NULL, provincia = NULL, numero_addetti = NULL`)
  })

  it('trigger: due inserimenti concorrenti nella stessa azienda si serializzano sul lock (N+1 e N+2, nessun P2002)', async () => {
    await sedeVecchia(randomUUID(), T.lock, true, '2026-01-01', 'Base') // N = 1
    const primo = new PrismaClient({ datasources: { db: { url: urlDb } } })
    const secondo = new PrismaClient({ datasources: { db: { url: urlDb } } })
    try {
      let rilascia!: () => void
      const via = new Promise<void>(r => (rilascia = r))
      let primoInserito!: () => void
      const inserito = new Promise<void>(r => (primoInserito = r))

      // il primo inserisce e tiene aperta la transazione (lock tenuto fino al commit)
      const t1 = primo.$transaction(
        async tx => {
          await tx.rentriUnitaLocale.create({
            data: { tenantId: T.lock, numIscrSito: iscrizione(), denominazione: 'Concorrente 1' },
          })
          primoInserito()
          await via
        },
        { timeout: 30_000 }
      )
      await inserito

      // il secondo parte mentre il primo non ha committato: deve restare bloccato sul lock
      let secondoFinito = false
      const t2 = secondo.rentriUnitaLocale
        .create({
          data: { tenantId: T.lock, numIscrSito: iscrizione(), denominazione: 'Concorrente 2' },
        })
        .finally(() => (secondoFinito = true))
      await new Promise(r => setTimeout(r, 1500))
      expect(secondoFinito).toBe(false)

      rilascia()
      await t1
      await t2

      const p = await progressiviDi(T.lock)
      expect(p).toEqual({ Base: 1, 'Concorrente 1': 2, 'Concorrente 2': 3 })
    } finally {
      await primo.$disconnect()
      await secondo.$disconnect()
    }
  })

  it('cambiare la principale non cambia i progressivi', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
    await sedeVecchia(a, T.cambio, true, '2026-01-01', 'A')
    await sedeVecchia(b, T.cambio, false, '2026-02-01', 'B')
    await sedeVecchia(c, T.cambio, false, '2026-03-01', 'C')
    const prima = await progressiviDi(T.cambio)
    expect(prima).toEqual({ A: 1, B: 2, C: 3 })

    await nelTenant(T.cambio, () => servizio.setPrincipale(T.cambio, c))

    expect(await progressiviDi(T.cambio)).toEqual(prima)
    const principali = await sel<{ denominazione: string }>(
      `SELECT denominazione FROM rentri_unita_locali WHERE tenant_id = '${T.cambio}' AND principale`
    )
    expect(principali.map(p => p.denominazione)).toEqual(['C'])
  })
})
