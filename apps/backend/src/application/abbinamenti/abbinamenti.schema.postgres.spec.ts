/**
 * Schema degli abbinamenti carico-scarico (4.6, Task 3) contro un Postgres reale.
 *
 * Si prova col ruolo applicativo `wasteflow_app` (RLS e privilegi: da superuser non si vedrebbero).
 * Dati di prova: aziende, registri, movimenti e giacenze creati dal proprietario, rimossi in fondo
 * solo per id esatti (tenant creati qui).
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55442/wasteflow_ci?schema=public'

describe('Abbinamenti carico-scarico, schema (Postgres reale)', () => {
  const CER = '99 99 09'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let n = 0

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  interface Scenario {
    tenantId: string
    registroId: string
    caricoId: string
    scaricoId: string
    giacenzaId: string
  }

  async function azienda(): Promise<Scenario> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `AB${suffisso}`, ragioneSociale: 'Abbinamenti SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro di prova' },
    })
    const mov = (numero: number, type: 'CARICO' | 'SCARICO') =>
      owner.wasteMovement.create({
        data: {
          tenantId: t.id,
          registroId: registro.id,
          progressiveYear: 2026,
          progressiveNumber: numero,
          type,
          movementDate: new Date('2026-03-01T10:00:00Z'),
          registrationDate: new Date('2026-03-01T10:00:00Z'),
          causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO',
          cerCode: CER,
          quantity: 100,
          unit: 'KG',
          tipoAnnotazione: 'ORDINARIA',
        },
      })
    const carico = await mov(1, 'CARICO')
    const scarico = await mov(2, 'SCARICO')
    const giacenza = await owner.giacenzaIniziale.create({
      data: {
        tenantId: t.id,
        registroId: registro.id,
        cerCode: CER,
        quantita: 50,
        unita: 'KG',
        dataRiferimento: new Date('2026-01-01'),
        impostatoDa: randomUUID(),
      },
    })
    return {
      tenantId: t.id,
      registroId: registro.id,
      caricoId: carico.id,
      scaricoId: scarico.id,
      giacenzaId: giacenza.id,
    }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  /** INSERT di una riga; i parametri non indicati usano i valori coerenti dello scenario. */
  function inserisci(
    tx: Tx,
    s: Scenario,
    v: {
      registroId?: string
      scaricoId?: string
      caricoId?: string | null
      giacenzaId?: string | null
      quantita?: number
    } = {}
  ) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO abbinamenti_carico_scarico
         (tenant_id, registro_id, scarico_id, carico_id, giacenza_iniziale_id, famiglia,
          quantita, origine)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'KG', $6::numeric,
               'AUTOMATICO'::origine_abbinamento)
       RETURNING id::text AS id`,
      s.tenantId,
      v.registroId ?? s.registroId,
      v.scaricoId ?? s.scaricoId,
      v.caricoId === undefined ? s.caricoId : v.caricoId,
      v.giacenzaId ?? null,
      v.quantita ?? 10
    )
  }

  /** Esito di una INSERT che deve fallire: restituisce il messaggio dell'errore. */
  async function errore(s: Scenario, v: Parameters<typeof inserisci>[2]): Promise<string> {
    try {
      await comeApp(s.tenantId, tx => inserisci(tx, s, v))
    } catch (e) {
      return String((e as Error).message)
    }
    throw new Error("l'INSERT doveva fallire")
  }

  beforeAll(async () => {
    if ((await owner.cERCode.count({ where: { code: CER } })) === 0) {
      cerCreati.push(CER)
      await owner.cERCode.create({
        data: { code: CER, description: 'Prova abbinamenti', category: '99', subcategory: '' },
      })
    }
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.$executeRawUnsafe(
        `DELETE FROM abbinamenti_carico_scarico WHERE tenant_id = ANY($1::uuid[])`,
        tenantCreati
      )
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('inserisce una riga carico e una riga giacenza iniziale', async () => {
    const s = await azienda()
    await comeApp(s.tenantId, async tx => {
      await inserisci(tx, s)
      await inserisci(tx, s, { caricoId: null, giacenzaId: s.giacenzaId })
      const r = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM abbinamenti_carico_scarico`
      )
      expect(r[0].n).toBe(2)
    })
  })

  it('rifiuta carico_id e giacenza_iniziale_id insieme o entrambi nulli', async () => {
    const s = await azienda()
    expect(await errore(s, { giacenzaId: s.giacenzaId })).toContain(
      'abbinamenti_cs_un_carico_check'
    )
    expect(await errore(s, { caricoId: null })).toContain('abbinamenti_cs_un_carico_check')
  })

  it('rifiuta quantita 0', async () => {
    const s = await azienda()
    expect(await errore(s, { quantita: 0 })).toContain('abbinamenti_cs_quantita_check')
  })

  it('rifiuta uno scarico usato come carico', async () => {
    const s = await azienda()
    expect(await errore(s, { caricoId: s.scaricoId })).toContain('abbinamenti_cs_carico_fkey')
  })

  it('rifiuta un carico di un altro registro', async () => {
    const s = await azienda()
    const altro = await owner.registroRifiuti.create({
      data: { tenantId: s.tenantId, descrizione: 'Altro registro', codice: 'ALTRO' },
    })
    const caricoAltro = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: altro.id,
        progressiveYear: 2026,
        progressiveNumber: 1,
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        cerCode: CER,
        quantity: 100,
        unit: 'KG',
        tipoAnnotazione: 'ORDINARIA',
      },
    })
    expect(await errore(s, { caricoId: caricoAltro.id })).toContain('abbinamenti_cs_carico_fkey')
  })

  it('rifiuta la stessa coppia scarico-carico due volte', async () => {
    const s = await azienda()
    await comeApp(s.tenantId, tx => inserisci(tx, s))
    // Prisma non riporta il nome dell'indice (23505, "N/A"): lo si legge in plpgsql.
    const indice = await comeApp(s.tenantId, async tx => {
      await tx.$executeRawUnsafe(
        `DO $$ DECLARE n text; BEGIN
           INSERT INTO abbinamenti_carico_scarico
             (tenant_id, registro_id, scarico_id, carico_id, famiglia, quantita, origine)
           VALUES ('${s.tenantId}'::uuid, '${s.registroId}'::uuid, '${s.scaricoId}'::uuid,
                   '${s.caricoId}'::uuid, 'KG', 5, 'AUTOMATICO');
         EXCEPTION WHEN unique_violation THEN
           GET STACKED DIAGNOSTICS n = CONSTRAINT_NAME;
           PERFORM set_config('test.indice', n, true);
         END $$`
      )
      const r = await tx.$queryRawUnsafe<{ v: string }[]>(
        `SELECT current_setting('test.indice', true) AS v`
      )
      return r[0].v
    })
    expect(indice).toBe('abbinamenti_cs_scarico_carico_key')
  })

  it('non cancella una giacenza iniziale abbinata', async () => {
    const s = await azienda()
    await comeApp(s.tenantId, tx => inserisci(tx, s, { caricoId: null, giacenzaId: s.giacenzaId }))
    const esito = await owner.giacenzaIniziale
      .delete({ where: { id: s.giacenzaId } })
      .then(() => null)
      .catch((e: unknown) => e as { code?: string; message: string })
    expect(esito).not.toBeNull()
    expect(`${esito?.code ?? ''} ${esito?.message}`).toMatch(/P2003|abbinamenti_cs_giacenza_fkey/)
  })

  it('RLS: B non vede ne inserisce righe di A; senza contesto 0 righe', async () => {
    const a = await azienda()
    const b = await azienda()
    await comeApp(a.tenantId, tx => inserisci(tx, a))
    await comeApp(b.tenantId, async tx => {
      const r = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM abbinamenti_carico_scarico WHERE tenant_id = $1::uuid`,
        a.tenantId
      )
      expect(r[0].n).toBe(0)
    })
    await expect(
      comeApp(b.tenantId, tx => inserisci(tx, { ...a, tenantId: a.tenantId }, {}))
    ).rejects.toThrow(/row-level security/)
    const senza = await app.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM abbinamenti_carico_scarico`
    )
    expect(senza[0].n).toBe(0)
  })
})
