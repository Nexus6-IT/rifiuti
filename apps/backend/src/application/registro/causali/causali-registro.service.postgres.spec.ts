/**
 * Gestione delle causali (Fase 2 pezzo 5, Task 5) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE), dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende e utenti e legge cio' che e' stato
 * scritto; la pulizia toglie solo le righe create qui. Le righe di `causali_registro` non si
 * toccano. I movimenti si registrano con il caso d'uso vero, cosi' i lock sono quelli reali.
 */
import { BadRequestException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

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
import { RegistraMovimentoUseCase } from '../use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { RegistriService } from '../registri.service'
import { CausaliRegistroService } from './causali-registro.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Gestione delle causali — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 05'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: CausaliRegistroService
  let useCase: RegistraMovimentoUseCase
  let cerCreato = false
  const tenantCreati: string[] = []
  let n = 0

  interface Azienda {
    tenantId: string
    userId: string
  }

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<Azienda> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `GC${suffisso}`, ragioneSociale: 'Gestione causali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-causali-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `causali-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    await nelTenant(t.id, () =>
      new RegistriService(app, loggerStub as never).assicuraRegistri(t.id)
    )
    return { tenantId: t.id, userId: u.id }
  }

  const crea = (
    a: Azienda,
    dati: Partial<Parameters<CausaliRegistroService['crea']>[2]> = {},
    s: CausaliRegistroService = service
  ) =>
    nelTenant(a.tenantId, () =>
      s.crea(a.tenantId, a.userId, {
        codice: 'AZ_PROVA',
        verso: 'CARICO',
        descrizione: 'Prova',
        ruoloMud: 'PRODOTTO',
        codiceRentri: 'DT',
        validaDal: '2026-01-01',
        ...dati,
      })
    )

  function comando(a: Azienda, causale: string, data: string): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      a.tenantId,
      undefined as unknown as string,
      'CARICO',
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

  const registra = (a: Azienda, causale: string, data: string, uc = useCase) =>
    nelTenant(a.tenantId, () => uc.execute(comando(a, causale, data)))

  async function registraOk(a: Azienda, causale: string, data: string) {
    const r = await registra(a, causale, data)
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
  }

  /** Esito di una promessa: l'eccezione (con status e codice) oppure null. */
  async function errore(p: Promise<unknown>): Promise<{ status: number; error?: string } | null> {
    try {
      await p
      return null
    } catch (e: any) {
      const risposta = typeof e.getResponse === 'function' ? e.getResponse() : {}
      return { status: e.getStatus?.() ?? 500, error: risposta?.error }
    }
  }

  const scadenza = (ms: number) => new Promise<'scaduto'>(r => setTimeout(() => r('scaduto'), ms))

  /** Un `$transaction` che, finita la funzione e prima del commit, aspetta il via. */
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

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toContain(':55432/')
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    service = new CausaliRegistroService(app)
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
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.causaleRegistroAzienda.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('ciclo completo: usata -> modifica del ruolo 409 -> nuova versione prima dell ultimo uso 409 -> dopo ok', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    await registraOk(a, 'AZ_PROVA', '2026-03-10')

    const modifica = await errore(
      nelTenant(a.tenantId, () =>
        service.modifica(a.tenantId, a.userId, v1.id, { ruoloMud: 'ESCLUSO' })
      )
    )
    expect(modifica).toEqual({ status: 409, error: 'CAUSALE_USATA_NUOVA_VERSIONE' })

    const prima = await errore(
      nelTenant(a.tenantId, () =>
        service.nuovaVersione(a.tenantId, a.userId, v1.id, {
          validaDal: '2026-03-05',
          ruoloMud: 'ESCLUSO',
        })
      )
    )
    expect(prima).toEqual({ status: 409, error: 'CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO' })

    const v2 = await nelTenant(a.tenantId, () =>
      service.nuovaVersione(a.tenantId, a.userId, v1.id, {
        validaDal: '2026-03-11',
        ruoloMud: 'ESCLUSO',
      })
    )
    expect(v2.validaDal).toBe('2026-03-11')
    expect(v2.validaAl).toBeNull()
    expect(v2.codiceRentri).toBeNull()
    expect(v2.operazione).toBeNull()
    expect(v2.descrizione).toBe('Prova')

    const righe = await owner.causaleRegistroAzienda.findMany({
      where: { tenantId: a.tenantId },
      orderBy: { validaDal: 'asc' },
    })
    expect(righe.map(r => r.validaAl?.toISOString().slice(0, 10) ?? null)).toEqual([
      '2026-03-10',
      null,
    ])
    // il movimento conserva la vecchia versione
    const mov = await owner.wasteMovement.findMany({ where: { tenantId: a.tenantId } })
    expect(mov.map(m => m.causaleAziendaId)).toEqual([v1.id])

    const azioni = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })
    expect(azioni.map(x => x.action)).toEqual([
      'REGISTRO_CAUSALE_CREATA',
      'REGISTRO_CAUSALE_VERSIONATA',
    ])
  })

  it('PATCH: codiceRentri null azzera, campo assente lascia invariato; modifica in place di una non usata', async () => {
    const a = await azienda()
    const v = await crea(a)
    const dopoDescrizione = await nelTenant(a.tenantId, () =>
      service.modifica(a.tenantId, a.userId, v.id, { descrizione: 'Nuova', ordine: 7 })
    )
    expect(dopoDescrizione.codiceRentri).toBe('DT')
    expect(dopoDescrizione.ordine).toBe(7)

    const dopoRuolo = await nelTenant(a.tenantId, () =>
      service.modifica(a.tenantId, a.userId, v.id, { ruoloMud: 'ESCLUSO' })
    )
    expect(dopoRuolo.ruoloMud).toBe('ESCLUSO')

    const azzerato = await nelTenant(a.tenantId, () =>
      service.modifica(a.tenantId, a.userId, v.id, { codiceRentri: null })
    )
    expect(azzerato.codiceRentri).toBeNull()
    const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: v.id } })
    expect(riga.codiceRentri).toBeNull()
    expect(riga.descrizione).toBe('Nuova')
  })

  it('PATCH che rende incoerente il record -> 400 e la riga non cambia', async () => {
    const a = await azienda()
    const v = await crea(a, {
      verso: 'SCARICO',
      ruoloMud: 'AVVIATO',
      codiceRentri: 'aT',
      operazione: 'R',
    })
    const e = await errore(
      nelTenant(a.tenantId, () =>
        service.modifica(a.tenantId, a.userId, v.id, { ruoloMud: 'ESCLUSO' })
      )
    )
    expect(e?.status).toBe(400)
    const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: v.id } })
    expect(riga.ruoloMud).toBe('AVVIATO')
    expect(riga.operazione).toBe('R')
  })

  it('crea due volte la stessa coppia -> 409 CAUSALE_ESISTENTE; stesso codice nell altro verso ok', async () => {
    const a = await azienda()
    await crea(a)
    expect(await errore(crea(a))).toEqual({ status: 409, error: 'CAUSALE_ESISTENTE' })
    await expect(
      crea(a, { verso: 'SCARICO', ruoloMud: 'ESCLUSO', codiceRentri: null })
    ).resolves.toBeDefined()
  })

  it('chiusura: prima dell ultimo uso 409; il giorno italiano di un movimento delle 23:30 UTC del 31/12 e il 1 gennaio', async () => {
    const a = await azienda()
    const v = await crea(a, { validaDal: '2025-06-01' })
    await registraOk(a, 'AZ_PROVA', '2025-12-31T23:30:00.000Z')

    const alTrentuno = await errore(
      nelTenant(a.tenantId, () => service.chiudi(a.tenantId, a.userId, v.id, '2025-12-31'))
    )
    expect(alTrentuno).toEqual({ status: 409, error: 'CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO' })

    const gestione = await nelTenant(a.tenantId, () => service.gestione(a.tenantId))
    expect(gestione.aziendali[0]).toMatchObject({ usata: true, ultimoGiornoUso: '2026-01-01' })

    const chiusa = await nelTenant(a.tenantId, () =>
      service.chiudi(a.tenantId, a.userId, v.id, '2026-01-01')
    )
    expect(chiusa.validaAl).toBe('2026-01-01')
  })

  it('elimina: usata -> 409, non usata -> ok; eliminando l ultima versione la precedente resta chiusa', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    await registraOk(a, 'AZ_PROVA', '2026-02-10')
    expect(
      await errore(nelTenant(a.tenantId, () => service.elimina(a.tenantId, a.userId, v1.id)))
    ).toEqual({ status: 409, error: 'CAUSALE_USATA_NON_ELIMINABILE' })

    const v2 = await nelTenant(a.tenantId, () =>
      service.nuovaVersione(a.tenantId, a.userId, v1.id, {
        validaDal: '2026-04-01',
        ruoloMud: 'ESCLUSO',
      })
    )
    await nelTenant(a.tenantId, () => service.elimina(a.tenantId, a.userId, v2.id))
    const rimaste = await owner.causaleRegistroAzienda.findMany({ where: { tenantId: a.tenantId } })
    expect(rimaste).toHaveLength(1)
    expect(rimaste[0].validaAl?.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('disattivazione idempotente, riattivazione, codice inesistente 404', async () => {
    const a = await azienda()
    const cessione = async () =>
      (await nelTenant(a.tenantId, () => service.opzioni(a.tenantId, 'SCARICO', '2026-06-01'))).map(
        o => o.codice
      )
    expect(await cessione()).toContain('CESSIONE')
    await nelTenant(a.tenantId, () =>
      service.disattiva(a.tenantId, a.userId, 'SCARICO', 'CESSIONE')
    )
    await nelTenant(a.tenantId, () =>
      service.disattiva(a.tenantId, a.userId, 'SCARICO', 'CESSIONE')
    )
    expect(await cessione()).not.toContain('CESSIONE')
    expect(
      await owner.causaleRegistroAzienda.count({
        where: { tenantId: a.tenantId, natura: 'DISATTIVAZIONE' },
      })
    ).toBe(1)
    const gestione = await nelTenant(a.tenantId, () => service.gestione(a.tenantId))
    expect(gestione.sistema).toHaveLength(11)
    expect(
      gestione.sistema.find(s => s.codice === 'CESSIONE' && s.verso === 'SCARICO')
    ).toMatchObject({ disattivataPerAzienda: true, attiva: true })

    await nelTenant(a.tenantId, () => service.riattiva(a.tenantId, a.userId, 'SCARICO', 'CESSIONE'))
    await nelTenant(a.tenantId, () => service.riattiva(a.tenantId, a.userId, 'SCARICO', 'CESSIONE'))
    expect(await cessione()).toContain('CESSIONE')

    expect(
      await errore(
        nelTenant(a.tenantId, () =>
          service.disattiva(a.tenantId, a.userId, 'SCARICO', 'NON_ESISTE')
        )
      )
    ).toMatchObject({ status: 404 })
    const azioni = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })
    expect(azioni.map(x => x.action)).toEqual([
      'REGISTRO_CAUSALE_DISATTIVATA',
      'REGISTRO_CAUSALE_RIATTIVATA',
    ])
  })

  it('isolamento fra aziende: B non vede ne tocca le causali di A (404), lo stesso codice convive', async () => {
    const a = await azienda()
    const b = await azienda()
    const va = await crea(a)
    const vb = await crea(b)
    expect(vb.id).not.toBe(va.id)

    const e = await errore(
      nelTenant(b.tenantId, () =>
        service.modifica(b.tenantId, b.userId, va.id, { descrizione: 'x' })
      )
    )
    expect(e).toMatchObject({ status: 404 })
    expect(
      await errore(nelTenant(b.tenantId, () => service.elimina(b.tenantId, b.userId, va.id)))
    ).toMatchObject({ status: 404 })
    const gestioneB = await nelTenant(b.tenantId, () => service.gestione(b.tenantId))
    expect(gestioneB.aziendali.map(x => x.id)).toEqual([vb.id])
    const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: va.id } })
    expect(riga.descrizione).toBe('Prova')
  })

  it('gestione con piu versioni fa UNA sola query sui movimenti', async () => {
    const a = await azienda()
    const v1 = await crea(a, { codice: 'AZ_UNO' })
    await crea(a, { codice: 'AZ_DUE' })
    await nelTenant(a.tenantId, () =>
      service.nuovaVersione(a.tenantId, a.userId, v1.id, {
        validaDal: '2026-05-01',
        ruoloMud: 'ESCLUSO',
      })
    )
    let querySuMovimenti = 0
    const contatore = new Proxy(app, {
      get(target, prop) {
        if (prop === '$transaction') {
          return (fn: (tx: any) => Promise<unknown>, opzioni?: unknown) =>
            (target as any).$transaction(
              (tx: any) =>
                fn(
                  new Proxy(tx, {
                    get(t, p) {
                      if (p === '$queryRaw') {
                        return (strings: TemplateStringsArray, ...valori: unknown[]) => {
                          if (strings.join('?').includes('waste_movements')) querySuMovimenti++
                          return t.$queryRaw(strings, ...valori)
                        }
                      }
                      const val = Reflect.get(t, p)
                      return typeof val === 'function' ? val.bind(t) : val
                    },
                  })
                ),
              opzioni
            )
        }
        const val = Reflect.get(target, prop)
        return typeof val === 'function' ? val.bind(target) : val
      },
    }) as PrismaService
    const gestione = await nelTenant(a.tenantId, () =>
      new CausaliRegistroService(contatore).gestione(a.tenantId)
    )
    expect(gestione.aziendali).toHaveLength(3)
    expect(querySuMovimenti).toBe(1)
  })

  it('PATCH di sola descrizione e ordine su una versione gia usata: passa, il resto non cambia', async () => {
    const a = await azienda()
    const v = await crea(a)
    await registraOk(a, 'AZ_PROVA', '2026-03-10')
    const m = await nelTenant(a.tenantId, () =>
      service.modifica(a.tenantId, a.userId, v.id, { descrizione: 'Nuova descrizione', ordine: 7 })
    )
    expect(m).toMatchObject({ descrizione: 'Nuova descrizione', ordine: 7, ruoloMud: 'PRODOTTO' })
    const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: v.id } })
    expect([riga.descrizione, riga.ordine, riga.ruoloMud, riga.codiceRentri]).toEqual([
      'Nuova descrizione',
      7,
      'PRODOTTO',
      'DT',
    ])
    // Un valore diverso per un campo bloccato resta un 409.
    expect(
      await errore(
        nelTenant(a.tenantId, () =>
          service.modifica(a.tenantId, a.userId, v.id, { ruoloMud: 'ESCLUSO' })
        )
      )
    ).toEqual({ status: 409, error: 'CAUSALE_USATA_NUOVA_VERSIONE' })
  })

  it('rete del trigger: un UPDATE diretto su una versione usata fallisce, la transazione si annulla e l errore diventa un 400 generico', async () => {
    const { Prisma } = await import('@prisma/client')
    const a = await azienda()
    const v = await crea(a)
    await registraOk(a, 'AZ_PROVA', '2026-03-10')
    let catturato: unknown
    try {
      await nelTenant(a.tenantId, () =>
        app.$transaction(async tx => {
          await tx.$executeRaw`UPDATE causali_registro_azienda SET descrizione = 'modificata nella transazione' WHERE id = ${v.id}::uuid`
          await tx.$executeRaw`UPDATE causali_registro_azienda SET ruolo_mud = 'ESCLUSO'::ruolo_mud_causale WHERE id = ${v.id}::uuid`
        })
      )
    } catch (e) {
      catturato = e
    }
    // La forma con la versione reale di Prisma: involucro P2010 con lo SQLSTATE del RAISE in meta.code.
    expect(catturato).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect((catturato as { code: string }).code).toBe('P2010')
    expect((catturato as { meta?: { code?: string } }).meta?.code).toBe('P0001')
    // Transazione annullata: nemmeno il primo UPDATE e rimasto.
    const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: v.id } })
    expect(riga.descrizione).toBe('Prova')
    expect(riga.ruoloMud).toBe('PRODOTTO')
    const tradotto = (service as unknown as { comeErroreHttp(e: unknown): unknown }).comeErroreHttp(
      catturato
    )
    expect(tradotto).toBeInstanceOf(BadRequestException)
    expect((tradotto as BadRequestException).message).toBe('I dati della causale non sono validi.')
  })

  describe('concorrenza', () => {
    it('registrazione in corso (KEY SHARE sulla versione): la modifica del ruolo attende e poi risponde 409', async () => {
      const a = await azienda()
      const v = await crea(a)
      const pausa = clientConPausa()
      const ucInPausa = new RegistraMovimentoUseCase(
        pausa.client,
        loggerStub as never,
        new RegistriService(app, loggerStub as never)
      )
      const registrazione = registra(a, 'AZ_PROVA', '2026-03-10', ucInPausa)
      let modifica: Promise<unknown> | undefined
      try {
        await pausa.arrivata // movimento inserito, commit non fatto
        modifica = errore(
          nelTenant(a.tenantId, () =>
            service.modifica(a.tenantId, a.userId, v.id, { ruoloMud: 'ESCLUSO' })
          )
        )
        const durante = await Promise.race([modifica, scadenza(1500)])
        expect(durante).toBe('scaduto') // aspetta il commit della registrazione
      } finally {
        pausa.rilascia()
      }
      expect((await registrazione).isSuccess).toBe(true)
      expect(await modifica).toEqual({ status: 409, error: 'CAUSALE_USATA_NUOVA_VERSIONE' })
      const riga = await owner.causaleRegistroAzienda.findUniqueOrThrow({ where: { id: v.id } })
      expect(riga.ruoloMud).toBe('PRODOTTO')
    }, 30_000)

    it('registrazione in corso: la chiusura prima del giorno del movimento attende e poi risponde 409', async () => {
      const a = await azienda()
      const v = await crea(a)
      const pausa = clientConPausa()
      const ucInPausa = new RegistraMovimentoUseCase(
        pausa.client,
        loggerStub as never,
        new RegistriService(app, loggerStub as never)
      )
      const registrazione = registra(a, 'AZ_PROVA', '2026-03-10', ucInPausa)
      let chiusura: Promise<unknown> | undefined
      try {
        await pausa.arrivata
        chiusura = errore(
          nelTenant(a.tenantId, () => service.chiudi(a.tenantId, a.userId, v.id, '2026-02-01'))
        )
        expect(await Promise.race([chiusura, scadenza(1500)])).toBe('scaduto')
      } finally {
        pausa.rilascia()
      }
      await registrazione
      expect(await chiusura).toEqual({ status: 409, error: 'CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO' })
    }, 30_000)

    it('chiusura in corso (FOR UPDATE): la registrazione attende e poi prende 409 CAUSALE_MODIFICATA', async () => {
      const a = await azienda()
      const v = await crea(a)
      const pausa = clientConPausa()
      const serviceInPausa = new CausaliRegistroService(pausa.client)
      const chiusura = nelTenant(a.tenantId, () =>
        serviceInPausa.chiudi(a.tenantId, a.userId, v.id, '2026-03-31')
      )
      let registrazione: Promise<unknown> | undefined
      try {
        await pausa.arrivata // FOR UPDATE + UPDATE fatti, commit non fatto
        registrazione = errore(registra(a, 'AZ_PROVA', '2026-06-10'))
        expect(await Promise.race([registrazione, scadenza(1500)])).toBe('scaduto')
      } finally {
        pausa.rilascia()
      }
      await chiusura
      expect(await registrazione).toEqual({ status: 409, error: 'CAUSALE_MODIFICATA' })
      expect(await owner.wasteMovement.count({ where: { tenantId: a.tenantId } })).toBe(0)
    }, 30_000)

    it('due nuove versioni concorrenti dalla stessa versione: la seconda attende il commit della prima e poi prende 409', async () => {
      const a = await azienda()
      const v = await crea(a)
      const pausa = clientConPausa()
      const serviceInPausa = new CausaliRegistroService(pausa.client)
      const prima = nelTenant(a.tenantId, () =>
        serviceInPausa.nuovaVersione(a.tenantId, a.userId, v.id, {
          validaDal: '2026-04-01',
          ruoloMud: 'ESCLUSO',
        })
      )
      let seconda: Promise<unknown> | undefined
      try {
        await pausa.arrivata // lock e INSERT fatti, commit non fatto
        seconda = errore(
          nelTenant(a.tenantId, () =>
            service.nuovaVersione(a.tenantId, a.userId, v.id, {
              validaDal: '2026-05-01',
              ruoloMud: 'ESCLUSO',
            })
          )
        )
        expect(await Promise.race([seconda, scadenza(1500)])).toBe('scaduto')
      } finally {
        pausa.rilascia()
      }
      await prima
      expect(await seconda).toEqual({ status: 409, error: 'CAUSALE_NON_ULTIMA_VERSIONE' })
      expect(await owner.causaleRegistroAzienda.count({ where: { tenantId: a.tenantId } })).toBe(2)
    }, 30_000)
  })
})
