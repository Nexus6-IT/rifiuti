/**
 * Colonna `waste_movements.counterpart_sede_id` (sede della ditta controparte) contro un Postgres
 * reale: tipo, FK composta `(counterpart_sede_id, tenant_id) -> sedi_ditte(id, tenant_id)` NO ACTION,
 * isolamento fra aziende, scrittura col ruolo applicativo sotto RLS, nessun indice (decisione D1).
 *
 * Il proprietario prepara i dati e prova i vincoli che valgono anche per lui; la prova di RLS gira
 * COME `wasteflow_app`. La pulizia cancella SOLO le aziende create qui, per id esatto (la cascata da
 * `tenants` porta via movimenti e sedi nello stesso statement: la FK e' NO ACTION).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
describe('Sede della controparte del movimento: schema (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const tenantCreati: string[] = []
  let progressivo = 0

  interface Azienda {
    t: string
    registroId: string
    sedeId: string
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaUnica(),
          ragioneSociale: 'Sede controparte SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t, descrizione: 'Registro di prova' },
    })
    const { sedeId } = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
    return { t, registroId: registro.id, sedeId }
  }

  /** INSERT di un movimento col client indicato; `sede` e' il valore della colonna (o NULL). */
  function inserisci(
    client: PrismaClient,
    a: Azienda,
    sede: string | null
  ): Promise<{ id: string; sede: string | null }[]> {
    const n = 800_000 + ++progressivo
    return client.$queryRawUnsafe<{ id: string; sede: string | null }[]>(
      `INSERT INTO waste_movements
         (tenant_id, registro_id, progressive_year, progressive_number, type, movement_date,
          registration_date, causale, cer_code, quantity, unit, counterpart_sede_id, updated_at)
       VALUES ('${a.t}', '${a.registroId}', 2026, ${n}, 'CARICO', '2026-03-01T10:00:00Z',
          '2026-03-01T10:00:00Z', 'PRODUZIONE_INTERNA', '15 01 01', 10, 'KG',
          ${sede === null ? 'NULL' : `'${sede}'`}, now())
       RETURNING id::text AS id, counterpart_sede_id::text AS sede`
    )
  }

  const comeApp = <R>(tenantId: string, fn: (tx: PrismaClient) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      return fn(tx as unknown as PrismaClient)
    })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia sede-controparte: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('la colonna esiste, e di tipo uuid ed e nullable', async () => {
    const r = await owner.$queryRawUnsafe<{ data_type: string; is_nullable: string }[]>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'waste_movements'
          AND column_name = 'counterpart_sede_id'`
    )
    expect(r).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }])
  })

  it('la FK composta e NO ACTION sulle colonne (counterpart_sede_id, tenant_id)', async () => {
    const r = await owner.$queryRawUnsafe<
      { confdeltype: string; confupdtype: string; colonne: string[]; riferita: string }[]
    >(
      `SELECT c.confdeltype::text AS confdeltype, c.confupdtype::text AS confupdtype,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS colonne,
              c.confrelid::regclass::text AS riferita
         FROM pg_constraint c
        WHERE c.conname = 'waste_movements_counterpart_sede_fkey'
          AND c.conrelid = 'waste_movements'::regclass`
    )
    expect(r).toEqual([
      {
        confdeltype: 'a',
        confupdtype: 'a',
        colonne: ['counterpart_sede_id', 'tenant_id'],
        riferita: 'sedi_ditte',
      },
    ])
  })

  it('la FK e validata (migration NOT VALID + VALIDATE)', async () => {
    const r = await owner.$queryRawUnsafe<{ convalidated: boolean }[]>(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'waste_movements_counterpart_sede_fkey'`
    )
    expect(r).toEqual([{ convalidated: true }])
  })

  it('accetta NULL e la sede della propria azienda', async () => {
    const a = await azienda()
    const [senza] = await inserisci(owner, a, null)
    expect(senza.sede).toBeNull()
    const [con] = await inserisci(owner, a, a.sedeId)
    expect(con.sede).toBe(a.sedeId)
  })

  it('rifiuta la sede di un altra azienda (23503), anche col proprietario', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(inserisci(owner, a, b.sedeId)).rejects.toMatchObject({
      meta: { code: '23503' },
    })
  })

  it('rifiuta un id di sede inesistente (23503)', async () => {
    const a = await azienda()
    await expect(inserisci(owner, a, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject(
      { meta: { code: '23503' } }
    )
  })

  it('con wasteflow_app sotto RLS la sede della propria azienda si scrive e si rilegge', async () => {
    const a = await azienda()
    const [scritta] = await comeApp(a.t, tx => inserisci(tx, a, a.sedeId))
    const lette = await comeApp(a.t, tx =>
      tx.$queryRawUnsafe<{ sede: string | null }[]>(
        `SELECT counterpart_sede_id::text AS sede FROM waste_movements WHERE id = '${scritta.id}'`
      )
    )
    expect(lette).toEqual([{ sede: a.sedeId }])
  })

  it('con wasteflow_app la sede di un altra azienda e rifiutata', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(comeApp(a.t, tx => inserisci(tx, a, b.sedeId))).rejects.toThrow()
  })

  it('nessun indice sulla colonna (decisione D1: nessuna query filtra per sede)', async () => {
    const r = await owner.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT i.relname::text AS indexname
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = ANY (x.indkey)
        WHERE x.indrelid = 'waste_movements'::regclass AND a.attname = 'counterpart_sede_id'`
    )
    expect(r).toEqual([])
  })
})
