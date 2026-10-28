/**
 * Registrazione con le causali del catalogo (Fase 2 pezzo 5, Task 4a) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE), dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende, causali aziendali e legge cio' che e'
 * stato scritto; la pulizia toglie solo le righe create qui. Le righe di `causali_registro` non si
 * toccano.
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

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { RegistriService } from '../registri.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Registrazione con le causali — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 04'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let useCase: RegistraMovimentoUseCase
  let cerCreato = false
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `RC${suffisso}`, ragioneSociale: 'Registra causali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    await nelTenant(t.id, () =>
      new RegistriService(app, loggerStub as never).assicuraRegistri(t.id)
    )
    return t.id
  }

  async function propria(
    tenantId: string,
    codice: string,
    dal: string,
    al: string | null,
    descrizione: string,
    verso: 'CARICO' | 'SCARICO' = 'CARICO'
  ): Promise<string> {
    const righe = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, valida_al,
          creato_da, updated_at)
       VALUES ($1::uuid, 'PROPRIA', $2, $3::waste_movement_type, $4, 'ESCLUSO'::ruolo_mud_causale,
               $5::date, $6::date, $7::uuid, now())
       RETURNING id::text AS id`,
      tenantId,
      codice,
      verso,
      descrizione,
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

  function comando(
    tenantId: string,
    type: 'CARICO' | 'SCARICO',
    causale: string,
    data: string
  ): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      type,
      new Date(data),
      new Date(),
      causale,
      CER,
      undefined,
      10,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
  }

  const registra = (tenantId: string, c: RegistraMovimentoCommand) =>
    nelTenant(tenantId, () => useCase.execute(c))

  const righe = (tenantId: string) =>
    owner.wasteMovement.findMany({
      where: { tenantId },
      select: { causale: true, causaleAziendaId: true },
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    useCase = new RegistraMovimentoUseCase(
      app,
      loggerStub as never,
      new RegistriService(app, loggerStub as never)
    )
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.causaleRegistroAzienda.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('causale di sistema: causale_azienda_id NULL e descrizione del catalogo nella risposta', async () => {
    const t = await azienda()
    const r = await registra(t, comando(t, 'CARICO', 'PRODUZIONE_INTERNA', '2026-03-10'))
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    expect(r.value.causale).toBe('PRODUZIONE_INTERNA')
    expect(r.value.causaleDescrizione).toBe('Produzione interna')
    expect(await righe(t)).toEqual([{ causale: 'PRODUZIONE_INTERNA', causaleAziendaId: null }])
  })

  it('causale propria: la versione valida alla data dell operazione, anche retrodatata', async () => {
    const t = await azienda()
    const v1 = await propria(t, 'AZ_PROVA', '2026-01-01', '2026-02-28', 'Prova prima')
    const v2 = await propria(t, 'AZ_PROVA', '2026-03-01', null, 'Prova dopo')

    const dopo = await registra(t, comando(t, 'CARICO', 'AZ_PROVA', '2026-04-01'))
    expect(dopo.isSuccess ? 'ok' : dopo.error).toBe('ok')
    expect(dopo.value.causaleDescrizione).toBe('Prova dopo')

    const retro = await registra(t, comando(t, 'CARICO', 'AZ_PROVA', '2026-02-10'))
    expect(retro.isSuccess ? 'ok' : retro.error).toBe('ok')
    expect(retro.value.causaleDescrizione).toBe('Prova prima')

    const salvate = await owner.wasteMovement.findMany({
      where: { tenantId: t },
      select: { movementDate: true, causaleAziendaId: true },
      orderBy: { movementDate: 'asc' },
    })
    expect(salvate.map(s => s.causaleAziendaId)).toEqual([v1, v2])
  })

  it('causale propria fuori da ogni versione: 400, nessuna riga', async () => {
    const t = await azienda()
    await propria(t, 'AZ_PROVA', '2026-03-01', null, 'Prova')
    const r = await registra(t, comando(t, 'CARICO', 'AZ_PROVA', '2026-02-10'))
    expect(r.isFailure).toBe(true)
    expect(r.error).toContain("non è valida alla data dell'operazione")
    expect(await righe(t)).toEqual([])
  })

  it('causale di sistema disattivata per l azienda: 400 e nessuna riga; le altre aziende non cambiano', async () => {
    const a = await azienda()
    const b = await azienda()
    await disattiva(a, 'CESSIONE', 'SCARICO')
    await registra(a, comando(a, 'CARICO', 'PRODUZIONE_INTERNA', '2026-03-01'))

    const rifiutata = await registra(a, comando(a, 'SCARICO', 'CESSIONE', '2026-03-10'))
    expect(rifiutata.isFailure).toBe(true)
    expect(rifiutata.error).toContain("non è attiva per l'azienda")
    expect((await righe(a)).map(r => r.causale)).toEqual(['PRODUZIONE_INTERNA'])

    await registra(b, comando(b, 'CARICO', 'PRODUZIONE_INTERNA', '2026-03-01'))
    const ok = await registra(b, comando(b, 'SCARICO', 'CESSIONE', '2026-03-10'))
    expect(ok.isSuccess ? 'ok' : ok.error).toBe('ok')
  })

  it('codice sconosciuto o del verso sbagliato: 400 con l elenco dei valori', async () => {
    const t = await azienda()
    const x = await registra(t, comando(t, 'CARICO', 'NON_ESISTE', '2026-03-10'))
    expect(x.isFailure).toBe(true)
    expect(x.error).toContain('Causale non valida per CARICO: NON_ESISTE. Valori: ')
    expect(x.error).toContain('PRODUZIONE_INTERNA')
    const verso = await registra(t, comando(t, 'CARICO', 'CESSIONE', '2026-03-10'))
    expect(verso.error).toContain('Causale non valida per CARICO: CESSIONE')
    expect(await righe(t)).toEqual([])
  })
})
