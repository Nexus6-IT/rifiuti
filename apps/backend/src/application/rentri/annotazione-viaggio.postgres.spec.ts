/**
 * FIR in viaggio P4 (Postgres reale, RLS): annotazione su un FIR emesso e firmato in locale.
 * - Gli stati letti dall'ente (`FirmaAnnotazione`, poi lo stato di viaggio) si applicano e si salvano (repository
 *   reale) SENZA toccare il documento firmato: hash identico e firma del produttore ancora valida (regola del giro
 *   P2: dopo l'emissione i campi firmati non cambiano).
 * - Il CF del tenant si legge dal database sotto RLS e deve comparire fra i soggetti del FIR salvato.
 * - L'isolamento fra aziende vale anche per l'annotazione.
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
import { AnnotazioneRentriUseCase } from './annotazione-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'

describe('FIR in viaggio P4 — annotazione con repository reale (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let cripto: SignatureFIRRepository
  let firma: DigitalSignatureService
  let emetti: EmettiFIRUseCase
  let verifica: VerifySignaturesUseCase
  let tenantId = ''
  let altroTenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)
  let progressivo = 0
  let ultimoNumeroFir = ''
  const CF_TENANT = `PF${sfx}`.slice(0, 11)

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
        data: {
          partitaIva: `PA${sfx}`.slice(0, 11),
          codiceFiscale: CF_TENANT,
          ragioneSociale: `Annotazione ${sfx}`,
        },
      })
    ).id
    altroTenantId = (
      await owner.tenant.create({
        data: {
          partitaIva: `PB${sfx}`.slice(0, 11),
          codiceFiscale: `PB${sfx}`.slice(0, 11),
          ragioneSociale: `Altra azienda ${sfx}`,
        },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-annotazione-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `annotazione-${sfx}@example.it`,
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
      await owner.tenant.deleteMany({ where: { id: { in: [tenantId, altroTenantId] } } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  async function firEmessoLegato(opzioni: { cfProduttore?: string } = {}): Promise<string> {
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 1.2 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
      tipoTrattaPrincipale: TipoTratta.TERRESTRE,
      produttore: {
        ragioneSociale: 'Produttore SRL',
        partitaIva: '',
        codiceFiscale: opzioni.cfProduttore ?? CF_TENANT,
      },
    })
    await nelTenant(() => repo.save(fir))
    const r = await nelTenant(() =>
      emetti.execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
    )
    if (!r.isSuccess) throw new Error(`emissione fallita: ${String(r.error)}`)
    ultimoNumeroFir = `BCDFGH0008${++progressivo}ZD`
    await owner.fIR.update({ where: { id: fir.id }, data: { rentriNumeroFir: ultimoNumeroFir } })
    return fir.id
  }

  const documentoFirmabile = async (firId: string) => {
    const c = await nelTenant(() => cripto.findById(firId))
    const doc = c!.toSignableDocument()
    return { doc, hash: firma.hashDocument(doc) }
  }

  /**
   * L'ente e' simulato (annotazione accettata -> `FirmaAnnotazione`; firma -> `InserimentoAccettazione`), ma il
   * FIR, il tenant, la RLS e le firme sono quelli reali.
   */
  function useCase() {
    const statiVisti: string[] = []
    const client = {
      inviaAnnotazione: jest.fn().mockResolvedValue({
        errore: false,
        validazione: [],
        transazioneId: 'tr-an-pg',
      }),
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 2, stato_formulario: 'FirmaAnnotazione' }),
    }
    const getAzioni = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ azioni: [{ operazione: 'Annotazione' }] })
        .mockResolvedValue({ azioni: [{ operazione: 'AcquisizioneFirmaAnnotazione' }] }),
    }
    const completa = {
      execute: jest.fn().mockImplementation(async (cmd: { firId: string }) => {
        const riga = await owner.fIR.findUnique({ where: { id: cmd.firId } })
        statiVisti.push(riga?.rentriStatoFormulario ?? '')
        const fir = await repo.findById(cmd.firId)
        fir!.applyRentriStato('InserimentoAccettazione')
        await repo.save(fir!)
        return { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
      }),
    }
    const eventi = new EventiFirRentriInMemoria()
    const sessioni = { trovaAperta: jest.fn().mockResolvedValue(null) }
    return {
      client,
      completa,
      eventi,
      statiVisti,
      build: () =>
        new AnnotazioneRentriUseCase(
          repo,
          getAzioni as any,
          client as any,
          completa as any,
          eventi,
          logger(),
          sessioni as any,
          { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any,
          app
        ),
    }
  }

  it('annotazione + firma: stati dell ente salvati, documento firmato e hash invariati, firma del produttore ancora valida', async () => {
    const firId = await firEmessoLegato()
    const prima = await documentoFirmabile(firId)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    const h = useCase()

    const esito = await nelTenant(() =>
      h.build().invia({ firId, tenantId, testo: 'Carico pesato due volte', utenteId: userId })
    )

    expect(esito).toEqual({
      operazione: 'Annotazione',
      statoFormulario: 'FirmaAnnotazione',
      firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
    })
    // Il CF e' quello del tenant letto dal database sotto RLS.
    expect(h.client.inviaAnnotazione).toHaveBeenCalledWith(tenantId, ultimoNumeroFir, {
      annotazione: 'Carico pesato due volte',
      identificativo_soggetto: CF_TENANT,
    })
    // Tra l'invio e la firma lo stato `FirmaAnnotazione` era gia' sul FIR salvato.
    expect(h.statiVisti).toEqual(['FirmaAnnotazione'])
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBe('InserimentoAccettazione')
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.IN_TRANSITO)
    const dopo = await documentoFirmabile(firId)
    expect(dopo.doc).toEqual(prima.doc)
    expect(dopo.hash).toBe(prima.hash)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    expect((await h.eventi.elenca(tenantId, firId)).map(e => e.operazione).sort()).toEqual([
      'AcquisizioneFirmaAnnotazione',
      'Annotazione',
    ])
  })

  it('il CF del tenant non compare nel FIR salvato: 409, nessuna scrittura verso l ente, stato invariato', async () => {
    const firId = await firEmessoLegato({ cfProduttore: 'ZZZZZZ00Z00Z000Z' })
    const h = useCase()

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, testo: 'x', utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR' }),
    })

    expect(h.client.inviaAnnotazione).not.toHaveBeenCalled()
    expect(await h.eventi.elenca(tenantId, firId)).toHaveLength(0)
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBeNull()
  })

  it('isolamento fra aziende (RLS): un altra azienda non vede il FIR, nessuna annotazione', async () => {
    const firId = await firEmessoLegato()
    const h = useCase()

    await expect(
      TenantContext.run({ tenantId: altroTenantId }, () =>
        h.build().invia({ firId, tenantId: altroTenantId, testo: 'x' })
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(h.client.inviaAnnotazione).not.toHaveBeenCalled()
  })

  it('FIR cartaceo (non legato): FIR_NON_LEGATO_RENTRI, nessuna scrittura', async () => {
    const firId = await firEmessoLegato()
    await owner.fIR.update({ where: { id: firId }, data: { rentriNumeroFir: null } })
    const h = useCase()

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, testo: 'x', utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'FIR_NON_LEGATO_RENTRI' }),
    })
    expect(h.client.inviaAnnotazione).not.toHaveBeenCalled()
  })
})
