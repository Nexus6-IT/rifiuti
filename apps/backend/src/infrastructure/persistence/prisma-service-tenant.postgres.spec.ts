/**
 * PrismaService dal container Nest (RLS pezzo 2a): l'istanza iniettata deve
 * impostare `app.tenant_id` in ogni transazione, sia sulle operazioni di
 * modello sia su `.db` e sulle transazioni interattive. Il `PrismaSistemaService`
 * non deve avere l'estensione.
 *
 * Per osservare il valore visto dal database nelle operazioni di MODELLO (dove
 * non si puo' leggere `current_setting` dentro la query) un trigger temporaneo
 * su `sedi_ditte` copia `app.tenant_id` nella colonna `via` in INSERT.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { PrismaModule } from './prisma.module'
import { PrismaService } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

const urlBase =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlBase

const PIVA_TENANT = '98765432109'
// P.IVA delle due ditte di prova: servono a ritrovare la sede (la ditta si crea col proprietario)
const PIVA_DITTA_1 = partitaIvaValida(7_100_001)
const PIVA_DITTA_2 = partitaIvaValida(7_100_002)
const datiSede = (tenantId: string, dittaId: string) => ({
  tenantId,
  dittaId,
  via: 'da-sovrascrivere',
  civico: '1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  principale: true,
})

describe('PrismaService dal container: tenant per transazione', () => {
  let modulo: TestingModule
  let prisma: PrismaService
  let sistema: PrismaSistemaService
  const admin = new PrismaClient({ datasources: { db: { url: urlBase } } })
  let tenantId = ''

  beforeAll(async () => {
    modulo = await Test.createTestingModule({ imports: [PrismaModule] }).compile()
    await modulo.init()
    prisma = modulo.get(PrismaService)
    sistema = modulo.get(PrismaSistemaService)
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION zz_osserva_tenant() RETURNS trigger AS $$
      BEGIN NEW.via := coalesce(current_setting('app.tenant_id', true), '<assente>'); RETURN NEW; END;
      $$ LANGUAGE plpgsql`)
    await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS zz_osserva_tenant ON sedi_ditte')
    await admin.$executeRawUnsafe(
      'CREATE TRIGGER zz_osserva_tenant BEFORE INSERT ON sedi_ditte FOR EACH ROW EXECUTE FUNCTION zz_osserva_tenant()'
    )
    await admin.tenant.deleteMany({ where: { partitaIva: PIVA_TENANT } })
    const t = await admin.tenant.create({
      data: { partitaIva: PIVA_TENANT, ragioneSociale: 'Tenant prova set_config' },
    })
    tenantId = t.id
  })

  afterAll(async () => {
    await admin.tenant.deleteMany({ where: { partitaIva: PIVA_TENANT } })
    await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS zz_osserva_tenant ON sedi_ditte')
    await admin.$executeRawUnsafe('DROP FUNCTION IF EXISTS zz_osserva_tenant()')
    await admin.$disconnect()
    await modulo.close()
  })

  const creaDitta = async (piva: string) =>
    (
      await admin.ditta.create({
        data: { tenantId, ragioneSociale: 'Ditta prova set_config', partitaIva: piva },
      })
    ).id

  const leggiVia = async (piva: string) =>
    (await admin.sedeDitta.findFirstOrThrow({ where: { ditta: { partitaIva: piva }, tenantId } }))
      .via

  it('PrismaService dal container: set_config su operazione di modello', async () => {
    // `await` DENTRO il contesto: le operazioni Prisma sono lazy e partono all'await
    const dittaId = await creaDitta(PIVA_DITTA_1)
    await TenantContext.run({ tenantId }, async () => {
      await prisma.sedeDitta.create({ data: datiSede(tenantId, dittaId) })
    })
    expect(await leggiVia(PIVA_DITTA_1)).toBe(tenantId)
  })

  it('PrismaService.db: set_config e filtro tenant insieme', async () => {
    // il filtro inietta il tenantId (non passato) e il set_config e' nella stessa transazione
    const dittaId = await creaDitta(PIVA_DITTA_2)
    await TenantContext.run({ tenantId }, async () => {
      await (prisma.db.sedeDitta as any).create({ data: datiSede(tenantId, dittaId) })
      expect(
        await prisma.db.sedeDitta.count({ where: { ditta: { partitaIva: PIVA_DITTA_2 } } })
      ).toBe(1)
      // check top-level sul client composto: filtro (conteggio solo del tenant) + set_config
      expect(await prisma.db.sedeDitta.count()).toBeGreaterThanOrEqual(1)
    })
    expect(await leggiVia(PIVA_DITTA_2)).toBe(tenantId)
    // altro tenant: il filtro nasconde le righe
    const altro = '00000000-0000-0000-0000-0000000000aa'
    const visti = await TenantContext.run(
      { tenantId: altro },
      async () =>
        await prisma.db.sedeDitta.count({ where: { ditta: { partitaIva: PIVA_DITTA_2 } } })
    )
    expect(visti).toBe(0)
  })

  it('PrismaService.$transaction interattiva: tenant al primo statement', async () => {
    const visto = await TenantContext.run({ tenantId }, () =>
      prisma.$transaction(async tx => {
        const r = await tx.$queryRaw<
          { v: string }[]
        >`SELECT current_setting('app.tenant_id', true) AS v`
        return r[0].v
      })
    )
    expect(visto).toBe(tenantId)
    // dentro la transazione di .db il filtro resta applicato
    const conteggio = await TenantContext.run({ tenantId }, () =>
      prisma.db.$transaction(async tx => {
        const r = await tx.$queryRaw<
          { v: string }[]
        >`SELECT current_setting('app.tenant_id', true) AS v`
        expect(r[0].v).toBe(tenantId)
        return tx.sedeDitta.count({ where: { ditta: { partitaIva: PIVA_DITTA_2 } } })
      })
    )
    expect(conteggio).toBe(1)
  })

  it('PrismaService mantiene cleanDatabase, onModuleInit e onModuleDestroy', () => {
    expect(typeof prisma.cleanDatabase).toBe('function')
    expect(typeof prisma.onModuleInit).toBe('function')
    expect(typeof prisma.onModuleDestroy).toBe('function')
  })

  it('PrismaSistemaService: nessun set_config', async () => {
    const visto = await TenantContext.run({ tenantId }, async () => {
      const r = await sistema.$queryRaw<
        { v: string | null }[]
      >`SELECT current_setting('app.tenant_id', true) AS v`
      return r[0].v ?? ''
    })
    expect(visto).toBe('')
  })
})
