/**
 * Schema delle tabelle dei tracciati (fase 4.9c-f, PR A) contro un Postgres reale:
 * `dati_tracciato_movimento`, `anagrafica_comunicazioni_sede`, `configurazione_comunicazione_sede`.
 *
 * Le scritture di prova si fanno col ruolo applicativo `wasteflow_app` dentro il contesto
 * dell'azienda (RLS e privilegi) con SQL esplicito: la spec prova i vincoli del database, non il
 * client generato. Il proprietario prepara i dati di partenza. Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaMovimentoDiTest, pulisciTenantDiTest } from '../../test-support/legami-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('Tracciati di comunicazione: schema (Postgres reale, ruolo wasteflow_app)', () => {
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
    sedeId: string
    registroId: string
    movimentoId: string
  }

  async function scenario(): Promise<Scenario> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Tracciati SRL', country: 'IT' },
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
    const ditta = await creaDittaConRuolo(owner, t.id, 'PRODUTTORE')
    const m = await creaMovimentoDiTest(owner, t.id)
    return {
      t: t.id,
      unitaId: unita.id,
      sedeId: ditta.sedeId,
      registroId: m.registroId,
      movimentoId: m.movimentoId,
    }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  interface DatiTracciato {
    tracciato?: string
    movimentoId?: string
    registroId?: string
    verso?: string
    dati?: string
    versioneSchema?: number
  }

  function inserisciDati(tx: Tx, s: Scenario, o: DatiTracciato = {}) {
    return tx.$executeRawUnsafe(
      `INSERT INTO dati_tracciato_movimento
         (tenant_id, registro_id, verso, movimento_originale_id, tracciato, dati, versione_schema, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::uuid, $5, $6::jsonb, $7::smallint, now())`,
      s.t,
      o.registroId ?? s.registroId,
      o.verso ?? 'CARICO',
      o.movimentoId ?? s.movimentoId,
      o.tracciato ?? 'CONOU',
      o.dati ?? '{"prodotto":"A"}',
      o.versioneSchema ?? 1
    )
  }

  interface DatiAnagrafica {
    sedeId?: string
    istat?: string | null
    ateco?: string | null
    orso?: string | null
  }

  function inserisciAnagrafica(tx: Tx, s: Scenario, o: DatiAnagrafica = {}) {
    return tx.$executeRawUnsafe(
      `INSERT INTO anagrafica_comunicazioni_sede
         (tenant_id, sede_ditta_id, codice_istat_comune, codice_ateco, codice_orso, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, now())`,
      s.t,
      o.sedeId ?? s.sedeId,
      o.istat === undefined ? null : o.istat,
      o.ateco === undefined ? null : o.ateco,
      o.orso === undefined ? null : o.orso
    )
  }

  interface DatiConfig {
    unitaId?: string
    consorzio?: string
    dati?: string
    versioneSchema?: number
  }

  function inserisciConfig(tx: Tx, s: Scenario, o: DatiConfig = {}) {
    return tx.$executeRawUnsafe(
      `INSERT INTO configurazione_comunicazione_sede
         (tenant_id, unita_locale_id, consorzio, dati, versione_schema, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::smallint, now())`,
      s.t,
      o.unitaId ?? s.unitaId,
      o.consorzio ?? 'CONOU',
      o.dati ?? '{"codiceDeposito":"ABC"}',
      o.versioneSchema ?? 1
    )
  }

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    for (const tabella of [
      'dati_tracciato_movimento',
      'anagrafica_comunicazioni_sede',
      'configurazione_comunicazione_sede',
    ]) {
      await owner.$executeRawUnsafe(
        `DELETE FROM ${tabella} WHERE tenant_id = ANY($1::uuid[])`,
        tenantCreati
      )
    }
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('le tre tabelle hanno RLS ENABLE + FORCE e le due policy attese', async () => {
    const righe = await owner.$queryRawUnsafe<
      { tabella: string; rls: boolean; forzata: boolean; policy: string[] }[]
    >(
      `SELECT c.relname AS tabella, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzata,
              (SELECT array_agg(policyname ORDER BY policyname) FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relname IN ('dati_tracciato_movimento', 'anagrafica_comunicazioni_sede',
                           'configurazione_comunicazione_sede')
       ORDER BY 1`
    )
    const attese = [
      'anagrafica_comunicazioni_sede',
      'configurazione_comunicazione_sede',
      'dati_tracciato_movimento',
    ]
    expect(righe).toEqual(
      attese.map(tabella => ({
        tabella,
        rls: true,
        forzata: true,
        policy: ['isolamento_azienda', 'sola_lettura'],
      }))
    )
  })

  it('inserisce una riga per tabella e le rilegge', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      await inserisciDati(tx, s)
      await inserisciAnagrafica(tx, s, { istat: '063049', ateco: '38.11.00', orso: '123456' })
      await inserisciConfig(tx, s)
      const r = await tx.$queryRawUnsafe<{ d: number; a: number; c: number }[]>(
        `SELECT (SELECT count(*) FROM dati_tracciato_movimento)::int AS d,
                (SELECT count(*) FROM anagrafica_comunicazioni_sede)::int AS a,
                (SELECT count(*) FROM configurazione_comunicazione_sede)::int AS c`
      )
      expect(r[0]).toEqual({ d: 1, a: 1, c: 1 })
    })
  })

  it('CHECK dati del tracciato: tracciato fuori elenco, dati non oggetto, versione non positiva', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiTracciato) => comeApp(s.t, tx => inserisciDati(tx, s, o))
    await expect(rifiutata({ tracciato: 'ORSO' })).rejects.toThrow(
      /dati_tracciato_movimento_tracciato_ammesso/
    )
    await expect(rifiutata({ dati: '[1]' })).rejects.toThrow(
      /dati_tracciato_movimento_dati_oggetto/
    )
    await expect(rifiutata({ versioneSchema: 0 })).rejects.toThrow(
      /dati_tracciato_movimento_versione_positiva/
    )
    for (const tracciato of ['CONOU', 'COBAT', 'ORR']) {
      await comeApp(s.t, tx => inserisciDati(tx, s, { tracciato }))
    }
  })

  it('CHECK anagrafica: ISTAT a 6 cifre, ATECO NN.NN.NN o 6 cifre, codice ARPA 1-9 cifre', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiAnagrafica) => comeApp(s.t, tx => inserisciAnagrafica(tx, s, o))
    await expect(rifiutata({ istat: '6304' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_istat_formato/
    )
    await expect(rifiutata({ istat: '06304A' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_istat_formato/
    )
    await expect(rifiutata({ ateco: '38.11' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_ateco_formato/
    )
    await expect(rifiutata({ ateco: '38-11-00' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_ateco_formato/
    )
    await expect(rifiutata({ orso: '' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_orso_formato/
    )
    await expect(rifiutata({ orso: '12345678A' })).rejects.toThrow(
      /anagrafica_comunicazioni_sede_orso_formato/
    )
    await comeApp(s.t, tx => inserisciAnagrafica(tx, s, { ateco: '381100', orso: '1' }))
  })

  it('CHECK configurazione: consorzio fuori elenco, dati non oggetto, versione non positiva', async () => {
    const s = await scenario()
    const rifiutata = (o: DatiConfig) => comeApp(s.t, tx => inserisciConfig(tx, s, o))
    await expect(rifiutata({ consorzio: 'COREPLA' })).rejects.toThrow(
      /configurazione_comunicazione_sede_consorzio_ammesso/
    )
    await expect(rifiutata({ dati: '"x"' })).rejects.toThrow(
      /configurazione_comunicazione_sede_dati_oggetto/
    )
    await expect(rifiutata({ versioneSchema: -1 })).rejects.toThrow(
      /configurazione_comunicazione_sede_versione_positiva/
    )
    for (const consorzio of ['CONOU', 'COBAT', 'ORSO', 'ORR']) {
      await comeApp(s.t, tx => inserisciConfig(tx, s, { consorzio }))
    }
  })

  it('unicita: una riga per (movimento, tracciato), per sede ditta, per (sede, consorzio)', async () => {
    const s = await scenario()
    await comeApp(s.t, async tx => {
      await inserisciDati(tx, s)
      await inserisciAnagrafica(tx, s)
      await inserisciConfig(tx, s)
    })
    await expect(comeApp(s.t, tx => inserisciDati(tx, s))).rejects.toThrow(/`23505`/)
    await expect(comeApp(s.t, tx => inserisciAnagrafica(tx, s))).rejects.toThrow(/`23505`/)
    await expect(comeApp(s.t, tx => inserisciConfig(tx, s))).rejects.toThrow(/`23505`/)
    await comeApp(s.t, async tx => {
      await inserisciDati(tx, s, { tracciato: 'COBAT' })
      await inserisciConfig(tx, s, { consorzio: 'COBAT' })
    })
  })

  it("FK composte: movimento, sede ditta e sede propria di un'altra azienda sono rifiutati", async () => {
    const a = await scenario()
    const b = await scenario()
    await expect(
      comeApp(a.t, tx =>
        inserisciDati(tx, { ...a, registroId: b.registroId }, { movimentoId: b.movimentoId })
      )
    ).rejects.toThrow(/dati_tracciato_movimento_originale_fkey/)
    await expect(comeApp(a.t, tx => inserisciDati(tx, a, { verso: 'SCARICO' }))).rejects.toThrow(
      /dati_tracciato_movimento_originale_fkey/
    )
    await expect(
      comeApp(a.t, tx => inserisciAnagrafica(tx, a, { sedeId: b.sedeId }))
    ).rejects.toThrow(/anagrafica_comunicazioni_sede_sede_fkey/)
    await expect(
      comeApp(a.t, tx => inserisciConfig(tx, a, { unitaId: b.unitaId }))
    ).rejects.toThrow(/configurazione_comunicazione_sede_unita_locale_fkey/)
  })

  it("RLS: un'altra azienda non vede ne scrive le righe; senza contesto non si vede nulla", async () => {
    const a = await scenario()
    const b = await scenario()
    await comeApp(a.t, async tx => {
      await inserisciDati(tx, a)
      await inserisciAnagrafica(tx, a)
      await inserisciConfig(tx, a)
    })
    const viste = await comeApp(b.t, tx =>
      tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT (SELECT count(*) FROM dati_tracciato_movimento)::int
              + (SELECT count(*) FROM anagrafica_comunicazioni_sede)::int
              + (SELECT count(*) FROM configurazione_comunicazione_sede)::int AS n`
      )
    )
    expect(viste[0].n).toBe(0)
    await expect(comeApp(b.t, tx => inserisciDati(tx, a))).rejects.toThrow(/row-level security/)
    await expect(comeApp(b.t, tx => inserisciAnagrafica(tx, a))).rejects.toThrow(
      /row-level security/
    )
    await expect(comeApp(b.t, tx => inserisciConfig(tx, a))).rejects.toThrow(/row-level security/)
    const nessunContesto = await app.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM dati_tracciato_movimento`
    )
    expect(nessunContesto[0].n).toBe(0)
  })

  it('il movimento con dati del tracciato non si cancella', async () => {
    const s = await scenario()
    await comeApp(s.t, tx => inserisciDati(tx, s))
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM waste_movements WHERE id = $1::uuid`, s.movimentoId)
    ).rejects.toThrow()
  })
})
