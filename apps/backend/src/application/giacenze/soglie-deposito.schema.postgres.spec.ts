/**
 * Schema delle soglie del deposito temporaneo (Fase 2 pezzo 6, Task 3) contro un Postgres reale.
 *
 * Si prova col ruolo applicativo `wasteflow_app` (RLS e privilegi: da superuser non si vedono). I
 * CHECK ripetono i range di `validaSoglie`: un caso per vincolo, col nome del vincolo nell'errore.
 * Dati di prova: aziende e registri creati dal proprietario, rimossi in fondo per tenant.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

describe('Soglie deposito temporaneo, schema (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  let n = 0

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `SD${suffisso}`, ragioneSociale: 'Soglie SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro di prova' },
    })
    return { tenantId: t.id, registroId: registro.id }
  }

  /** Esegue come `wasteflow_app` dentro il contesto dell'azienda (set_config locale alla transazione). */
  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  interface Valori {
    registroId?: string | null
    criterio?: string
    giorniMax?: number | null
    kgTot?: number
    kgPer?: number
    prevGiorni?: number
    prevPerc?: number
  }

  /** INSERT come `wasteflow_app` nel contesto dell'azienda; ritorna l'id. */
  function inserisci(tx: Tx, tenantId: string, v: Valori = {}) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO soglie_deposito_temporaneo
         (tenant_id, registro_id, criterio, giorni_max, kg_max_totale, kg_max_pericolosi,
          preavviso_giorni, preavviso_percentuale, impostato_da, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::criterio_deposito_temporaneo, $4::smallint, $5::numeric,
               $6::numeric, $7::smallint, $8::smallint, $9::uuid, now())
       RETURNING id::text AS id`,
      tenantId,
      v.registroId ?? null,
      v.criterio ?? 'TEMPORALE',
      v.giorniMax === undefined ? 60 : v.giorniMax,
      v.kgTot ?? 30000,
      v.kgPer ?? 10000,
      v.prevGiorni ?? 7,
      v.prevPerc ?? 90,
      randomUUID()
    )
  }

  afterAll(async () => {
    for (const id of tenantCreati) {
      await owner.registroRifiuti.deleteMany({ where: { tenantId: id } })
      await owner.tenant.delete({ where: { id } }).catch(() => undefined)
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('inserisce la riga azienda (giorni_max NULL) e la riga registro', async () => {
    const { tenantId, registroId } = await azienda()
    await comeApp(tenantId, async tx => {
      await inserisci(tx, tenantId, { giorniMax: null, prevGiorni: 88 })
      await inserisci(tx, tenantId, { registroId })
    })
    const righe = await owner.$queryRawUnsafe<
      { registro_id: string | null; giorni_max: number | null }[]
    >(
      `SELECT registro_id::text, giorni_max FROM soglie_deposito_temporaneo
       WHERE tenant_id = $1::uuid ORDER BY registro_id NULLS FIRST`,
      tenantId
    )
    expect(righe).toEqual([
      { registro_id: null, giorni_max: null },
      { registro_id: registroId, giorni_max: 60 },
    ])
  })

  it('una seconda riga azienda per lo stesso tenant viola l indice parziale', async () => {
    const { tenantId } = await azienda()
    await comeApp(tenantId, tx => inserisci(tx, tenantId))
    await expect(comeApp(tenantId, tx => inserisci(tx, tenantId))).rejects.toThrow(
      /Code: `23505`/ // unique_violation: Prisma non riporta il nome dell indice; per due righe azienda solo il parziale puo scattare
    )
  })

  it('una seconda riga per lo stesso registro viola l unico', async () => {
    const { tenantId, registroId } = await azienda()
    await comeApp(tenantId, tx => inserisci(tx, tenantId, { registroId }))
    await expect(comeApp(tenantId, tx => inserisci(tx, tenantId, { registroId }))).rejects.toThrow(
      /Code: `23505`/ // unique_violation: per due righe dello stesso registro scatta solo l unico (il parziale e solo per registro_id NULL)
    )
  })

  it('un registro di un altra azienda viola la chiave esterna composta', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(
      comeApp(a.tenantId, tx => inserisci(tx, a.tenantId, { registroId: b.registroId }))
    ).rejects.toThrow(/soglie_deposito_temporaneo_registro_fkey/)
  })

  describe('CHECK', () => {
    const P = 'soglie_deposito_temporaneo_'
    const casi: Array<[string, Valori, RegExp]> = [
      ['giorni_max 0', { giorniMax: 0, prevGiorni: 0 }, new RegExp(`${P}giorni_max_check`)],
      ['giorni_max 93', { giorniMax: 93 }, new RegExp(`${P}giorni_max_check`)],
      // Con totale 0 anche i pericolosi (> 0 e <= totale) sono fuori range: Postgres riporta il primo CHECK in ordine di nome.
      ['kg totale 0', { kgTot: 0, kgPer: 0.01 }, new RegExp(`${P}kg_(totale|pericolosi)_check`)],
      ['kg totale oltre 10 milioni', { kgTot: 10000000.01 }, new RegExp(`${P}kg_totale_check`)],
      ['kg pericolosi 0', { kgPer: 0 }, new RegExp(`${P}kg_pericolosi_check`)],
      [
        'kg pericolosi oltre il totale',
        { kgTot: 100, kgPer: 101 },
        new RegExp(`${P}kg_pericolosi_check`),
      ],
      ['preavviso_giorni negativo', { prevGiorni: -1 }, new RegExp(`${P}preavviso_giorni_check`)],
      [
        'preavviso_giorni 89 con giorni_max NULL',
        { giorniMax: null, prevGiorni: 89 },
        new RegExp(`${P}preavviso_giorni_check`),
      ],
      [
        'preavviso_giorni 30 con giorni_max 30',
        { giorniMax: 30, prevGiorni: 30 },
        new RegExp(`${P}preavviso_giorni_check`),
      ],
      [
        'preavviso_percentuale 100',
        { prevPerc: 100 },
        new RegExp(`${P}preavviso_percentuale_check`),
      ],
      [
        'preavviso_percentuale negativa',
        { prevPerc: -1 },
        new RegExp(`${P}preavviso_percentuale_check`),
      ],
    ]
    it.each(casi)('%s è respinto', async (_nome, v, atteso) => {
      const { tenantId } = await azienda()
      await expect(comeApp(tenantId, tx => inserisci(tx, tenantId, v))).rejects.toThrow(atteso)
    })

    it('i valori limite sono accettati', async () => {
      const { tenantId, registroId } = await azienda()
      await comeApp(tenantId, async tx => {
        await inserisci(tx, tenantId, {
          giorniMax: null,
          prevGiorni: 88,
          kgTot: 10000000,
          kgPer: 10000000,
          prevPerc: 99,
        })
        await inserisci(tx, tenantId, { registroId, giorniMax: 92, prevGiorni: 88, prevPerc: 0 })
      })
    })
  })

  it('con il contesto di un altra azienda la riga non si vede né si aggiorna', async () => {
    const a = await azienda()
    const b = await azienda()
    const [{ id }] = await comeApp(a.tenantId, tx => inserisci(tx, a.tenantId))
    await comeApp(b.tenantId, async tx => {
      const viste = await tx.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM soglie_deposito_temporaneo WHERE id = $1::uuid`,
        id
      )
      expect(viste).toHaveLength(0)
      const toccate = await tx.$executeRawUnsafe(
        `UPDATE soglie_deposito_temporaneo SET note = 'x' WHERE id = $1::uuid`,
        id
      )
      expect(toccate).toBe(0)
    })
    const [riga] = await owner.$queryRawUnsafe<{ note: string | null }[]>(
      `SELECT note FROM soglie_deposito_temporaneo WHERE id = $1::uuid`,
      id
    )
    expect(riga.note).toBeNull()
  })

  it('cancellare il registro cancella la sua riga e lascia quella dell azienda', async () => {
    const { tenantId, registroId } = await azienda()
    await comeApp(tenantId, async tx => {
      await inserisci(tx, tenantId)
      await inserisci(tx, tenantId, { registroId })
    })
    await owner.registroRifiuti.delete({ where: { id: registroId } })
    const righe = await owner.$queryRawUnsafe<{ registro_id: string | null }[]>(
      `SELECT registro_id::text FROM soglie_deposito_temporaneo WHERE tenant_id = $1::uuid`,
      tenantId
    )
    expect(righe).toEqual([{ registro_id: null }])
  })
})
