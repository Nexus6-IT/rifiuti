/**
 * Modifica della bozza FIR (Fase 2 pezzo 4, Task 3b) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS attiva) e dentro il `TenantContext` dell'azienda. Il proprietario
 * (`wasteflow`) prepara le aziende, forza stati che l'applicazione non scrive e legge cio' che e'
 * stato scritto; la pulizia toglie solo le righe create qui.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono queste due variabili, come in produzione.
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
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { SignatureFIRRepository } from '../signatures/signature-fir.repository'
import {
  FIR,
  ParteFIR,
  ProvenienzaRifiuto,
  TipoTratta,
} from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { Produttore } from '../../domain/registry/entities/produttore'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { ModificaFIRUseCase } from '../../application/fir/use-cases/modifica-fir.use-case'
import { ModificaFIRCommand } from '../../application/fir/commands/modifica-fir.command'
import { EmettiFIRUseCase } from '../../application/fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../../application/fir/commands/emetti-fir.command'
import { AcquisisciFormularioRENTRIUseCase } from '../../application/rentri/acquisisci-formulario-rentri.use-case'
import {
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
  FirNonTrovatoError,
} from '../../core/domain/errors'

const P1 = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const D1 = '33333333-3333-4333-8333-333333333333'
const D2 = '44444444-4444-4444-8444-444444444444'
const T2 = '55555555-5555-4555-8555-555555555555'
const T3 = '66666666-6666-4666-8666-666666666666'

describe('FIR: modifica della bozza (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let repo: FIRPrismaRepository
  let repoFirme: SignatureFIRRepository
  let tenantId = ''
  let userId = ''
  let altroTenantId = ''
  let altroUserId = ''
  const sfx = Date.now().toString().slice(-8)
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  // Registro finto: i nomi sono modificabili per provare che uno snapshot invariato non cambia
  // anche quando l'anagrafica del registro e' cambiata nel frattempo.
  const registro = { produttore: 'Produttore registro', destinatario: 'Destinatario registro' }
  const indirizzo = Indirizzo.create({
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
  })
  const produttori = {
    findById: async (id: string) =>
      Produttore.reconstitute({
        id,
        ragioneSociale: registro.produttore,
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: indirizzo,
        pec: 'prod@pec.it',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  }
  const trasportatori = {
    findById: async (id: string) =>
      Trasportatore.reconstitute({
        id,
        ragioneSociale: `Trasportatore ${id.slice(0, 2)}`,
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        partitaIVA: PartitaIVA.create('22345678901'),
        sedeLegale: indirizzo,
        numeroIscrizione: 'ALBO-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  }
  const destinatari = {
    findById: async (id: string) =>
      Destinatario.reconstitute({
        id,
        ragioneSociale: `${registro.destinatario} ${id.slice(0, 2)}`,
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        partitaIVA: PartitaIVA.create('32345678901'),
        sede: indirizzo,
        numeroAutorizzazione: 'AUT-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  }
  const cer = {
    exists: async () => true,
    isUtilizzabilePerNuovoFormulario: async () => true,
  }

  let modifica: ModificaFIRUseCase

  const nelTenant = <T>(fn: () => Promise<T>, t = tenantId): Promise<T> =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    repo = new FIRPrismaRepository(app, sistema)
    repoFirme = new SignatureFIRRepository(app, sistema, logger)
    modifica = new ModificaFIRUseCase(
      repo,
      cer as never,
      produttori as never,
      trasportatori as never,
      destinatari as never,
      { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never
    )
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    const crea = async (n: string) => {
      const tenant = await owner.tenant.create({
        data: {
          partitaIva: `${n}${sfx}`.slice(0, 11),
          ragioneSociale: `Modifica bozza ${n} ${sfx}`,
        },
      })
      const user = await owner.user.create({
        data: {
          tenantId: tenant.id,
          keycloakId: `kc-modifica-${n}-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `modifica-${n}-${sfx}@example.it`,
          role: 'ADMIN',
        },
      })
      return { tenantId: tenant.id, userId: user.id }
    }
    ;({ tenantId, userId } = await crea('MA'))
    ;({ tenantId: altroTenantId, userId: altroUserId } = await crea('MB'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    // Senza id (beforeAll fallito) Prisma toglierebbe il filtro: non si cancella nulla.
    for (const t of [tenantId, altroTenantId]) {
      if (!t) continue
      await owner.activityLog.deleteMany({ where: { tenantId: t } })
      await owner.fIR.deleteMany({ where: { tenantId: t } })
      await owner.user.deleteMany({ where: { tenantId: t } })
      await owner.tenant.deleteMany({ where: { id: t } })
    }
    await Promise.all([owner.$disconnect(), app.onModuleDestroy(), sistema.onModuleDestroy()])
  })

  const snapP: ParteFIR = {
    registroId: P1,
    ragioneSociale: 'Produttore congelato',
    partitaIva: '12345678901',
    indirizzo: 'Via Vecchia 1',
    contatto: 'vecchio@pec.it',
  }
  const snapT: ParteFIR = {
    registroId: T1,
    ragioneSociale: 'Trasportatore congelato',
    partitaIva: '22345678901',
    indirizzo: 'Via Vecchia 2',
  }
  const snapD: ParteFIR = {
    registroId: D1,
    ragioneSociale: 'Destinatario congelato',
    partitaIva: '32345678901',
    indirizzo: 'Via Vecchia 3',
  }

  async function bozzaSalvata(
    opzioni: {
      rifiuto?: Partial<{
        statoFisico: string
        caratteristichePericolo: string
        numeroColli: number
        codiceOperazione: string
      }>
      annotazioni?: string
      tratte?: boolean
      tenant?: string
      user?: string
    } = {}
  ): Promise<FIR> {
    const t = opzioni.tenant ?? tenantId
    const fir = FIR.create({
      produttoreId: P1,
      rifiuto: {
        cerCode: '15 01 01',
        quantita: 100,
        unitaMisura: UnitaMisura.KG,
        ...opzioni.rifiuto,
      },
      trasportatoreId: T1,
      destinatarioId: D1,
      tenantId: t,
      creatoDaUserId: opzioni.user ?? userId,
      produttore: snapP,
      trasportatore: snapT,
      destinatario: snapD,
      annotazioni: opzioni.annotazioni,
      provenienza: ProvenienzaRifiuto.SPECIALE,
      tipoTrattaPrincipale: TipoTratta.TERRESTRE,
      trasportatoriAggiuntivi: opzioni.tratte
        ? [
            {
              ordine: 1,
              tipoTratta: TipoTratta.FERROVIARIA,
              trasportatoreId: T2,
              denominazione: 'Ferrovie congelate',
              partitaIva: '22345678901',
            },
          ]
        : [],
    })
    await nelTenant(() => repo.save(fir), t)
    return fir
  }

  const riga = (id: string) => owner.fIR.findUniqueOrThrow({ where: { id } })
  const audit = (id: string) =>
    owner.activityLog.findMany({ where: { firId: id, action: 'FIR_BOZZA_MODIFICATA' } })
  const tratte = (id: string) =>
    owner.fIRTransporter.findMany({ where: { firId: id }, orderBy: { ordine: 'asc' } })

  const comando = (fir: FIR, extra: Partial<ModificaFIRCommand> = {}): ModificaFIRCommand => ({
    firId: fir.id,
    tenantId,
    userId,
    versione: fir.versione,
    produttoreId: P1,
    trasportatoreId: T1,
    destinatarioId: D1,
    rifiuto: { cerCode: '15 01 01', quantita: 100, unitaMisura: UnitaMisura.KG },
    provenienza: ProvenienzaRifiuto.SPECIALE,
    tipoTrattaPrincipale: TipoTratta.TERRESTRE,
    trasportatoriAggiuntivi: [],
    ...extra,
  })

  const esegui = (c: ModificaFIRCommand) => nelTenant(() => modifica.execute(c))
  const attesa = (ms: number) => new Promise(r => setTimeout(r, ms))

  /** Ferma la prima `salvaCon` dopo la sua scrittura: la transaction resta aperta con il lock. */
  function tieniApertaLaPrimaScrittura(): { raggiunto: Promise<void>; rilascia: () => void } {
    let rilascia!: () => void
    const via = new Promise<void>(r => (rilascia = r))
    let segnala!: () => void
    const raggiunto = new Promise<void>(r => (segnala = r))
    const originale = (repo as any).salvaCon.bind(repo)
    jest.spyOn(repo as any, 'salvaCon').mockImplementationOnce(async (...args: unknown[]) => {
      const esito = await originale(...args)
      segnala()
      await via
      return esito
    })
    return { raggiunto, rilascia }
  }

  const hashDelDocumentoFirmabile = async (id: string): Promise<string> => {
    const cripto = (await nelTenant(() => repoFirme.findById(id)))!
    return createHash('sha256').update(cripto.toSignableDocument(), 'utf8').digest('hex')
  }

  function emissione(): EmettiFIRUseCase {
    const firma = {
      createSignature: async (documento: string) => ({
        signatureValue: 'valore-firma',
        documentHash: createHash('sha256').update(documento, 'utf8').digest('hex'),
        certificateHash: 'a'.repeat(64),
        publicKey: 'chiave-pubblica',
        timestampToken: 'token',
        signatureMethod: 'ECDSA-SHA256',
        isQualified: false,
      }),
    }
    const rentri = { eseguiSeAutomatica: async () => undefined }
    return new EmettiFIRUseCase(repo, repoFirme, firma as never, rentri as never, logger)
  }

  // ---------------------------------------------------------------------------------------------

  it('modifica di quantita, CER e annotazioni: riga aggiornata, versione +1, audit con tenant e metadata', async () => {
    const fir = await bozzaSalvata()
    const prima = await riga(fir.id)

    const r = await esegui(
      comando(fir, {
        rifiuto: { cerCode: '20 03 01', quantita: 250.5, unitaMisura: UnitaMisura.KG },
        annotazioni: 'Ritiro il lunedi',
      })
    )

    expect(r.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(dopo.cerCode).toBe('20 03 01')
    expect(Number(dopo.quantity)).toBe(250.5)
    expect(dopo.wasteNotes).toBe('Ritiro il lunedi')
    expect(dopo.versione).toBe(prima.versione + 1)
    expect(r.value.versione).toBe(prima.versione + 1)
    expect(dopo.status).toBe('DRAFT')

    const log = await audit(fir.id)
    expect(log).toHaveLength(1)
    expect(log[0].tenantId).toBe(tenantId)
    expect(log[0].userId).toBe(userId)
    expect(log[0].description).toBe('Bozza del FIR modificata')
    const meta = log[0].metadata as any
    expect(meta.versionePrecedente).toBe(prima.versione)
    expect(meta.versioneNuova).toBe(prima.versione + 1)
    expect(meta.campiModificati).toEqual(
      expect.arrayContaining(['cerCode', 'quantita', 'annotazioni'])
    )
    expect(meta.partiRisnapshottate).toEqual([])
  })

  it('nessun cambiamento: nessuna scrittura, nessun incremento, nessun audit', async () => {
    const fir = await bozzaSalvata()
    const prima = await riga(fir.id)

    const r = await esegui(comando(fir))

    expect(r.isSuccess).toBe(true)
    expect((await riga(fir.id)).versione).toBe(prima.versione)
    expect((await riga(fir.id)).updatedAt.getTime()).toBe(prima.updatedAt.getTime())
    expect(await audit(fir.id)).toHaveLength(0)
  })

  it.each([
    ['campi assenti', {}],
    ['campi vuoti', { statoFisico: '', caratteristichePericolo: '', codiceOperazione: '' }],
  ])(
    'svuotamento (%s): annotazioni, HP, colli, stato fisico e codice operazione tornano NULL',
    async (_n, vuoti) => {
      const fir = await bozzaSalvata({
        annotazioni: 'Da svuotare',
        rifiuto: {
          statoFisico: 'SOLIDO',
          caratteristichePericolo: 'HP4,HP14',
          numeroColli: 7,
          codiceOperazione: 'R13',
        },
      })
      const prima = await riga(fir.id)
      expect(prima.wasteNotes).toBe('Da svuotare')
      expect(prima.wasteHazardClasses).toBe('HP4,HP14')
      expect(prima.wastePackageCount).toBe(7)

      const r = await esegui(
        comando(fir, {
          annotazioni: _n === 'campi vuoti' ? '' : undefined,
          rifiuto: {
            cerCode: '15 01 01',
            quantita: 100,
            unitaMisura: UnitaMisura.KG,
            ...vuoti,
          },
        })
      )

      expect(r.isSuccess).toBe(true)
      const dopo = await riga(fir.id)
      expect(dopo.wasteNotes).toBeNull()
      expect(dopo.wasteHazardClasses).toBeNull()
      expect(dopo.wastePackageCount).toBeNull()
      expect(dopo.wastePhysicalState).toBeNull()
      expect(dopo.wasteOperationCode).toBeNull()
      expect(dopo.versione).toBe(prima.versione + 1)
      const meta = (await audit(fir.id))[0].metadata as any
      expect(meta.campiModificati).toEqual(
        expect.arrayContaining([
          'annotazioni',
          'caratteristichePericolo',
          'numeroColli',
          'statoFisico',
          'codiceOperazione',
        ])
      )
    }
  )

  it('descrizione, categoria e tipo operazione scritti dal proprietario restano invariati', async () => {
    const fir = await bozzaSalvata()
    await owner.fIR.update({
      where: { id: fir.id },
      data: {
        wasteDescription: 'Imballaggi in carta',
        wasteCategory: 'Speciale non pericoloso',
        wasteOperationType: 'RECOVERY',
      },
    })
    const caricato = (await nelTenant(() => repo.findById(fir.id)))!

    const r = await esegui(
      comando(caricato, {
        rifiuto: { cerCode: '15 01 01', quantita: 999, unitaMisura: UnitaMisura.KG },
      })
    )

    expect(r.isSuccess).toBe(true)
    const dopo = await riga(fir.id)
    expect(Number(dopo.quantity)).toBe(999)
    expect(dopo.wasteDescription).toBe('Imballaggi in carta')
    expect(dopo.wasteCategory).toBe('Speciale non pericoloso')
    expect(dopo.wasteOperationType).toBe('RECOVERY')
  })

  it('cambio del destinatario: snapshot del nuovo; produttore invariato resta congelato anche se il registro e cambiato', async () => {
    const fir = await bozzaSalvata()
    registro.produttore = 'Produttore RINOMINATO nel registro'
    try {
      const r = await esegui(comando(fir, { destinatarioId: D2 }))

      expect(r.isSuccess).toBe(true)
      const dopo = await riga(fir.id)
      expect(dopo.receiverId).toBe(D2)
      expect(dopo.receiverName).toContain('Destinatario registro')
      expect(dopo.receiverAddress).not.toBe('Via Vecchia 3')
      expect(dopo.producerName).toBe('Produttore congelato')
      expect(dopo.producerAddress).toBe('Via Vecchia 1')
      expect(dopo.producerContact).toBe('vecchio@pec.it')
      const meta = (await audit(fir.id))[0].metadata as any
      expect(meta.partiRisnapshottate).toEqual(['destinatario'])
      expect(meta.campiModificati).toContain('destinatario')
    } finally {
      registro.produttore = 'Produttore registro'
    }
  })

  it('tratte cambiate: righe sostituite con il tenant; invariate: stessi id', async () => {
    const fir = await bozzaSalvata({ tratte: true })
    const iniziali = await tratte(fir.id)
    expect(iniziali).toHaveLength(1)

    // Invariate (stessa chiave trasportatore, tipo, ordine): stesse righe.
    const identiche = {
      trasportatoriAggiuntivi: [
        { trasportatoreId: T2, tipoTratta: TipoTratta.FERROVIARIA, ordine: 1 },
      ],
    }
    const r1 = await esegui(comando(fir, { ...identiche, annotazioni: 'solo nota' }))
    expect(r1.isSuccess).toBe(true)
    const dopoNota = await tratte(fir.id)
    expect(dopoNota.map(t => t.id)).toEqual(iniziali.map(t => t.id))

    // Cambiate: due tratte nuove, le vecchie spariscono.
    const aggiornato = (await nelTenant(() => repo.findById(fir.id)))!
    const r2 = await esegui(
      comando(aggiornato, {
        annotazioni: 'solo nota',
        trasportatoriAggiuntivi: [
          { trasportatoreId: T2, tipoTratta: TipoTratta.FERROVIARIA, ordine: 1 },
          { trasportatoreId: T3, tipoTratta: TipoTratta.MARITTIMA, ordine: 2 },
        ],
      })
    )
    expect(r2.isSuccess).toBe(true)
    const dopo = await tratte(fir.id)
    expect(dopo).toHaveLength(2)
    expect(dopo.map(t => t.trasportatoreId)).toEqual([T2, T3])
    expect(dopo.every(t => t.tenantId === tenantId)).toBe(true)
    expect(dopo.map(t => t.id)).not.toContain(iniziali[0].id)
    const meta = (await audit(fir.id)).find(a => (a.metadata as any).versionePrecedente === 2)
      ?.metadata as any
    expect(meta.campiModificati).toContain('trasportatoriAggiuntivi')
  })

  it('versione vecchia: 409 modificato, nessuna scrittura, nessun audit', async () => {
    const fir = await bozzaSalvata()
    const prima = await riga(fir.id)
    // Un'altra modifica arriva per prima.
    await esegui(comando(fir, { annotazioni: 'prima' }))
    const dopoPrima = await riga(fir.id)
    expect(dopoPrima.versione).toBe(prima.versione + 1)

    await expect(
      esegui(comando(fir, { annotazioni: 'seconda', versione: prima.versione }))
    ).rejects.toBeInstanceOf(FirModificatoNelFrattempoError)

    const dopo = await riga(fir.id)
    expect(dopo.wasteNotes).toBe('prima')
    expect(dopo.versione).toBe(dopoPrima.versione)
    expect(await audit(fir.id)).toHaveLength(1)
  })

  it('due modifiche concorrenti con la stessa versione: una sola riesce', async () => {
    const fir = await bozzaSalvata()
    const v = (await riga(fir.id)).versione
    const gate = tieniApertaLaPrimaScrittura()

    const primo = esegui(comando(fir, { annotazioni: 'A' })).then(
      () => 'ok' as const,
      e => e as Error
    )
    await gate.raggiunto
    const secondo = esegui(comando(fir, { annotazioni: 'B' })).then(
      () => 'ok' as const,
      e => e as Error
    )
    await attesa(500)
    expect(await Promise.race([secondo, attesa(10).then(() => 'in-attesa')])).toBe('in-attesa')
    gate.rilascia()

    expect(await primo).toBe('ok')
    expect(await secondo).toBeInstanceOf(FirModificatoNelFrattempoError)
    const dopo = await riga(fir.id)
    expect(dopo.wasteNotes).toBe('A')
    expect(dopo.versione).toBe(v + 1)
    expect(await audit(fir.id)).toHaveLength(1)
  })

  describe('corsa con l emissione', () => {
    it('modifica tenuta aperta mentre parte l emissione: vince la modifica, l emissione riceve 409 e nulla viene emesso', async () => {
      const fir = await bozzaSalvata()
      const gate = tieniApertaLaPrimaScrittura()

      const mod = esegui(comando(fir, { annotazioni: 'Modificata' }))
      await gate.raggiunto
      const em = nelTenant(() =>
        emissione().execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
      ).then(
        () => 'ok' as const,
        e => e as Error
      )
      await attesa(500)
      expect(await Promise.race([em, attesa(10).then(() => 'in-attesa')])).toBe('in-attesa')
      gate.rilascia()

      expect((await mod).isSuccess).toBe(true)
      expect(await em).toBeInstanceOf(FirModificatoNelFrattempoError)
      const dopo = await riga(fir.id)
      expect(dopo.status).toBe('DRAFT')
      expect(dopo.firNumber).toBeNull()
      expect(dopo.wasteNotes).toBe('Modificata')
      expect(await owner.fIRSignature.count({ where: { firId: fir.id } })).toBe(0)
    })

    it('emissione tenuta aperta mentre parte la modifica: vince l emissione, la modifica riceve 409 e la firma copre il contenuto finale', async () => {
      const fir = await bozzaSalvata({ annotazioni: 'Originale' })
      const gate = tieniApertaLaPrimaScrittura()

      const em = nelTenant(() =>
        emissione().execute(new EmettiFIRCommand(fir.id, userId, 'Mario Rossi'))
      )
      await gate.raggiunto
      const mod = esegui(comando(fir, { annotazioni: 'Troppo tardi' })).then(
        () => 'ok' as const,
        e => e as Error
      )
      await attesa(500)
      expect(await Promise.race([mod, attesa(10).then(() => 'in-attesa')])).toBe('in-attesa')
      gate.rilascia()

      expect((await em).isSuccess).toBe(true)
      const errore = await mod
      expect(errore).toBeInstanceOf(FirNonModificabileError)
      expect((errore as FirNonModificabileError).motivo).toBe('NON_BOZZA')

      const dopo = await riga(fir.id)
      expect(dopo.status).toBe('AWAITING_CARRIER')
      expect(dopo.wasteNotes).toBe('Originale')
      expect(await audit(fir.id)).toHaveLength(0)
      // Mai un FIR emesso con contenuto diverso da quello firmato.
      const firma = await owner.fIRSignature.findFirstOrThrow({
        where: { firId: fir.id, role: 'PRODUTTORE' },
      })
      expect(firma.documentHash).toBe(await hashDelDocumentoFirmabile(fir.id))
    })
  })

  it('modifica, poi aggancio manuale con una copia vecchia: 409, contenuto modificato intatto, nessun legame', async () => {
    const fir = await bozzaSalvata()
    const client = {
      acquisisciVisibilita: jest.fn(async () => undefined),
      // Fra la lettura della copia e il salvataggio dell'aggancio arriva una modifica.
      leggiFormulario: jest.fn(async () => {
        await esegui(comando(fir, { annotazioni: 'Modificata durante l aggancio' }))
        return {}
      }),
    }
    const aggancio = new AcquisisciFormularioRENTRIUseCase(
      repo,
      client as never,
      app,
      { creaDaDettaglio: jest.fn() } as never,
      logger
    )

    await expect(
      nelTenant(() =>
        aggancio.execute({
          tenantId,
          userId,
          userRole: 'ADMIN',
          numeroFir: `MI-${sfx}`,
          numIscrSito: 'SITO-1',
          visibilitaGiaAcquisita: false,
          scelta: { tipo: 'COLLEGA_ESISTENTE', firId: fir.id },
        })
      )
    ).rejects.toBeInstanceOf(FirModificatoNelFrattempoError)

    const dopo = await riga(fir.id)
    expect(dopo.wasteNotes).toBe('Modificata durante l aggancio')
    expect(dopo.rentriNumeroFir).toBeNull()
    expect(dopo.rentriOrigineLegame).toBeNull()
  })

  describe('motivi di rifiuto sotto lock (stesso ordine dell aggregate)', () => {
    /** Carica e modifica in memoria una bozza valida, poi lascia al chiamante forzare la riga. */
    async function copiaModificata(): Promise<{ fir: FIR; id: string }> {
      const fir = await bozzaSalvata()
      const copia = (await nelTenant(() => repo.findById(fir.id)))!
      const cambiati = copia.modificaBozza({
        produttoreId: P1,
        trasportatoreId: T1,
        destinatarioId: D1,
        produttore: snapP,
        trasportatore: snapT,
        destinatario: snapD,
        rifiuto: { cerCode: '15 01 01', quantita: 5, unitaMisura: UnitaMisura.KG },
        trasportatoriAggiuntivi: [],
        provenienza: ProvenienzaRifiuto.SPECIALE,
        tipoTrattaPrincipale: TipoTratta.TERRESTRE,
      })
      expect(cambiati).toContain('quantita')
      return { fir: copia, id: fir.id }
    }

    const salva = (fir: FIR) =>
      nelTenant(() =>
        repo.salvaModificaBozza(fir, fir.versione, {
          userId,
          campiModificati: ['quantita'],
          partiRisnapshottate: [],
        })
      )

    const firmaPer = (id: string, role: string) =>
      owner.fIRSignature.create({
        data: {
          firId: id,
          tenantId,
          userId,
          role,
          signedAt: new Date(),
          signatureValue: 'valore',
          certificateHash: 'a'.repeat(64),
          documentHash: 'b'.repeat(64),
        },
      })

    const motivo = async (p: Promise<void>) => {
      const e = await p.then(
        () => null,
        err => err
      )
      expect(e).toBeInstanceOf(FirNonModificabileError)
      return (e as FirNonModificabileError).motivo
    }

    const nessunaScrittura = async (id: string, versione: number) => {
      const r = await riga(id)
      expect(r.versione).toBe(versione)
      expect(Number(r.quantity)).toBe(100)
      expect(await audit(id)).toHaveLength(0)
    }

    it('bozza con firma PRODUCER QES: FIRMATO', async () => {
      const { fir, id } = await copiaModificata()
      await firmaPer(id, 'PRODUCER')
      expect(await motivo(salva(fir))).toBe('FIRMATO')
      await nessunaScrittura(id, 1)
    })

    it('riga forzata ad AWAITING_PRODUCER: IN_ATTESA_FIRMA_PRODUTTORE', async () => {
      const { fir, id } = await copiaModificata()
      await owner.fIR.update({ where: { id }, data: { status: 'AWAITING_PRODUCER' } })
      expect(await motivo(salva(fir))).toBe('IN_ATTESA_FIRMA_PRODUTTORE')
      await nessunaScrittura(id, 1)
    })

    it('FIR emesso: NON_BOZZA', async () => {
      const { fir, id } = await copiaModificata()
      await owner.fIR.update({ where: { id }, data: { status: 'AWAITING_CARRIER' } })
      expect(await motivo(salva(fir))).toBe('NON_BOZZA')
      await nessunaScrittura(id, 1)
    })

    it('bozza con rentri_numero_fir: LEGATO_RENTRI', async () => {
      const { fir, id } = await copiaModificata()
      await owner.fIR.update({ where: { id }, data: { rentriNumeroFir: `MI-L-${sfx}` } })
      expect(await motivo(salva(fir))).toBe('LEGATO_RENTRI')
      await nessunaScrittura(id, 1)
    })

    it('piu motivi insieme: stesso ordine dell aggregate', async () => {
      // legata + emessa + firmata -> LEGATO_RENTRI
      let { fir, id } = await copiaModificata()
      await owner.fIR.update({
        where: { id },
        data: { rentriNumeroFir: `MI-M-${sfx}`, status: 'AWAITING_CARRIER' },
      })
      await firmaPer(id, 'PRODUTTORE')
      expect(await motivo(salva(fir))).toBe('LEGATO_RENTRI')

      // emessa + firmata -> NON_BOZZA
      ;({ fir, id } = await copiaModificata())
      await owner.fIR.update({ where: { id }, data: { status: 'AWAITING_CARRIER' } })
      await firmaPer(id, 'PRODUTTORE')
      expect(await motivo(salva(fir))).toBe('NON_BOZZA')

      // AWAITING_PRODUCER + firmata -> FIRMATO
      ;({ fir, id } = await copiaModificata())
      await owner.fIR.update({ where: { id }, data: { status: 'AWAITING_PRODUCER' } })
      await firmaPer(id, 'PRODUCER')
      expect(await motivo(salva(fir))).toBe('FIRMATO')
    })

    it('non modificabile ha la precedenza sulla versione vecchia', async () => {
      const { fir, id } = await copiaModificata()
      await owner.fIR.update({ where: { id }, data: { status: 'AWAITING_CARRIER', versione: 9 } })
      expect(await motivo(salva(fir))).toBe('NON_BOZZA')
    })

    it('stesso esito passando dal caso d uso (aggregate): bozza firmata -> FIRMATO', async () => {
      const fir = await bozzaSalvata()
      await firmaPer(fir.id, 'PRODUCER')
      const caricato = (await nelTenant(() => repo.findById(fir.id)))!
      await expect(esegui(comando(caricato, { annotazioni: 'x' }))).rejects.toMatchObject({
        motivo: 'FIRMATO',
      })
    })
  })

  describe('FIR di un altra azienda (RLS)', () => {
    it('dal caso d uso: FirNonTrovatoError, nessuna scrittura', async () => {
      const altro = await bozzaSalvata({ tenant: altroTenantId, user: altroUserId })
      const prima = await riga(altro.id)

      await expect(esegui(comando(altro, { annotazioni: 'intrusione' }))).rejects.toBeInstanceOf(
        FirNonTrovatoError
      )

      const dopo = await riga(altro.id)
      expect(dopo.versione).toBe(prima.versione)
      expect(dopo.wasteNotes).toBeNull()
      expect(await audit(altro.id)).toHaveLength(0)
    })

    it('dal repository con una copia dell altra azienda nel contesto sbagliato: FirNonTrovatoError', async () => {
      const altro = await bozzaSalvata({ tenant: altroTenantId, user: altroUserId })
      const copia = (await nelTenant(() => repo.findById(altro.id), altroTenantId))!
      copia.modificaBozza({
        produttoreId: P1,
        trasportatoreId: T1,
        destinatarioId: D1,
        produttore: snapP,
        trasportatore: snapT,
        destinatario: snapD,
        rifiuto: { cerCode: '15 01 01', quantita: 5, unitaMisura: UnitaMisura.KG },
        trasportatoriAggiuntivi: [],
        provenienza: ProvenienzaRifiuto.SPECIALE,
        tipoTrattaPrincipale: TipoTratta.TERRESTRE,
      })

      await expect(
        nelTenant(() =>
          repo.salvaModificaBozza(copia, copia.versione, {
            userId,
            campiModificati: ['quantita'],
            partiRisnapshottate: [],
          })
        )
      ).rejects.toBeInstanceOf(FirNonTrovatoError)

      expect(Number((await riga(altro.id)).quantity)).toBe(100)
      expect(await audit(altro.id)).toHaveLength(0)
    })
  })
})
