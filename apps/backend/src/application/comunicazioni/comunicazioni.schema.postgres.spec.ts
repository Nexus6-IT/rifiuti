/**
 * Schema delle comunicazioni ai consorzi (fase 4.9a, T0) contro un Postgres reale:
 * `comunicazioni_consorzi` e `comunicazioni_consorzi_movimenti`.
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

const HASH = 'a'.repeat(64)

describe('Comunicazioni ai consorzi: schema (Postgres reale, ruolo wasteflow_app)', () => {
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
    unitaId: string
    movimentoId: string
    registroId: string
  }

  async function scenario(): Promise<Scenario> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Comunicazioni SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const unita = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: 'OP1234ABC000001-MI0001',
        denominazione: 'Sede di prova',
        principale: true,
      },
    })
    const m = await creaMovimentoDiTest(owner, t.id)
    return { t: t.id, unitaId: unita.id, movimentoId: m.movimentoId, registroId: m.registroId }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  interface DatiComunicazione {
    unitaId?: string
    periodoDa?: string
    periodoA?: string
    stato?: string
    hash?: string
    inviataIl?: string | null
    inviataDa?: string | null
  }

  function inserisciComunicazione(tx: Tx, s: Scenario, o: DatiComunicazione = {}) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO comunicazioni_consorzi
         (tenant_id, consorzio, unita_locale_id, periodo_da, periodo_a, tracciato, versione, stato,
          hash_dati, nome_file, contenuto, inviata_il, inviata_da, updated_at)
       VALUES ($1::uuid, 'ORSO', $2::uuid, $3::date, $4::date, 'ORSO_IMPIANTO_MESI', '1',
          $5, $6, 'orso.xml', '<x/>', $7::timestamptz, $8::uuid, now())
       RETURNING id::text AS id`,
      s.t,
      o.unitaId ?? s.unitaId,
      o.periodoDa ?? '2026-01-01',
      o.periodoA ?? '2026-12-31',
      o.stato ?? 'GENERATA',
      o.hash ?? HASH,
      o.inviataIl === undefined ? null : o.inviataIl,
      o.inviataDa === undefined ? null : o.inviataDa
    )
  }

  function inserisciMovimento(
    tx: Tx,
    s: Scenario,
    comunicazioneId: string,
    over: { tipo?: string; movimentoId?: string; kg?: string } = {}
  ) {
    return tx.$executeRawUnsafe(
      `INSERT INTO comunicazioni_consorzi_movimenti
         (tenant_id, comunicazione_id, movimento_id, registro_id, movimento_tipo, quantita_kg)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::waste_movement_type, $6::numeric)`,
      s.t,
      comunicazioneId,
      over.movimentoId ?? s.movimentoId,
      s.registroId,
      over.tipo ?? 'CARICO',
      over.kg ?? '100.500'
    )
  }

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM comunicazioni_consorzi WHERE tenant_id = ANY($1::uuid[])`,
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
       WHERE c.relname IN ('comunicazioni_consorzi', 'comunicazioni_consorzi_movimenti')
       ORDER BY 1`
    )
    expect(righe).toEqual([
      {
        tabella: 'comunicazioni_consorzi',
        rls: true,
        forzata: true,
        policy: ['isolamento_azienda', 'sola_lettura'],
      },
      {
        tabella: 'comunicazioni_consorzi_movimenti',
        rls: true,
        forzata: true,
        policy: ['isolamento_azienda', 'sola_lettura'],
      },
    ])
  })

  it('inserisce una comunicazione con la sua istantanea e la rilegge', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      const [c] = await inserisciComunicazione(tx, s)
      await inserisciMovimento(tx, s, c.id)
      const r = await tx.$queryRawUnsafe<{ n: number; stato: string }[]>(
        `SELECT count(m.*)::int AS n, max(c.stato) AS stato
         FROM comunicazioni_consorzi c JOIN comunicazioni_consorzi_movimenti m ON m.comunicazione_id = c.id
         WHERE c.id = $1::uuid`,
        c.id
      )
      expect(r[0]).toEqual({ n: 1, stato: 'GENERATA' })
    })
  })

  it('CHECK: stato fuori elenco, periodo invertito, hash malformato, invio incoerente', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiComunicazione) => comeApp(s.t, tx => inserisciComunicazione(tx, s, o))
    await expect(rifiutata({ stato: 'BOZZA' })).rejects.toThrow(/`23514`/)
    await expect(rifiutata({ periodoDa: '2026-02-01', periodoA: '2026-01-31' })).rejects.toThrow(
      /comunicazioni_consorzi_periodo_valido/
    )
    await expect(rifiutata({ hash: 'XYZ' })).rejects.toThrow(/comunicazioni_consorzi_hash_formato/)
    await expect(rifiutata({ stato: 'INVIATA' })).rejects.toThrow(
      /comunicazioni_consorzi_invio_coerente/
    )
    await expect(
      rifiutata({ stato: 'GENERATA', inviataIl: '2026-02-01T10:00:00Z' })
    ).rejects.toThrow(/comunicazioni_consorzi_invio_coerente/)
    await comeApp(s.t, async tx => {
      await inserisciComunicazione(tx, s, {
        stato: 'INVIATA',
        inviataIl: '2026-02-01T10:00:00Z',
        hash: 'b'.repeat(64),
      })
    })
  })

  it('la generazione e idempotente per hash: stesso hash = stessa riga, hash diverso = riga nuova', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      await inserisciComunicazione(tx, s)
    })
    await expect(comeApp(s.t, tx => inserisciComunicazione(tx, s))).rejects.toThrow(/`23505`/)
    await comeApp(s.t, async tx => {
      await inserisciComunicazione(tx, s, { hash: 'c'.repeat(64) })
    })
  })

  it("FK composte: una sede di un'altra azienda e un movimento di un'altra azienda sono rifiutati", async () => {
    const a = await scenario()
    const b = await scenario()
    // La sede di B dentro una comunicazione di A.
    await expect(
      comeApp(a.t, tx => inserisciComunicazione(tx, a, { unitaId: b.unitaId }))
    ).rejects.toThrow(/comunicazioni_consorzi_unita_locale_fkey/)
    // Il movimento di B nell'istantanea di una comunicazione di A.
    await comeApp(a.t, async tx => {
      const [c] = await inserisciComunicazione(tx, a)
      await expect(
        inserisciMovimento(tx, { ...a, registroId: b.registroId }, c.id, {
          movimentoId: b.movimentoId,
        })
      ).rejects.toThrow(/comunicazioni_consorzi_movimenti_movimento_fkey/)
    })
  })

  it('FK movimento: il tipo deve essere quello vero del movimento', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      const [c] = await inserisciComunicazione(tx, s)
      await expect(inserisciMovimento(tx, s, c.id, { tipo: 'SCARICO' })).rejects.toThrow(
        /comunicazioni_consorzi_movimenti_movimento_fkey/
      )
    })
  })

  it('la stessa riga di movimento non entra due volte nella stessa comunicazione; kg negativi no', async () => {
    const s = await scenario()
    const [c] = await comeApp(s.t, tx => inserisciComunicazione(tx, s))
    await comeApp(s.t, tx => inserisciMovimento(tx, s, c.id))
    await expect(comeApp(s.t, tx => inserisciMovimento(tx, s, c.id))).rejects.toThrow(/`23505`/)
    const altro = await creaMovimentoDiTest(owner, s.t)
    await expect(
      comeApp(s.t, tx =>
        inserisciMovimento(tx, s, c.id, { movimentoId: altro.movimentoId, kg: '-1' })
      )
    ).rejects.toThrow(/comunicazioni_consorzi_movimenti_quantita_check/)
  })

  it("RLS: un'altra azienda non vede ne scrive le righe; senza contesto non si vede nulla", async () => {
    const a = await scenario()
    const b = await scenario()
    const [c] = await comeApp(a.t, tx => inserisciComunicazione(tx, a))
    await comeApp(a.t, tx => inserisciMovimento(tx, a, c.id))
    const viste = await comeApp(b.t, tx =>
      tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT (SELECT count(*) FROM comunicazioni_consorzi)::int
              + (SELECT count(*) FROM comunicazioni_consorzi_movimenti)::int AS n`
      )
    )
    expect(viste[0].n).toBe(0)
    await expect(
      comeApp(b.t, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO comunicazioni_consorzi
             (tenant_id, consorzio, unita_locale_id, periodo_da, periodo_a, tracciato, versione,
              hash_dati, nome_file, contenuto, updated_at)
           VALUES ($1::uuid, 'ORSO', $2::uuid, '2026-01-01', '2026-01-31', 't', '1', $3, 'f', 'c', now())`,
          a.t,
          a.unitaId,
          HASH
        )
      )
    ).rejects.toThrow(/row-level security/)
    const nessunContesto = await app.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM comunicazioni_consorzi`
    )
    expect(nessunContesto[0].n).toBe(0)
  })

  it('cancellare la comunicazione porta via la sua istantanea; la sede referenziata non si cancella', async () => {
    const s = await scenario()
    const [c] = await comeApp(s.t, tx => inserisciComunicazione(tx, s))
    await comeApp(s.t, tx => inserisciMovimento(tx, s, c.id))
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM rentri_unita_locali WHERE id = $1::uuid`, s.unitaId)
    ).rejects.toThrow()
    await owner.$executeRawUnsafe(`DELETE FROM comunicazioni_consorzi WHERE id = $1::uuid`, c.id)
    const [r] = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM comunicazioni_consorzi_movimenti WHERE tenant_id = $1::uuid`,
      s.t
    )
    expect(r.n).toBe(0)
  })
})
