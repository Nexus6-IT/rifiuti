/**
 * Schema della marcatura per consorzio (fase 4.9b, T8) contro un Postgres reale:
 * `regole_consorzio` e `dati_consorzio_movimento`.
 *
 * Le scritture di prova si fanno col ruolo applicativo `wasteflow_app` dentro il contesto
 * dell'azienda (RLS e privilegi) con SQL esplicito: la spec prova i vincoli del database, non il
 * client generato. Il proprietario prepara i dati di partenza. Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaMovimentoDiTest, pulisciTenantDiTest } from '../../test-support/legami-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('Marcatura per consorzio: schema (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  interface Scenario {
    t: string
    registroId: string
    movimentoId: string
  }

  async function scenario(): Promise<Scenario> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Consorzi SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const m = await creaMovimentoDiTest(owner, t.id)
    return { t: t.id, registroId: m.registroId, movimentoId: m.movimentoId }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  interface DatiRegola {
    consorzio?: string
    verso?: string | null
    prefisso?: string | null
    esatto?: string | null
    registroId?: string | null
  }

  function inserisciRegola(tx: Tx, tenant: string, o: DatiRegola = {}) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO regole_consorzio
         (tenant_id, consorzio, verso, cer_prefisso, cer_esatto, registro_id, updated_at)
       VALUES ($1::uuid, $2, $3::waste_movement_type, $4, $5, $6::uuid, now())
       RETURNING id::text AS id`,
      tenant,
      o.consorzio ?? 'CONOU',
      o.verso === undefined ? null : o.verso,
      o.prefisso === undefined ? (o.esatto === undefined ? '13' : null) : o.prefisso,
      o.esatto === undefined ? null : o.esatto,
      o.registroId === undefined ? null : o.registroId
    )
  }

  interface DatiOverride {
    consorzio?: string
    verso?: string
    movimentoId?: string
    registroId?: string
    dati?: string | null
    versioneSchema?: number | null
  }

  function inserisciOverride(tx: Tx, s: Scenario, o: DatiOverride = {}) {
    return tx.$executeRawUnsafe(
      `INSERT INTO dati_consorzio_movimento
         (tenant_id, registro_id, verso, movimento_originale_id, consorzio, dati, versione_schema, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::uuid, $5, $6::jsonb, $7::smallint, now())`,
      s.t,
      o.registroId ?? s.registroId,
      o.verso ?? 'CARICO',
      o.movimentoId ?? s.movimentoId,
      o.consorzio ?? 'CONOU',
      o.dati === undefined ? null : o.dati,
      o.versioneSchema === undefined ? null : o.versioneSchema
    )
  }

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM dati_consorzio_movimento WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await owner.$executeRawUnsafe(
      `DELETE FROM regole_consorzio WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('le due tabelle hanno RLS ENABLE + FORCE e le due policy attese', async () => {
    const righe = await owner.$queryRawUnsafe<
      { tabella: string; rls: boolean; forzata: boolean; policy: string[] }[]
    >(
      `SELECT c.relname AS tabella, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzata,
              (SELECT array_agg(policyname ORDER BY policyname) FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relname IN ('regole_consorzio', 'dati_consorzio_movimento')
       ORDER BY 1`
    )
    expect(righe).toEqual([
      {
        tabella: 'dati_consorzio_movimento',
        rls: true,
        forzata: true,
        policy: ['isolamento_azienda', 'sola_lettura'],
      },
      {
        tabella: 'regole_consorzio',
        rls: true,
        forzata: true,
        policy: ['isolamento_azienda', 'sola_lettura'],
      },
    ])
  })

  it('inserisce una regola (prefisso o codice esatto) e una correzione e le rilegge', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      await inserisciRegola(tx, s.t)
      await inserisciRegola(tx, s.t, { consorzio: 'COBAT', esatto: '160601', verso: 'CARICO' })
      await inserisciOverride(tx, s)
      const r = await tx.$queryRawUnsafe<{ regole: number; correzioni: number }[]>(
        `SELECT (SELECT count(*) FROM regole_consorzio)::int AS regole,
                (SELECT count(*) FROM dati_consorzio_movimento)::int AS correzioni`
      )
      expect(r[0]).toEqual({ regole: 2, correzioni: 1 })
    })
  })

  it('CHECK regole: consorzio fuori elenco, CER in formato sbagliato, prefisso ed esatto insieme o nessuno', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiRegola) => comeApp(s.t, tx => inserisciRegola(tx, s.t, o))
    await expect(rifiutata({ consorzio: 'ORSO' })).rejects.toThrow(
      /regole_consorzio_consorzio_ammesso/
    )
    await expect(rifiutata({ prefisso: '1' })).rejects.toThrow(
      /regole_consorzio_cer_prefisso_formato/
    )
    await expect(rifiutata({ prefisso: '13 0' })).rejects.toThrow(
      /regole_consorzio_cer_prefisso_formato/
    )
    await expect(rifiutata({ esatto: '16060' })).rejects.toThrow(
      /regole_consorzio_cer_esatto_formato/
    )
    await expect(rifiutata({ prefisso: '13', esatto: '130205' })).rejects.toThrow(
      /regole_consorzio_cer_uno_solo/
    )
    await expect(rifiutata({ prefisso: null, esatto: null })).rejects.toThrow(
      /regole_consorzio_cer_uno_solo/
    )
    await expect(rifiutata({ verso: 'ENTRAMBI' })).rejects.toThrow()
  })

  it('CHECK correzioni: consorzio fuori elenco; dati e versione dello schema vanno insieme', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiOverride) => comeApp(s.t, tx => inserisciOverride(tx, s, o))
    await expect(rifiutata({ consorzio: 'ORSO' })).rejects.toThrow(
      /dati_consorzio_movimento_consorzio_ammesso/
    )
    await expect(rifiutata({ dati: '{"a":1}' })).rejects.toThrow(
      /dati_consorzio_movimento_schema_coerente/
    )
    await expect(rifiutata({ versioneSchema: 1 })).rejects.toThrow(
      /dati_consorzio_movimento_schema_coerente/
    )
    await comeApp(s.t, tx => inserisciOverride(tx, s, { dati: '{"a":1}', versioneSchema: 1 }))
  })

  it('unicita: una sola correzione per movimento e consorzio, consorzi diversi ammessi', async () => {
    const s = await scenario()
    await comeApp(s.t, tx => inserisciOverride(tx, s))
    await expect(comeApp(s.t, tx => inserisciOverride(tx, s))).rejects.toThrow(/`23505`/)
    await comeApp(s.t, tx => inserisciOverride(tx, s, { consorzio: 'COBAT' }))
  })

  it("FK composte: registro e movimento di un'altra azienda sono rifiutati, e il verso deve essere quello vero", async () => {
    const a = await scenario()
    const b = await scenario()
    await expect(
      comeApp(a.t, tx => inserisciRegola(tx, a.t, { registroId: b.registroId }))
    ).rejects.toThrow(/regole_consorzio_registro_fkey/)
    await expect(
      comeApp(a.t, tx =>
        inserisciOverride(tx, { ...a, registroId: b.registroId }, { movimentoId: b.movimentoId })
      )
    ).rejects.toThrow(/dati_consorzio_movimento_originale_fkey/)
    await expect(
      comeApp(a.t, tx => inserisciOverride(tx, a, { verso: 'SCARICO' }))
    ).rejects.toThrow(/dati_consorzio_movimento_originale_fkey/)
  })

  it("RLS: un'altra azienda non vede ne scrive le righe; senza contesto non si vede nulla", async () => {
    const a = await scenario()
    const b = await scenario()
    await comeApp(a.t, async tx => {
      await inserisciRegola(tx, a.t)
      await inserisciOverride(tx, a)
    })
    const viste = await comeApp(b.t, tx =>
      tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT (SELECT count(*) FROM regole_consorzio)::int
              + (SELECT count(*) FROM dati_consorzio_movimento)::int AS n`
      )
    )
    expect(viste[0].n).toBe(0)
    await expect(comeApp(b.t, tx => inserisciRegola(tx, a.t))).rejects.toThrow(/row-level security/)
    await expect(comeApp(b.t, tx => inserisciOverride(tx, a))).rejects.toThrow(/row-level security/)
    const nessunContesto = await app.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM regole_consorzio`
    )
    expect(nessunContesto[0].n).toBe(0)
  })

  it('il movimento con una correzione non si cancella; il registro con una regola neppure', async () => {
    const s = await scenario()
    const [r] = await comeApp(s.t, tx => inserisciRegola(tx, s.t, { registroId: s.registroId }))
    await comeApp(s.t, tx => inserisciOverride(tx, s))
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM waste_movements WHERE id = $1::uuid`, s.movimentoId)
    ).rejects.toThrow()
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM registri_rifiuti WHERE id = $1::uuid`, s.registroId)
    ).rejects.toThrow()
    await owner.$executeRawUnsafe(`DELETE FROM regole_consorzio WHERE id = $1::uuid`, r.id)
  })
})
