/**
 * RisoluzioneAgenteService contro un Postgres reale, COL RUOLO DI SISTEMA (`wasteflow_sistema`,
 * BYPASSRLS): trova l'agente di QUALUNQUE azienda dal solo hash, cosa che `wasteflow_app` senza
 * contesto non puo' fare (RLS). Prova anche l'unicita' degli hash.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import type { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'
import { partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { RisoluzioneAgenteService } from './risoluzione-agente.service'

describe('RisoluzioneAgenteService (Postgres reale, ruolo di sistema)', () => {
  const owner = new PrismaClient()
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'
  )
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const servizio = new RisoluzioneAgenteService(sistema as unknown as PrismaSistemaService)
  const tenantCreati: string[] = []
  const seme = 7_000_000 + (Date.now() % 2_000_000)
  const hash = (c: string, n: number) => `${n}`.padStart(64, c)

  async function agente(n: number, stato: 'IN_ATTESA' | 'ATTIVO' | 'REVOCATO') {
    const tenant = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(seme + n * 19),
        ragioneSociale: 'Risoluzione SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(tenant.id)
    const user = await owner.user.create({
      data: {
        tenantId: tenant.id,
        keycloakId: `kc-ris-${seme}-${n}`,
        fiscalCode: `RIS${seme}${n}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Risoluzione',
        email: `ris-${seme}-${n}@example.test`,
      },
    })
    const base = { tenant_id: tenant.id, creato_da: user.id }
    const r =
      stato === 'IN_ATTESA'
        ? await owner.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO agenti_pesa (tenant_id, creato_da, descrizione, stato, codice_sha256, codice_scade_il, updated_at)
             VALUES ('${base.tenant_id}', '${base.creato_da}', 'PC', 'IN_ATTESA', '${hash('d', n)}', now() + interval '15 minutes', now())
             RETURNING id::text AS id`
          )
        : await owner.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO agenti_pesa (tenant_id, creato_da, descrizione, stato, token_sha256, chiave_pubblica, impronta_chiave, abbinato_il,
               revocato_da, revocato_il, motivo_revoca, updated_at)
             VALUES ('${base.tenant_id}', '${base.creato_da}', 'PC', '${stato}', '${hash('c', n)}', '${'A'.repeat(43)}=', '${hash('e', n)}', now(),
               ${stato === 'REVOCATO' ? `'${base.creato_da}', now(), 'sostituito'` : 'NULL, NULL, NULL'}, now())
             RETURNING id::text AS id`
          )
    return { id: r[0].id, tenantId: tenant.id }
  }

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), sistema.$disconnect(), app.$disconnect()])
  })

  it('trova l’agente e la sua azienda dal solo hash del token, senza contesto', async () => {
    const a = await agente(1, 'ATTIVO')
    const b = await agente(2, 'ATTIVO')
    await expect(servizio.daToken(hash('c', 1))).resolves.toEqual({
      id: a.id,
      tenantId: a.tenantId,
      stato: 'ATTIVO',
    })
    await expect(servizio.daToken(hash('c', 2))).resolves.toEqual({
      id: b.id,
      tenantId: b.tenantId,
      stato: 'ATTIVO',
    })
  })

  it('un agente REVOCATO si riconosce ancora dal token', async () => {
    const r = await agente(3, 'REVOCATO')
    await expect(servizio.daToken(hash('c', 3))).resolves.toMatchObject({
      id: r.id,
      stato: 'REVOCATO',
    })
  })

  it('un hash ignoto da null', async () => {
    await expect(servizio.daToken('f'.repeat(64))).resolves.toBeNull()
    await expect(servizio.daCodice('f'.repeat(64))).resolves.toBeNull()
  })

  it('daCodice trova un agente IN_ATTESA', async () => {
    const r = await agente(4, 'IN_ATTESA')
    await expect(servizio.daCodice(hash('d', 4))).resolves.toEqual({
      id: r.id,
      tenantId: r.tenantId,
      stato: 'IN_ATTESA',
    })
  })

  it('senza il ruolo di sistema la stessa ricerca non troverebbe nulla (RLS): per questo serve', async () => {
    await agente(5, 'ATTIVO')
    const comeApp = new RisoluzioneAgenteService(app as unknown as PrismaSistemaService)
    await expect(comeApp.daToken(hash('c', 5))).resolves.toBeNull()
  })
})
