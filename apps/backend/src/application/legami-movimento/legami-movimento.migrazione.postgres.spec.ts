/**
 * Migration `20261103200000_legami_movimento` applicata a un database con DATI PRIMA della
 * migration (fase 4.3, Task 3, revisione I1): crea un database temporaneo, applica le migration
 * precedenti con `prisma migrate deploy`, inserisce causali aziendali PROPRIE (una gia' usata e
 * chiusa) e DISATTIVAZIONI, applica la migration con `prisma db execute` e verifica backfill e
 * `VALIDATE`. Simula anche il backend vecchio (INSERT di una PROPRIA senza la colonna nuova).
 *
 * Le migration le esegue il ruolo proprietario del database di test (`wasteflow`, superuser come in
 * produzione).
 */
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const MIGRATION = '20261103200000_legami_movimento'
const BACKEND = path.resolve(__dirname, '..', '..', '..')
const MIGRAZIONI = path.join(BACKEND, 'prisma', 'migrations')
const BASE_URL = (
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
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

describe('Migration legami_movimento su dati preesistenti (Postgres reale)', () => {
  const nomeDb = `wasteflow_mig_legami_${Date.now()}`
  const urlDb = `${BASE_URL}/${nomeDb}?schema=public`
  const cartellaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-legami-'))
  const tenantId = randomUUID()
  let admin: PrismaClient
  let db: PrismaClient

  const q = (sql: string, ...p: unknown[]) => db.$executeRawUnsafe(sql, ...p)
  const sel = <R>(sql: string, ...p: unknown[]) => db.$queryRawUnsafe<R[]>(sql, ...p)

  beforeAll(async () => {
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

    // Dati "vecchi": azienda, registro, una PROPRIA usata e chiusa, una PROPRIA aperta, una DISATTIVAZIONE.
    await q(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ($1::uuid, now(), 'MIGL0000001', 'Legami migrazione')`,
      tenantId
    )
    const registro = randomUUID()
    await q(
      `INSERT INTO registri_rifiuti (id, tenant_id, descrizione, updated_at) VALUES ($1::uuid, $2::uuid, 'Registro', now())`,
      registro,
      tenantId
    )
    const usata = randomUUID()
    await q(
      `INSERT INTO causali_registro_azienda
         (id, tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, valida_al, creato_da, updated_at)
       VALUES ($1::uuid, $2::uuid, 'PROPRIA', 'AZ_USATA', 'CARICO', 'Usata', 'ESCLUSO', '2026-01-01', '2026-06-30', $3::uuid, now())`,
      usata,
      tenantId,
      randomUUID()
    )
    await q(
      `INSERT INTO waste_movements
         (tenant_id, registro_id, type, movement_date, causale, causale_azienda_id, cer_code, quantity, unit,
          progressive_year, progressive_number, updated_at)
       VALUES ($1::uuid, $2::uuid, 'CARICO', '2026-06-30T10:00:00Z', 'AZ_USATA', $3::uuid, '20 03 01', 1, 'KG', 2026, 1, now())`,
      tenantId,
      registro,
      usata
    )
    await q(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da, updated_at)
       VALUES ($1::uuid, 'PROPRIA', 'AZ_APERTA', 'SCARICO', 'Aperta', 'ESCLUSO', '2026-01-01', $2::uuid, now())`,
      tenantId,
      randomUUID()
    )
    await q(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, causale_sistema_codice, creato_da, updated_at)
       VALUES ($1::uuid, 'DISATTIVAZIONE', 'RICLASSIFICAZIONE', 'CARICO', 'RICLASSIFICAZIONE', $2::uuid, now())`,
      tenantId,
      randomUUID()
    )

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
  }, 240_000)

  afterAll(async () => {
    await db?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`)
      await admin.$disconnect()
    }
    fs.rmSync(cartellaTmp, { recursive: true, force: true })
  })

  it('backfill e VALIDATE passano: le PROPRIE storiche (anche usata e chiusa) sono false, la DISATTIVAZIONE NULL', async () => {
    const righe = await sel<{ codice: string; natura: string; fatturabile: boolean | null }>(
      `SELECT codice, natura::text AS natura, fatturabile FROM causali_registro_azienda
       WHERE tenant_id = $1::uuid ORDER BY codice`,
      tenantId
    )
    expect(righe).toEqual([
      { codice: 'AZ_APERTA', natura: 'PROPRIA', fatturabile: false },
      { codice: 'AZ_USATA', natura: 'PROPRIA', fatturabile: false },
      { codice: 'RICLASSIFICAZIONE', natura: 'DISATTIVAZIONE', fatturabile: null },
    ])
    const [c] = await sel<{ convalidato: boolean }>(
      `SELECT convalidated AS convalidato FROM pg_constraint
       WHERE conname = 'causali_registro_azienda_fatturabile_propria'`
    )
    expect(c.convalidato).toBe(true)
  })

  it('il valore iniziale del catalogo: solo INGRESSO_ESTERNO CARICO e fatturabile', async () => {
    const vere = await sel<{ codice: string; verso: string }>(
      `SELECT codice, verso::text AS verso FROM causali_registro WHERE fatturabile`
    )
    expect(vere).toEqual([{ codice: 'INGRESSO_ESTERNO', verso: 'CARICO' }])
  })

  it('backend vecchio: INSERT di una PROPRIA senza la colonna fatturabile riesce con false', async () => {
    await q(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da, updated_at)
       VALUES ($1::uuid, 'PROPRIA', 'AZ_VECCHIO', 'CARICO', 'Dal codice vecchio', 'ESCLUSO', '2026-01-01', $2::uuid, now())`,
      tenantId,
      randomUUID()
    )
    const [r] = await sel<{ fatturabile: boolean | null }>(
      `SELECT fatturabile FROM causali_registro_azienda WHERE tenant_id = $1::uuid AND codice = 'AZ_VECCHIO'`,
      tenantId
    )
    expect(r.fatturabile).toBe(false)
  })

  it('una PROPRIA con fatturabile NULL esplicito resta respinta dal CHECK', async () => {
    await expect(
      q(
        `INSERT INTO causali_registro_azienda
           (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da, fatturabile, updated_at)
         VALUES ($1::uuid, 'PROPRIA', 'AZ_NULLA', 'CARICO', 'x', 'ESCLUSO', '2026-01-01', $2::uuid, NULL, now())`,
        tenantId,
        randomUUID()
      )
    ).rejects.toThrow(/causali_registro_azienda_fatturabile_propria/)
  })
})
