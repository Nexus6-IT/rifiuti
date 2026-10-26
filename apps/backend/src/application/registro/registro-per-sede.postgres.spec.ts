/**
 * Numerazione, progressivo iniziale e giacenza PER REGISTRO (Fase 2 pezzo 1, Task 3) contro un
 * Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy), dentro il
 * `TenantContext` dell'azienda: un test da superuser non vedrebbe i difetti della RLS.
 *
 * Il proprietario (`wasteflow`, superuser) prepara le aziende, le sedi e i FIR e legge cio' che e'
 * stato scritto; la pulizia toglie solo le righe create qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { ConflictException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { FirGiaRegistratoInAltroRegistroError } from '../../core/domain/errors'
import { RegistraMovimentoUseCase } from './use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from './commands/registra-movimento.command'
import { ProgressivoInizialeService } from './progressivo-iniziale.service'
import { RegistriService, RegistroNonCoerenteConFirError } from './registri.service'
import { annoSolareItaliano } from '../../core/time/anno-italiano'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { BadRequestException } from '@nestjs/common'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Registro per sede — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 03'
  const ANNO = annoSolareItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let useCase: RegistraMovimentoUseCase
  let progressivi: ProgressivoInizialeService
  let userId: string
  let cerCreato = false
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  /** Azienda con le sedi indicate (la prima e' la principale se `principale` e' vero). */
  async function azienda(sedi: string[], principale = true) {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `RP${suffisso}`, ragioneSociale: 'Registro per sede SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const righe = []
    for (const [i, nome] of sedi.entries()) {
      righe.push(
        await owner.rentriUnitaLocale.create({
          data: {
            tenantId: t.id,
            numIscrSito: `OP0001RP${String(++n).padStart(6, '0')}-MI0001`,
            denominazione: nome,
            principale: principale && i === 0,
          },
        })
      )
    }
    return { tenantId: t.id, sedi: righe }
  }

  /** Come `azienda`, con i registri gia' creati: `registroDi(nome)` e' il registro di quella sede. */
  async function aziendaConRegistri(sedi: string[], principale = true) {
    const a = await azienda(sedi, principale)
    const viste = await nelTenant(a.tenantId, () => registri.assicuraRegistri(a.tenantId))
    const registroDi = (nome: string) => {
      const sede = a.sedi.find(s => s.denominazione === nome)!
      return viste.find(v => v.unitaLocaleId === sede.id)!.id
    }
    return { ...a, registroDi }
  }

  function comando(
    tenantId: string,
    registroId: string | undefined,
    opzioni: { type?: 'CARICO' | 'SCARICO'; qty?: number; firId?: string } = {}
  ): RegistraMovimentoCommand {
    const adesso = new Date()
    const type = opzioni.type ?? 'CARICO'
    return new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      type,
      adesso,
      adesso,
      type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'CONFERIMENTO_TRASPORTATORE',
      CER,
      undefined,
      opzioni.qty ?? 10,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      opzioni.firId,
      undefined,
      registroId
    )
  }

  const registra = (tenantId: string, c: RegistraMovimentoCommand, uc = useCase) =>
    nelTenant(tenantId, () => uc.execute(c))

  /** Un FIR emesso (collegabile a un movimento) dell'azienda. */
  async function firEmesso(tenantId: string): Promise<string> {
    const repo = new FIRPrismaRepository(
      Object.assign(owner, { db: owner }) as never,
      owner as never
    )
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '999903', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId,
      creatoDaUserId: userId,
    })
    await repo.save(fir)
    await owner.fIR.update({ where: { id: fir.id }, data: { status: 'AWAITING_CARRIER' } })
    return fir.id
  }

  const numeri = async (tenantId: string, registroId: string) =>
    (
      await owner.wasteMovement.findMany({
        where: { tenantId, registroId },
        select: { progressiveNumber: true },
        orderBy: { progressiveNumber: 'asc' },
      })
    ).map(m => m.progressiveNumber)

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    registri = new RegistriService(app, loggerStub as never)
    useCase = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    progressivi = new ProgressivoInizialeService(app, registri)
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    // Apre il pool a gradini: 16 connessioni nuove tutte insieme attraverso il proxy di Docker
    // su Windows ogni tanto cadono ("Can't reach database server"), e non e' cio' che si prova qui.
    for (const k of [2, 4, 8, 16]) {
      await Promise.all(
        Array.from({ length: k }, () => app.$queryRaw`SELECT pg_sleep(0.05)::text AS s`)
      )
    }
    expect(a.u).toBe('wasteflow_app')
    const tenantUtente = await azienda([])
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenantUtente.tenantId,
          keycloakId: `keycloak-per-sede-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `per-sede-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
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
    await owner.registroProgressivoIniziale.deleteMany({
      where: { tenantId: { in: tenantCreati } },
    })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    // senza id deleteMany non avrebbe filtro e cancellerebbe tutti gli utenti
    if (userId) await owner.user.deleteMany({ where: { id: userId } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('due sedi: A registra 3 movimenti e B 2 nello stesso anno, A ha 1-3 e B ha 1-2', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    for (const reg of [regA, regB, regA, regB, regA]) {
      const r = await registra(az.tenantId, comando(az.tenantId, reg))
      expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
      expect(r.value.registroId).toBe(reg)
    }
    expect(await numeri(az.tenantId, regA)).toEqual([1, 2, 3])
    expect(await numeri(az.tenantId, regB)).toEqual([1, 2])
  })

  it('scarico in sede B non usa il carico di sede A: bloccato per giacenza insufficiente', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    const carico = await registra(az.tenantId, comando(az.tenantId, regA, { qty: 100 }))
    expect(carico.isSuccess).toBe(true)

    const r = await registra(az.tenantId, comando(az.tenantId, regB, { type: 'SCARICO', qty: 10 }))
    expect(r.isFailure).toBe(true)
    expect(r.error).toMatch(/Giacenza insufficiente per CER 99 99 03/)
    expect(await numeri(az.tenantId, regB)).toEqual([])
  })

  it('scarico in sede A usa il carico di sede A anche se B ha più giacenza', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    await registra(az.tenantId, comando(az.tenantId, regA, { qty: 100 }))
    await registra(az.tenantId, comando(az.tenantId, regB, { qty: 5000 }))

    const ok = await registra(
      az.tenantId,
      comando(az.tenantId, regA, { type: 'SCARICO', qty: 100 })
    )
    expect(ok.isSuccess ? 'ok' : ok.error).toBe('ok')
    // A e' ora a zero: un altro scarico in A e' rifiutato anche se B ha 5.000 kg
    const troppo = await registra(
      az.tenantId,
      comando(az.tenantId, regA, { type: 'SCARICO', qty: 1 })
    )
    expect(troppo.isFailure).toBe(true)
    expect(troppo.error).toMatch(/Giacenza insufficiente/)
  })

  it('8 registrazioni parallele su A e 8 su B: 1-8 su ciascuno, senza buchi né duplicati', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    const esiti = await Promise.all(
      [...Array(8).keys()].flatMap(() => [
        registra(az.tenantId, comando(az.tenantId, regA)),
        registra(az.tenantId, comando(az.tenantId, regB)),
      ])
    )
    expect(esiti.map(e => (e.isSuccess ? 'ok' : e.error))).toEqual(Array(16).fill('ok'))
    const uno = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(await numeri(az.tenantId, regA)).toEqual(uno)
    expect(await numeri(az.tenantId, regB)).toEqual(uno)
  })

  describe('lock del progressivo', () => {
    /** Client la cui transazione, scritto il movimento, aspetta il via prima del commit. */
    function clientConPausa() {
      let segnalaArrivo!: () => void
      const arrivata = new Promise<void>(r => (segnalaArrivo = r))
      let rilascia!: () => void
      const via = new Promise<void>(r => (rilascia = r))
      const client = new Proxy(app, {
        get(target, prop) {
          if (prop === '$transaction') {
            return (fn: (tx: unknown) => Promise<unknown>, opzioni?: unknown) =>
              (target as any).$transaction(async (tx: unknown) => {
                const risultato = await fn(tx)
                segnalaArrivo()
                await via
                return risultato
              }, opzioni)
          }
          const valore = Reflect.get(target, prop)
          return typeof valore === 'function' ? valore.bind(target) : valore
        },
      })
      return { client: client as PrismaService, arrivata, rilascia }
    }

    const scadenza = (ms: number) => new Promise<'scaduto'>(r => setTimeout(() => r('scaduto'), ms))

    it('una registrazione su A ferma sul lock del progressivo di A non blocca una registrazione su B', async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'])
      const regA = az.registroDi('Sede A')
      const regB = az.registroDi('Sede B')
      const pausa = clientConPausa()
      const useCaseInPausa = new RegistraMovimentoUseCase(
        pausa.client,
        loggerStub as never,
        registri
      )

      const registrazioneA = registra(az.tenantId, comando(az.tenantId, regA), useCaseInPausa)
      try {
        await pausa.arrivata // A ha scritto e tiene il lock del suo progressivo, commit non fatto
        const [{ n: lockTenuti }] = await owner.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted
        `
        expect(lockTenuti).toBeGreaterThan(0)

        // B deve completarsi mentre A e' ancora in attesa: con un lock per azienda aspetterebbe.
        const esitoB = await Promise.race([
          registra(az.tenantId, comando(az.tenantId, regB)),
          scadenza(5000),
        ])
        expect(esitoB).not.toBe('scaduto')
        expect(esitoB !== 'scaduto' && esitoB.isSuccess).toBe(true)
        expect(await numeri(az.tenantId, regB)).toEqual([1])
        // A non ha ancora fatto commit: dal punto di vista di B il suo registro e' vuoto.
        expect(await numeri(az.tenantId, regA)).toEqual([])
      } finally {
        pausa.rilascia()
      }
      const esitoA = await registrazioneA
      expect(esitoA.isSuccess).toBe(true)
      expect(await numeri(az.tenantId, regA)).toEqual([1])
    }, 30_000)

    it("due registrazioni sullo STESSO registro si aspettano (il lock esiste ed e' per registro)", async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'])
      const regA = az.registroDi('Sede A')
      const pausa = clientConPausa()
      const useCaseInPausa = new RegistraMovimentoUseCase(
        pausa.client,
        loggerStub as never,
        registri
      )

      const registrazione1 = registra(az.tenantId, comando(az.tenantId, regA), useCaseInPausa)
      let registrazione2: ReturnType<typeof registra> | undefined
      try {
        await pausa.arrivata
        registrazione2 = registra(az.tenantId, comando(az.tenantId, regA))
        expect(await Promise.race([registrazione2, scadenza(1500)])).toBe('scaduto')
      } finally {
        pausa.rilascia()
      }
      expect((await registrazione1).isSuccess).toBe(true)
      expect((await registrazione2!).isSuccess).toBe(true)
      expect(await numeri(az.tenantId, regA)).toEqual([1, 2])
    }, 30_000)
  })

  it('progressivo iniziale della sede A non cambia la numerazione della sede B', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    const impostato = await nelTenant(az.tenantId, () =>
      progressivi.imposta(az.tenantId, ANNO, 500, 'Migrazione da WinWaste', userId, regA)
    )
    expect(impostato).toEqual({ anno: ANNO, primoProgressivo: 500, registroId: regA })

    const inA = await registra(az.tenantId, comando(az.tenantId, regA))
    const inB = await registra(az.tenantId, comando(az.tenantId, regB))
    expect(inA.value.progressiveNumber).toBe(500)
    expect(inB.value.progressiveNumber).toBe(1)
    // B non ha un progressivo iniziale, e A ne ha uno gia' impostato
    await expect(
      nelTenant(az.tenantId, () =>
        progressivi.imposta(az.tenantId, ANNO, 900, 'Correzione', userId, regA)
      )
    ).rejects.toBeInstanceOf(ConflictException)
    expect(
      (await nelTenant(az.tenantId, () => progressivi.leggi(az.tenantId, ANNO, regB)))
        .primoProgressivo
    ).toBeNull()
  })

  it('azienda con una sola sede: registrazione senza registroId, finisce nel registro della principale', async () => {
    const az = await azienda(['Sede unica'])
    const r = await registra(az.tenantId, comando(az.tenantId, undefined))
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    const registro = await owner.registroRifiuti.findFirstOrThrow({
      where: { tenantId: az.tenantId, unitaLocaleId: az.sedi[0].id },
    })
    expect(r.value.registroId).toBe(registro.id)
    expect(r.value.progressiveNumber).toBe(1)
  })

  it('registrazione su azienda con sedi ma senza registri: preparaRegistri li crea e la registrazione riesce', async () => {
    const az = await azienda(['Sede A', 'Sede B'])
    expect(await owner.registroRifiuti.count({ where: { tenantId: az.tenantId } })).toBe(0)

    const r = await registra(az.tenantId, comando(az.tenantId, undefined))
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    const registriCreati = await owner.registroRifiuti.findMany({
      where: { tenantId: az.tenantId },
    })
    expect(registriCreati).toHaveLength(2)
    // senza registroId vale il registro della sede principale
    const dellaPrincipale = registriCreati.find(x => x.unitaLocaleId === az.sedi[0].id)!
    expect(r.value.registroId).toBe(dellaPrincipale.id)
  })

  it('movimento con firId e registroId di una sede non principale → RegistroNonCoerenteConFirError', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const firId = await firEmesso(az.tenantId)
    const r = await registra(
      az.tenantId,
      comando(az.tenantId, az.registroDi('Sede B'), { firId, type: 'CARICO' })
    )
    expect(r.isFailure).toBe(true)
    expect(r.error).toBe(new RegistroNonCoerenteConFirError().message)
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('movimento con firId senza registroId finisce nel registro della sede principale', async () => {
    const az = await aziendaConRegistri(['Sede A', 'Sede B'])
    const firId = await firEmesso(az.tenantId)
    const r = await registra(az.tenantId, comando(az.tenantId, undefined, { firId }))
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    expect(r.value.registroId).toBe(az.registroDi('Sede A'))
  })

  it('ricopia dello stesso FIR con un registro diverso → FIR già registrato', async () => {
    // Nessuna sede principale e due registri: con un FIR il registro lo sceglie l'utente.
    const az = await aziendaConRegistri(['Sede A', 'Sede B'], false)
    const regA = az.registroDi('Sede A')
    const regB = az.registroDi('Sede B')
    const firId = await firEmesso(az.tenantId)

    const comandoA = comando(az.tenantId, regA, { firId })
    const prima = await registra(az.tenantId, comandoA)
    expect(prima.isSuccess ? 'ok' : prima.error).toBe('ok')

    const seconda = await registra(az.tenantId, comando(az.tenantId, regB, { firId }))
    expect(seconda.isFailure).toBe(true)
    expect(seconda.error).toBe(
      new FirGiaRegistratoInAltroRegistroError(prima.value.progressiveNumber, ANNO, 'Sede A')
        .message
    )
    expect(seconda.error).toContain('nel registro Sede A')
    expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId, firId } })).toBe(1)

    // Senza registroId (e senza principale, con due registri) vale la ricopia esistente: retry idempotente.
    const senzaRegistro = await registra(az.tenantId, {
      ...comandoA,
      registroId: undefined,
    } as RegistraMovimentoCommand)
    expect(senzaRegistro.isSuccess ? 'ok' : senzaRegistro.error).toBe('ok')
    expect(senzaRegistro.value).toMatchObject({ id: prima.value.id, giaRegistrato: true })

    // Lo stesso retry (stessi dati) sul registro di partenza e' idempotente.
    const retry = await registra(az.tenantId, comandoA)
    expect(retry.value).toMatchObject({ id: prima.value.id, giaRegistrato: true })
  })
  describe('eliminazione di una sede (D8), ruolo wasteflow_app', () => {
    const MESSAGGIO = 'La sede ha un registro con movimenti: disattivala invece di eliminarla.'
    const elimina = (tenantId: string, sedeId: string) =>
      nelTenant(tenantId, () => new RentriUnitaLocaleService(app).remove(tenantId, sedeId))

    it('sede con registro vuoto: cancella registro e sede', async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'])
      const sedeB = az.sedi.find(s => s.denominazione === 'Sede B')!

      await elimina(az.tenantId, sedeB.id)

      expect(await owner.rentriUnitaLocale.count({ where: { id: sedeB.id } })).toBe(0)
      expect(await owner.registroRifiuti.count({ where: { id: az.registroDi('Sede B') } })).toBe(0)
      expect(await owner.registroRifiuti.count({ where: { id: az.registroDi('Sede A') } })).toBe(1)
    })

    it('sede con un movimento: rifiutata col messaggio esatto, niente viene cancellato', async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'])
      const sedeB = az.sedi.find(s => s.denominazione === 'Sede B')!
      const r = await registra(az.tenantId, comando(az.tenantId, az.registroDi('Sede B')))
      expect(r.isSuccess).toBe(true)

      const errore = await elimina(az.tenantId, sedeB.id).catch(e => e)

      expect(errore).toBeInstanceOf(BadRequestException)
      expect(errore.message).toBe(MESSAGGIO)
      expect(await owner.rentriUnitaLocale.count({ where: { id: sedeB.id } })).toBe(1)
      expect(await owner.registroRifiuti.count({ where: { id: az.registroDi('Sede B') } })).toBe(1)
    })

    it('sede con progressivo iniziale ma senza movimenti: rifiutata', async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'])
      const sedeB = az.sedi.find(s => s.denominazione === 'Sede B')!
      await nelTenant(az.tenantId, () =>
        progressivi.imposta(
          az.tenantId,
          ANNO,
          50,
          'Migrazione di prova',
          userId,
          az.registroDi('Sede B')
        )
      )

      const errore = await elimina(az.tenantId, sedeB.id).catch(e => e)

      expect(errore).toBeInstanceOf(BadRequestException)
      expect(errore.message).toBe(MESSAGGIO)
      expect(await owner.rentriUnitaLocale.count({ where: { id: sedeB.id } })).toBe(1)
    })
  })

  describe('GET del progressivo iniziale (sola lettura)', () => {
    it('azienda senza registri: stato neutro e nessuna scrittura', async () => {
      const az = await azienda(['Sede A'])
      const stato = await nelTenant(az.tenantId, () => progressivi.leggi(az.tenantId, ANNO))
      expect(stato).toEqual({
        anno: ANNO,
        registroId: null,
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: false,
      })
      expect(await owner.registroRifiuti.count({ where: { tenantId: az.tenantId } })).toBe(0)
    })

    it('due registri e nessuna principale: stato neutro, non un errore', async () => {
      const az = await aziendaConRegistri(['Sede A', 'Sede B'], false)
      const stato = await nelTenant(az.tenantId, () => progressivi.leggi(az.tenantId, ANNO))
      expect(stato.registroId).toBeNull()
      // con il registro indicato si legge normalmente
      const b = await nelTenant(az.tenantId, () =>
        progressivi.leggi(az.tenantId, ANNO, az.registroDi('Sede B'))
      )
      expect(b.registroId).toBe(az.registroDi('Sede B'))
    })
  })
})
