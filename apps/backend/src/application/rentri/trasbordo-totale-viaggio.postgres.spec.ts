/**
 * FIR in viaggio P6 (Postgres reale, RLS): trasbordo totale su un FIR emesso e firmato in locale.
 * - Dopo l'esito positivo dell'ente nasce la tratta del nuovo trasportatore in `fir_transporters` (ordine + 1)
 *   SENZA toccare il documento firmato ne' la `versione` del FIR: hash identico e firma del produttore valida.
 * - Nessuna riga se l'ente rifiuta; la scrittura e' idempotente (una riconciliazione non duplica la tratta).
 * - Il CF del tenant si legge dal database sotto RLS e deve essere di un trasportatore del FIR salvato.
 * - L'isolamento fra aziende vale anche per la tratta: un'altra azienda non puo aggiungerla.
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
import { FIR, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { DigitalSignatureService } from '../signatures/digital-signature.service'
import { VerifySignaturesUseCase } from '../signatures/verify-signatures.use-case'
import { EmettiFIRUseCase } from '../fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../fir/commands/emetti-fir.command'
import { TrasbordoTotaleRentriUseCase } from './trasbordo-totale-rentri.use-case'
import { DatiViaggioFirRepository } from '../../infrastructure/persistence/dati-viaggio-fir.repository'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

describe('FIR in viaggio P6 — trasbordo totale con repository reale (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let cripto: SignatureFIRRepository
  let firma: DigitalSignatureService
  let emetti: EmettiFIRUseCase
  let verifica: VerifySignaturesUseCase
  let datiViaggio: DatiViaggioFirRepository
  let tenantId = ''
  let altroTenantId = ''
  let userId = ''
  const sfx = Date.now().toString().slice(-8)
  let progressivo = 0
  let ultimoNumeroFir = ''
  const CF_TENANT = `PF${sfx}`.slice(0, 11)
  const CF_NUOVO = '01234567890'
  const NUOVO_ID = '44444444-4444-4444-8444-444444444444'
  const INIZIO = '2026-11-18T12:00:00.000Z'
  const DATI = {
    trasportatoreId: NUOVO_ID,
    conducenteNome: 'Luca',
    conducenteCognome: 'Bianchi',
    targaAutomezzo: 'FG456HI',
    dataOraInizioTrasporto: INIZIO,
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
    datiViaggio = new DatiViaggioFirRepository(app)
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
          ragioneSociale: `Trasbordo totale ${sfx}`,
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
          keycloakId: `kc-trasbordo-totale-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `trasbordo-totale-${sfx}@example.it`,
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
      // Il soggetto che dichiara il trasbordo e' il trasportatore che ha in carico il rifiuto.
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
   * L'ente e' simulato (trasbordo accettato -> `FirmaTrasbordoTotale`), ma il FIR, il tenant, la RLS, le firme e
   * il repository dei dati di viaggio sono quelli reali. Il nuovo trasportatore e' un'anagrafica di prova.
   */
  function useCase(opzioni: { ente?: 'accetta' | 'rifiuta' } = {}) {
    const inviaTrasbordoTotale = jest
      .fn()
      .mockResolvedValue(
        opzioni.ente === 'rifiuta'
          ? { errore: true, validazione: [{ campo: 'x' }], transazioneId: 'tr-tt-no' }
          : { errore: false, validazione: [], transazioneId: 'tr-tt-pg' }
      )
    const client = {
      inviaTrasbordoTotale,
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 2, stato_formulario: 'FirmaTrasbordoTotale' }),
      leggiFormulario: jest.fn(),
      leggiStatoTransazione: jest.fn(),
    }
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({ azioni: [{ operazione: 'TrasbordoTotale' }] }),
    }
    const anagrafica = {
      id: NUOVO_ID,
      ragioneSociale: 'Trasporti Verdi Srl',
      partitaIVA: { getValue: () => CF_NUOVO },
      codiceFiscale: undefined,
      numeroIscrizione: 'MI/7490',
    }
    const eventi = new EventiFirRentriInMemoria()
    const sessioni = new SessioniFirmaRentriInMemoria()
    return {
      client,
      eventi,
      build: () =>
        new TrasbordoTotaleRentriUseCase(
          repo,
          getAzioni as any,
          client as any,
          { execute: jest.fn() } as any,
          eventi,
          logger(),
          sessioni,
          { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any,
          app,
          { findById: jest.fn().mockResolvedValue(anagrafica) } as any,
          datiViaggio
        ),
    }
  }

  const tratte = (firId: string) =>
    owner.fIRTransporter.findMany({ where: { firId }, orderBy: { ordine: 'asc' } })

  it('trasbordo accettato: tratta del nuovo trasportatore in fir_transporters, stato salvato, documento firmato, hash, versione e firma del produttore invariati', async () => {
    const firId = await firEmessoLegato()
    const prima = await documentoFirmabile(firId)
    const versionePrima = (await owner.fIR.findUnique({ where: { id: firId } }))!.versione
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    const h = useCase()

    const esito = await nelTenant(() =>
      h.build().invia({ firId, tenantId, ...DATI, utenteId: userId })
    )

    expect(esito).toMatchObject({
      operazione: 'TrasbordoTotale',
      statoFormulario: 'FirmaTrasbordoTotale',
      trattaLocaleCreata: true,
    })
    // Il CF del tenant, letto dal database sotto RLS, e' quello del trasportatore del FIR salvato.
    expect(h.client.inviaTrasbordoTotale).toHaveBeenCalledWith(
      tenantId,
      ultimoNumeroFir,
      expect.objectContaining({
        trasportatore: expect.objectContaining({
          codice_fiscale: CF_NUOVO,
          tipo_trasporto: 'Terrestre',
        }),
      })
    )
    const righe = await tratte(firId)
    expect(righe).toHaveLength(1)
    expect(righe[0]).toMatchObject({
      tenantId,
      ordine: 2,
      tipoTratta: 'TERRESTRE',
      denominazione: 'Trasporti Verdi Srl',
      partitaIva: CF_NUOVO,
      numeroIscrizioneAlbo: 'MI/007490',
      mezzo: 'FG456HI',
      conducenteNome: 'Luca',
      conducenteCognome: 'Bianchi',
    })
    expect(righe[0].dataOraInizioTrasporto?.toISOString()).toBe(INIZIO)
    // Stato dell'ente salvato; il documento firmato non cambia.
    const riga = await owner.fIR.findUnique({ where: { id: firId } })
    expect(riga?.rentriStatoFormulario).toBe('FirmaTrasbordoTotale')
    const dopo = await documentoFirmabile(firId)
    expect(dopo.doc).toEqual(prima.doc)
    expect(dopo.hash).toBe(prima.hash)
    expect((await nelTenant(() => verifica.execute({ firId, tenantId }))).allValid).toBe(true)
    // La tratta non fa avanzare la versione: solo lo stato RENTRI (un save) la muove.
    expect(riga!.versione - versionePrima).toBeLessThanOrEqual(1)
    // Il FIR riletto dall'aggregate porta la tratta nei trasportatori aggiuntivi.
    const riletto = await nelTenant(() => repo.findById(firId))
    expect(riletto?.trasportatoriAggiuntivi.map(t => [t.ordine, t.denominazione])).toEqual([
      [2, 'Trasporti Verdi Srl'],
    ])
  })

  it('l ente rifiuta: nessuna riga in fir_transporters, stato RENTRI invariato', async () => {
    const firId = await firEmessoLegato()
    const h = useCase({ ente: 'rifiuta' })

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, ...DATI, utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_RENTRI_RIFIUTATO' }),
    })

    expect(await tratte(firId)).toHaveLength(0)
    expect((await owner.fIR.findUnique({ where: { id: firId } }))?.rentriStatoFormulario).toBeNull()
  })

  it('aggiungiTrattaTrasbordoTotale: idempotente (stessa tratta = nessun duplicato) e ordine progressivo, senza toccare la versione del FIR', async () => {
    const firId = await firEmessoLegato()
    const versione = (await owner.fIR.findUnique({ where: { id: firId } }))!.versione
    const tratta = {
      trasportatoreId: null,
      denominazione: 'Trasporti Verdi Srl',
      partitaIva: CF_NUOVO,
      codiceFiscale: null,
      numeroIscrizioneAlbo: null,
      mezzo: 'FG456HI',
      conducenteNome: 'Luca',
      conducenteCognome: 'Bianchi',
      targaRimorchio: null,
      percorso: null,
      dataOraInizioTrasporto: new Date(INIZIO),
    }

    const prima = await nelTenant(() =>
      datiViaggio.aggiungiTrattaTrasbordoTotale(tenantId, firId, tratta)
    )
    const ancora = await nelTenant(() =>
      datiViaggio.aggiungiTrattaTrasbordoTotale(tenantId, firId, tratta)
    )
    const altra = await nelTenant(() =>
      datiViaggio.aggiungiTrattaTrasbordoTotale(tenantId, firId, {
        ...tratta,
        partitaIva: null,
        codiceFiscale: 'RSSMRA80A01H501U',
        dataOraInizioTrasporto: new Date('2026-11-19T08:00:00.000Z'),
      })
    )

    expect(prima).toEqual({ creata: true, ordine: 2 })
    expect(ancora).toEqual({ creata: false, ordine: 2 })
    expect(altra).toEqual({ creata: true, ordine: 3 })
    expect((await tratte(firId)).map(t => t.ordine)).toEqual([2, 3])
    expect((await owner.fIR.findUnique({ where: { id: firId } }))!.versione).toBe(versione)
  })

  it('aggiungiTrattaTrasbordoTotale: chiamate concorrenti per la stessa tratta ne creano una sola (lock sulla riga del FIR)', async () => {
    const firId = await firEmessoLegato()
    const tratta = {
      trasportatoreId: null,
      denominazione: 'Trasporti Verdi Srl',
      partitaIva: CF_NUOVO,
      codiceFiscale: null,
      numeroIscrizioneAlbo: null,
      mezzo: 'FG456HI',
      conducenteNome: 'Luca',
      conducenteCognome: 'Bianchi',
      targaRimorchio: null,
      percorso: null,
      dataOraInizioTrasporto: new Date(INIZIO),
    }

    const esiti = await Promise.all(
      Array.from({ length: 16 }, () =>
        nelTenant(() => datiViaggio.aggiungiTrattaTrasbordoTotale(tenantId, firId, tratta))
      )
    )

    expect(esiti.filter(e => e.creata)).toHaveLength(1)
    expect(new Set(esiti.map(e => e.ordine))).toEqual(new Set([2]))
    expect((await tratte(firId)).map(t => t.ordine)).toEqual([2])
  })

  it('il CF del tenant non e di un trasportatore del FIR salvato: 409, nessuna scrittura verso l ente, nessuna tratta', async () => {
    const firId = await firEmessoLegato({ cfProduttore: 'ZZZZZZ00Z00Z000Z' })
    const h = useCase()

    await expect(
      nelTenant(() => h.build().invia({ firId, tenantId, ...DATI, utenteId: userId }))
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR' }),
    })

    expect(h.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    expect(await h.eventi.elenca(tenantId, firId)).toHaveLength(0)
    expect(await tratte(firId)).toHaveLength(0)
  })

  it('isolamento fra aziende (RLS): un altra azienda non vede il FIR e non puo aggiungergli una tratta', async () => {
    const firId = await firEmessoLegato()
    const h = useCase()

    await expect(
      TenantContext.run({ tenantId: altroTenantId }, () =>
        h.build().invia({ firId, tenantId: altroTenantId, ...DATI })
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(h.client.inviaTrasbordoTotale).not.toHaveBeenCalled()

    // Anche scrivendo direttamente col repository: il FIR non e della sua azienda (RLS / FK composta).
    await expect(
      TenantContext.run({ tenantId: altroTenantId }, () =>
        datiViaggio.aggiungiTrattaTrasbordoTotale(altroTenantId, firId, {
          trasportatoreId: null,
          denominazione: 'Intrusa',
          partitaIva: CF_NUOVO,
          codiceFiscale: null,
          numeroIscrizioneAlbo: null,
          mezzo: null,
          conducenteNome: 'A',
          conducenteCognome: 'B',
          targaRimorchio: null,
          percorso: null,
          dataOraInizioTrasporto: new Date(INIZIO),
        })
      )
    ).rejects.toBeDefined()
    expect(await tratte(firId)).toHaveLength(0)
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
    expect(h.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    expect(await tratte(firId)).toHaveLength(0)
  })
})
