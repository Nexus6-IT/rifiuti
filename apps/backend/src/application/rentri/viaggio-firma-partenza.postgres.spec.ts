/**
 * FIR in viaggio P3 (Postgres reale, RLS): firma di partenza su un FIR emesso e firmato in locale.
 * - Lo stato letto dall'ente si applica e si salva (repository reale) SENZA toccare il documento firmato: la
 *   firma del produttore resta valida (regola del giro P2: dopo l'emissione i campi firmati non cambiano).
 * - `tenantSeLegatoRentri` rispetta l'isolamento fra aziende e il flusso cartaceo (FIR non legato).
 * - Non regressione: la presa in carico locale di un FIR non legato funziona come prima.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { LoggerService } from '../../core/logger/logger.service'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'
import { FIR, FIRStato, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { DigitalSignatureService } from '../signatures/digital-signature.service'
import { VerifySignaturesUseCase } from '../signatures/verify-signatures.use-case'
import { EmettiFIRUseCase } from '../fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../fir/commands/emetti-fir.command'
import { PresaInCaricoFIRUseCase } from '../fir/use-cases/presa-in-carico-fir.use-case'
import { PresaInCaricoFIRCommand } from '../fir/commands/presa-in-carico-fir.command'
import { FirmaPartenzaRentriUseCase } from './firma-partenza-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'

describe('FIR in viaggio P3 — firma di partenza con repository reale (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let cripto: SignatureFIRRepository
  let firma: DigitalSignatureService
  let emetti: EmettiFIRUseCase
  let verifica: VerifySignaturesUseCase
  let tenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)
  const NUMERO_FIR = 'BCDFGH00070ZD'

  const logger = (): LoggerService =>
    ({
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as unknown as LoggerService

  const nelTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    cripto = new SignatureFIRRepository(app, sistema, logger())
    firma = new DigitalSignatureService(logger())
    const rentri = { eseguiSeAutomatica: jest.fn().mockResolvedValue(undefined) } as any
    emetti = new EmettiFIRUseCase(repo, cripto, firma, rentri, logger())
    verifica = new VerifySignaturesUseCase(cripto, firma, logger())

    tenantId = (
      await owner.tenant.create({
        data: { partitaIva: `PF${sfx}`.slice(0, 11), ragioneSociale: `Partenza firma ${sfx}` },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-partenza-firma-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `partenza-firma-${sfx}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    if (tenantId) {
      await owner.fIRSignature.deleteMany({ where: { fir: { tenantId } } })
      await owner.fIR.deleteMany({ where: { tenantId } })
      await owner.user.deleteMany({ where: { tenantId } })
      await owner.tenant.deleteMany({ where: { id: tenantId } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  async function firEmesso(): Promise<string> {
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 1.2 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
      tipoTrattaPrincipale: TipoTratta.TERRESTRE,
    })
    await nelTenant(() => repo.save(fir))
    const r = await nelTenant(() =>
      emetti.execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
    )
    if (!r.isSuccess) throw new Error(`emissione fallita: ${String(r.error)}`)
    return fir.id
  }

  /** Come l'ultimo passo reale del ciclo di firma: stato RILETTO dall'ente, applicato e salvato. */
  function useCaseFirmaPartenza() {
    const completa = {
      execute: jest.fn().mockImplementation(async (cmd: { firId: string }) => {
        const fir = await repo.findById(cmd.firId)
        fir!.applyRentriStato('InserimentoAccettazione')
        await repo.save(fir!)
        return { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
      }),
    }
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaProduttoreTrasportatore' }],
      }),
    }
    return {
      completa,
      eventi: new EventiFirRentriInMemoria(),
      build() {
        return new FirmaPartenzaRentriUseCase(
          repo,
          getAzioni as any,
          completa as any,
          this.eventi,
          logger(),
          { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
        )
      },
    }
  }

  const documentoFirmabile = async (firId: string) => {
    const c = await nelTenant(() => cripto.findById(firId))
    const doc = c!.toSignableDocument()
    return { doc, hash: firma.hashDocument(doc) }
  }

  it('dopo la firma di partenza lo stato di viaggio e salvato, il documento firmato e l hash non cambiano e la firma del produttore resta valida', async () => {
    const firId = await firEmesso()
    await owner.fIR.update({ where: { id: firId }, data: { rentriNumeroFir: NUMERO_FIR } })
    const prima = await documentoFirmabile(firId)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    const h = useCaseFirmaPartenza()

    const esito = await nelTenant(() =>
      h.build().dopoAzioneLocale({ firId, tenantId, utenteId: userId })
    )

    expect(esito).toEqual({ stato: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBe('InserimentoAccettazione')
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.IN_TRANSITO)
    const dopo = await documentoFirmabile(firId)
    expect(dopo.doc).toEqual(prima.doc)
    expect(dopo.hash).toBe(prima.hash)
    const r = await nelTenant(() => verifica.execute({ firId, tenantId }))
    expect(r.allValid).toBe(true)
    // lo storico ha una riga per l'operazione scelta dall'ente
    expect(await h.eventi.elenca(tenantId, firId)).toHaveLength(1)
  })

  it('tenantSeLegatoRentri: l azienda per un FIR legato, null per un FIR cartaceo e per un FIR di un altra azienda', async () => {
    const legato = await firEmesso()
    await owner.fIR.update({ where: { id: legato }, data: { rentriNumeroFir: 'BCDFGH00071ZD' } })
    const cartaceo = await firEmesso()
    const uc = useCaseFirmaPartenza().build()

    expect(await nelTenant(() => uc.tenantSeLegatoRentri(legato))).toBe(tenantId)
    expect(await nelTenant(() => uc.tenantSeLegatoRentri(cartaceo))).toBeNull()
    // Un'altra azienda non vede il FIR (RLS): nessuna fuga di esistenza, nessuna firma.
    const altro = await TenantContext.run(
      { tenantId: '99999999-9999-4999-8999-999999999999' },
      () => uc.tenantSeLegatoRentri(legato)
    )
    expect(altro).toBeNull()
  })

  it('FIR non legato: la firma di partenza e NON_ANCORA_LEGATO e non tocca ne ente ne stato', async () => {
    const firId = await firEmesso()
    const h = useCaseFirmaPartenza()

    const esito = await nelTenant(() =>
      h.build().dopoAzioneLocale({ firId, tenantId, utenteId: userId })
    )

    expect(esito).toMatchObject({ stato: 'NON_ANCORA_LEGATO' })
    expect(h.completa.execute).not.toHaveBeenCalled()
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.EMESSO)
    expect(riga?.rentriStatoFormulario).toBeNull()
  })

  it('non regressione: la presa in carico locale di un FIR non legato resta com e (EMESSO -> IN_TRANSITO, firma del trasportatore)', async () => {
    const firId = await firEmesso()
    const presa = new PresaInCaricoFIRUseCase(repo, cripto, firma)

    const r = await nelTenant(() =>
      presa.execute(new PresaInCaricoFIRCommand(firId, userId, 'Mario Rossi'))
    )

    expect(r.isSuccess).toBe(true)
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.IN_TRANSITO)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
  })

  it('FIR legato: la presa in carico locale e vietata dall aggregate (lo sostituisce la firma di partenza)', async () => {
    const firId = await firEmesso()
    await owner.fIR.update({ where: { id: firId }, data: { rentriNumeroFir: 'BCDFGH00072ZD' } })
    const presa = new PresaInCaricoFIRUseCase(repo, cripto, firma)

    const r = await nelTenant(() =>
      presa.execute(new PresaInCaricoFIRCommand(firId, userId, 'Mario Rossi'))
    )

    expect(r.isFailure).toBe(true)
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.EMESSO)
  })
})
