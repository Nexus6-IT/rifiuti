/**
 * FIR in viaggio P2, T3 — `fir_eventi_rentri` contro un Postgres reale, collegato COME `wasteflow_app` (RLS
 * ENABLE+FORCE): isolamento fra aziende, SOLO INSERIMENTO (niente UPDATE, DELETE ne' TRUNCATE al ruolo
 * applicativo), chiavi esterne composte, e il repository Prisma.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { EventiFirRentriRepository } from '../../infrastructure/persistence/eventi-fir-rentri.repository'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

describe('FIR in viaggio P2 — storico fir_eventi_rentri, Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let repo: EventiFirRentriRepository
  const tenantCreati: string[] = []
  const REG = '11111111-1111-4111-8111-111111111111'

  interface Azienda {
    t: string
    utente: string
    fir: string
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Eventi SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-ev-${sigla}`,
          fiscalCode: `EVE${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Eventi',
          email: `ev-${sigla}@example.test`,
          role: 'OPERATOR',
        },
      })
    ).id
    const fir = FIR.create({
      produttoreId: REG,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: REG,
      destinatarioId: REG,
      tenantId: t,
      creatoDaUserId: utente,
    } as any)
    await new FIRPrismaRepository(owner as any, owner as any).save(fir)
    return { t, utente, fir: fir.id }
  }

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  const evento = (a: Azienda, extra: Record<string, unknown> = {}) => ({
    tenantId: a.t,
    firId: a.fir,
    operazione: 'DatiQuantita',
    payload: { quantita: { valore: 1500, unita_misura: 'kg' }, numero_colli: '3' },
    transazioneId: 'tr-1',
    esito: 'ACCETTATA' as const,
    dettaglioEnte: null,
    statoFormularioDopo: 'FirmaProduttoreTrasportatoreIniziale',
    utenteId: a.utente,
    ...extra,
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    repo = new EventiFirRentriRepository(app)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await owner.fIR.deleteMany({ where: { tenantId: t } })
        await owner.user.deleteMany({ where: { tenantId: t } })
        await owner.tenant.delete({ where: { id: t } })
      } catch (e) {
        console.error(`pulizia eventi RENTRI: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('RLS ENABLE+FORCE con isolamento_azienda e sola_lettura', async () => {
    const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
       WHERE relname = 'fir_eventi_rentri' AND relnamespace = 'public'::regnamespace`
    )
    expect(t).toEqual({ rls: true, forzata: true })
    const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'fir_eventi_rentri' ORDER BY policyname`
    )
    expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
  })

  it('registra e rilegge un evento con payload JSON, esito, transazione e stato dopo', async () => {
    const a = await azienda()
    const e = await nelTenant(a.t, () => repo.registra(evento(a)))
    expect(e).toMatchObject({
      tenantId: a.t,
      firId: a.fir,
      operazione: 'DatiQuantita',
      esito: 'ACCETTATA',
      transazioneId: 'tr-1',
      statoFormularioDopo: 'FirmaProduttoreTrasportatoreIniziale',
      utenteId: a.utente,
    })
    expect(e.payload).toEqual({ quantita: { valore: 1500, unita_misura: 'kg' }, numero_colli: '3' })
    const lista = await nelTenant(a.t, () => repo.elenca(a.t, a.fir))
    expect(lista).toHaveLength(1)
    expect(lista[0].id).toBe(e.id)
  })

  it('payload assente = NULL (rollback e reset non hanno un corpo)', async () => {
    const a = await azienda()
    const e = await nelTenant(a.t, () =>
      repo.registra(evento(a, { operazione: 'Reset', payload: null, statoFormularioDopo: null }))
    )
    expect(e.payload).toBeNull()
    expect(e.statoFormularioDopo).toBeNull()
  })

  it("elenca dal piu' recente e solo per quel FIR", async () => {
    const a = await azienda()
    await nelTenant(a.t, () => repo.registra(evento(a, { operazione: 'DatiQuantita' })))
    await nelTenant(a.t, () => repo.registra(evento(a, { operazione: 'Trasporto' })))
    const lista = await nelTenant(a.t, () => repo.elenca(a.t, a.fir))
    expect(lista.map(e => e.operazione)).toEqual(['Trasporto', 'DatiQuantita'])
  })

  it("un altro tenant non vede gli eventi dell'azienda, nemmeno passando il tenant giusto nel filtro", async () => {
    const a = await azienda()
    const b = await azienda()
    await nelTenant(a.t, () => repo.registra(evento(a)))
    expect(await nelTenant(b.t, () => repo.elenca(b.t, a.fir))).toEqual([])
    expect(await nelTenant(b.t, () => repo.elenca(a.t, a.fir))).toEqual([])
  })

  it("con il contesto di un'altra azienda la scrittura e' rifiutata dalla RLS (WITH CHECK)", async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(nelTenant(b.t, () => repo.registra(evento(a)))).rejects.toThrow()
    expect(await nelTenant(a.t, () => repo.elenca(a.t, a.fir))).toEqual([])
  })

  it('chiavi composte: FIR o utente di un altro tenant rifiutati dal database', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO fir_eventi_rentri (tenant_id, fir_id, operazione, esito)
         VALUES ('${a.t}', '${b.fir}', 'Reset', 'ACCETTATA')`
      )
    ).rejects.toThrow(/fir_eventi_rentri_fir_fkey/)
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO fir_eventi_rentri (tenant_id, fir_id, operazione, esito, utente_id)
         VALUES ('${a.t}', '${a.fir}', 'Reset', 'ACCETTATA', '${b.utente}')`
      )
    ).rejects.toThrow(/fir_eventi_rentri_utente_fkey/)
  })

  it('operazione vuota rifiutata dal vincolo', async () => {
    const a = await azienda()
    await expect(
      nelTenant(a.t, () => repo.registra(evento(a, { operazione: '  ' })))
    ).rejects.toThrow(/fir_eventi_rentri_operazione_non_vuota/)
  })

  it("SOLO INSERIMENTO: il ruolo applicativo non fa UPDATE, DELETE ne' TRUNCATE", async () => {
    const a = await azienda()
    const e = await nelTenant(a.t, () => repo.registra(evento(a)))
    for (const sql of [
      `UPDATE fir_eventi_rentri SET esito = 'RIFIUTATA' WHERE id = '${e.id}'`,
      `DELETE FROM fir_eventi_rentri WHERE id = '${e.id}'`,
      `TRUNCATE fir_eventi_rentri`,
    ]) {
      await expect(nelTenant(a.t, () => app.$executeRawUnsafe(sql))).rejects.toThrow(
        /permission denied/
      )
    }
    const [riga] = await nelTenant(a.t, () => repo.elenca(a.t, a.fir))
    expect(riga.esito).toBe('ACCETTATA')
  })
})
