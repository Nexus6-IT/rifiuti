/**
 * Rettifica e annullamento con le causali del catalogo (Fase 2 pezzo 5, Task 4b) contro un
 * Postgres reale, COME `wasteflow_app` dentro il `TenantContext`. Il proprietario (`wasteflow`)
 * prepara aziende, causali e storico con insert diretti e legge cio' che e' stato scritto.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { BadRequestException } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import { RegistriService } from '../registri.service'
import { VerificaCatenaRegistroService } from '../verifica-catena-registro.service'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { CorreggiMovimentoUseCase, DatiRettifica } from './correggi-movimento.use-case'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Correzioni con le causali - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 05'
  const ANNO = annoSolareItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let correggi: CorreggiMovimentoUseCase
  let registra: RegistraMovimentoUseCase
  let verifica: VerificaCatenaRegistroService
  let cerCreato = false
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  type Az = { tenantId: string; registroId: string }

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `CC${suffisso}`,
        ragioneSociale: 'Correzioni causali SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001CC${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }

  async function propria(
    az: Az,
    codice: string,
    dal: string,
    al: string | null,
    descrizione: string
  ): Promise<string> {
    const r = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, valida_al,
          creato_da, updated_at)
       VALUES ($1::uuid, 'PROPRIA', $2, 'CARICO'::waste_movement_type, $3,
               'ESCLUSO'::ruolo_mud_causale, $4::date, $5::date, $6::uuid, now())
       RETURNING id::text AS id`,
      az.tenantId,
      codice,
      descrizione,
      dal,
      al,
      randomUUID()
    )
    return r[0].id
  }

  async function disattiva(az: Az, codice: string, verso: 'CARICO' | 'SCARICO') {
    await owner.$executeRawUnsafe(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, causale_sistema_codice, creato_da, updated_at)
       VALUES ($1::uuid, 'DISATTIVAZIONE', $2, $3::waste_movement_type, $2, $4::uuid, now())`,
      az.tenantId,
      codice,
      verso,
      randomUUID()
    )
  }

  /** Annotazione ordinaria scritta dal proprietario (hash vuoto: storico). */
  function storica(
    az: Az,
    o: {
      type?: 'CARICO' | 'SCARICO'
      causale: string
      causaleAziendaId?: string
      data?: string
      quantita?: number
    }
  ) {
    const data = new Date(o.data ?? '2026-03-01T10:00:00Z')
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: ANNO,
        progressiveNumber: ++progressivo,
        type: o.type ?? 'CARICO',
        movementDate: data,
        registrationDate: data,
        causale: o.causale,
        causaleAziendaId: o.causaleAziendaId,
        cerCode: CER,
        quantity: o.quantita ?? 100,
        unit: 'KG',
      },
    })
  }

  const rettifica = (az: Az, id: string, d: Partial<DatiRettifica>) =>
    nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'correzione',
        dati: {
          movementDate: new Date('2026-03-01T00:00:00Z'),
          causale: 'PRODUZIONE_INTERNA',
          cerCode: CER,
          quantity: 100,
          unit: 'KG',
          ...d,
        },
      })
    )

  const annulla = (az: Az, id: string) =>
    nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'inserito per errore',
      })
    )

  async function eccezione(p: Promise<unknown>) {
    try {
      await p
    } catch (e) {
      return e as Error
    }
    throw new Error('attesa un eccezione')
  }

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toContain(':55432/')
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    verifica = new VerificaCatenaRegistroService(app)
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.causaleRegistroAzienda.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroProgressivoIniziale.deleteMany({
      where: { tenantId: { in: tenantCreati } },
    })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('rettifica della sola quantita di un movimento con causale di sistema disattivata dopo la registrazione: riesce', async () => {
    const az = await azienda()
    await storica(az, {
      causale: 'PRODUZIONE_INTERNA',
      quantita: 1000,
      data: '2026-02-01T10:00:00Z',
    })
    const scarico = await storica(az, { type: 'SCARICO', causale: 'CESSIONE', quantita: 100 })
    await disattiva(az, 'CESSIONE', 'SCARICO')

    const { movimento } = await rettifica(az, scarico.id, { causale: 'CESSIONE', quantity: 50 })
    expect(movimento.causale).toBe('CESSIONE')
    expect(movimento.quantity).toBe(50)
    expect(movimento.causaleDescrizione).not.toBe('CESSIONE')
    const salvata = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimento.id } })
    expect(salvata.causaleAziendaId).toBeNull()
  })

  it('rettifica che passa a una causale disattivata: 400', async () => {
    const az = await azienda()
    await storica(az, {
      causale: 'PRODUZIONE_INTERNA',
      quantita: 1000,
      data: '2026-02-01T10:00:00Z',
    })
    const scarico = await storica(az, { type: 'SCARICO', causale: 'ALTRO_SCARICO' })
    await disattiva(az, 'CESSIONE', 'SCARICO')

    const e = await eccezione(rettifica(az, scarico.id, { causale: 'CESSIONE' }))
    expect(e).toBeInstanceOf(BadRequestException)
    expect(e.message).toContain("non è attiva per l'azienda")
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(2)
  })

  it('rettifica che sposta la data in un altra versione della causale propria: usa la nuova versione', async () => {
    const az = await azienda()
    const v1 = await propria(az, 'AZ_PROVA', '2026-01-01', '2026-02-28', 'Prova prima')
    const v2 = await propria(az, 'AZ_PROVA', '2026-03-01', null, 'Prova dopo')
    const c = await storica(az, {
      causale: 'AZ_PROVA',
      causaleAziendaId: v1,
      data: '2026-02-10T10:00:00Z',
    })

    const { movimento } = await rettifica(az, c.id, {
      causale: 'AZ_PROVA',
      movementDate: new Date('2026-04-01T00:00:00Z'),
    })
    expect(movimento.causaleDescrizione).toBe('Prova dopo')
    const salvata = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimento.id } })
    expect(salvata.causaleAziendaId).toBe(v2)
  })

  it('rettifica che sposta la data fuori da ogni versione della causale propria: 400', async () => {
    const az = await azienda()
    const v1 = await propria(az, 'AZ_PROVA', '2026-01-01', '2026-02-28', 'Prova')
    const c = await storica(az, {
      causale: 'AZ_PROVA',
      causaleAziendaId: v1,
      data: '2026-02-10T10:00:00Z',
    })
    const e = await eccezione(
      rettifica(az, c.id, { causale: 'AZ_PROVA', movementDate: new Date('2026-05-01T00:00:00Z') })
    )
    expect(e).toBeInstanceOf(BadRequestException)
    expect(e.message).toContain("non è valida alla data dell'operazione")
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(1)
  })

  it('annullamento di un movimento con causale storica fuori catalogo: riesce, descrizione = codice', async () => {
    const az = await azienda()
    const c = await storica(az, { causale: 'CAUSALE_DISMESSA' })
    const { movimento } = await annulla(az, c.id)
    expect(movimento.tipoAnnotazione).toBe('ANNULLAMENTO')
    expect(movimento.causale).toBe('CAUSALE_DISMESSA')
    expect(movimento.causaleDescrizione).toBe('CAUSALE_DISMESSA')
    const salvata = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimento.id } })
    expect(salvata.causaleAziendaId).toBeNull()
  })

  it('annullamento di un movimento con versione chiusa: riesce, copia il riferimento e la descrizione della versione', async () => {
    const az = await azienda()
    const v1 = await propria(az, 'AZ_PROVA', '2026-01-01', '2026-02-28', 'Prova prima')
    await propria(az, 'AZ_PROVA', '2026-03-01', null, 'Prova dopo')
    const c = await storica(az, {
      causale: 'AZ_PROVA',
      causaleAziendaId: v1,
      data: '2026-02-10T10:00:00Z',
    })
    const { movimento } = await annulla(az, c.id)
    expect(movimento.causaleDescrizione).toBe('Prova prima')
    const salvata = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimento.id } })
    expect(salvata.causale).toBe('AZ_PROVA')
    expect(salvata.causaleAziendaId).toBe(v1)
  })

  it('la catena hash resta verificata: registrazione, rettifica che cambia versione, annullamento', async () => {
    const az = await azienda()
    const v1 = await propria(az, 'AZ_PROVA', '2026-01-01', '2026-02-28', 'Prova prima')
    const v2 = await propria(az, 'AZ_PROVA', '2026-03-01', null, 'Prova dopo')
    const r = await nelTenant(az.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          az.tenantId,
          undefined as unknown as string,
          'CARICO',
          new Date('2026-02-10T00:00:00Z'),
          new Date(),
          'AZ_PROVA',
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
          az.registroId
        )
      )
    )
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    const registrata = await owner.wasteMovement.findUniqueOrThrow({ where: { id: r.value.id } })
    expect(registrata.causaleAziendaId).toBe(v1)

    const rett = await rettifica(az, r.value.id, {
      causale: 'AZ_PROVA',
      movementDate: new Date('2026-04-01T00:00:00Z'),
      quantity: 10,
    })
    const rettificata = await owner.wasteMovement.findUniqueOrThrow({
      where: { id: rett.movimento.id },
    })
    expect(rettificata.causaleAziendaId).toBe(v2)
    await annulla(az, rett.movimento.id)

    const esito = await nelTenant(az.tenantId, () =>
      verifica.verifica(az.tenantId, az.registroId, ANNO)
    )
    expect(esito.primoErrore).toBeNull()
    expect(esito.verificate).toBe(3)
  })
})
