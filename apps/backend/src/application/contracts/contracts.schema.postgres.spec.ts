/**
 * Schema di `contracts` dopo la Fase 4 pezzo 0 (versione, cancellazione logica, FK verso
 * `tenants`) contro un Postgres reale.
 *
 * Le scritture si fanno col ruolo applicativo `wasteflow_app` dentro il contesto dell'azienda
 * (RLS e privilegi); il proprietario prepara i dati e prova la FK (da superuser, senza RLS).
 * Pulizia solo per id esatti creati.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

describe('Contratti, schema (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  async function azienda() {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Contratti schema SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  /** INSERT minima; `extra` aggiunge colonne (nome -> SQL già cast, valore). */
  function inserisci(
    tx: Tx,
    tenantId: string,
    extra: { colonne?: string; segnaposto?: string; valori?: unknown[] } = {}
  ) {
    const numero = `T-${randomUUID().slice(0, 8)}`
    const colonne = extra.colonne ? `, ${extra.colonne}` : ''
    const segnaposto = extra.segnaposto ? `, ${extra.segnaposto}` : ''
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO contracts
         (tenant_id, contract_number, producer_id, counterparty_id, counterparty_type,
          contract_type, cer_codes, pricing_model, start_date, updated_at${colonne})
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'TRANSPORTER', 'WASTE_TRANSPORT', ARRAY['150101']::text[],
               'FLAT_RATE', now(), now()${segnaposto})
       RETURNING id::text AS id`,
      tenantId,
      numero,
      randomUUID(),
      randomUUID(),
      ...(extra.valori ?? [])
    )
  }

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.contract.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('un contratto nuovo nasce con versione 1, eliminato_il e eliminato_da null', async () => {
    const tenantId = await azienda()
    const [{ id }] = await comeApp(tenantId, tx => inserisci(tx, tenantId))
    const riga = await owner.contract.findUniqueOrThrow({ where: { id } })
    expect(riga.versione).toBe(1)
    expect(riga.eliminatoIl).toBeNull()
    expect(riga.eliminatoDa).toBeNull()
  })

  it('eliminato_da senza eliminato_il è respinto', async () => {
    const tenantId = await azienda()
    await expect(
      comeApp(tenantId, tx =>
        inserisci(tx, tenantId, {
          colonne: 'eliminato_da',
          segnaposto: '$5::uuid',
          valori: [randomUUID()],
        })
      )
    ).rejects.toThrow(/contracts_eliminazione_coerente/)
  })

  it('versione 0 è respinta', async () => {
    const tenantId = await azienda()
    await expect(
      comeApp(tenantId, tx =>
        inserisci(tx, tenantId, { colonne: 'versione', segnaposto: '$5::int', valori: [0] })
      )
    ).rejects.toThrow(/contracts_versione_positiva/)
  })

  it('un contratto con tenant_id inesistente è respinto dalla FK', async () => {
    await expect(
      owner.$queryRawUnsafe(
        `INSERT INTO contracts
           (tenant_id, contract_number, producer_id, counterparty_id, counterparty_type,
            contract_type, cer_codes, pricing_model, start_date, updated_at)
         VALUES ($1::uuid, 'ORFANO-1', $2::uuid, $3::uuid, 'TRANSPORTER', 'WASTE_TRANSPORT',
                 ARRAY['150101']::text[], 'FLAT_RATE', now(), now())`,
        randomUUID(),
        randomUUID(),
        randomUUID()
      )
    ).rejects.toThrow(/contracts_tenant_id_fkey/)
  })

  it("nel contesto di B l'update di un contratto di A tocca 0 righe", async () => {
    const a = await azienda()
    const b = await azienda()
    const [{ id }] = await comeApp(a, tx => inserisci(tx, a))
    const toccate = await comeApp(b, tx =>
      tx.$executeRawUnsafe(`UPDATE contracts SET versione = 2 WHERE id = $1::uuid`, id)
    )
    expect(toccate).toBe(0)
    expect((await owner.contract.findUniqueOrThrow({ where: { id } })).versione).toBe(1)
  })

  it('cancellare il tenant cancella i suoi contratti', async () => {
    const tenantId = await azienda()
    const [{ id }] = await comeApp(tenantId, tx => inserisci(tx, tenantId))
    await owner.tenant.delete({ where: { id: tenantId } })
    expect(await owner.contract.findUnique({ where: { id } })).toBeNull()
  })
})
