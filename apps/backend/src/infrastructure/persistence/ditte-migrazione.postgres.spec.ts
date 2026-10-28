import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { clientComeRuolo } from '../database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

/**
 * Migration `20261031110000_ditte_sedi_controparti` (Fase 2 pezzo 10, Task 1) contro un Postgres
 * reale: crea un database vuoto, applica le migration PRECEDENTI con `prisma migrate deploy`,
 * inserisce anagrafiche "vecchie" (senza ditta), applica la migration con `prisma db execute` e
 * verifica backfill, vincoli e RLS.
 *
 * Le asserzioni sono query sui DATI, mai sui NOTICE (I5). Le migration le esegue il ruolo del
 * database di test (`wasteflow`, superuser con BYPASSRLS, come in produzione).
 */
const MIGRATION = '20261031110000_ditte_sedi_controparti'
const BACKEND = path.resolve(__dirname, '..', '..', '..')
const MIGRAZIONI = path.join(BACKEND, 'prisma', 'migrations')
const URL_PROPRIETARIO =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
const BASE_URL = URL_PROPRIETARIO.replace(/\/[^/?]*(\?.*)?$/, '')
const PRISMA_CLI = require.resolve('prisma/build/index.js')

function prismaCli(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Partite IVA di 11 cifre (la migration controlla la sola forma, non il checksum).
const X = '12345678903'
const Y = '11111111111'
const Z = '33333333333'
const INVALIDA_CHECKSUM = '12345678901'

describe('Migration F2-10 — ditte e sedi delle controparti (Postgres reale)', () => {
  const stamp = Date.now()
  const nomeDb = `wasteflow_ditte_${stamp}`
  const nomeDbFallita = `wasteflow_ditte_ko_${stamp}`
  const urlDb = `${BASE_URL}/${nomeDb}?schema=public`
  const urlDbFallita = `${BASE_URL}/${nomeDbFallita}?schema=public`
  const cartellaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-ditte-'))
  const schemaTmp = path.join(cartellaTmp, 'schema.prisma')
  let admin: PrismaClient
  let db: PrismaClient
  let dbFallita: PrismaClient
  let app: PrismaClient

  const A = randomUUID() // azienda con anagrafiche
  const B = randomUUID() // altra azienda, stessa P.IVA X
  const C = randomUUID() // azienda senza anagrafiche
  const id = {
    prodX: randomUUID(),
    destX: randomUUID(),
    prodY: randomUUID(),
    trasY: randomUUID(),
    destInvalida: randomUUID(),
    prodB: randomUUID(),
    fir: randomUUID(),
    contratto: randomUUID(),
    user: randomUUID(),
  }

  const esc = (s: string) => s.replace(/'/g, "''")
  const q = (sql: string) => db.$executeRawUnsafe(sql)
  const sel = <R>(sql: string) => db.$queryRawUnsafe<R[]>(sql)

  async function azienda(idTenant: string, n: number) {
    await q(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ('${idTenant}', now(), 'DIT${n}0000000', 'Azienda ${n}')`
    )
  }
  async function produttore(
    idRiga: string,
    tenant: string,
    nome: string,
    piva: string,
    via: string,
    civico: string,
    aggiornato: string,
    email: string | null = null
  ) {
    await q(
      `INSERT INTO produttori (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, via, civico, cap, comune, provincia, email)
       VALUES ('${idRiga}', '${tenant}', '${aggiornato}', '${aggiornato}', '${esc(nome)}', '${piva}', '${esc(via)}', '${civico}', '20100', 'Milano', 'MI', ${email ? `'${email}'` : 'NULL'})`
    )
  }
  async function destinatario(
    idRiga: string,
    tenant: string,
    nome: string,
    piva: string,
    via: string,
    civico: string,
    aggiornato: string
  ) {
    await q(
      `INSERT INTO destinatari (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, numero_autorizzazione, via, civico, cap, comune, provincia)
       VALUES ('${idRiga}', '${tenant}', '${aggiornato}', '${aggiornato}', '${esc(nome)}', '${piva}', 'AUT-1', '${esc(via)}', '${civico}', '20100', 'Milano', 'MI')`
    )
  }
  async function trasportatore(
    idRiga: string,
    tenant: string,
    nome: string,
    piva: string,
    via: string,
    civico: string,
    aggiornato: string,
    email: string | null = null
  ) {
    await q(
      `INSERT INTO trasportatori (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, numero_iscrizione, via, civico, cap, comune, provincia, email)
       VALUES ('${idRiga}', '${tenant}', '${aggiornato}', '${aggiornato}', '${esc(nome)}', '${piva}', 'ALBO-1', '${esc(via)}', '${civico}', '20100', 'Milano', 'MI', ${email ? `'${email}'` : 'NULL'})`
    )
  }

  const ditteDi = (tenant: string) =>
    sel<{
      id: string
      ragione_sociale: string
      partita_iva: string | null
      codice_fiscale: string | null
    }>(
      `SELECT id, ragione_sociale, partita_iva, codice_fiscale FROM ditte WHERE tenant_id = '${tenant}' ORDER BY partita_iva`
    )
  const sediDi = (dittaId: string) =>
    sel<{
      id: string
      via: string
      civico: string
      principale: boolean
      attiva: boolean
      email: string | null
    }>(
      `SELECT id, via, civico, principale, attiva, email FROM sedi_ditte WHERE ditta_id = '${dittaId}' ORDER BY via`
    )
  const istantanea = () =>
    sel<{ ditte: string; sedi: string; ruoli: string }>(
      `SELECT (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]') FROM ditte d)::text AS ditte,
              (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]') FROM sedi_ditte s)::text AS sedi,
              (SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'), '[]') FROM (
                 SELECT to_jsonb(p) AS x FROM produttori p
                 UNION ALL SELECT to_jsonb(t) FROM trasportatori t
                 UNION ALL SELECT to_jsonb(d) FROM destinatari d) r)::text AS ruoli`
    )

  let firPrima: string
  let contrattoPrima: string

  beforeAll(async () => {
    // Prima di creare qualunque database: mai su un database che non sia quello di test locale.
    if (!eDatabaseDiTestLocale(URL_PROPRIETARIO)) {
      throw new Error('DATABASE_URL non punta a un database di test locale: fermo')
    }
    admin = new PrismaClient({ datasources: { db: { url: `${BASE_URL}/postgres` } } })
    await admin.$executeRawUnsafe(`CREATE DATABASE ${nomeDb}`)

    // schema + migration precedenti alla F2-10 + lock, in una cartella temporanea
    fs.copyFileSync(path.join(BACKEND, 'prisma', 'schema.prisma'), schemaTmp)
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
    prismaCli(['migrate', 'deploy', '--schema', schemaTmp], urlDb)

    // Secondo database (per la precondizione che fallisce): copia del primo prima di ogni dato.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${nomeDbFallita} TEMPLATE ${nomeDb}`)

    db = new PrismaClient({ datasources: { db: { url: urlDb } } })
    await db.$connect()
    dbFallita = new PrismaClient({ datasources: { db: { url: urlDbFallita } } })
    await dbFallita.$connect()
    app = clientComeRuolo(
      'wasteflow_app',
      process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
      urlDb
    )

    await azienda(A, 1)
    await azienda(B, 2)
    await azienda(C, 3)

    // A: stessa P.IVA X come produttore (via Roma 1) e destinatario (via dell'Industria 5,
    // aggiornato dopo) con ragioni sociali scritte diversamente.
    await produttore(
      id.prodX,
      A,
      'Rossi S.r.l.',
      X,
      'Via Roma',
      '1',
      '2026-01-01 10:00:00',
      'prod@rossi.it'
    )
    await destinatario(
      id.destX,
      A,
      'ROSSI SRL',
      X,
      "Via dell'Industria",
      '5',
      '2026-03-01 10:00:00'
    )
    // A: produttore e trasportatore con P.IVA Y e lo stesso indirizzo scritto diversamente;
    // il trasportatore e' piu' recente e ha un'altra email.
    await produttore(
      id.prodY,
      A,
      'Verdi Srl',
      Y,
      'Via Garibaldi',
      '3',
      '2026-01-01 10:00:00',
      'vecchia@verdi.it'
    )
    await trasportatore(
      id.trasY,
      A,
      'VERDI S.R.L.',
      Y,
      '  VIA   GARIBALDI ',
      '3',
      '2026-02-01 10:00:00',
      'nuova@verdi.it'
    )
    // A: P.IVA di 11 cifre con checksum sbagliato: migrata cosi' com'e'.
    await destinatario(
      id.destInvalida,
      A,
      'Bianchi',
      INVALIDA_CHECKSUM,
      'Via Po',
      '7',
      '2026-01-05 10:00:00'
    )
    // B: stessa P.IVA X, azienda diversa.
    await produttore(id.prodB, B, 'Rossi di B', X, 'Via Dante', '2', '2026-01-02 10:00:00')

    // FIR e contratto di A inseriti prima della migration.
    await q(
      `INSERT INTO users (id, tenant_id, updated_at, keycloak_id, fiscal_code, first_name, last_name, email)
       VALUES ('${id.user}', '${A}', now(), 'kc-${id.user}', 'RSSMRA80A01H501U', 'Mario', 'Rossi', 'mario@rossi.it')`
    )
    await q(
      `INSERT INTO firs (id, tenant_id, updated_at, producer_user_id, producer_id, producer_partita_iva, producer_name, producer_address,
                         carrier_id, carrier_partita_iva, carrier_name, carrier_vehicle_plate,
                         receiver_id, receiver_partita_iva, receiver_name, receiver_address,
                         cer_code, waste_description, waste_category, quantity, transport_date)
       VALUES ('${id.fir}', '${A}', now(), '${id.user}', '${id.prodX}', '${X}', 'Rossi S.r.l.', 'Via Roma 1',
               '${id.trasY}', '${Y}', 'VERDI S.R.L.', 'AB123CD',
               '${id.destX}', '${X}', 'ROSSI SRL', 'Via dell''Industria 5',
               '15 01 01', 'Imballaggi', 'NON_PERICOLOSO', 10, now())`
    )
    await q(
      `INSERT INTO contracts (id, tenant_id, updated_at, contract_number, producer_id, counterparty_id, counterparty_type, contract_type, pricing_model, start_date)
       VALUES ('${id.contratto}', '${A}', now(), 'CT-1', '${id.prodX}', '${id.destX}', 'DISPOSER', 'WASTE_DISPOSAL', 'FLAT_RATE', now())`
    )
    firPrima = (
      await sel<{ r: string }>(`SELECT to_jsonb(f)::text AS r FROM firs f WHERE id = '${id.fir}'`)
    )[0].r
    contrattoPrima = (
      await sel<{ r: string }>(
        `SELECT to_jsonb(c)::text AS r FROM contracts c WHERE id = '${id.contratto}'`
      )
    )[0].r

    // Database "fallito": una P.IVA di 11 caratteri ma non di cifre.
    await dbFallita.$executeRawUnsafe(
      `INSERT INTO tenants (id, updated_at, partita_iva, ragione_sociale) VALUES ('${A}', now(), 'DIT90000000', 'Azienda KO')`
    )
    await dbFallita.$executeRawUnsafe(
      `INSERT INTO produttori (tenant_id, updated_at, ragione_sociale, partita_iva, via, civico, cap, comune, provincia)
       VALUES ('${A}', now(), 'Storta', '1234567890A', 'Via Storta', '1', '20100', 'Milano', 'MI')`
    )

    prismaCli(
      [
        'db',
        'execute',
        '--file',
        path.join(MIGRAZIONI, MIGRATION, 'migration.sql'),
        '--schema',
        schemaTmp,
      ],
      urlDb
    )
  }, 300_000)

  afterAll(async () => {
    await app?.$disconnect()
    await db?.$disconnect()
    await dbFallita?.$disconnect()
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDb} WITH (FORCE)`)
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nomeDbFallita} WITH (FORCE)`)
      await admin.$disconnect()
    }
    fs.rmSync(cartellaTmp, { recursive: true, force: true })
  })

  it('stessa P.IVA in due ruoli: UNA ditta, due sedi, principale = quella della riga piu recente', async () => {
    const ditte = (await ditteDi(A)).filter(d => d.partita_iva === X)
    expect(ditte).toHaveLength(1)
    expect(ditte[0].ragione_sociale).toBe('ROSSI SRL')
    expect(ditte[0].codice_fiscale).toBeNull()
    const sedi = await sediDi(ditte[0].id)
    expect(sedi).toHaveLength(2)
    expect(sedi.find(s => s.principale)?.via).toBe("Via dell'Industria")
    expect(sedi.filter(s => s.principale)).toHaveLength(1)
    expect(sedi.every(s => s.attiva)).toBe(true)

    const [prod] = await sel<{ ditta_id: string; sede_id: string; ragione_sociale: string }>(
      `SELECT ditta_id, sede_id, ragione_sociale FROM produttori WHERE id = '${id.prodX}'`
    )
    const [dest] = await sel<{ ditta_id: string; sede_id: string; ragione_sociale: string }>(
      `SELECT ditta_id, sede_id, ragione_sociale FROM destinatari WHERE id = '${id.destX}'`
    )
    expect(prod.ditta_id).toBe(ditte[0].id)
    expect(dest.ditta_id).toBe(ditte[0].id)
    expect(sedi.find(s => s.id === prod.sede_id)?.via).toBe('Via Roma')
    expect(sedi.find(s => s.id === dest.sede_id)?.via).toBe("Via dell'Industria")
    // id di ruolo invariati e ragione sociale della riga di ruolo invariata
    expect(prod.ragione_sociale).toBe('Rossi S.r.l.')
    expect(dest.ragione_sociale).toBe('ROSSI SRL')
  })

  it('stesso indirizzo scritto con maiuscole e spazi diversi: una ditta, UNA sede, contatti della riga piu recente', async () => {
    const ditte = (await ditteDi(A)).filter(d => d.partita_iva === Y)
    expect(ditte).toHaveLength(1)
    expect(ditte[0].ragione_sociale).toBe('VERDI S.R.L.')
    const sedi = await sediDi(ditte[0].id)
    expect(sedi).toHaveLength(1)
    expect(sedi[0].principale).toBe(true)
    expect(sedi[0].email).toBe('nuova@verdi.it')
    const righe = await sel<{ ditta_id: string; sede_id: string }>(
      `SELECT ditta_id, sede_id FROM produttori WHERE id = '${id.prodY}'
       UNION ALL SELECT ditta_id, sede_id FROM trasportatori WHERE id = '${id.trasY}'`
    )
    expect(righe).toHaveLength(2)
    for (const r of righe) expect(r).toEqual({ ditta_id: ditte[0].id, sede_id: sedi[0].id })
  })

  it('un altra azienda con la stessa P.IVA ottiene una ditta separata', async () => {
    const dA = (await ditteDi(A)).find(d => d.partita_iva === X)
    const dB = await ditteDi(B)
    expect(dB).toHaveLength(1)
    expect(dB[0].partita_iva).toBe(X)
    expect(dB[0].id).not.toBe(dA?.id)
    expect(dB[0].ragione_sociale).toBe('Rossi di B')
  })

  it('una P.IVA di 11 cifre con checksum sbagliato viene migrata cosi com e', async () => {
    const d = (await ditteDi(A)).find(x => x.partita_iva === INVALIDA_CHECKSUM)
    expect(d?.ragione_sociale).toBe('Bianchi')
  })

  it('un azienda senza anagrafiche non ottiene nessuna ditta', async () => {
    expect(await ditteDi(C)).toHaveLength(0)
    const [n] = await sel<{ n: number }>(
      `SELECT count(*)::int AS n FROM sedi_ditte WHERE tenant_id = '${C}'`
    )
    expect(n.n).toBe(0)
  })

  it('ogni ditta ha esattamente una sede principale, nessuna riga di ruolo resta senza ditta o sede', async () => {
    const [r] = await sel<{ senza_principale: number; senza_ditta: number }>(
      `SELECT (SELECT count(*)::int FROM ditte d WHERE (SELECT count(*) FROM sedi_ditte s WHERE s.ditta_id = d.id AND s.principale) <> 1) AS senza_principale,
              (SELECT count(*)::int FROM produttori WHERE ditta_id IS NULL OR sede_id IS NULL)
            + (SELECT count(*)::int FROM trasportatori WHERE ditta_id IS NULL OR sede_id IS NULL)
            + (SELECT count(*)::int FROM destinatari WHERE ditta_id IS NULL OR sede_id IS NULL) AS senza_ditta`
    )
    expect(r).toEqual({ senza_principale: 0, senza_ditta: 0 })
  })

  it('FIR e contratto inseriti prima: tutte le colonne identiche dopo la migration', async () => {
    const [f] = await sel<{ r: string }>(
      `SELECT to_jsonb(f)::text AS r FROM firs f WHERE id = '${id.fir}'`
    )
    const [c] = await sel<{ r: string }>(
      `SELECT to_jsonb(c)::text AS r FROM contracts c WHERE id = '${id.contratto}'`
    )
    expect(f.r).toBe(firPrima)
    expect(c.r).toBe(contrattoPrima)
  })

  it('idempotenza: righe con ditta_id NULL (backend vecchio) si collegano; una seconda chiamata non cambia nulla', async () => {
    const idT = randomUUID()
    const idZ = randomUUID()
    // trasportatore con P.IVA X in un nuovo indirizzo: va sulla ditta esistente
    await trasportatore(idT, A, 'Rossi Trasporti', X, 'Via Nuova', '9', '2026-05-01 10:00:00')
    // produttore con una P.IVA nuova: ditta nuova
    await produttore(idZ, A, 'Neri Spa', Z, 'Via Mazzini', '4', '2026-05-02 10:00:00')

    await q('SELECT f210_collega_anagrafiche()')

    const dX = (await ditteDi(A)).find(d => d.partita_iva === X)!
    const [t] = await sel<{ ditta_id: string; sede_id: string }>(
      `SELECT ditta_id, sede_id FROM trasportatori WHERE id = '${idT}'`
    )
    expect(t.ditta_id).toBe(dX.id)
    const sediX = await sediDi(dX.id)
    expect(sediX).toHaveLength(3)
    expect(sediX.find(s => s.id === t.sede_id)?.via).toBe('Via Nuova')
    // la principale non cambia: una ditta gia esistente non cambia sede principale
    expect(sediX.find(s => s.principale)?.via).toBe("Via dell'Industria")

    const dZ = (await ditteDi(A)).filter(d => d.partita_iva === Z)
    expect(dZ).toHaveLength(1)
    expect(dZ[0].ragione_sociale).toBe('Neri Spa')
    expect((await sediDi(dZ[0].id))[0].principale).toBe(true)
    const [p] = await sel<{ ditta_id: string }>(
      `SELECT ditta_id FROM produttori WHERE id = '${idZ}'`
    )
    expect(p.ditta_id).toBe(dZ[0].id)

    const prima = await istantanea()
    await q('SELECT f210_collega_anagrafiche()')
    expect(await istantanea()).toEqual(prima)
  })

  it('ragione sociale vuota in una riga di ruolo: la ditta si chiama "Ditta senza ragione sociale"', async () => {
    const D = randomUUID()
    const idRiga = randomUUID()
    const W = '44444444444'
    await azienda(D, 4)
    await produttore(idRiga, D, '   ', W, 'Via Vuota', '1', '2026-06-01 10:00:00')

    await q('SELECT f210_collega_anagrafiche()')

    const ditte = await ditteDi(D)
    expect(ditte).toHaveLength(1)
    expect(ditte[0].ragione_sociale).toBe('Ditta senza ragione sociale')
    const [riga] = await sel<{ ditta_id: string }>(
      `SELECT ditta_id FROM produttori WHERE id = '${idRiga}'`
    )
    expect(riga.ditta_id).toBe(ditte[0].id)
  })

  it('una sede disattivata non viene ricollegata: la nuova riga ottiene una sede nuova e attiva (D4)', async () => {
    const D = randomUUID()
    const idProd = randomUUID()
    const idTras = randomUUID()
    const V = '55555555555'
    await azienda(D, 5)
    // la principale e' la sede del produttore (riga piu' recente), la secondaria quella del destinatario
    await produttore(idProd, D, 'Gialli Srl', V, 'Via Principale', '1', '2026-06-02 10:00:00')
    await destinatario(randomUUID(), D, 'Gialli Srl', V, 'Via Vecchia', '1', '2026-06-01 10:00:00')
    await q('SELECT f210_collega_anagrafiche()')
    const [ditta] = await ditteDi(D)
    const vecchia = (await sediDi(ditta.id)).find(x => x.via === 'Via Vecchia')!
    expect(vecchia.principale).toBe(false)
    // la sede secondaria viene disattivata
    await q(`UPDATE sedi_ditte SET attiva = false WHERE id = '${vecchia.id}'`)
    // il backend vecchio crea un trasportatore con lo STESSO indirizzo e la stessa P.IVA
    await trasportatore(idTras, D, 'Gialli Trasporti', V, 'Via Vecchia', '1', '2026-06-02 10:00:00')

    await q('SELECT f210_collega_anagrafiche()')

    const [tras] = await sel<{ ditta_id: string; sede_id: string }>(
      `SELECT ditta_id, sede_id FROM trasportatori WHERE id = '${idTras}'`
    )
    expect(tras.ditta_id).toBe(ditta.id)
    expect(tras.sede_id).not.toBe(vecchia.id)
    const sedi = await sediDi(ditta.id)
    expect(sedi).toHaveLength(3)
    expect(sedi.find(x => x.id === vecchia.id)?.attiva).toBe(false)
    expect(sedi.find(x => x.id === tras.sede_id)?.attiva).toBe(true)
  })

  it('precondizione: una P.IVA non di 11 cifre ferma la migration con i soli conteggi e annulla tutto', async () => {
    let stderr = ''
    try {
      prismaCli(
        [
          'db',
          'execute',
          '--file',
          path.join(MIGRAZIONI, MIGRATION, 'migration.sql'),
          '--schema',
          schemaTmp,
        ],
        urlDbFallita
      )
      throw new Error('la migration doveva fallire')
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? e)
    }
    expect(stderr).toContain('produttori: 1')
    expect(stderr).toContain('trasportatori: 0')
    expect(stderr).toContain('destinatari: 0')
    expect(stderr).not.toContain('1234567890A')
    // transazionalita': nessuna tabella creata
    const [r] = await dbFallita.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT to_regclass('public.ditte')::text AS t`
    )
    expect(r.t).toBeNull()
    const [col] = await dbFallita.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'produttori' AND column_name = 'ditta_id'`
    )
    expect(col.n).toBe(0)
  })

  describe('vincoli (col proprietario)', () => {
    const nuovaDitta = (tenant: string, piva: string | null, cf: string | null, nome = 'Prova') =>
      q(
        `INSERT INTO ditte (tenant_id, updated_at, ragione_sociale, partita_iva, codice_fiscale)
         VALUES ('${tenant}', now(), '${nome}', ${piva ? `'${piva}'` : 'NULL'}, ${cf ? `'${cf}'` : 'NULL'})`
      )

    it('due ditte con la stessa P.IVA nella stessa azienda: violazione; stesso codice fiscale: violazione', async () => {
      await expect(nuovaDitta(A, X, null)).rejects.toThrow(/23505/)
      await nuovaDitta(A, null, 'RSSMRA80A01H501U')
      await expect(nuovaDitta(A, null, 'RSSMRA80A01H501U')).rejects.toThrow(/23505/)
    })

    it('due ditte con P.IVA NULL e codici fiscali diversi sono ammesse', async () => {
      await nuovaDitta(A, null, 'VRDLGI80A01H501X')
      await nuovaDitta(A, null, 'BNCGNN80A01H501Y')
      const r = await sel<{ n: number }>(
        `SELECT count(*)::int AS n FROM ditte WHERE tenant_id = '${A}' AND partita_iva IS NULL AND codice_fiscale IN ('VRDLGI80A01H501X','BNCGNN80A01H501Y')`
      )
      expect(r[0].n).toBe(2)
    })

    it('nessun identificativo, P.IVA di forma sbagliata o ragione sociale vuota: CHECK', async () => {
      await expect(nuovaDitta(A, null, null)).rejects.toThrow(/23514/)
      await expect(nuovaDitta(A, 'IT12345678', null)).rejects.toThrow(/23514/)
      await expect(nuovaDitta(A, '44444444444', null, '   ')).rejects.toThrow(/23514/)
      await expect(nuovaDitta(A, null, 'troppo-corto')).rejects.toThrow(/23514/)
    })

    it('una seconda sede principale per la stessa ditta: indice parziale; principale non attiva: CHECK', async () => {
      const dX = (await ditteDi(A)).find(d => d.partita_iva === X)!
      await expect(
        q(
          `INSERT INTO sedi_ditte (tenant_id, ditta_id, updated_at, via, civico, cap, comune, provincia, principale)
           VALUES ('${A}', '${dX.id}', now(), 'Via Seconda', '1', '20100', 'Milano', 'MI', true)`
        )
      ).rejects.toThrow(/23505/)
      await expect(
        q(
          `INSERT INTO sedi_ditte (tenant_id, ditta_id, updated_at, via, civico, cap, comune, provincia, principale, attiva)
           VALUES ('${A}', '${dX.id}', now(), 'Via Seconda', '1', '20100', 'Milano', 'MI', true, false)`
        )
      ).rejects.toThrow(/23514/)
    })

    it('un ruolo con la sede di un altra ditta: chiave esterna', async () => {
      const dY = (await ditteDi(A)).find(d => d.partita_iva === Y)!
      const sedeY = (await sediDi(dY.id))[0]
      await expect(
        q(`UPDATE produttori SET sede_id = '${sedeY.id}' WHERE id = '${id.prodX}'`)
      ).rejects.toThrow(/23503/)
    })

    it('una sede con tenant diverso da quello della ditta: chiave esterna', async () => {
      const dX = (await ditteDi(A)).find(d => d.partita_iva === X)!
      await expect(
        q(
          `INSERT INTO sedi_ditte (tenant_id, ditta_id, updated_at, via, civico, cap, comune, provincia)
           VALUES ('${B}', '${dX.id}', now(), 'Via Altrui', '1', '20100', 'Milano', 'MI')`
        )
      ).rejects.toThrow(/23503/)
    })

    it('un secondo produttore per la stessa ditta: unico (azienda, ditta)', async () => {
      const dX = (await ditteDi(A)).find(d => d.partita_iva === X)!
      await expect(
        q(
          `INSERT INTO produttori (tenant_id, updated_at, ragione_sociale, partita_iva, via, civico, cap, comune, provincia, ditta_id)
           VALUES ('${A}', now(), 'Doppione', '55555555555', 'Via X', '1', '20100', 'Milano', 'MI', '${dX.id}')`
        )
      ).rejects.toThrow(/23505/)
    })
  })

  it('wasteflow_app non puo eseguire f210_collega_anagrafiche()', async () => {
    await expect(app.$queryRawUnsafe('SELECT f210_collega_anagrafiche()')).rejects.toThrow(
      /permission denied/i
    )
    const [r] = await sel<{ ok: boolean }>(
      "SELECT has_function_privilege('wasteflow_app', 'f210_collega_anagrafiche()', 'EXECUTE') AS ok"
    )
    expect(r.ok).toBe(false)
  })

  describe('RLS (ruolo wasteflow_app)', () => {
    beforeAll(async () => {
      // Il ruolo esiste a livello di cluster (ops/db-ruoli.sh); nel database temporaneo gli si
      // danno i privilegi che gli darebbero i default privileges.
      await q(`GRANT USAGE ON SCHEMA public TO wasteflow_app`)
      await q(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wasteflow_app`
      )
    })

    it('nel contesto di A si vedono solo ditte e sedi di A', async () => {
      const [ditte, sedi] = await app.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A}', true)`)
        return [
          await tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(`SELECT tenant_id FROM ditte`),
          await tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
            `SELECT tenant_id FROM sedi_ditte`
          ),
        ]
      })
      expect(ditte.length).toBeGreaterThan(0)
      expect(sedi.length).toBeGreaterThan(0)
      expect(new Set(ditte.map(d => d.tenant_id))).toEqual(new Set([A]))
      expect(new Set(sedi.map(d => d.tenant_id))).toEqual(new Set([A]))
    })

    it('un INSERT con il tenant di B nel contesto di A e respinto', async () => {
      await expect(
        app.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A}', true)`)
          await tx.$executeRawUnsafe(
            `INSERT INTO ditte (tenant_id, updated_at, ragione_sociale, partita_iva)
             VALUES ('${B}', now(), 'Abusiva', '66666666666')`
          )
        })
      ).rejects.toThrow(/row-level security|42501/)
    })

    it('senza contesto non si vede nulla', async () => {
      const righe = await app.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM ditte`
      )
      expect(righe[0].n).toBe(0)
    })
  })
})
