/**
 * Punti critici del codice esistente, provati sul percorso reale (RLS pezzo 2a).
 *
 * Use case, repository e service veri girano dentro `TenantContext.run({ tenantId })`
 * con il `PrismaService` prodotto dalla factory dell'applicazione (client esteso con
 * `estensioneTenantTransazione`). Il database stesso dice quale `app.tenant_id` vedeva
 * la scrittura: un trigger di appoggio (AFTER INSERT/UPDATE, per riga) copia
 * `current_setting('app.tenant_id', true)` in una tabella di appoggio, insieme al nome
 * della tabella toccata. Un trigger scatta nella transazione della scrittura: se il
 * `set_config` non fosse nella stessa transazione, il valore registrato sarebbe
 * `<assente>`.
 *
 * Casi: transazione interattiva con advisory lock (registro), `save` ed emissione con
 * numerazione (FIR), unita' locali RENTRI in forma interattiva e batch, transazione MUD,
 * raw `FOR UPDATE SKIP LOCKED` fuori transazione (scorta).
 *
 * Oggetti di appoggio (`zz_*`) creati e rimossi sia in beforeAll sia in afterAll, cosi'
 * un'esecuzione interrotta non lascia trigger dietro di se'.
 *
 * Prova di significativita': con `TEST_SENZA_ESTENSIONE=1` i servizi usano il `PrismaService`
 * nudo e tutti i casi devono FALLIRE con `<assente>`.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../../application/registro/commands/registra-movimento.command'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { MudPresentazioneService } from '../../application/mud/mud-presentazione.service'
import { MudVersionRegistry } from '../../application/mud/export/mud-version.registry'
import { RentriScortaRepository } from './rentri-scorta.repository'

const urlBase =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlBase

const TABELLE = [
  'waste_movements',
  'firs',
  'rentri_unita_locali',
  'mud_reports',
  'rentri_numeri_vidimati',
]

describe('Tenant per transazione sui casi reali', () => {
  const CER = '99 99 01'
  const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
  // Client amministrativo (nessuna estensione): prepara i dati e legge le osservazioni
  const admin = new PrismaClient({ datasources: { db: { url: urlBase } } })
  let prisma: PrismaService
  let tenantId = ''
  let userId = ''
  let cerCreato = false

  const REGISTRO_PRODUTTORE = '11111111-1111-4111-8111-111111111111'
  const REGISTRO_TRASPORTATORE = '22222222-2222-4222-8222-222222222222'
  const REGISTRO_DESTINATARIO = '33333333-3333-4333-8333-333333333333'

  async function rimuoviAppoggio() {
    for (const t of TABELLE) {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zz_casi_reali ON ${t}`)
    }
    await admin.$executeRawUnsafe('DROP FUNCTION IF EXISTS zz_casi_reali_osserva()')
    await admin.$executeRawUnsafe('DROP TABLE IF EXISTS zz_casi_reali_osservazioni')
  }

  async function creaAppoggio() {
    await rimuoviAppoggio()
    await admin.$executeRawUnsafe(
      'CREATE TABLE zz_casi_reali_osservazioni (id serial PRIMARY KEY, tabella text, op text, tenant text)'
    )
    await admin.$executeRawUnsafe(`
      CREATE FUNCTION zz_casi_reali_osserva() RETURNS trigger AS $$
      BEGIN
        INSERT INTO zz_casi_reali_osservazioni (tabella, op, tenant)
        VALUES (TG_TABLE_NAME, TG_OP, coalesce(nullif(current_setting('app.tenant_id', true), ''), '<assente>'));
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`)
    for (const t of TABELLE) {
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER zz_casi_reali AFTER INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION zz_casi_reali_osserva()`
      )
    }
  }

  const azzera = () => admin.$executeRawUnsafe('DELETE FROM zz_casi_reali_osservazioni')

  /** Tenant visti dal database nelle scritture di una tabella, con le operazioni. */
  async function osservazioni(tabella: string) {
    return admin.$queryRawUnsafe<{ op: string; tenant: string }[]>(
      'SELECT op, tenant FROM zz_casi_reali_osservazioni WHERE tabella = $1 ORDER BY id',
      tabella
    )
  }

  /** Almeno `minimo` scritture sulla tabella, tutte col tenant atteso. */
  async function attendiTenant(tabella: string, minimo = 1, ops?: string[]) {
    const righe = (await osservazioni(tabella)).filter(r => !ops || ops.includes(r.op))
    expect(righe.length).toBeGreaterThanOrEqual(minimo)
    expect(righe.map(r => r.tenant)).toEqual(righe.map(() => tenantId))
  }

  beforeAll(async () => {
    prisma = process.env.TEST_SENZA_ESTENSIONE
      ? new PrismaService()
      : creaPrismaServiceApplicativo()
    await prisma.onModuleInit()
    await creaAppoggio()
    const suffisso = Date.now().toString().slice(-9)
    const tenant = await admin.tenant.create({
      data: { partitaIva: `CR${suffisso}`, ragioneSociale: 'Casi reali tenant SRL', country: 'IT' },
    })
    tenantId = tenant.id
    const user = await admin.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-casireali-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `casireali-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    userId = user.id
    cerCreato = (await admin.cERCode.count({ where: { code: CER } })) === 0
    await admin.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await rimuoviAppoggio()
    // Con un id vuoto Prisma toglierebbe il filtro: senza id non si cancella nulla.
    if (tenantId) {
      await admin.wasteMovement.deleteMany({ where: { tenantId } })
      await admin.activityLog.deleteMany({ where: { tenantId } })
      await admin.mUDReport.deleteMany({ where: { tenantId } })
      await admin.rentriNumeroVidimato.deleteMany({ where: { tenantId } })
      await admin.rentriUnitaLocale.deleteMany({ where: { tenantId } })
      await admin.fIR.deleteMany({ where: { tenantId } })
      await admin.user.deleteMany({ where: { tenantId } })
      await admin.tenant.deleteMany({ where: { id: tenantId } })
    }
    if (cerCreato) await admin.cERCode.deleteMany({ where: { code: CER } })
    await admin.$disconnect()
    await prisma.onModuleDestroy()
  })

  beforeEach(azzera)

  it('RegistraMovimentoUseCase: transazione interattiva con advisory lock, tenant sulla scrittura', async () => {
    const useCase = new RegistraMovimentoUseCase(prisma, loggerStub as any)
    const comando = new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      'CARICO',
      new Date('2025-12-20'),
      new Date('2025-12-20'),
      'PRODUZIONE_INTERNA',
      CER,
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const esito = await TenantContext.run({ tenantId }, async () => await useCase.execute(comando))
    expect(esito.isSuccess).toBe(true)
    await attendiTenant('waste_movements', 1, ['INSERT'])
  })

  describe('FIRPrismaRepository', () => {
    let repo: FIRPrismaRepository
    const firma = (): FirmaDigitale => ({
      firmatario: 'Mario Rossi',
      timestamp: new Date(),
      certificato: 'x',
      userId,
    })
    const nuovaBozza = () =>
      FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId,
        creatoDaUserId: userId,
      })

    beforeAll(() => {
      repo = new FIRPrismaRepository(prisma, prisma as any)
    })

    it('save: upsert e firme nella stessa transazione, con il tenant', async () => {
      const fir = nuovaBozza()
      await TenantContext.run({ tenantId }, async () => await repo.save(fir))
      await attendiTenant('firs', 1, ['INSERT'])
    })

    it('emettiConNumerazione: lock, numero e upsert con il tenant', async () => {
      const fir = nuovaBozza()
      await TenantContext.run({ tenantId }, async () => await repo.save(fir))
      await azzera()
      const numero = await TenantContext.run(
        { tenantId },
        async () => await repo.emettiConNumerazione(fir, 2031, n => fir.emetti(n, firma()))
      )
      expect(numero).toMatch(/^FIR-2031-/)
      await attendiTenant('firs', 1, ['UPDATE'])
    })
  })

  describe('RentriUnitaLocaleService', () => {
    let service: RentriUnitaLocaleService
    const SITI = ['OP9999ZZZ999991-ZZ9991', 'OP9999ZZZ999992-ZZ9992']
    beforeAll(() => {
      service = new RentriUnitaLocaleService(prisma)
    })

    it('forma interattiva: create con principale (updateMany + create) con il tenant', async () => {
      await TenantContext.run({ tenantId }, async () => {
        await service.create(tenantId, { numIscrSito: SITI[0], denominazione: 'Sede 1' })
        await service.create(tenantId, {
          numIscrSito: SITI[1],
          denominazione: 'Sede 2',
          principale: true,
        })
      })
      // 2 INSERT + 1 UPDATE (la vecchia principale perde il flag)
      await attendiTenant('rentri_unita_locali', 3)
      const ops = (await osservazioni('rentri_unita_locali')).map(r => r.op)
      expect(ops).toEqual(expect.arrayContaining(['INSERT', 'UPDATE']))
    })

    it('forma batch: setPrincipale aggiorna le due sedi in un array di operazioni', async () => {
      const lista = await TenantContext.run(
        { tenantId },
        async () => await service.listForTenant(tenantId)
      )
      const nonPrincipale = lista.find(u => !u.principale)!
      await azzera()
      await TenantContext.run({ tenantId }, async () => {
        await service.setPrincipale(tenantId, nonPrincipale.id)
      })
      await attendiTenant('rentri_unita_locali', 2, ['UPDATE'])
    })
  })

  it('MudPresentazioneService.segnaPresentato: transazione MUD con il tenant', async () => {
    const aggregazione = {
      aggrega: jest.fn().mockResolvedValue({
        anno: 2025,
        righe: [],
        controlli: [],
        dichiarante: { atecoNormalizzato: '381100', comuneCode: '058091' },
        movimentiPerCer: {},
        pericolosiPerCer: {},
        mudNonDovuto: false,
      }),
    }
    const service = new MudPresentazioneService(
      prisma,
      new MudVersionRegistry(),
      aggregazione as any,
      loggerStub as any
    )
    await TenantContext.run({ tenantId }, async () => {
      await service.segnaPresentato(tenantId, 2025, userId)
    })
    await attendiTenant('mud_reports', 1)
  })

  it('RentriScortaRepository.consumaProssimoDisponibile: raw FOR UPDATE SKIP LOCKED con il tenant', async () => {
    const NUM_ISCR_SITO = 'OP9999ZZZ999999-ZZ9999'
    // popolata dal client amministrativo, fuori contesto
    await new RentriScortaRepository(admin as never).inserisciDisponibile(tenantId, {
      numIscrSito: NUM_ISCR_SITO,
      codiceBlocco: 'BLK-CASI-REALI',
      progressivo: 1,
      numeroFir: 'TSTCR00001XY',
      qrCodeBytes: Buffer.from('qr').toString('base64'),
      dataVidimazione: new Date(),
    })
    await azzera()
    const repo = new RentriScortaRepository(prisma)
    const preso = await TenantContext.run(
      { tenantId },
      async () => await repo.consumaProssimoDisponibile(tenantId, { firId: randomUUID() })
    )
    expect(preso).not.toBeNull()
    await attendiTenant('rentri_numeri_vidimati', 1, ['UPDATE'])
  })
})
