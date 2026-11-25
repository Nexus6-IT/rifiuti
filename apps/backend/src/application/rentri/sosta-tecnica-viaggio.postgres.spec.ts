/**
 * FIR in viaggio P5 (Postgres reale, RLS): sosta tecnica su un FIR emesso e firmato in locale.
 * - Gli stati letti dall'ente (`FirmaSostaTecnica`, poi lo stato di viaggio) si applicano e si salvano (repository
 *   reale) SENZA toccare il documento firmato: hash identico e firma del produttore ancora valida (regola del giro
 *   P2: dopo l'emissione i campi firmati non cambiano).
 * - Il CF del tenant si legge dal database sotto RLS e deve essere di un trasportatore del FIR salvato.
 * - L'isolamento fra aziende vale anche per la sosta tecnica.
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
import { SostaTecnicaRentriUseCase } from './sosta-tecnica-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

describe('FIR in viaggio P5 — sosta tecnica con repository reale (Postgres reale)', () => {
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
  const CORPO = {
    luogo_stazionamento: 'Area di servizio A1 km 120',
    data_ora_sospensione: '2026-11-18T10:00:00.000Z',
    data_ora_ripresa: '2026-11-18T12:30:00.000Z',
  }
  const DATI = {
    luogoStazionamento: CORPO.luogo_stazionamento,
    dataOraSospensione: CORPO.data_ora_sospensione,
    dataOraRipresa: CORPO.data_ora_ripresa,
  }

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
          ragioneSociale: `Sosta tecnica ${sfx}`,
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
          keycloakId: `kc-sosta-tecnica-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `sosta-tecnica-${sfx}@example.it`,
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
      // Il soggetto che dichiara la sosta e' il trasportatore che ha in carico il rifiuto.
      trasportatore: {
        ragioneSociale: 'Trasporti SRL',
        partitaIva: '',
        codiceFiscale: opzioni.cfProduttore ?? CF_TENANT,
      },
    })
    await nelTenant(() => repo.save(fir))
    const r = await nelTenant(() =>
      emetti.execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
    )
    if (!r.isSuccess) throw new Error(`emissione fallita: ${String(r.error)}`)
    ultimoNumeroFir = `BCDFGH0009${++progressivo}ZD`
    await owner.fIR.update({ where: { id: fir.id }, data: { rentriNumeroFir: ultimoNumeroFir } })
    return fir.id
  }

  const documentoFirmabile = async (firId: string) => {
    const c = await nelTenant(() => cripto.findById(firId))
    const doc = c!.toSignableDocument()
    return { doc, hash: firma.hashDocument(doc) }
  }

  /**
   * L'ente e' simulato (sosta accettata -> `FirmaSostaTecnica`; firma -> `InserimentoAccettazione`), ma il
   * FIR, il tenant, la RLS e le firme sono quelli reali.
   */
  function useCase() {
    const statiVisti: string[] = []
    const inviaSostaTecnica = jest.fn()
    const client = {
      inviaSostaTecnica: inviaSostaTecnica.mockResolvedValue({
        errore: false,
        validazione: [],
        transazioneId: 'tr-st-pg',
      }),
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 2, stato_formulario: 'FirmaSostaTecnica' }),
      // Dettaglio dell'ente: mostra la sosta inviata, non firmata finche' il ciclo di firma non e' passato.
      leggiFormulario: jest.fn().mockImplementation(async () => {
        const inviata = inviaSostaTecnica.mock.calls[0]?.[2] as Record<string, unknown> | undefined
        const firmata = completa.execute.mock.calls.length > 0
        return {
          stato_formulario: firmata ? 'InserimentoAccettazione' : 'FirmaSostaTecnica',
          dati_soste_tecniche: inviata
            ? [{ ...inviata, dati_firma: firmata ? { data_firma: '2026-11-20T10:00:00Z' } : null }]
            : [],
        }
      }),
    }
    const getAzioni = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ azioni: [{ operazione: 'SostaTecnica' }] })
        .mockResolvedValue({ azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }] }),
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
    const sessioni = new SessioniFirmaRentriInMemoria()
    return {
      client,
      completa,
      eventi,
      statiVisti,
      build: () =>
        new SostaTecnicaRentriUseCase(
          repo,
          getAzioni as any,
          client as any,
          completa as any,
          eventi,
          logger(),
          sessioni,
          { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any,
          app
        ),
    }
  }

  it('sosta + firma: stati dell ente salvati, documento firmato e hash invariati, firma del produttore ancora valida', async () => {
    const firId = await firEmessoLegato()
    const prima = await documentoFirmabile(firId)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    const h = useCase()

    const esito = await nelTenant(() =>
      h.build().invia({ firId, tenantId, ...DATI, utenteId: userId })
    )

    expect(esito).toEqual({
      operazione: 'SostaTecnica',
      statoFormulario: 'FirmaSostaTecnica',
      firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
    })
    // Il CF del tenant, letto dal database sotto RLS, e' quello del trasportatore del FIR salvato.
    expect(h.client.inviaSostaTecnica).toHaveBeenCalledWith(tenantId, ultimoNumeroFir, CORPO)
    // Tra l'invio e la firma lo stato `FirmaSostaTecnica` era gia' sul FIR salvato.
    expect(h.statiVisti).toEqual(['FirmaSostaTecnica'])
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBe('InserimentoAccettazione')
    expect((await nelTenant(() => repo.findById(firId)))?.stato).toBe(FIRStato.IN_TRANSITO)
    const dopo = await documentoFirmabile(firId)
    expect(dopo.doc).toEqual(prima.doc)
    expect(dopo.hash).toBe(prima.hash)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    // Ciclo di vita dell'invio (R1): INVIATA prima del POST, poi l'esito, poi la firma, in quest'ordine
    // anche rileggendo da Postgres (la riconciliazione guarda la riga piu' recente).
    expect(
      (await h.eventi.elenca(tenantId, firId)).reverse().map(e => [e.operazione, e.esito])
    ).toEqual([
      ['SostaTecnica', 'INVIATA'],
      ['SostaTecnica', 'ACCETTATA'],
      ['AcquisizioneFirmaSostaTecnica', 'ACCETTATA'],
    ])
  })

  it('il CF del tenant non e di un trasportatore del FIR salvato: 409, nessuna scrittura verso l ente, stato invariato', async () => {
    const firId = await firEmessoLegato({ cfProduttore: 'ZZZZZZ00Z00Z000Z' })
    const h = useCase()

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, ...DATI, utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR' }),
    })

    expect(h.client.inviaSostaTecnica).not.toHaveBeenCalled()
    expect(await h.eventi.elenca(tenantId, firId)).toHaveLength(0)
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBeNull()
  })

  it('isolamento fra aziende (RLS): un altra azienda non vede il FIR, nessuna sosta tecnica', async () => {
    const firId = await firEmessoLegato()
    const h = useCase()

    await expect(
      TenantContext.run({ tenantId: altroTenantId }, () =>
        h.build().invia({ firId, tenantId: altroTenantId, ...DATI })
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    expect(h.client.inviaSostaTecnica).not.toHaveBeenCalled()
  })

  it('FIR cartaceo (non legato): FIR_NON_LEGATO_RENTRI, nessuna scrittura', async () => {
    const firId = await firEmessoLegato()
    await owner.fIR.update({ where: { id: firId }, data: { rentriNumeroFir: null } })
    const h = useCase()

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, ...DATI, utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'FIR_NON_LEGATO_RENTRI' }),
    })
    expect(h.client.inviaSostaTecnica).not.toHaveBeenCalled()
  })
})
