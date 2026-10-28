/**
 * RUOLI DATABASE `wasteflow_app` e `wasteflow_sistema` — prova dei GRANT.
 *
 * Esegue lo STESSO file `prisma/sql/ruoli-db.sql` che gira in deploy, ma senza
 * psql (non c'e' ovunque): sostituisce i due `:'...'` con letterali e lo
 * spezza in statement. Poi si collega DAVVERO come ciascun ruolo e verifica
 * cosa puo' e cosa non puo' fare; le query sul catalogo sono solo un di piu'.
 *
 * I ruoli sono validi per tutto il cluster: lo script e' idempotente e il
 * test non li elimina (resterebbero i GRANT sul database in uso).
 *
 * A fine test il file viene rieseguito con le password vere (DB_APP_PASSWORD /
 * DB_SISTEMA_PASSWORD se impostate, altrimenti i valori di sviluppo
 * `wasteflow_app_dev` / `wasteflow_sistema_dev`): le password di prova non
 * restano sui ruoli, che sono validi per tutto il cluster.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from './client-come-ruolo'

const PWD_APP_1 = 'ProvaApp_uno_1'
const PWD_APP_2 = 'ProvaApp_due_2'
const PWD_SIS_1 = 'ProvaSis_uno_1'
const PWD_SIS_2 = 'ProvaSis_due_2'

const SCRIPT = join(__dirname, '..', '..', '..', 'prisma', 'sql', 'ruoli-db.sql')

/** Spezza il file in statement, rispettando commenti, apici e dollar-quoting. */
function spezza(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let dollaro: string | null = null
  while (i < sql.length) {
    const c = sql[i]
    if (dollaro) {
      if (sql.startsWith(dollaro, i)) {
        cur += dollaro
        i += dollaro.length
        dollaro = null
      } else cur += sql[i++]
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === "'") {
      const fine = sql.indexOf("'", i + 1)
      cur += sql.slice(i, fine + 1)
      i = fine + 1
      continue
    }
    const m = c === '$' ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i)) : null
    if (m) {
      dollaro = m[0]
      cur += dollaro
      i += dollaro.length
      continue
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += sql[i++]
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const lett = (v: string) => `'${v.replace(/'/g, "''")}'`

type Tx = Pick<PrismaClient, '$executeRawUnsafe'>

async function eseguiNellaTx(tx: Tx, appPwd: string, sistemaPwd: string) {
  const sql = readFileSync(SCRIPT, 'utf8')
    .replace(":'app_password'", lett(appPwd))
    .replace(":'sistema_password'", lett(sistemaPwd))
  for (const stmt of spezza(sql)) await tx.$executeRawUnsafe(stmt)
}

async function eseguiScript(owner: PrismaClient, appPwd: string, sistemaPwd: string) {
  // Un'unica transazione interattiva = un'unica connessione: set_config di
  // sessione e RESET finale devono stare sulla stessa.
  await owner.$transaction(async tx => eseguiNellaTx(tx, appPwd, sistemaPwd))
}

describe('Ruoli database (Postgres reale)', () => {
  const owner = new PrismaClient()
  const aperti: PrismaClient[] = []
  const T_ESISTENTE = 'ruoli_db_test_esistente'
  const T_FUTURA = 'ruoli_db_test_futura'

  const comeRuolo = (ruolo: string, pwd: string) => {
    const c = clientComeRuolo(ruolo, pwd)
    aperti.push(c)
    return c
  }

  const crud = async (c: PrismaClient, tabella: string) => {
    await c.$executeRawUnsafe(`INSERT INTO ${tabella} (id, v) VALUES (1, 'a')`)
    await c.$executeRawUnsafe(`UPDATE ${tabella} SET v = 'b' WHERE id = 1`)
    const r = await c.$queryRawUnsafe<{ v: string }[]>(`SELECT v FROM ${tabella} WHERE id = 1`)
    expect(r[0].v).toBe('b')
    await c.$executeRawUnsafe(`DELETE FROM ${tabella} WHERE id = 1`)
  }

  /**
   * Il test "la vecchia password non entra piu'" ha senso solo se il server
   * chiede la password a QUESTO tipo di connessione. L'immagine ufficiale di
   * postgres mette `trust` sul loopback (127.0.0.1, ::1): con `--network host`
   * (CI) ogni password passa e l'asserzione fallirebbe con un messaggio
   * fuorviante. Si interroga pg_hba_file_rules (serve superuser: l'owner lo e')
   * per la prima regola che corrisponde all'indirizzo con cui il test si collega,
   * e si fallisce con una spiegazione se il metodo e' `trust`.
   */
  const verificaCheLaPasswordSiaRichiesta = async () => {
    const [r] = await owner.$queryRawUnsafe<{ addr: string | null; metodo: string | null }[]>(
      `SELECT inet_client_addr()::text AS addr,
              (SELECT h.auth_method FROM pg_hba_file_rules h
               WHERE h.error IS NULL
                 AND h.database @> ARRAY['all']
                 AND (CASE WHEN inet_client_addr() IS NULL THEN h.type = 'local'
                      ELSE h.type IN ('host', 'hostssl', 'hostnossl')
                       AND (h.address = 'all'
                            OR (h.address ~ '^[0-9a-fA-F:.]+$'
                                AND h.netmask IS NOT NULL
                                AND CASE WHEN family(h.address::inet) = family(inet_client_addr())
                                         THEN (inet_client_addr() & h.netmask::inet) = (h.address::inet & h.netmask::inet)
                                         ELSE false END))
                      END)
               ORDER BY h.rule_number LIMIT 1) AS metodo`
    )
    if (r.metodo === null) {
      throw new Error(
        `nessuna regola di pg_hba.conf corrisponde alla connessione del test (indirizzo ${r.addr ?? 'socket locale'}): impossibile stabilire se la password e' richiesta`
      )
    }
    if (r.metodo === 'trust') {
      throw new Error(
        `il server accetta connessioni senza password su questo indirizzo (${r.addr ?? 'socket locale'}, pg_hba: trust): il test della password non e' significativo. ` +
          `Avviare Postgres con POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256" (vedi ci.yml, job test-postgres).`
      )
    }
  }

  const negato = (p: Promise<unknown>) =>
    expect(p).rejects.toThrow(/permission denied|must be owner/i)

  beforeAll(async () => {
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T_ESISTENTE}`)
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T_FUTURA}`)
    await owner.$executeRawUnsafe(`CREATE TABLE ${T_ESISTENTE} (id int PRIMARY KEY, v text)`)
    await eseguiScript(owner, PWD_APP_1, PWD_SIS_1)
  })

  afterAll(async () => {
    await Promise.all(aperti.map(c => c.$disconnect()))
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T_ESISTENTE}`)
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T_FUTURA}`)
    await eseguiScript(
      owner,
      process.env.DB_APP_PASSWORD || 'wasteflow_app_dev',
      process.env.DB_SISTEMA_PASSWORD || 'wasteflow_sistema_dev'
    )
    await owner.$disconnect()
  })

  it('wasteflow_app: CRUD su una tabella esistente, nessun CREATE/ALTER/TRUNCATE, rolbypassrls false, nessuna tabella posseduta', async () => {
    const app = comeRuolo('wasteflow_app', PWD_APP_1)
    await crud(app, T_ESISTENTE)

    await negato(app.$executeRawUnsafe(`CREATE TABLE public.x_app (id int)`))
    await negato(app.$executeRawUnsafe(`ALTER TABLE ${T_ESISTENTE} ADD COLUMN z int`))
    await negato(app.$executeRawUnsafe(`TRUNCATE ${T_ESISTENTE}`))
    // _prisma_migrations: solo lettura.
    await app.$queryRawUnsafe(`SELECT 1 FROM _prisma_migrations LIMIT 1`)
    await negato(app.$executeRawUnsafe(`DELETE FROM _prisma_migrations`))

    const [r] = await owner.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'wasteflow_app'`
    )
    expect(r).toEqual({ rolbypassrls: false, rolsuper: false })
    const possedute = await owner.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE r.rolname = 'wasteflow_app'`
    )
    expect(possedute).toHaveLength(0)
  })

  it('wasteflow_sistema: rolbypassrls true, CRUD, nessun CREATE', async () => {
    const sis = comeRuolo('wasteflow_sistema', PWD_SIS_1)
    await crud(sis, T_ESISTENTE)
    await negato(sis.$executeRawUnsafe(`CREATE TABLE public.x_sis (id int)`))
    await negato(sis.$executeRawUnsafe(`TRUNCATE ${T_ESISTENTE}`))
    await negato(sis.$executeRawUnsafe(`DELETE FROM _prisma_migrations`))

    const [r] = await owner.$queryRawUnsafe<{ rolbypassrls: boolean; rolsuper: boolean }[]>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'wasteflow_sistema'`
    )
    expect(r).toEqual({ rolbypassrls: true, rolsuper: false })
  })

  /** Privilegi su una tabella per un ruolo (tutti e cinque, anche TRUNCATE che information_schema non mostra). */
  const privilegi = async (ruolo: string, tabella: string) => {
    const r: Record<string, boolean> = {}
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      const [x] = await owner.$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT has_table_privilege('${ruolo}', 'public.${tabella}', '${p}') AS ok`
      )
      r[p] = x.ok
    }
    return r
  }
  const SOLA_LETTURA = {
    SELECT: true,
    INSERT: false,
    UPDATE: false,
    DELETE: false,
    TRUNCATE: false,
  }
  const CRUD = { SELECT: true, INSERT: true, UPDATE: true, DELETE: true, TRUNCATE: false }

  it('causali_registro (catalogo globale): i due ruoli leggono, INSERT/UPDATE/DELETE/TRUNCATE danno 42501; le altre tabelle restano CRUD', async () => {
    for (const [ruolo, pwd] of [
      ['wasteflow_app', PWD_APP_1],
      ['wasteflow_sistema', PWD_SIS_1],
    ]) {
      const c = comeRuolo(ruolo, pwd)
      const righe = await c.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM causali_registro`
      )
      expect(righe[0].n).toBeGreaterThan(0)
      for (const sql of [
        `INSERT INTO causali_registro (codice, verso, descrizione, ruolo_mud, ordine) VALUES ('PROVA_RUOLI', 'CARICO', 'x', 'ESCLUSO', 1)`,
        `UPDATE causali_registro SET attiva = false`,
        `DELETE FROM causali_registro`,
        `TRUNCATE causali_registro`,
      ]) {
        await expect(c.$executeRawUnsafe(sql)).rejects.toThrow(/42501|permission denied/i)
      }
      expect(await privilegi(ruolo, 'causali_registro')).toEqual(SOLA_LETTURA)
      // Le altre tabelle di dominio restano CRUD (mai TRUNCATE).
      expect(await privilegi(ruolo, 'waste_movements')).toEqual(CRUD)
      expect(await privilegi(ruolo, 'causali_registro_azienda')).toEqual(CRUD)
    }
  })

  it("tabella creata dall'owner dopo lo script: accessibile ai due ruoli", async () => {
    await owner.$executeRawUnsafe(`CREATE TABLE ${T_FUTURA} (id serial PRIMARY KEY, v text)`)
    for (const [ruolo, pwd] of [
      ['wasteflow_app', PWD_APP_1],
      ['wasteflow_sistema', PWD_SIS_1],
    ]) {
      const c = comeRuolo(ruolo, pwd)
      // La sequence serial e' coperta dai default privileges.
      await c.$executeRawUnsafe(`INSERT INTO ${T_FUTURA} (v) VALUES ('a')`)
      await c.$executeRawUnsafe(`UPDATE ${T_FUTURA} SET v = 'b'`)
      const r = await c.$queryRawUnsafe<{ v: string }[]>(`SELECT v FROM ${T_FUTURA}`)
      expect(r.length).toBeGreaterThan(0)
      await c.$executeRawUnsafe(`DELETE FROM ${T_FUTURA}`)
      await negato(c.$executeRawUnsafe(`TRUNCATE ${T_FUTURA}`))
    }
  })

  it('script eseguito due volte: nessun errore; seconda password valida, prima no', async () => {
    await expect(eseguiScript(owner, PWD_APP_2, PWD_SIS_2)).resolves.toBeUndefined()
    await verificaCheLaPasswordSiaRichiesta()

    for (const [ruolo, nuova, vecchia] of [
      ['wasteflow_app', PWD_APP_2, PWD_APP_1],
      ['wasteflow_sistema', PWD_SIS_2, PWD_SIS_1],
    ]) {
      const ok = comeRuolo(ruolo, nuova)
      await ok.$queryRawUnsafe(`SELECT 1 FROM ${T_ESISTENTE}`)
      const ko = comeRuolo(ruolo, vecchia)
      await expect(ko.$queryRawUnsafe(`SELECT 1`)).rejects.toThrow(/authentication failed/i)
    }
    // I GRANT restano identici dopo la seconda esecuzione.
    await crud(comeRuolo('wasteflow_app', PWD_APP_2), T_ESISTENTE)
    // Anche la sola lettura del catalogo: lo script rieseguito la ripristina, non la perde.
    for (const ruolo of ['wasteflow_app', 'wasteflow_sistema']) {
      expect(await privilegi(ruolo, 'causali_registro')).toEqual(SOLA_LETTURA)
      expect(await privilegi(ruolo, 'waste_movements')).toEqual(CRUD)
    }
  })

  it('causali_registro: se i privilegi di scrittura tornano (GRANT manuale), lo script li toglie di nuovo', async () => {
    try {
      await owner.$executeRawUnsafe(
        `GRANT INSERT, UPDATE, DELETE ON TABLE causali_registro TO wasteflow_app, wasteflow_sistema`
      )
      expect((await privilegi('wasteflow_app', 'causali_registro')).INSERT).toBe(true)
      await eseguiScript(owner, PWD_APP_2, PWD_SIS_2)
    } finally {
      // Qualunque cosa succeda, il catalogo non resta scrivibile dai ruoli applicativi.
      await owner.$executeRawUnsafe(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE causali_registro FROM wasteflow_app, wasteflow_sistema`
      )
    }
    for (const ruolo of ['wasteflow_app', 'wasteflow_sistema']) {
      expect(await privilegi(ruolo, 'causali_registro')).toEqual(SOLA_LETTURA)
    }
  })

  it('senza _prisma_migrations lo script fallisce (da eseguire dopo migrate deploy)', async () => {
    // Transazione che rinomina la tabella e poi viene annullata: nessun
    // effetto sul DB condiviso (il rename tiene un lock solo per la durata).
    const SENTINELLA = new Error('rollback voluto')
    const esito = owner
      .$transaction(async tx => {
        await tx.$executeRawUnsafe(`ALTER TABLE _prisma_migrations RENAME TO _pm_tmp_test`)
        await eseguiNellaTx(tx, PWD_APP_2, PWD_SIS_2)
        throw SENTINELLA
      })
      .catch(e => e as Error)
    const errore = await esito
    expect(errore).not.toBe(SENTINELLA)
    expect(String(errore.message)).toMatch(/eseguire dopo prisma migrate deploy/)
    const [t] = await owner.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`
    )
    expect(t.ok).toBe(true)
  })

  it('da un ruolo non superuser lo script fallisce', async () => {
    const app = comeRuolo('wasteflow_app', PWD_APP_2)
    const errore = await app
      .$transaction(async tx => eseguiNellaTx(tx, PWD_APP_2, PWD_SIS_2))
      .catch(e => e as Error)
    expect(String((errore as Error).message)).toMatch(/superuser|permission denied|must be/i)
  })
})
