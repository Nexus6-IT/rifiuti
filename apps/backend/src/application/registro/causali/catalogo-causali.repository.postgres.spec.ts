/**
 * Caricamento del catalogo delle causali e conferma della versione (Fase 2 pezzo 5, Task 2)
 * contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE soggetta alle
 * policy), dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende e causali aziendali; la pulizia toglie
 * solo le righe create qui. Le righe di `causali_registro` non si toccano.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { ConflictException } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { caricaCatalogoCausali, confermaVersioneAzienda } from './catalogo-causali.repository'

describe('Catalogo causali — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `CC${suffisso}`, ragioneSociale: 'Catalogo causali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  async function propria(
    tenantId: string,
    codice: string,
    dal: string,
    al: string | null,
    verso: 'CARICO' | 'SCARICO' = 'SCARICO'
  ): Promise<string> {
    const righe = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, valida_al,
          creato_da, fatturabile, updated_at)
       VALUES ($1::uuid, 'PROPRIA', $2, $3::waste_movement_type, $4, 'ESCLUSO'::ruolo_mud_causale,
               $5::date, $6::date, $7::uuid, false, now())
       RETURNING id::text AS id`,
      tenantId,
      codice,
      verso,
      `Prova ${codice}`,
      dal,
      al,
      randomUUID()
    )
    return righe[0].id
  }

  async function disattiva(tenantId: string, codice: string, verso: 'CARICO' | 'SCARICO') {
    await owner.$executeRawUnsafe(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, causale_sistema_codice, creato_da, updated_at)
       VALUES ($1::uuid, 'DISATTIVAZIONE', $2, $3::waste_movement_type, $2, $4::uuid, now())`,
      tenantId,
      codice,
      verso,
      randomUUID()
    )
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    await owner.causaleRegistroAzienda.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('A vede le 11 righe di sistema + le proprie e non quelle di B', async () => {
    const a = await azienda()
    const b = await azienda()
    await propria(a, 'AZ_SOLO_A', '2026-01-01', null)
    await propria(b, 'AZ_SOLO_B', '2026-01-01', null)
    await disattiva(a, 'CESSIONE', 'SCARICO')

    const catalogoA = await nelTenant(a, () => caricaCatalogoCausali(app, a))

    // sistema: 5 CARICO + 6 SCARICO, CESSIONE disattivata per A
    expect(catalogoA.opzioni('CARICO', '2026-06-01')).toHaveLength(5)
    const scarico = catalogoA.opzioni('SCARICO', '2026-06-01').map(o => o.codice)
    expect(scarico).toContain('AZ_SOLO_A')
    expect(scarico).not.toContain('AZ_SOLO_B')
    expect(scarico).not.toContain('CESSIONE')
    expect(scarico).toHaveLength(6) // 6 di sistema - CESSIONE + AZ_SOLO_A
    // la disattivata resta risolvibile (MUD)
    expect(catalogoA.comportamento('SCARICO', 'CESSIONE', '2026-06-01')!.ruoloMud).toBe('AVVIATO')
    expect(catalogoA.comportamento('SCARICO', 'AZ_SOLO_B', '2026-06-01')).toBeNull()
    // date DATE convertite senza spostamenti
    expect(catalogoA.comportamento('SCARICO', 'AZ_SOLO_A', '2026-01-01')!.validaDal).toBe(
      '2026-01-01'
    )
    expect(catalogoA.comportamento('SCARICO', 'AZ_SOLO_A', '2025-12-31')).toBeNull()

    const catalogoB = await nelTenant(b, () => caricaCatalogoCausali(app, b))
    expect(catalogoB.opzioni('SCARICO', '2026-06-01').map(o => o.codice)).toEqual(
      expect.arrayContaining(['CESSIONE', 'AZ_SOLO_B'])
    )
    expect(catalogoB.comportamento('SCARICO', 'AZ_SOLO_A', '2026-06-01')).toBeNull()
  })

  it('confermaVersioneAzienda: versione valida passa, chiusa nel frattempo -> 409 CAUSALE_MODIFICATA', async () => {
    const t = await azienda()
    const aperta = await propria(t, 'AZ_APERTA', '2026-01-01', null)
    const chiusa = await propria(t, 'AZ_CHIUSA', '2026-01-01', '2026-05-31')

    await expect(
      nelTenant(t, () =>
        app.$transaction(tx => confermaVersioneAzienda(tx, t, aperta, '2026-06-01'))
      )
    ).resolves.toBeUndefined()

    const errore = await nelTenant(t, () =>
      app.$transaction(tx => confermaVersioneAzienda(tx, t, chiusa, '2026-06-01'))
    ).catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(ConflictException)
    expect((errore as ConflictException).getResponse()).toMatchObject({
      error: 'CAUSALE_MODIFICATA',
    })
  })

  it("confermaVersioneAzienda: la versione di un'altra azienda non si vede (409)", async () => {
    const a = await azienda()
    const b = await azienda()
    const diB = await propria(b, 'AZ_DI_B', '2026-01-01', null)

    const errore = await nelTenant(a, () =>
      app.$transaction(tx => confermaVersioneAzienda(tx, a, diB, '2026-06-01'))
    ).catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(ConflictException)
  })
})
