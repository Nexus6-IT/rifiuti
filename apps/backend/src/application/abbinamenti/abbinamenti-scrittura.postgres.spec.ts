/**
 * Scritture degli abbinamenti (4.6, Task 5) contro un Postgres reale, COME `wasteflow_app`
 * dentro il `TenantContext`. Carichi e scarichi si registrano con il caso d'uso vero (che in
 * questo Task non abbina ancora: le funzioni si chiamano a mano dentro una transazione).
 * Pulizia per id esatti.
 */
import { randomUUID } from 'crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
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
import {
  abbinaNuovoScarico,
  bloccaAmbiti,
  ricalcolaAbbinamenti,
  salvaAbbinamentoManuale,
} from './abbinamenti-scrittura'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Scritture abbinamenti - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 13'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
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
    }
  ): Promise<string> {
    const r = await nelTenant(az.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          az.tenantId,
          undefined as unknown as string,
          o.type,
          new Date(`${o.giorno}T10:00:00Z`),
          new Date(),
          o.causale ?? (o.type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO'),
          CER,
          undefined,
          o.quantita,
          'KG',
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
    // dal Task 7 la registrazione abbina da sola: qui si parte da scarichi senza righe, per
    // provare le funzioni di scrittura una alla volta (id esatto, mai un filtro vuoto)
    if (o.type === 'SCARICO' && r.value.id) {
      await owner.abbinamentoCaricoScarico.deleteMany({ where: { scaricoId: r.value.id } })
    }
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

  const abbina = (az: Az, scaricoId: string) =>
    inTx(az, tx =>
      abbinaNuovoScarico(tx, {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId,
        userId,
      })
    )

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    if ((await owner.cERCode.count({ where: { code: CER } })) === 0) cerCreati.push(CER)
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
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
    await owner.$disconnect()
  })

  it('abbinaNuovoScarico FIFO: due carichi R13, scarico 150', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const c2 = await carico(az, '2026-03-02', 100)
    const s = await scarico(az, '2026-03-10', 150)
    const avvisi = await abbina(az, s)
    expect(avvisi).toEqual([])
    const righe = await righeDi(az)
    expect(
      righe.map(r => [r.caricoId, Number(r.quantita), r.origine, r.creatoDa, r.scaricoId])
    ).toEqual([
      [c1, 100, 'AUTOMATICO', userId, s],
      [c2, 50, 'AUTOMATICO', userId, s],
    ])
  })

  it('parziale con avviso', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100)
    await carico(az, '2026-03-02', 100)
    // terzo carico fuori stoccaggio: serve solo a far tornare il saldo del registro
    await movimento(az, { type: 'CARICO', giorno: '2026-03-03', quantita: 100 })
    const s = await scarico(az, '2026-03-10', 250)
    const avvisi = await abbina(az, s)
    expect(avvisi).toEqual([
      "Lo scarico è coperto dai carichi in stoccaggio R13 solo per 200 kg: completa l'abbinamento da Giacenze → Abbinamenti.",
    ])
    const somma = (await righeDi(az)).reduce((x, r) => x + Number(r.quantita), 0)
    expect(somma).toBe(200)
  })

  it('fuori ambito: nessun carico di stoccaggio, nessuna riga e nessun avviso', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100, 'R1')
    const s = await scarico(az, '2026-03-10', 10)
    expect(await abbina(az, s)).toEqual([])
    expect(await righeDi(az)).toHaveLength(0)
  })

  it('classe indeterminata con due classi: nessuna riga e avviso', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100, 'R13')
    await carico(az, '2026-03-02', 100, 'D15')
    // ALTRO_SCARICO: nessuna operazione R/D nella causale e nessun operationCode
    const s = await scarico(az, '2026-03-10', 10, { causale: 'ALTRO_SCARICO' })
    expect(await abbina(az, s)).toEqual([
      "Il rifiuto è in stoccaggio sia R13 sia D15: indica l'abbinamento a mano (Giacenze → Abbinamenti).",
    ])
    expect(await righeDi(az)).toHaveLength(0)
  })

  it('retrodatato non tocca le righe esistenti', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const c2 = await carico(az, '2026-03-20', 100)
    const sTardo = await scarico(az, '2026-03-25', 150)
    await abbina(az, sTardo)
    const prima = (await righeDi(az)).map(r => [r.id, r.caricoId, Number(r.quantita)])
    expect(prima).toHaveLength(2)
    expect(prima.map(p => [p[1], p[2]]).sort()).toEqual(
      [
        [c1, 100],
        [c2, 50],
      ].sort()
    )
    // scarico retrodatato al 05/03: C1 e' tutto preso dallo scarico tardo e C2 e' successivo,
    // quindi non trova nulla e non ruba niente agli altri
    const sPresto = await scarico(az, '2026-03-05', 10)
    const avvisi = await abbina(az, sPresto)
    expect(avvisi).toHaveLength(1)
    const dopo = (await righeDi(az)).map(r => [r.id, r.caricoId, Number(r.quantita)])
    expect(dopo).toEqual(prima)
  })

  it('giacenza iniziale in ambito a una classe, usata per prima se piu vecchia', async () => {
    const az = await azienda()
    const g = await owner.giacenzaIniziale.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        cerCode: CER,
        quantita: 30,
        unita: 'KG',
        dataRiferimento: new Date('2026-01-01'),
        impostatoDa: randomUUID(),
      },
    })
    const c1 = await carico(az, '2026-03-01', 100)
    const s = await scarico(az, '2026-03-10', 50)
    await abbina(az, s)
    const righe = await righeDi(az)
    expect(righe.map(r => [r.giacenzaInizialeId, r.caricoId, Number(r.quantita)]).sort()).toEqual(
      [
        [g.id, null, 30],
        [null, c1, 20],
      ].sort()
    )
  })

  it('salvaAbbinamentoManuale sostituisce le righe con MANUALE e scrive l audit', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100)
    const c2 = await carico(az, '2026-03-02', 100)
    const s = await scarico(az, '2026-03-10', 80)
    await abbina(az, s)
    const esito = await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s,
        userId,
        righe: [{ caricoId: c2, quantita: 80 }],
      })
    )
    expect(esito.avvisi).toEqual([])
    const righe = await righeDi(az)
    expect(righe.map(r => [r.caricoId, Number(r.quantita), r.origine])).toEqual([
      [c2, 80, 'MANUALE'],
    ])
    const audit = await owner.activityLog.findMany({
      where: { tenantId: az.tenantId, action: 'ABBINAMENTO_SCARICO_MODIFICATO' },
    })
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('salvaAbbinamentoManuale: errori di validazione -> 400, righe invariate; elenco vuoto scollega', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const s = await scarico(az, '2026-03-10', 50)
    await abbina(az, s)
    const prima = await righeDi(az)
    await expect(
      inTx(az, tx =>
        salvaAbbinamentoManuale(tx, {
          tenantId: az.tenantId,
          scaricoRadiceId: s,
          userId,
          righe: [{ caricoId: c1, quantita: 70 }],
        })
      )
    ).rejects.toThrow(BadRequestException)
    expect((await righeDi(az)).map(r => r.id)).toEqual(prima.map(r => r.id))
    await expect(
      inTx(az, tx =>
        salvaAbbinamentoManuale(tx, {
          tenantId: az.tenantId,
          scaricoRadiceId: randomUUID(),
          userId,
          righe: [],
        })
      )
    ).rejects.toThrow(NotFoundException)
    const vuoto = await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s,
        userId,
        righe: [],
      })
    )
    expect(vuoto.avvisi).toEqual(['Lo scarico resta senza abbinamento.'])
    expect(await righeDi(az)).toHaveLength(0)
  })

  it('ricalcolo NON_ABBINATI riempie solo gli scarichi senza righe', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100)
    await carico(az, '2026-03-02', 100)
    const s1 = await scarico(az, '2026-03-10', 40)
    const s2 = await scarico(az, '2026-03-11', 30)
    await abbina(az, s1)
    const prima = await righeDi(az)
    const esito = await inTx(az, tx =>
      ricalcolaAbbinamenti(tx, {
        tenantId: az.tenantId,
        registroId: az.registroId,
        modalita: 'NON_ABBINATI',
        userId,
      })
    )
    expect(esito).toMatchObject({ scarichiAbbinati: 1, righeScritte: 1, righeCancellate: 0 })
    const dopo = await righeDi(az)
    expect(dopo).toHaveLength(prima.length + 1)
    expect(dopo.filter(r => r.scaricoId === s2).map(r => Number(r.quantita))).toEqual([30])
  })

  it('ricalcolo AUTOMATICI tiene le MANUALE, rifa le altre e conta; un solo audit', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    await carico(az, '2026-03-02', 100)
    const s1 = await scarico(az, '2026-03-10', 40)
    const s2 = await scarico(az, '2026-03-11', 30)
    await abbina(az, s1)
    await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s2,
        userId,
        righe: [{ caricoId: c1, quantita: 30 }],
      })
    )
    const esito = await inTx(az, tx =>
      ricalcolaAbbinamenti(tx, {
        tenantId: az.tenantId,
        registroId: az.registroId,
        modalita: 'AUTOMATICI',
        userId,
      })
    )
    expect(esito).toMatchObject({ scarichiAbbinati: 1, righeScritte: 1, righeCancellate: 1 })
    const righe = await righeDi(az)
    const manuale = righe.filter(r => r.origine === 'MANUALE')
    expect(manuale.map(r => [r.scaricoId, r.caricoId, Number(r.quantita)])).toEqual([[s2, c1, 30]])
    // s1 rifatto sul residuo: C1 ha 70 liberi -> 40 da C1
    const auto = righe.filter(r => r.origine === 'AUTOMATICO')
    expect(auto.map(r => [r.scaricoId, r.caricoId, Number(r.quantita)])).toEqual([[s1, c1, 40]])
    const audit = await owner.activityLog.findMany({
      where: { tenantId: az.tenantId, action: 'ABBINAMENTI_RICALCOLATI' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({ righeScritte: 1, righeCancellate: 1 })
  })

  const annullaScarico = (az: Az, id: string) =>
    nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'inserito per errore',
      })
    )

  const ricalcola = (az: Az, modalita: 'NON_ABBINATI' | 'AUTOMATICI') =>
    inTx(az, tx =>
      ricalcolaAbbinamenti(tx, {
        tenantId: az.tenantId,
        registroId: az.registroId,
        modalita,
        userId,
      })
    )
  const coppie = async (az: Az) =>
    (await righeDi(az))
      .map(
        r =>
          `${r.scaricoId}|${r.caricoId ?? r.giacenzaInizialeId}|${Number(r.quantita)}|${r.origine}`
      )
      .sort()

  it('AUTOMATICI con una riga MANUALE parziale: non lancia e le righe di quello scarico restano identiche', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const s = await scarico(az, '2026-03-10', 30)
    const sAuto = await scarico(az, '2026-03-11', 20)
    const manuale = await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s,
        userId,
        righe: [{ caricoId: c1, quantita: 10 }],
      })
    )
    expect(manuale.avvisi).toHaveLength(1)
    const prima = (await righeDi(az)).filter(r => r.scaricoId === s).map(r => r.id)
    const esito = await ricalcola(az, 'AUTOMATICI')
    expect(esito.righeScritte).toBe(1)
    const dopo = (await righeDi(az)).filter(r => r.scaricoId === s)
    expect(dopo.map(r => r.id)).toEqual(prima)
    expect(dopo.map(r => [Number(r.quantita), r.origine])).toEqual([[10, 'MANUALE']])
    // l'altro scarico e' stato abbinato sul residuo (90)
    const altro = (await righeDi(az)).filter(r => r.scaricoId === sAuto)
    expect(altro.map(r => Number(r.quantita))).toEqual([20])
  })

  it('una riga morta non blocca la capacita e si pulisce solo in AUTOMATICI', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const sMorto = await scarico(az, '2026-03-10', 100)
    // l'annullamento libera le righe: la riga morta si inserisce dopo, a mano
    await annullaScarico(az, sMorto)
    const morta = await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: sMorto,
        caricoId: c1,
        famiglia: 'KG',
        quantita: 100,
        origine: 'AUTOMATICO',
      },
    })
    const s2 = await scarico(az, '2026-03-12', 60)
    expect(await abbina(az, s2)).toEqual([])
    expect(
      (await righeDi(az)).filter(r => r.scaricoId === s2).map(r => Number(r.quantita))
    ).toEqual([60])
    await ricalcola(az, 'NON_ABBINATI')
    expect(await owner.abbinamentoCaricoScarico.count({ where: { id: morta.id } })).toBe(1)
    const esito = await ricalcola(az, 'AUTOMATICI')
    expect(esito.righeCancellate).toBeGreaterThanOrEqual(2)
    expect(await owner.abbinamentoCaricoScarico.count({ where: { id: morta.id } })).toBe(0)
    expect((await righeDi(az)).map(r => Number(r.quantita))).toEqual([60])
  })

  it('NON_ABBINATI: uno scarico vigente con sole righe morte viene riabbinato (la morta resta)', async () => {
    const az = await azienda()
    const c0 = await carico(az, '2026-03-01', 50)
    await annullaScarico(az, c0)
    const c1 = await carico(az, '2026-03-02', 100)
    const s = await scarico(az, '2026-03-10', 30)
    const morta = await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: s,
        caricoId: c0,
        famiglia: 'KG',
        quantita: 30,
        origine: 'AUTOMATICO',
      },
    })
    const esito = await ricalcola(az, 'NON_ABBINATI')
    expect(esito.righeScritte).toBe(1)
    const righe = await righeDi(az)
    expect(
      righe.filter(r => r.id !== morta.id).map(r => [r.scaricoId, r.caricoId, Number(r.quantita)])
    ).toEqual([[s, c1, 30]])
    expect(await owner.abbinamentoCaricoScarico.count({ where: { id: morta.id } })).toBe(1)
  })

  it('AUTOMATICI: la riga AUTOMATICO morta di uno scarico intoccabile si cancella, la MANUALE resta', async () => {
    const az = await azienda()
    const c0 = await carico(az, '2026-03-01', 50)
    await annullaScarico(az, c0)
    const c1 = await carico(az, '2026-03-02', 100)
    const s = await scarico(az, '2026-03-10', 30)
    await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s,
        userId,
        righe: [{ caricoId: c1, quantita: 10 }],
      })
    )
    const manuale = (await righeDi(az)).filter(r => r.scaricoId === s)
    const morta = await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: s,
        caricoId: c0,
        famiglia: 'KG',
        quantita: 5,
        origine: 'AUTOMATICO',
      },
    })
    await ricalcola(az, 'AUTOMATICI')
    expect(await owner.abbinamentoCaricoScarico.count({ where: { id: morta.id } })).toBe(0)
    const dopo = (await righeDi(az)).filter(r => r.scaricoId === s)
    expect(dopo.map(r => r.id)).toEqual(manuale.map(r => r.id))
    expect(dopo.map(r => r.origine)).toEqual(['MANUALE'])
  })

  it('AUTOMATICI: uno scarico a classe indeterminata e intoccabile, le sue righe restano', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100, 'R13')
    await carico(az, '2026-03-02', 100, 'D15')
    const s = await scarico(az, '2026-03-10', 10, { causale: 'ALTRO_SCARICO' })
    const riga = await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: s,
        caricoId: c1,
        famiglia: 'KG',
        quantita: 10,
        origine: 'AUTOMATICO',
      },
    })
    const esito = await ricalcola(az, 'AUTOMATICI')
    expect(esito.righeCancellate).toBe(0)
    expect(esito.righeScritte).toBe(0)
    expect((await righeDi(az)).map(r => r.id)).toEqual([riga.id])
  })

  it('override: una riga morta nell ambito non blocca il residuo', async () => {
    const az = await azienda()
    const c1 = await carico(az, '2026-03-01', 100)
    const sMorto = await scarico(az, '2026-03-10', 100)
    await annullaScarico(az, sMorto)
    await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: sMorto,
        caricoId: c1,
        famiglia: 'KG',
        quantita: 100,
        origine: 'AUTOMATICO',
      },
    })
    const s2 = await scarico(az, '2026-03-12', 80)
    await inTx(az, tx =>
      salvaAbbinamentoManuale(tx, {
        tenantId: az.tenantId,
        scaricoRadiceId: s2,
        userId,
        righe: [{ caricoId: c1, quantita: 80 }],
      })
    )
    expect(
      (await righeDi(az)).filter(r => r.scaricoId === s2).map(r => [Number(r.quantita), r.origine])
    ).toEqual([[80, 'MANUALE']])
  })

  it('idempotenza: due ricalcoli di fila', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100)
    await carico(az, '2026-03-02', 100)
    await scarico(az, '2026-03-10', 40)
    await scarico(az, '2026-03-11', 90)
    const primo = await ricalcola(az, 'NON_ABBINATI')
    expect(primo.righeScritte).toBeGreaterThan(0)
    const dopoPrimo = await coppie(az)
    const secondo = await ricalcola(az, 'NON_ABBINATI')
    expect(secondo.righeScritte).toBe(0)
    expect(await coppie(az)).toEqual(dopoPrimo)
    const a1 = await ricalcola(az, 'AUTOMATICI')
    const dopoA1 = await coppie(az)
    const a2 = await ricalcola(az, 'AUTOMATICI')
    expect(a2.righeScritte).toBe(a1.righeScritte)
    expect(await coppie(az)).toEqual(dopoA1)
    expect(dopoA1).toEqual(dopoPrimo)
  })

  it('avviso dedicato quando la classe dello scarico non ha carichi', async () => {
    const az = await azienda()
    await carico(az, '2026-03-01', 100, 'R13')
    const s = await scarico(az, '2026-03-10', 10, { causale: 'AVVIO_SMALTIMENTO' })
    expect(await abbina(az, s)).toEqual([
      "Nessun carico in stoccaggio D15 è disponibile per questo scarico: completa l'abbinamento da Giacenze → Abbinamenti.",
    ])
  })

  it('bloccaAmbiti prende i lock senza errori con CER ripetuti e in formati diversi', async () => {
    const az = await azienda()
    await inTx(az, tx => bloccaAmbiti(tx, az.registroId, ['99 99 13', '999913', '99 99 13*']))
  })
})
