/**
 * Rettifica e annullamento (Fase 2 pezzo 3, Task 3) contro un Postgres reale, COME `wasteflow_app`
 * dentro il `TenantContext`. Il proprietario (`wasteflow`) prepara aziende e storico con insert
 * diretti e legge cio' che e' stato scritto. Modello: `registro-per-sede.postgres.spec.ts`.
 */
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

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { FIRPrismaRepository } from '../../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import * as numerazione from '../numerazione-annotazione'
import { INDICAZIONE_FIR_ANNULLATO } from '../../../core/domain/errors'
import { RegistriService } from '../registri.service'
import { VerificaCatenaRegistroService } from '../verifica-catena-registro.service'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { CorreggiMovimentoUseCase, DatiRettifica } from './correggi-movimento.use-case'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('CorreggiMovimentoUseCase - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 07'
  const CER_B = '99 99 08'
  const ANNO = annoSolareItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let app2: PrismaService
  let registri: RegistriService
  let correggi: CorreggiMovimentoUseCase
  let registra: RegistraMovimentoUseCase
  let verifica: VerificaCatenaRegistroService
  let userId: string
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  type Az = { tenantId: string; registroId: string }

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `CG${suffisso}`, ragioneSociale: 'Correzioni SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001CG${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }

  /** Registrazione ordinaria scritta dal proprietario (hash vuoto: storico). */
  function ordinaria(
    az: Az,
    o: {
      type?: 'CARICO' | 'SCARICO'
      quantita?: number
      data?: string
      anno?: number
      cer?: string
      unit?: string
      firId?: string
      numero?: number
    } = {}
  ) {
    const type = o.type ?? 'CARICO'
    const data = new Date(o.data ?? '2026-03-01T10:00:00Z')
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: o.anno ?? ANNO,
        progressiveNumber: o.numero ?? ++progressivo,
        type,
        movementDate: data,
        registrationDate: data,
        causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'ALTRO_SCARICO',
        cerCode: o.cer ?? CER,
        quantity: o.quantita ?? 100,
        unit: o.unit ?? 'KG',
        firId: o.firId,
      },
    })
  }

  const dati = (o: Partial<DatiRettifica> = {}): DatiRettifica => ({
    movementDate: new Date('2026-03-01T00:00:00Z'),
    causale: 'PRODUZIONE_INTERNA',
    cerCode: CER,
    quantity: 100,
    unit: 'KG',
    ...o,
  })

  const rettifica = (
    az: Az,
    id: string,
    d: Partial<DatiRettifica> = {},
    extra: { conferma?: boolean; motivo?: string; uc?: CorreggiMovimentoUseCase } = {}
  ) =>
    nelTenant(az.tenantId, () =>
      (extra.uc ?? correggi).rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: extra.motivo ?? 'errore di battitura',
        confermaAnnoPresentato: extra.conferma,
        dati: dati(d),
      })
    )

  const annulla = (
    az: Az,
    id: string,
    extra: { conferma?: boolean; uc?: CorreggiMovimentoUseCase; tenantId?: string } = {}
  ) =>
    nelTenant(extra.tenantId ?? az.tenantId, () =>
      (extra.uc ?? correggi).annulla({
        tenantId: extra.tenantId ?? az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'inserito per errore',
        confermaAnnoPresentato: extra.conferma,
      })
    )

  const righe = (az: Az) => owner.wasteMovement.count({ where: { tenantId: az.tenantId } })

  async function eccezione(p: Promise<unknown>) {
    try {
      await p
    } catch (e) {
      return e as Error
    }
    throw new Error('attesa un eccezione')
  }

  function comando(az: Az, o: { type: 'CARICO' | 'SCARICO'; qty: number; firId?: string }) {
    const adesso = new Date()
    return new RegistraMovimentoCommand(
      az.tenantId,
      undefined as unknown as string,
      o.type,
      adesso,
      adesso,
      o.type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'CONFERIMENTO_TRASPORTATORE',
      CER,
      undefined,
      o.qty,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      o.firId,
      undefined,
      az.registroId
    )
  }

  const registraOrdinaria = (
    az: Az,
    o: { type: 'CARICO' | 'SCARICO'; qty: number; firId?: string }
  ) => nelTenant(az.tenantId, () => registra.execute(comando(az, o)))

  async function firEmesso(tenantId: string): Promise<string> {
    const repo = new FIRPrismaRepository(
      Object.assign(owner, { db: owner }) as never,
      owner as never
    )
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '999907', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
    })
    await repo.save(fir)
    await owner.fIR.update({ where: { id: fir.id }, data: { status: 'AWAITING_CARRIER' } })
    return fir.id
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    app2 = creaPrismaServiceApplicativo()
    await app2.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    verifica = new VerificaCatenaRegistroService(app)
    for (const code of [CER, CER_B]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
    const tenantUtente = await azienda()
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenantUtente.tenantId,
          keycloakId: `keycloak-correggi-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `correggi-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    // Le catene si cancellano in un solo statement (le chiavi esterne sono NO ACTION).
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.mUDReport.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroProgressivoIniziale.deleteMany({
      where: { tenantId: { in: tenantCreati } },
    })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    // senza id deleteMany non avrebbe filtro e cancellerebbe tutti gli utenti
    if (userId) await owner.user.deleteMany({ where: { id: userId } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreati.length) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await app2.onModuleDestroy()
    await owner.$disconnect()
  })

  describe('rettifica e annullamento di CARICO e SCARICO', () => {
    it('rettifica di un CARICO: nuova annotazione col numero successivo, collegata e con la radice', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100 })
      const { movimento, avvisi } = await rettifica(az, c.id, { quantity: 80 })
      expect(avvisi).toEqual([])
      expect(movimento.tipoAnnotazione).toBe('RETTIFICA')
      expect(movimento.progressiveYear).toBe(ANNO)
      expect(movimento.progressiveNumber).toBe(c.progressiveNumber + 1)
      expect(movimento.movimentoRettificatoId).toBe(c.id)
      expect(movimento.movimentoOriginaleId).toBe(c.id)
      expect(movimento.fuoriTermine).toBe(false)
      expect(movimento.ritardoGg).toBe(0)
      const riga = await owner.wasteMovement.findUniqueOrThrow({ where: { id: movimento.id } })
      expect(Number(riga.quantity)).toBe(80)
      expect(riga.hashVersione).toBe(2)
      expect(riga.firIdRicopia).toBeNull()
      expect(riga.ricopiaChiave).toBe('')
      expect(riga.motivoAnnotazione).toBe('errore di battitura')
      // La riga originale non e' stata toccata (R13).
      const originale = await owner.wasteMovement.findUniqueOrThrow({ where: { id: c.id } })
      expect(Number(originale.quantity)).toBe(100)
    })

    it('annullamento di un CARICO: copia alla lettera e toglie la catena dai conteggi', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100 })
      const { movimento } = await annulla(az, c.id)
      expect(movimento.tipoAnnotazione).toBe('ANNULLAMENTO')
      expect(movimento.quantity).toBe(100)
      expect(movimento.causale).toBe('PRODUZIONE_INTERNA')
      expect(movimento.motivoAnnotazione).toBe('inserito per errore')
    })

    it('rettifica e annullamento di uno SCARICO', async () => {
      const az = await azienda()
      await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      const s = await ordinaria(az, { type: 'SCARICO', quantita: 60, data: '2026-03-05T10:00:00Z' })
      const r = await rettifica(az, s.id, {
        causale: 'ALTRO_SCARICO',
        quantity: 30,
        movementDate: new Date('2026-03-05T00:00:00Z'),
      })
      expect(r.movimento.type).toBe('SCARICO')
      expect(r.avvisi).toEqual([])
      const a = await annulla(az, r.movimento.id)
      expect(a.movimento.movimentoOriginaleId).toBe(s.id)
      expect(a.movimento.movimentoRettificatoId).toBe(r.movimento.id)
    })

    it("registra l'audit nella stessa transazione", async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const r = await annulla(az, c.id)
      const log = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: az.tenantId, action: 'REGISTRO_MOVIMENTO_ANNULLATO' },
      })
      expect(log.metadata).toMatchObject({
        predecessoreId: c.id,
        radiceId: c.id,
        radiceNumero: `${c.progressiveNumber}/${c.progressiveYear}`,
        correzioneId: r.movimento.id,
        motivo: 'inserito per errore',
      })
    })
  })

  describe('controllo di giacenza (R6)', () => {
    it('un carico interamente scaricato non si annulla: 409 e nessuna riga nuova', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await ordinaria(az, { type: 'SCARICO', quantita: 100, data: '2026-03-05T10:00:00Z' })
      const prima = await righe(az)
      const e = await eccezione(annulla(az, c.id))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.message).toContain('giacenza negativa')
      expect(await righe(az)).toBe(prima)
    })

    it('una rettifica sotto lo scaricato e respinta, entro lo scaricato e accettata', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await ordinaria(az, { type: 'SCARICO', quantita: 70, data: '2026-03-05T10:00:00Z' })
      expect(await eccezione(rettifica(az, c.id, { quantity: 50 }))).toBeInstanceOf(
        ConflictException
      )
      const ok = await rettifica(az, c.id, { quantity: 70 })
      expect(ok.avvisi).toEqual([])
    })

    it('data del carico spostata dopo lo scarico: registrata con un avviso', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await ordinaria(az, { type: 'SCARICO', quantita: 70, data: '2026-03-05T10:00:00Z' })
      const r = await rettifica(az, c.id, { movementDate: new Date('2026-03-10T00:00:00Z') })
      expect(r.avvisi.length).toBe(1)
      expect(r.avvisi[0]).toContain('sotto zero')
    })

    it('carico kg rettificato in litri con altri carichi in litri: avviso invece del blocco', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await ordinaria(az, { quantita: 5, unit: 'LITRI', data: '2026-03-02T10:00:00Z' })
      await ordinaria(az, { type: 'SCARICO', quantita: 80, data: '2026-03-05T10:00:00Z' })
      const r = await rettifica(az, c.id, { unit: 'LITRI' })
      expect(r.avvisi.join(' ')).toContain('LITRI')
      expect(r.avvisi.join(' ')).toContain('verificata a mano')
    })

    it('CER cambiato: controlla il vecchio (carico scaricato) e il nuovo (scarico senza carichi)', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { quantita: 100, data: '2026-03-01T10:00:00Z' })
      await ordinaria(az, { type: 'SCARICO', quantita: 80, data: '2026-03-05T10:00:00Z' })
      // il vecchio CER resterebbe scoperto
      expect(await eccezione(rettifica(az, c.id, { cerCode: CER_B }))).toBeInstanceOf(
        ConflictException
      )
      // il nuovo CER non ha carichi: lo scarico spostato lo porterebbe sotto zero
      const s2 = await ordinaria(az, { type: 'SCARICO', quantita: 5, data: '2026-03-06T10:00:00Z' })
      const e = await eccezione(
        rettifica(az, s2.id, { cerCode: CER_B, causale: 'ALTRO_SCARICO', quantity: 5 })
      )
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.message).toContain('99 99 08')
    })
  })

  describe('vigenza e invarianti della catena', () => {
    it('correggere una annotazione non vigente: 409', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      await rettifica(az, c.id, { quantity: 90 })
      expect(await eccezione(rettifica(az, c.id, { quantity: 80 }))).toBeInstanceOf(
        ConflictException
      )
      expect(await eccezione(annulla(az, c.id))).toBeInstanceOf(ConflictException)
    })

    it('due annullamenti concorrenti su due client applicativi: uno solo riesce', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const uc2 = new CorreggiMovimentoUseCase(app2, loggerStub as never)
      const esiti = await Promise.allSettled([annulla(az, c.id), annulla(az, c.id, { uc: uc2 })])
      expect(esiti.filter(e => e.status === 'fulfilled').length).toBe(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason).toBeInstanceOf(ConflictException)
      expect(await owner.wasteMovement.count({ where: { movimentoRettificatoId: c.id } })).toBe(1)
    })

    it('movimento_originale_id e la radice anche al secondo anello', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const r1 = await rettifica(az, c.id, { quantity: 90 })
      const r2 = await rettifica(az, r1.movimento.id, { quantity: 80 })
      expect(r2.movimento.movimentoRettificatoId).toBe(r1.movimento.id)
      expect(r2.movimento.movimentoOriginaleId).toBe(c.id)
      const a = await annulla(az, r2.movimento.id)
      expect(a.movimento.movimentoOriginaleId).toBe(c.id)
      const radice = await owner.wasteMovement.findUniqueOrThrow({
        where: { id: a.movimento.movimentoOriginaleId! },
      })
      expect(radice.tipoAnnotazione).toBe('ORDINARIA')
    })

    it('una catena con la radice non ordinaria e un errore interno, senza scrivere', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const r1 = await rettifica(az, c.id, { quantity: 90 })
      // Il database non lo impedisce: un anello che indica come radice una rettifica.
      const guasta = await owner.wasteMovement.create({
        data: {
          tenantId: az.tenantId,
          registroId: az.registroId,
          progressiveYear: ANNO,
          progressiveNumber: ++progressivo + 1000,
          type: 'CARICO',
          movementDate: new Date('2026-03-01T10:00:00Z'),
          registrationDate: new Date('2026-03-01T10:00:00Z'),
          causale: 'PRODUZIONE_INTERNA',
          cerCode: CER,
          quantity: 50,
          unit: 'KG',
          tipoAnnotazione: 'RETTIFICA',
          movimentoRettificatoId: r1.movimento.id,
          movimentoOriginaleId: r1.movimento.id,
          motivoAnnotazione: 'guasta',
        },
      })
      const prima = await righe(az)
      const e = await eccezione(annulla(az, guasta.id))
      expect(e.message).toContain('non è coerente')
      expect(await righe(az)).toBe(prima)
    })

    it("isolamento fra aziende: l'id di un'altra azienda e un 404", async () => {
      const a = await azienda()
      const b = await azienda()
      const c = await ordinaria(a)
      expect(await eccezione(annulla(b, c.id))).toBeInstanceOf(NotFoundException)
      expect(await eccezione(rettifica(b, c.id))).toBeInstanceOf(NotFoundException)
      expect(await eccezione(annulla(a, '00000000-0000-4000-8000-000000000000'))).toBeInstanceOf(
        NotFoundException
      )
    })

    it('dati non validi: CER inesistente, causale incoerente, motivo vuoto, quantita zero', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      expect(await eccezione(rettifica(az, c.id, { cerCode: '11 11 11' }))).toBeInstanceOf(
        BadRequestException
      )
      expect(await eccezione(rettifica(az, c.id, { causale: 'CESSIONE' }))).toBeInstanceOf(
        BadRequestException
      )
      expect(await eccezione(rettifica(az, c.id, {}, { motivo: '   ' }))).toBeInstanceOf(
        BadRequestException
      )
      expect(await eccezione(rettifica(az, c.id, { quantity: 0 }))).toBeInstanceOf(
        BadRequestException
      )
      expect(await righe(az)).toBe(1)
    })

    it('annullare una riga storica con CER non normalizzato e fuori catalogo riesce', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { cer: '111111', quantita: 10 })
      const { movimento } = await annulla(az, c.id)
      expect(movimento.cerCode).toBe('111111')
      expect(movimento.tipoAnnotazione).toBe('ANNULLAMENTO')
    })
  })

  describe('correzioni dopo la revisione', () => {
    it('P2002 vero: una correzione concorrente inserita senza lock da 409, non errore interno', async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const reale = numerazione.numeraAnnotazione
      const spia = jest
        .spyOn(numerazione, 'numeraAnnotazione')
        .mockImplementation(async (tx, a, b) => {
          // il rivale entra dopo il controllo di vigenza e senza prendere alcun lock
          await owner.wasteMovement.create({
            data: {
              tenantId: az.tenantId,
              registroId: az.registroId,
              progressiveYear: ANNO,
              progressiveNumber: 900,
              type: 'CARICO',
              movementDate: c.movementDate,
              registrationDate: c.movementDate,
              causale: 'PRODUZIONE_INTERNA',
              cerCode: CER,
              quantity: 100,
              unit: 'KG',
              tipoAnnotazione: 'RETTIFICA',
              movimentoRettificatoId: c.id,
              movimentoOriginaleId: c.id,
              motivoAnnotazione: 'rivale',
            },
          })
          return reale(tx, a, b)
        })
      try {
        const e = await eccezione(annulla(az, c.id))
        expect(e).toBeInstanceOf(ConflictException)
        expect(e.message).toContain('già stato rettificato o annullato')
      } finally {
        spia.mockRestore()
      }
    })

    it('quantita zero con un MUD presentato: 400, non il 409 della conferma', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { anno: 2025, data: '2025-06-01T10:00:00Z', numero: 7 })
      await owner.mUDReport.create({
        data: { tenantId: az.tenantId, year: 2026, status: 'SUBMITTED', reportData: {} },
      })
      const e = await eccezione(rettifica(az, c.id, { quantity: 0 }))
      expect(e).toBeInstanceOf(BadRequestException)
    })

    it('retry identico della ricopia con catena annullata o rettificata: avviso', async () => {
      const az = await azienda()
      const f1 = await firEmesso(az.tenantId)
      const f2 = await firEmesso(az.tenantId)
      await registraOrdinaria(az, { type: 'CARICO', qty: 200 })
      // stesso comando = stessa data al millisecondo: e' il retry identico
      const c1 = comando(az, { type: 'SCARICO', qty: 40, firId: f1 })
      const c2 = comando(az, { type: 'SCARICO', qty: 30, firId: f2 })
      const esegui = (c: RegistraMovimentoCommand) =>
        nelTenant(az.tenantId, () => registra.execute(c))
      const s1 = (await esegui(c1)).value
      const s2 = (await esegui(c2)).value
      // vigente: nessun avviso
      const vivo = (await esegui(c2)).value
      expect(vivo.giaRegistrato).toBe(true)
      expect(vivo.avvisi).toEqual([])
      // rettificato
      const r = await rettifica(az, s2.id, {
        causale: 'CONFERIMENTO_TRASPORTATORE',
        quantity: 30,
        movementDate: s2.movementDate,
      })
      const retryR = (await esegui(c2)).value
      expect(retryR.id).toBe(s2.id)
      expect(retryR.avvisi.join(' ')).toContain(
        `rettificato con n. ${r.movimento.progressiveNumber}/${r.movimento.progressiveYear}`
      )
      // annullato
      await annulla(az, s1.id)
      const retryA = (await esegui(c1)).value
      expect(retryA.id).toBe(s1.id)
      expect(retryA.avvisi).toEqual([INDICAZIONE_FIR_ANNULLATO])
    })
  })

  describe('MUD gia presentato (R10)', () => {
    async function mud(az: Az, year: number, status: 'SUBMITTED' | 'ARCHIVED' | 'DRAFT') {
      await owner.mUDReport.create({
        data: { tenantId: az.tenantId, year, status, reportData: {} },
      })
    }

    it("MUD SUBMITTED dell'anno dopo: 409 con l'anno, con conferma registrato con avviso", async () => {
      const az = await azienda()
      const c = await ordinaria(az, { anno: 2025, data: '2025-06-01T10:00:00Z', numero: 7 })
      await mud(az, 2026, 'SUBMITTED')
      const e = await eccezione(annulla(az, c.id))
      expect(e).toBeInstanceOf(ConflictException)
      expect((e as ConflictException).getResponse()).toMatchObject({
        error: 'REGISTRO_ANNO_MUD_PRESENTATO',
      })
      expect(e.message).toContain('2026')
      expect(await righe(az)).toBe(1)
      const ok = await annulla(az, c.id, { conferma: true })
      expect(ok.avvisi.join(' ')).toContain('2026')
      expect(ok.avvisi.join(' ')).toContain('già presentato')
    })

    it('un MUD in bozza o di un anno precedente non blocca', async () => {
      const az = await azienda()
      const c = await ordinaria(az, { data: '2026-03-01T10:00:00Z' })
      await mud(az, 2026, 'DRAFT')
      await mud(az, 2024, 'ARCHIVED')
      const ok = await annulla(az, c.id)
      expect(ok.avvisi).toEqual([])
    })

    it("la data nuova in un anno piu vecchio estende il controllo da quell'anno", async () => {
      const az = await azienda()
      const c = await ordinaria(az, { data: '2026-03-01T10:00:00Z' })
      await mud(az, 2025, 'ARCHIVED')
      const e = await eccezione(rettifica(az, c.id, { movementDate: new Date('2025-12-15') }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.message).toContain('2025')
    })
  })

  describe('numerazione e catena hash', () => {
    it("numero: successivo dell'anno corrente anche se l'originale e dell'anno prima", async () => {
      const az = await azienda()
      const vecchio = await ordinaria(az, {
        anno: ANNO - 1,
        data: '2025-06-01T10:00:00Z',
        numero: 41,
      })
      await ordinaria(az, { numero: 3 })
      const { movimento } = await annulla(az, vecchio.id, { conferma: true })
      expect(movimento.progressiveYear).toBe(ANNO)
      expect(movimento.progressiveNumber).toBe(4)
    })

    it("rispetta il progressivo iniziale dell'anno corrente", async () => {
      const az = await azienda()
      const c = await ordinaria(az, { anno: ANNO - 1, data: '2025-06-01T10:00:00Z', numero: 1 })
      await owner.registroProgressivoIniziale.create({
        data: {
          tenantId: az.tenantId,
          registroId: az.registroId,
          anno: ANNO,
          primoProgressivo: 50,
          motivo: 'avvio da altro programma',
          impostatoDa: userId,
        },
      })
      const { movimento } = await annulla(az, c.id, { conferma: true })
      expect(movimento.progressiveNumber).toBe(50)
    })

    it('la catena degli hash resta verificata dopo registrazioni, rettifica e annullamento', async () => {
      const az = await azienda()
      const k = await registraOrdinaria(az, { type: 'CARICO', qty: 100 })
      const s = await registraOrdinaria(az, { type: 'SCARICO', qty: 20 })
      expect(k.isSuccess && s.isSuccess).toBe(true)
      const carico = k.value
      await rettifica(az, carico.id, {
        movementDate: carico.movementDate,
        quantity: 90,
      })
      await annulla(az, s.value.id)
      const esito = await nelTenant(az.tenantId, () =>
        verifica.verifica(az.tenantId, az.registroId, ANNO)
      )
      expect(esito.primoErrore).toBeNull()
      expect(esito.verificate).toBe(4)
      const righeDb = await owner.wasteMovement.findMany({
        where: { tenantId: az.tenantId },
        orderBy: { progressiveNumber: 'asc' },
      })
      expect(righeDb.map(x => x.tipoAnnotazione)).toEqual([
        'ORDINARIA',
        'ORDINARIA',
        'RETTIFICA',
        'ANNULLAMENTO',
      ])
      expect(new Set(righeDb.map(x => x.hashVersione))).toEqual(new Set([2]))
    })
  })

  describe('ricopia del FIR', () => {
    it('annullare una ricopia avvisa che il FIR non si ricopia piu; il retry legge la stessa indicazione', async () => {
      const az = await azienda()
      const firId = await firEmesso(az.tenantId)
      await registraOrdinaria(az, { type: 'CARICO', qty: 100 })
      const s = await registraOrdinaria(az, { type: 'SCARICO', qty: 40, firId })
      expect(s.isSuccess ? 'ok' : s.error).toBe('ok')
      const ricopia = s.value
      const r = await annulla(az, ricopia.id)
      expect(r.avvisi.join(' ')).toContain('Questa registrazione veniva dalla ricopia del FIR')
      expect(r.avvisi.join(' ')).toContain('non si può ricopiare di nuovo')
      expect(r.movimento.firId).toBe(firId)
      const riga = await owner.wasteMovement.findUniqueOrThrow({ where: { id: r.movimento.id } })
      expect(riga.firIdRicopia).toBeNull()
      // Chi riprova la ricopia con dati diversi legge la stessa indicazione.
      const retry = await registraOrdinaria(az, { type: 'SCARICO', qty: 41, firId })
      expect(retry.isSuccess).toBe(false)
      expect(retry.error).toContain('poi annullato')
      expect(retry.error).toContain(INDICAZIONE_FIR_ANNULLATO)
    })

    it('annullare una rettifica di una ricopia avvisa allo stesso modo (radice con firIdRicopia)', async () => {
      const az = await azienda()
      const firId = await firEmesso(az.tenantId)
      await registraOrdinaria(az, { type: 'CARICO', qty: 100 })
      const s = (await registraOrdinaria(az, { type: 'SCARICO', qty: 40, firId })).value
      const r1 = await rettifica(az, s.id, {
        causale: 'CONFERIMENTO_TRASPORTATORE',
        quantity: 30,
        movementDate: s.movementDate,
      })
      const a = await annulla(az, r1.movimento.id)
      expect(a.avvisi.join(' ')).toContain('ricopia del FIR')
    })

    it("un annullamento di un movimento senza ricopia non porta l'avviso del FIR", async () => {
      const az = await azienda()
      const c = await ordinaria(az)
      const { avvisi } = await annulla(az, c.id)
      expect(avvisi).toEqual([])
    })
  })
})
