/**
 * I lettori contano solo le annotazioni vigenti (Fase 2 pezzo 3, Task 2a, R3) contro un Postgres
 * reale, COME `wasteflow_app` dentro il `TenantContext`. Le catene di correzione si costruiscono
 * con insert diretti del proprietario (`wasteflow`): il caso d'uso di correzione arriva piu'
 * avanti. Modello: `registro-per-sede.postgres.spec.ts`.
 */
import { randomUUID } from 'crypto'
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

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { FirGiaRegistratoError } from '../../core/domain/errors'
import { giacenzaDisponibileAl, saldiRegistroCer } from './giacenza-disponibile'
import { GiacenzeService } from '../giacenze/giacenze.service'
import { AnomalyDetectionService } from '../anomaly/anomaly-detection.service'
import { MudAggregazioneService } from '../mud/aggregazione/mud-aggregazione.service'
import { GiacenzeInizialiService } from './giacenze-iniziali.service'
import { RegistriService } from './registri.service'
import { RegistraMovimentoUseCase } from './use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from './commands/registra-movimento.command'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('I lettori contano solo le vigenti — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 04'
  const CER_CIFRE = '999904'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let giacenze: GiacenzeService
  let anomalie: AnomalyDetectionService
  let mud: MudAggregazioneService
  let giacenzeIniziali: GiacenzeInizialiService
  let useCase: RegistraMovimentoUseCase
  const tenantCreati: string[] = []
  let cerCreato = false
  let n = 0
  let progressivo = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `LV${suffisso}`, ragioneSociale: 'Lettori vigenti SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001LV${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }
  type Az = { tenantId: string; registroId: string }
  type Ann = 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'

  /** Annotazione scritta dal proprietario; per le correzioni passare predecessore e radice. */
  function inserisci(
    az: Az,
    o: {
      tipo?: Ann
      rettificato?: string
      originale?: string
      type?: 'CARICO' | 'SCARICO'
      causale?: string
      quantita?: number
      data?: string
      firId?: string
      unit?: string
    } = {}
  ) {
    const tipo = o.tipo ?? 'ORDINARIA'
    const corr = tipo !== 'ORDINARIA'
    const type = o.type ?? 'CARICO'
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        type,
        movementDate: new Date(o.data ?? '2026-03-01T10:00:00Z'),
        registrationDate: new Date(o.data ?? '2026-03-01T10:00:00Z'),
        causale: o.causale ?? (type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'ALTRO_SCARICO'),
        cerCode: CER,
        quantity: o.quantita ?? 100,
        unit: o.unit ?? 'KG',
        firId: o.firId,
        tipoAnnotazione: tipo,
        movimentoRettificatoId: corr ? o.rettificato : null,
        movimentoOriginaleId: corr ? o.originale : null,
        motivoAnnotazione: corr ? 'correzione di prova' : null,
      },
    })
  }

  async function rettifica(az: Az, da: { id: string }, radice: { id: string }, quantita: number) {
    const base = await owner.wasteMovement.findUniqueOrThrow({ where: { id: da.id } })
    return inserisci(az, {
      tipo: 'RETTIFICA',
      rettificato: da.id,
      originale: radice.id,
      type: base.type as 'CARICO' | 'SCARICO',
      causale: base.causale,
      quantita,
      firId: base.firId ?? undefined,
    })
  }
  async function annulla(az: Az, da: { id: string }, radice: { id: string }) {
    const base = await owner.wasteMovement.findUniqueOrThrow({ where: { id: da.id } })
    return inserisci(az, {
      tipo: 'ANNULLAMENTO',
      rettificato: da.id,
      originale: radice.id,
      type: base.type as 'CARICO' | 'SCARICO',
      causale: base.causale,
      quantita: Number(base.quantity),
      firId: base.firId ?? undefined,
    })
  }

  const disp = (az: Az, alla = new Date('2026-12-31T12:00:00Z')) =>
    nelTenant(az.tenantId, () =>
      app.$transaction(tx =>
        giacenzaDisponibileAl(tx, {
          tenantId: az.tenantId,
          registroId: az.registroId,
          cerCode: CER,
          alla,
        })
      )
    )

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    giacenze = new GiacenzeService(app, loggerStub as never)
    anomalie = new AnomalyDetectionService(app, loggerStub as never)
    mud = new MudAggregazioneService(app, {} as never, loggerStub as never)
    giacenzeIniziali = new GiacenzeInizialiService(app, registri)
    useCase = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    // Le catene si cancellano in un solo statement (le chiavi esterne sono NO ACTION).
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  describe('giacenzaDisponibileAl', () => {
    it('un carico annullato non copre piu uno scarico', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      expect((await disp(az)).saldoComplessivoKg).toBe(100)
      await annulla(az, c, c)
      const g = await disp(az)
      expect(g.saldoComplessivoKg).toBe(0)
      expect(g.disponibileAllaDataKg).toBe(0)
    })

    it('un carico rettificato da 100 a 40 copre 40', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      await rettifica(az, c, c, 40)
      expect((await disp(az)).saldoComplessivoKg).toBe(40)
    })

    it('rettifica su rettifica: conta solo la testa; scarico rettificato libera la giacenza', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      const r1 = await rettifica(az, c, c, 60)
      await rettifica(az, r1, c, 70)
      const s = await inserisci(az, { type: 'SCARICO', quantita: 50, data: '2026-03-05T10:00:00Z' })
      expect((await disp(az)).saldoComplessivoKg).toBe(20)
      await rettifica(az, s, s, 10)
      expect((await disp(az)).saldoComplessivoKg).toBe(60)
    })

    it('un carico in unita non di massa annullato non compare fra le unita caricate', async () => {
      const az = await azienda()
      const l = await inserisci(az, { quantita: 5, unit: 'LITRI' })
      expect((await disp(az)).unitaNonDiMassaCaricate).toEqual(['LITRI'])
      await annulla(az, l, l)
      expect((await disp(az)).unitaNonDiMassaCaricate).toEqual([])
    })
  })

  describe('saldiRegistroCer (controllo di giacenza delle correzioni, R6)', () => {
    const saldi = (az: Az, cerCode = CER) =>
      nelTenant(az.tenantId, () =>
        app.$transaction(tx =>
          saldiRegistroCer(tx, { tenantId: az.tenantId, registroId: az.registroId, cerCode })
        )
      )
    const apertura = (az: Az, quantita: number, unita = 'KG', data = '2026-02-01') =>
      owner.giacenzaIniziale.create({
        data: {
          tenantId: az.tenantId,
          registroId: az.registroId,
          cerCode: CER,
          quantita,
          unita,
          dataRiferimento: new Date(`${data}T00:00:00Z`),
          impostatoDa: randomUUID(),
        },
      })

    it('senza movimenti: zero, zero, nessuna unita', async () => {
      const az = await azienda()
      expect(await saldi(az)).toEqual({
        saldoComplessivoKg: 0,
        saldoMinimoGiornalieroKg: 0,
        unitaNonDiMassaCaricate: [],
      })
    })

    it('conta le sole vigenti piu le aperture: rettifica al posto dell originale, scarico', async () => {
      const az = await azienda()
      await apertura(az, 200)
      const c = await inserisci(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await rettifica(az, c, c, 40)
      await inserisci(az, { type: 'SCARICO', quantita: 50, data: '2026-03-05T10:00:00Z' })
      // 200 (apertura) + 40 (rettifica, non i 100 originali) - 50
      expect(await saldi(az)).toMatchObject({
        saldoComplessivoKg: 190,
        saldoMinimoGiornalieroKg: 190,
      })
    })

    it('una catena annullata e esclusa, anche con piu anelli', async () => {
      const az = await azienda()
      await apertura(az, 20)
      const c = await inserisci(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      const r1 = await rettifica(az, c, c, 70)
      await annulla(az, r1, c)
      expect(await saldi(az)).toMatchObject({
        saldoComplessivoKg: 20,
        saldoMinimoGiornalieroKg: 20,
      })
    })

    it('storico negativo: complessivo e minimo giornaliero restano distinti', async () => {
      const az = await azienda()
      await inserisci(az, { type: 'SCARICO', quantita: 30, data: '2026-03-01T10:00:00Z' })
      await inserisci(az, { quantita: 10, data: '2026-03-02T10:00:00Z' })
      expect(await saldi(az)).toMatchObject({
        saldoComplessivoKg: -20,
        saldoMinimoGiornalieroKg: -30,
      })
    })

    it('spostare un carico dopo lo scarico abbassa il minimo ma non il complessivo', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await inserisci(az, { type: 'SCARICO', quantita: 60, data: '2026-03-05T10:00:00Z' })
      const prima = await saldi(az)
      const base = await owner.wasteMovement.findUniqueOrThrow({ where: { id: c.id } })
      await inserisci(az, {
        tipo: 'RETTIFICA',
        rettificato: c.id,
        originale: c.id,
        type: 'CARICO',
        causale: base.causale,
        quantita: 100,
        data: '2026-03-10T10:00:00Z',
      })
      const dopo = await saldi(az)
      expect(prima).toMatchObject({ saldoComplessivoKg: 40, saldoMinimoGiornalieroKg: 40 })
      expect(dopo).toMatchObject({ saldoComplessivoKg: 40, saldoMinimoGiornalieroKg: -60 })
    })

    it('le unita non di massa: vigenti e aperture, non le annullate', async () => {
      const az = await azienda()
      const l = await inserisci(az, { quantita: 5, unit: 'LITRI' })
      await apertura(az, 3, 'MC')
      expect((await saldi(az)).unitaNonDiMassaCaricate).toEqual(['LITRI', 'MC'])
      await annulla(az, l, l)
      expect((await saldi(az)).unitaNonDiMassaCaricate).toEqual(['MC'])
    })

    it('stessi numeri di giacenzaDisponibileAl sullo stesso registro', async () => {
      const az = await azienda()
      await apertura(az, 15, 'T')
      const c = await inserisci(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await rettifica(az, c, c, 80)
      await inserisci(az, { type: 'SCARICO', quantita: 500, data: '2026-03-05T10:00:00Z' })
      const s = await saldi(az)
      const g = await disp(az)
      expect(s.saldoComplessivoKg).toBe(g.saldoComplessivoKg)
      expect(s.unitaNonDiMassaCaricate).toEqual(g.unitaNonDiMassaCaricate)
    })

    it('un altro registro o un altro CER non entrano nei saldi', async () => {
      const az = await azienda()
      await inserisci(az, { quantita: 100 })
      const altroCer = await saldi(az, '99 99 05')
      expect(altroCer.saldoComplessivoKg).toBe(0)
      const altra = await azienda()
      expect((await saldi(altra)).saldoComplessivoKg).toBe(0)
    })
  })

  describe('GiacenzeService', () => {
    it('conta carichi e scarichi vigenti e la data del carico piu vecchio', async () => {
      const az = await azienda()
      const vecchio = await inserisci(az, { quantita: 10, data: '2026-01-10T10:00:00Z' })
      await annulla(az, vecchio, vecchio)
      const c = await inserisci(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await rettifica(az, c, c, 80)
      const s = await inserisci(az, { type: 'SCARICO', quantita: 30, data: '2026-03-05T10:00:00Z' })
      await annulla(az, s, s)
      const righe = await nelTenant(az.tenantId, () =>
        giacenze.getGiacenze(az.tenantId, az.registroId)
      )
      expect(righe).toHaveLength(1)
      expect(righe[0]).toMatchObject({ caricoKg: 80, scaricoKg: 0, giacenzaKg: 80 })
      expect(righe[0].oldestCaricoDate?.toISOString()).toBe('2026-03-01T10:00:00.000Z')
    })
  })

  describe('AnomalyDetectionService', () => {
    const stock = async (az: Az) =>
      (await nelTenant(az.tenantId, () => anomalie.detectAnomalies(az.tenantId))).filter(
        a => a.type === 'NEGATIVE_STOCK'
      )

    it('una catena annullata non conta: lo scarico resta senza carico', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      await inserisci(az, { type: 'SCARICO', quantita: 50, data: '2026-03-05T10:00:00Z' })
      expect(await stock(az)).toHaveLength(0)
      await annulla(az, c, c)
      expect(await stock(az)).toHaveLength(1)
    })

    it('un carico rettificato al ribasso puo rendere il saldo negativo', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      await inserisci(az, { type: 'SCARICO', quantita: 50, data: '2026-03-05T10:00:00Z' })
      await rettifica(az, c, c, 40)
      expect(await stock(az)).toHaveLength(1)
    })
  })

  describe('MudAggregazioneService', () => {
    const riga = async (az: Az) => {
      const agg = await nelTenant(az.tenantId, () => mud.aggrega(az.tenantId, 2026))
      return { agg, riga: agg.righe.find(r => r.cerCode.replace(/\D/g, '') === CER_CIFRE) }
    }

    it('un movimento rettificato conta con i dati nuovi', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      expect((await riga(az)).riga?.prodottoKg).toBe(100)
      await rettifica(az, c, c, 40)
      const { agg, riga: r } = await riga(az)
      expect(r?.prodottoKg).toBe(40)
      expect(agg.movimentiPerCer[CER_CIFRE]).toBe(1)
    })

    it('un movimento annullato non conta', async () => {
      const az = await azienda()
      const c = await inserisci(az, { quantita: 100 })
      await annulla(az, c, c)
      const { riga: r } = await riga(az)
      expect(r).toBeUndefined()
    })

    describe('doppio FIR', () => {
      async function conFir(az: Az) {
        const user = await owner.user.create({
          data: {
            tenantId: az.tenantId,
            keycloakId: `keycloak-lv-${Date.now()}-${++n}`,
            fiscalCode: 'RSSMRA80A01H501U',
            firstName: 'Mario',
            lastName: 'Rossi',
            email: `lv-${Date.now()}-${n}@example.com`,
            role: 'OPERATOR',
          },
        })
        const repo = new FIRPrismaRepository(
          Object.assign(owner, { db: owner }) as never,
          owner as never
        )
        const fir = FIR.create({
          produttoreId: '11111111-1111-4111-8111-111111111111',
          rifiuto: { cerCode: CER_CIFRE, quantita: 100 },
          trasportatoreId: '22222222-2222-4222-8222-222222222222',
          destinatarioId: '33333333-3333-4333-8333-333333333333',
          tenantId: az.tenantId,
          creatoDaUserId: user.id,
        })
        await repo.save(fir)
        await owner.fIR.update({ where: { id: fir.id }, data: { status: 'AWAITING_CARRIER' } })
        return fir.id
      }

      it('un doppio annullato non produce piu il controllo del doppio', async () => {
        const az = await azienda()
        const firId = await conFir(az)
        const scarico = () =>
          inserisci(az, {
            type: 'SCARICO',
            causale: 'CONFERIMENTO_TRASPORTATORE',
            quantita: 100,
            firId,
          })
        const primo = await scarico()
        const secondo = await scarico()
        await inserisci(az, { quantita: 500, data: '2026-02-01T10:00:00Z' })
        const prima = await nelTenant(az.tenantId, () => mud.aggrega(az.tenantId, 2026))
        expect(prima.controlli.some(c => c.codice === 'FIR_DOPPIO_IDENTICO')).toBe(true)

        await annulla(az, secondo, secondo)
        const dopo = await nelTenant(az.tenantId, () => mud.aggrega(az.tenantId, 2026))
        expect(dopo.controlli.some(c => c.codice === 'FIR_DOPPIO_IDENTICO')).toBe(false)
        expect(primo.id).toBeDefined()
      })
    })
  })

  describe('GiacenzeInizialiService (avviso G8)', () => {
    it("l'avviso sugli 'Altro carico' ignora le catene annullate", async () => {
      const az = await azienda()
      const utente = await owner.user.create({
        data: {
          tenantId: az.tenantId,
          keycloakId: `keycloak-g8-${Date.now()}-${++n}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `g8-${Date.now()}-${n}@example.com`,
          role: 'ADMIN',
        },
      })
      const altro = await inserisci(az, { causale: 'ALTRO_CARICO', quantita: 10 })
      const crea = () =>
        nelTenant(az.tenantId, () =>
          giacenzeIniziali.crea(az.tenantId, utente.id, {
            cerCode: CER,
            quantita: 1,
            unita: 'KG',
            statoFisico: 'SOLIDO_NON_POLVERULENTO',
            dataRiferimento: '2026-01-01',
          } as never)
        )
      const con = (await crea()) as { avvisi?: string[] }
      expect(con.avvisi?.length ?? 0).toBeGreaterThan(0)

      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: az.tenantId } })
      await annulla(az, altro, altro)
      const senza = (await crea()) as { avvisi?: string[] }
      expect(senza.avvisi?.length ?? 0).toBe(0)
    })
  })

  describe('ricopia del FIR', () => {
    let az: Az
    let firId: string

    function cmd(quantita: number): RegistraMovimentoCommand {
      return new RegistraMovimentoCommand(
        az.tenantId,
        undefined as unknown as string,
        'CARICO',
        new Date('2026-03-01'),
        new Date('2026-03-01'),
        'INGRESSO_ESTERNO',
        CER,
        undefined,
        quantita,
        'KG',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        firId,
        undefined,
        undefined
      )
    }

    // Ogni test parte da un'azienda e da un FIR propri: nessuno dipende dallo stato del precedente.
    beforeEach(async () => {
      az = await azienda()
      const user = await owner.user.create({
        data: {
          tenantId: az.tenantId,
          keycloakId: `keycloak-ric-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `ric-${Date.now()}@example.com`,
          role: 'OPERATOR',
        },
      })
      const repo = new FIRPrismaRepository(
        Object.assign(owner, { db: owner }) as never,
        owner as never
      )
      const fir = FIR.create({
        produttoreId: '11111111-1111-4111-8111-111111111111',
        rifiuto: { cerCode: CER_CIFRE, quantita: 100 },
        trasportatoreId: '22222222-2222-4222-8222-222222222222',
        destinatarioId: '33333333-3333-4333-8333-333333333333',
        tenantId: az.tenantId,
        creatoDaUserId: user.id,
      })
      await repo.save(fir)
      firId = fir.id
      await owner.fIR.update({ where: { id: firId }, data: { status: 'AWAITING_CARRIER' } })
    })

    it('un retry dopo rettifica e annullamento restituisce l originale, non le correzioni', async () => {
      const primo = await nelTenant(az.tenantId, () => useCase.execute(cmd(100)))
      expect(primo.isSuccess).toBe(true)
      const orig = { id: primo.value.id }
      const r1 = await rettifica(az, orig, orig, 60)
      const retryRettificato = await nelTenant(az.tenantId, () => useCase.execute(cmd(100)))
      expect(retryRettificato.value).toMatchObject({ id: orig.id, giaRegistrato: true })

      await annulla(az, r1, orig)
      const retryAnnullato = await nelTenant(az.tenantId, () => useCase.execute(cmd(100)))
      expect(retryAnnullato.value).toMatchObject({ id: orig.id, giaRegistrato: true })
    })

    it('con dati diversi il messaggio cita l originale e dice che non e piu vigente', async () => {
      const primo = await nelTenant(az.tenantId, () => useCase.execute(cmd(100)))
      expect(primo.isSuccess).toBe(true)
      const originale = await owner.wasteMovement.findFirstOrThrow({
        where: { tenantId: az.tenantId, firId, tipoAnnotazione: 'ORDINARIA' },
      })
      await annulla(az, originale, originale)
      const r = await nelTenant(az.tenantId, () => useCase.execute(cmd(90)))
      expect(r.error).toBe(
        new FirGiaRegistratoError(
          originale.progressiveNumber,
          originale.progressiveYear,
          undefined,
          'annullato'
        ).message
      )
      expect(r.error).toContain('poi annullato')
    })
  })
})
