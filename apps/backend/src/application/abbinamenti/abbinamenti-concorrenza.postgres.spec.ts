/**
 * Concorrenza degli abbinamenti (4.6, Task 6) contro un Postgres reale, COME `wasteflow_app`.
 * Due `PrismaService` applicativi = due pool = connessioni distinte: le transazioni si
 * sovrappongono davvero (`Promise.all`). L'invariante e' sempre la stessa: il lettore non trova
 * righe incoerenti (nessun carico o scarico abbinato oltre la sua quantita) e non c'e deadlock.
 * Pulizia per id esatti.
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55442/wasteflow_ci?schema=public'
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
import { RegistriService } from '../registro/registri.service'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import { CorreggiMovimentoUseCase } from '../registro/use-cases/correggi-movimento.use-case'
import { leggiAmbitiAbbinamento } from './lettore-abbinamenti'
import {
  bloccaAmbiti,
  ricalcolaAbbinamenti,
  salvaAbbinamentoManuale,
} from './abbinamenti-scrittura'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Concorrenza abbinamenti - Postgres reale, ruolo wasteflow_app, due pool', () => {
  const CER = '99 99 13'
  const CER2 = '99 99 14'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let appB: PrismaService
  let registraB: RegistraMovimentoUseCase
  let correggiB: CorreggiMovimentoUseCase
  let registri: RegistriService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  let userId: string
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0

  type Az = { tenantId: string; registroId: string }
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())
  const inTx = <R>(az: Az, fn: (tx: Prisma.TransactionClient) => Promise<R>) =>
    nelTenant(az.tenantId, () => app.$transaction(tx => fn(tx)))

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `SC${suffisso}`,
        ragioneSociale: 'Scritture abbinamenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001SC${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }

  async function movimento(
    az: Az,
    o: {
      type: 'CARICO' | 'SCARICO'
      giorno: string
      quantita: number
      op?: string
      causale?: string
      cer?: string
      unita?: string
      via?: RegistraMovimentoUseCase
    }
  ): Promise<string> {
    const r = await nelTenant(az.tenantId, () =>
      (o.via ?? registra).execute(
        new RegistraMovimentoCommand(
          az.tenantId,
          undefined as unknown as string,
          o.type,
          new Date(`${o.giorno}T10:00:00Z`),
          new Date(),
          o.causale ?? (o.type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO'),
          o.cer ?? CER,
          undefined,
          o.quantita,
          o.unita ?? 'KG',
          undefined,
          undefined,
          o.op,
          undefined,
          undefined,
          undefined,
          undefined,
          az.registroId
        )
      )
    )
    if (!r.isSuccess) throw new Error(`registrazione fallita: ${r.error}`)
    return r.value.id
  }

  const carico = (az: Az, giorno: string, q: number, op = 'R13') =>
    movimento(az, { type: 'CARICO', giorno, quantita: q, op })
  const scarico = (
    az: Az,
    giorno: string,
    q: number,
    extra: { causale?: string; op?: string } = {}
  ) => movimento(az, { type: 'SCARICO', giorno, quantita: q, ...extra })

  const righeDi = (az: Az) =>
    owner.abbinamentoCaricoScarico.findMany({
      where: { tenantId: az.tenantId },
      orderBy: [{ createdAt: 'asc' }, { quantita: 'desc' }],
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    appB = creaPrismaServiceApplicativo()
    await appB.onModuleInit()
    registraB = new RegistraMovimentoUseCase(
      appB,
      loggerStub as never,
      new RegistriService(appB, loggerStub as never)
    )
    correggiB = new CorreggiMovimentoUseCase(appB, loggerStub as never)
    for (const code of [CER, CER2]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
    const primo = await azienda()
    userId = (
      await owner.user.create({
        data: {
          tenantId: primo.tenantId,
          keycloakId: `keycloak-abbinamenti-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `abbinamenti-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.abbinamentoCaricoScarico.deleteMany({
        where: { tenantId: { in: tenantCreati } },
      })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.registroProgressivoIniziale.deleteMany({
        where: { tenantId: { in: tenantCreati } },
      })
      await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      if (userId) await owner.user.deleteMany({ where: { id: userId } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await appB.onModuleDestroy()
    await owner.$disconnect()
  })

  const RIPETIZIONI = 10

  const inTxB = <R>(az: Az, fn: (tx: Prisma.TransactionClient) => Promise<R>) =>
    nelTenant(az.tenantId, () => appB.$transaction(tx => fn(tx)))

  const conB = (az: Az, o: Parameters<typeof movimento>[1]) =>
    movimento(az, { ...o, via: registraB })

  /** Invariante: nessuna riga incoerente (oltre la quantita di carico o scarico) in nessun ambito. */
  async function verificaCoerenza(az: Az) {
    const ambiti = await inTx(az, tx =>
      leggiAmbitiAbbinamento(tx, az.tenantId, { registroId: az.registroId })
    )
    for (const a of ambiti) expect(a.righeIncoerenti).toEqual([])
    // somma per carico e per scarico, in millesimi, entro la quantita
    const righe = await righeDi(az)
    const perCarico = new Map<string, number>()
    for (const r of righe) {
      const k = r.caricoId ?? (r.giacenzaInizialeId as string)
      perCarico.set(k, (perCarico.get(k) ?? 0) + Math.round(Number(r.quantita) * 1000))
    }
    for (const a of ambiti) {
      for (const c of a.carichi) {
        const id = c.chiave.slice(2)
        expect(perCarico.get(id) ?? 0).toBeLessThanOrEqual(Math.round(c.evento.quantita * 1000))
      }
    }
    return righe
  }
  const somma = (righe: Array<{ quantita: unknown }>) =>
    righe.reduce((s, r) => s + Math.round(Number(r.quantita) * 1000), 0) / 1000

  it('due scarichi concorrenti sullo stesso carico residuo: la somma non supera il carico', async () => {
    for (let i = 0; i < RIPETIZIONI; i++) {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      // giacenza: un secondo carico non di stoccaggio, cosi' i due scarichi da 70 sono ammessi
      await carico(az, '2026-03-01', 100, 'R1')
      const [sA, sB] = await Promise.all([
        movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 70 }),
        conB(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 70 }),
      ])
      const righe = await verificaCoerenza(az)
      expect(somma(righe.filter(r => r.caricoId === c1))).toBe(100)
      const totali = [
        somma(righe.filter(r => r.scaricoId === sA)),
        somma(righe.filter(r => r.scaricoId === sB)),
      ]
      expect(totali.sort((x, y) => x - y)).toEqual([30, 70])
    }
  }, 120_000)

  it('override concorrente a una registrazione: nessuna riga oltre il carico, nessun deadlock', async () => {
    for (let i = 0; i < RIPETIZIONI; i++) {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      const c2 = await carico(az, '2026-03-02', 100)
      const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 70 })
      const [, s2] = await Promise.all([
        inTxB(az, tx =>
          salvaAbbinamentoManuale(tx, {
            tenantId: az.tenantId,
            scaricoRadiceId: s1,
            userId,
            righe: [{ caricoId: c2, quantita: 70 }],
          })
        ),
        movimento(az, { type: 'SCARICO', giorno: '2026-03-11', quantita: 100 }),
      ])
      const righe = await verificaCoerenza(az)
      expect(somma(righe.filter(r => r.scaricoId === s1))).toBe(70)
      expect(somma(righe.filter(r => r.scaricoId === s2))).toBe(100)
    }
  }, 120_000)

  it('ricalcolo AUTOMATICI concorrente a una registrazione: stessa invariante', async () => {
    for (let i = 0; i < RIPETIZIONI; i++) {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      await carico(az, '2026-03-02', 100)
      const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 70 })
      const [, s2] = await Promise.all([
        inTxB(az, tx =>
          ricalcolaAbbinamenti(tx, {
            tenantId: az.tenantId,
            registroId: az.registroId,
            modalita: 'AUTOMATICI',
            userId,
          })
        ),
        movimento(az, { type: 'SCARICO', giorno: '2026-03-11', quantita: 90 }),
      ])
      const righe = await verificaCoerenza(az)
      expect(somma(righe.filter(r => r.scaricoId === s1))).toBe(70)
      expect(somma(righe.filter(r => r.scaricoId === s2))).toBe(90)
    }
  }, 120_000)

  it('correzioni concorrenti di carico e scarico: nessun deadlock, stato coerente', async () => {
    for (let i = 0; i < RIPETIZIONI; i++) {
      const az = await azienda()
      const c1 = await carico(az, '2026-03-01', 100)
      const s1 = await scarico(az, '2026-03-10', 50)
      const s2 = await scarico(az, '2026-03-11', 20)
      const esiti = await Promise.allSettled([
        nelTenant(az.tenantId, () =>
          correggi.rettifica({
            tenantId: az.tenantId,
            userId,
            movimentoId: c1,
            motivo: 'aumento',
            dati: {
              movementDate: new Date('2026-03-01T10:00:00Z'),
              causale: 'PRODUZIONE_INTERNA',
              cerCode: CER,
              quantity: 150,
              unit: 'KG',
              operationCode: 'R13',
            },
          })
        ),
        nelTenant(az.tenantId, () =>
          correggiB.rettifica({
            tenantId: az.tenantId,
            userId,
            movimentoId: s1,
            motivo: 'quantita',
            dati: {
              movementDate: new Date('2026-03-10T10:00:00Z'),
              causale: 'AVVIO_RECUPERO',
              cerCode: CER,
              quantity: 80,
              unit: 'KG',
            },
          })
        ),
        nelTenant(az.tenantId, () =>
          correggiB.annulla({ tenantId: az.tenantId, userId, movimentoId: s2, motivo: 'errore' })
        ),
      ])
      // ogni esito e' un successo o un rifiuto di dominio (409/400): mai un errore di database
      for (const e of esiti) {
        if (e.status === 'rejected') {
          expect([400, 409]).toContain((e.reason as { status?: number }).status)
        }
      }
      await verificaCoerenza(az)
    }
  }, 120_000)

  it('rettifiche incrociate di CER in ordine opposto: nessun deadlock sui lock dei CER', async () => {
    for (let i = 0; i < RIPETIZIONI; i++) {
      const az = await azienda()
      await carico(az, '2026-03-01', 100)
      await movimento(az, {
        type: 'CARICO',
        giorno: '2026-03-01',
        quantita: 100,
        op: 'R13',
        cer: CER2,
      })
      const sA = await scarico(az, '2026-03-10', 30)
      const sB = await movimento(az, {
        type: 'SCARICO',
        giorno: '2026-03-10',
        quantita: 30,
        cer: CER2,
      })
      const rett = (uc: CorreggiMovimentoUseCase, id: string, cer: string) =>
        nelTenant(az.tenantId, () =>
          uc.rettifica({
            tenantId: az.tenantId,
            userId,
            movimentoId: id,
            motivo: 'cer errato',
            dati: {
              movementDate: new Date('2026-03-10T10:00:00Z'),
              causale: 'AVVIO_RECUPERO',
              cerCode: cer,
              quantity: 30,
              unit: 'KG',
            },
          })
        )
      const esiti = await Promise.allSettled([rett(correggi, sA, CER2), rett(correggiB, sB, CER)])
      for (const e of esiti) expect(e.status).toBe('fulfilled')
      await verificaCoerenza(az)
    }
  }, 120_000)
  it("i lock dell'ambito serializzano override e ricalcolo (prova deterministica)", async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const s1 = await scarico(az, '2026-03-10', 50)
    const TENUTA_MS = 800
    const dormi = (ms: number) => new Promise(r => setTimeout(r, ms))

    /** Una transazione tiene il lock dell'ambito per TENUTA_MS; l'operazione parte 200 ms dopo. */
    async function conLockTenuto(operazione: () => Promise<unknown>): Promise<{ attesa: number }> {
      let rilascio = 0
      const titolare = inTxB(az, async tx => {
        await bloccaAmbiti(tx, az.registroId, [CER])
        await dormi(TENUTA_MS)
        rilascio = Date.now()
      })
      await dormi(200)
      await operazione()
      const fine = Date.now()
      await titolare
      // l'operazione non puo finire prima che il titolare abbia rilasciato il lock
      return { attesa: fine - rilascio }
    }

    const override = await conLockTenuto(() =>
      inTx(az, tx =>
        salvaAbbinamentoManuale(tx, {
          tenantId: az.tenantId,
          scaricoRadiceId: s1,
          userId,
          righe: [{ caricoId: c1, quantita: 50 }],
        })
      )
    )
    expect(override.attesa).toBeGreaterThanOrEqual(0)

    const ricalcolo = await conLockTenuto(() =>
      inTx(az, tx =>
        ricalcolaAbbinamenti(tx, {
          tenantId: az.tenantId,
          registroId: az.registroId,
          modalita: 'AUTOMATICI',
          userId,
        })
      )
    )
    expect(ricalcolo.attesa).toBeGreaterThanOrEqual(0)
    await verificaCoerenza(az)
  }, 30_000)
})
