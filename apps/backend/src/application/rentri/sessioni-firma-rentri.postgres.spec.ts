/**
 * FIR in viaggio P1, T0 — `fir_sessioni_firma_rentri` contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE): isolamento fra aziende, indice unico della sessione aperta,
 * chiavi esterne composte, niente DELETE, e il repository Prisma. Il proprietario prepara FIR e
 * aziende; la pulizia cancella solo cio' che crea (la cascata da `tenants` porta via il resto).
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
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { SessioniFirmaRentriRepository } from '../../infrastructure/persistence/sessioni-firma-rentri.repository'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { SessioneFirmaGiaApertaError } from './sessioni-firma-rentri.port'

describe('FIR in viaggio P1 — sessioni di firma RENTRI, Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let repo: SessioniFirmaRentriRepository
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
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Firma SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-sess-${sigla}`,
          fiscalCode: `SES${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Sessione',
          email: `sess-${sigla}@example.test`,
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

  const dati = (a: Azienda, extra: Record<string, unknown> = {}) => ({
    tenantId: a.t,
    firId: a.fir,
    tipoOperazione: 'ACCETTAZIONE',
    scadenza: new Date(Date.now() + 120_000),
    utenteId: a.utente,
    ...extra,
  })

  /** Prenota e porta la sessione a IN_ATTESA (il percorso normale). */
  const apriInAttesa = async (a: Azienda, handle = 'handle-1') => {
    const s = await repo.prenota(dati(a))
    await repo.completaAvvio(a.t, s.id, {
      handle,
      tokenAcquisizione: 'token-segreto-1',
      digestToSign: 'digest-1',
      scadenza: new Date(Date.now() + 120_000),
    })
    return (await repo.trovaPerId(a.t, s.id))!
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    repo = new SessioniFirmaRentriRepository(app)
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
        console.error(`pulizia sessioni firma: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('RLS ENABLE+FORCE con isolamento_azienda e sola_lettura', async () => {
    const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
       WHERE relname = 'fir_sessioni_firma_rentri' AND relnamespace = 'public'::regnamespace`
    )
    expect(t).toEqual({ rls: true, forzata: true })
    const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'fir_sessioni_firma_rentri' ORDER BY policyname`
    )
    expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
  })

  it('un altro tenant non vede ne chiude le sessioni dell azienda', async () => {
    const a = await azienda()
    const b = await azienda()
    const s = await nelTenant(a.t, () => apriInAttesa(a))
    expect(await nelTenant(b.t, () => repo.trovaPerId(b.t, s.id))).toBeNull()
    expect(await nelTenant(b.t, () => repo.trovaAperta(b.t, a.fir))).toBeNull()
    // Anche passando il tenant giusto nel filtro, la RLS del contesto B nasconde la riga.
    expect(await nelTenant(b.t, () => repo.trovaPerId(a.t, s.id))).toBeNull()
    expect(await nelTenant(b.t, () => repo.chiudi(a.t, s.id, 'ANNULLATA'))).toBe(false)
    expect((await nelTenant(a.t, () => repo.trovaPerId(a.t, s.id)))?.stato).toBe('IN_ATTESA')
  })

  it('una sola sessione IN_ATTESA per FIR; chiusa quella, se ne puo aprire un altra', async () => {
    const a = await azienda()
    const prima = await nelTenant(a.t, () => apriInAttesa(a))
    await expect(nelTenant(a.t, () => repo.prenota(dati(a)))).rejects.toBeInstanceOf(
      SessioneFirmaGiaApertaError
    )
    expect(await nelTenant(a.t, () => repo.chiudi(a.t, prima.id, 'SCADUTA', 'scaduta'))).toBe(true)
    // Una sessione chiusa non si riapre ne si richiude.
    expect(await nelTenant(a.t, () => repo.chiudi(a.t, prima.id, 'ANNULLATA'))).toBe(false)
    const chiusa = await nelTenant(a.t, () => repo.trovaPerId(a.t, prima.id))
    expect(chiusa).toMatchObject({ stato: 'SCADUTA', dettaglioEnte: 'scaduta' })
    const seconda = await nelTenant(a.t, () => repo.prenota(dati(a)))
    expect(seconda.id).not.toBe(prima.id)
    expect((await nelTenant(a.t, () => repo.trovaAperta(a.t, a.fir)))?.id).toBe(seconda.id)
  })

  it('la riga si prenota IN_AVVIO senza handle e blocca subito una seconda prenotazione (I1)', async () => {
    const a = await azienda()
    const r = await nelTenant(a.t, () => repo.prenota(dati(a)))
    expect(r).toMatchObject({ stato: 'IN_AVVIO', handle: null, tokenAcquisizione: null })
    await expect(nelTenant(a.t, () => repo.prenota(dati(a)))).rejects.toBeInstanceOf(
      SessioneFirmaGiaApertaError
    )
    // Due prenotazioni davvero concorrenti: una sola passa.
    const b = await azienda()
    const esiti = await Promise.allSettled([
      nelTenant(b.t, () => repo.prenota(dati(b))),
      nelTenant(b.t, () => repo.prenota(dati(b))),
    ])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
  })

  it('presa esclusiva: di due prendiPerFirma concorrenti ne vince una sola (I2)', async () => {
    const a = await azienda()
    const s = await nelTenant(a.t, () => apriInAttesa(a))
    const scad = new Date(Date.now() + 60_000)
    const esiti = await Promise.all([
      nelTenant(a.t, () => repo.prendiPerFirma(a.t, s.id, scad)),
      nelTenant(a.t, () => repo.prendiPerFirma(a.t, s.id, scad)),
    ])
    expect(esiti.filter(Boolean)).toHaveLength(1)
    expect((await nelTenant(a.t, () => repo.trovaPerId(a.t, s.id)))?.stato).toBe('IN_FIRMA')
    // Una sessione IN_FIRMA e ancora aperta: blocca una nuova prenotazione.
    await expect(nelTenant(a.t, () => repo.prenota(dati(a)))).rejects.toBeInstanceOf(
      SessioneFirmaGiaApertaError
    )
  })

  it('chiudi azzera il token in chiaro e conserva l hash (M2)', async () => {
    const a = await azienda()
    const s = await nelTenant(a.t, () => apriInAttesa(a))
    await nelTenant(a.t, () => repo.chiudi(a.t, s.id, 'COMPLETATA'))
    const chiusa = await nelTenant(a.t, () => repo.trovaPerId(a.t, s.id))
    expect(chiusa?.tokenAcquisizione).toBeNull()
    expect(chiusa?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ultima restituisce la sessione piu recente, di qualunque stato (I3)', async () => {
    const a = await azienda()
    const prima = await nelTenant(a.t, () => apriInAttesa(a))
    await nelTenant(a.t, () => repo.chiudi(a.t, prima.id, 'SCADUTA'))
    expect((await nelTenant(a.t, () => repo.ultima(a.t, a.fir)))?.stato).toBe('SCADUTA')
    const seconda = await nelTenant(a.t, () => repo.prenota(dati(a)))
    expect((await nelTenant(a.t, () => repo.ultima(a.t, a.fir)))?.id).toBe(seconda.id)
  })

  it('il token e salvato anche come SHA-256 (64 esadecimali)', async () => {
    const a = await azienda()
    const s = await nelTenant(a.t, () => apriInAttesa(a))
    expect(s.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(s.tokenAcquisizione).toBe('token-segreto-1')
  })

  it('chiavi composte: FIR o utente di un altro tenant rifiutati dal database', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO fir_sessioni_firma_rentri
           (tenant_id, fir_id, tipo_operazione, handle, token_hash, token_acquisizione, digest_to_sign, scadenza, updated_at)
         VALUES ('${a.t}', '${b.fir}', 'X', 'h', 'x', 't', 'd', now(), now())`
      )
    ).rejects.toThrow(/fir_sessioni_firma_rentri_fir_fkey/)
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO fir_sessioni_firma_rentri
           (tenant_id, fir_id, tipo_operazione, handle, token_hash, token_acquisizione, digest_to_sign, scadenza, utente_id, updated_at)
         VALUES ('${a.t}', '${a.fir}', 'X', 'h', 'x', 't', 'd', now(), '${b.utente}', now())`
      )
    ).rejects.toThrow(/fir_sessioni_firma_rentri_utente_fkey/)
  })

  it('il ruolo applicativo non cancella ne tronca le sessioni', async () => {
    const a = await azienda()
    const s = await nelTenant(a.t, () => apriInAttesa(a))
    await expect(
      nelTenant(a.t, () =>
        app.$executeRawUnsafe(`DELETE FROM fir_sessioni_firma_rentri WHERE id = '${s.id}'`)
      )
    ).rejects.toThrow(/permission denied/)
    expect(await nelTenant(a.t, () => repo.trovaPerId(a.t, s.id))).not.toBeNull()
  })
})
