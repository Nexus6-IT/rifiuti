/**
 * Lettore dell'ambito degli abbinamenti (4.6, Task 4) contro un Postgres reale, COME
 * `wasteflow_app` dentro il `TenantContext`. I dati si costruiscono con i casi d'uso veri
 * (registrazione, rettifica, annullamento); il proprietario inserisce solo giacenze iniziali e
 * righe di abbinamento "sporche". Pulizia per id esatti.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
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
import { leggiAmbitiAbbinamento, radiceScarico, righeDelCarico } from './lettore-abbinamenti'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Lettore abbinamenti - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 11'
  const CER2 = '99 99 12'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0

  type Az = { tenantId: string; registroId: string }

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `LA${suffisso}`,
        ragioneSociale: 'Lettore abbinamenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001LA${String(++n).padStart(6, '0')}-MI0001`,
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
      unit?: string
      op?: string
      causale?: string
      cer?: string
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
          o.cer ?? CER,
          undefined,
          o.quantita,
          o.unit ?? 'KG',
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

  const rettifica = (az: Az, id: string, d: { giorno: string; quantita: number; op?: string }) =>
    nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'correzione',
        dati: {
          movementDate: new Date(`${d.giorno}T10:00:00Z`),
          causale: 'PRODUZIONE_INTERNA',
          cerCode: CER,
          quantity: d.quantita,
          unit: 'KG',
          operationCode: d.op,
        },
      })
    )

  const annulla = (az: Az, id: string) =>
    nelTenant(az.tenantId, () =>
      correggi.annulla({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: id,
        motivo: 'inserito per errore',
      })
    )

  const leggi = (az: Az, cer?: string) =>
    nelTenant(az.tenantId, () =>
      app.$transaction(tx =>
        leggiAmbitiAbbinamento(tx, az.tenantId, { registroId: az.registroId, cer })
      )
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
    for (const code of [CER, CER2]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
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
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('un ambito per CER e famiglia: kg e t insieme, i litri a parte', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    await movimento(az, { type: 'CARICO', giorno: '2026-03-02', quantita: 2, unit: 't', op: 'R13' })
    await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-03',
      quantita: 50,
      unit: 'L',
      op: 'R13',
    })
    const ambiti = await leggi(az)
    expect(ambiti.map(a => a.famiglia).sort()).toEqual(['KG', 'L'])
    const kg = ambiti.find(a => a.famiglia === 'KG')!
    expect(kg.unita).toBe('kg')
    expect(kg.carichi.map(c => c.evento.quantita).sort((a, b) => a - b)).toEqual([100, 2000])
    expect(kg.classi).toEqual(['R13'])
    expect(kg.diStoccaggio).toBe(true)
  })

  it('carico senza operazione R13/D15 escluso; senza stoccaggio diStoccaggio e false', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R1' })
    await movimento(az, { type: 'CARICO', giorno: '2026-03-02', quantita: 100 })
    const [a] = await leggi(az)
    expect(a.carichi).toHaveLength(0)
    expect(a.diStoccaggio).toBe(false)
  })

  it('testa vigente e radice: giorno e numero della testa, ordine e id della radice', async () => {
    const az = await azienda()
    const radice = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const prima = await owner.wasteMovement.findUniqueOrThrow({ where: { id: radice } })
    const esito = await rettifica(az, radice, { giorno: '2026-03-05', quantita: 80, op: 'R13' })
    const [a] = await leggi(az)
    expect(a.carichi).toHaveLength(1)
    const c = a.carichi[0]
    expect(c.chiave).toBe(`M:${radice}`)
    expect(c.evento.riferimento.id).toBe(radice)
    expect(c.evento.giorno).toBe('2026-03-05')
    expect(c.evento.quantita).toBe(80)
    expect(c.evento.ordine).toBe(prima.progressiveYear * 1e7 + prima.progressiveNumber)
    expect(c.numero).toBe(`${esito.movimento.progressiveNumber}/${esito.movimento.progressiveYear}`)
  })

  it('catena annullata esclusa (carico e scarico)', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    await annulla(az, s1)
    await annulla(az, c1)
    const [a] = await leggi(az)
    expect(a.carichi).toHaveLength(1)
    expect(a.scarichi).toHaveLength(0)
  })

  it('classe attesa dalla causale: AVVIO_SMALTIMENTO senza operationCode e D15', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'D15' })
    await movimento(az, {
      type: 'SCARICO',
      giorno: '2026-03-10',
      quantita: 10,
      causale: 'AVVIO_SMALTIMENTO',
    })
    const [a] = await leggi(az)
    expect(a.scarichi[0].classeAttesa).toBe('D15')
    expect(a.classi).toEqual(['D15'])
  })

  it('giacenze iniziali dell ambito con chiave A: e classe null; filtro per CER', async () => {
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
    await owner.giacenzaIniziale.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        cerCode: CER2,
        quantita: 5,
        unita: 'KG',
        dataRiferimento: new Date('2026-01-01'),
        impostatoDa: randomUUID(),
      },
    })
    const ambiti = await leggi(az, CER)
    expect(ambiti).toHaveLength(1)
    expect(ambiti[0].carichi.map(c => [c.chiave, c.classe])).toEqual([[`A:${g.id}`, null]])
    expect(ambiti[0].carichi[0].evento.origine).toBe('APERTURA')
  })

  it('righeIncoerenti: riga che punta a un carico la cui catena e annullata', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    const buona = await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: s1,
        caricoId: c1,
        famiglia: 'KG',
        quantita: 10,
        origine: 'AUTOMATICO',
      },
    })
    const [pulito] = await leggi(az)
    expect(pulito.righe).toHaveLength(1)
    expect(pulito.righeIncoerenti).toEqual([])
    // il carico viene annullato dopo l'abbinamento: la riga resta ma e incoerente
    await annullaInDeroga(c1)
    const [sporco] = await leggi(az)
    expect(sporco.righeIncoerenti).toEqual([{ id: buona.id, motivo: 'carico non più vigente' }])
  })

  it('radiceScarico: testa rettificata -> radice; carico -> null; altra azienda -> null', async () => {
    const az = await azienda()
    const altra = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    const rett = await nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: s1,
        motivo: 'correzione',
        dati: {
          movementDate: new Date('2026-03-11T10:00:00Z'),
          causale: 'AVVIO_RECUPERO',
          cerCode: CER,
          quantity: 12,
          unit: 'KG',
        },
      })
    )
    const carico = (
      await owner.wasteMovement.findFirstOrThrow({
        where: { tenantId: az.tenantId, type: 'CARICO' },
      })
    ).id
    const dal = (client: PrismaService, t: string, id: string) =>
      nelTenant(t, () => client.$transaction(tx => radiceScarico(tx, t, id)))
    expect(await dal(app, az.tenantId, rett.movimento.id)).toEqual({
      radiceId: s1,
      registroId: az.registroId,
      cerCode: CER,
    })
    expect(await dal(app, az.tenantId, carico)).toBeNull()
    expect(await dal(app, altra.tenantId, s1)).toBeNull()
  })

  it('righeDelCarico: scarichi che usano la radice del carico', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    await owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId: s1,
        caricoId: c1,
        famiglia: 'KG',
        quantita: 10,
        origine: 'MANUALE',
      },
    })
    const righe = await nelTenant(az.tenantId, () =>
      app.$transaction(tx => righeDelCarico(tx, az.tenantId, c1))
    )
    expect(righe).toHaveLength(1)
    expect(righe[0]).toMatchObject({
      scaricoRadiceId: s1,
      giornoScarico: '2026-03-10',
      quantita: 10,
      famiglia: 'KG',
    })
    expect(righe[0].numeroScarico).toMatch(/^\d+\/\d{4}$/)
  })

  const riga = (az: Az, scaricoId: string, caricoId: string, quantita: number) =>
    owner.abbinamentoCaricoScarico.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        scaricoId,
        caricoId,
        famiglia: 'KG',
        quantita,
        origine: 'AUTOMATICO',
      },
    })

  it('una riga morta non fa risultare incoerente una riga buona (somme solo sulle valide)', async () => {
    const az = await azienda()
    const c = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100 })
    const sBuono = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 60 })
    const sMorto = await movimento(az, { type: 'SCARICO', giorno: '2026-03-11', quantita: 60 })
    await riga(az, sBuono, c, 60)
    const morta = await riga(az, sMorto, c, 60)
    await annulla(az, sMorto)
    const [a] = await leggi(az)
    expect(a.righe).toHaveLength(2)
    expect(a.righeIncoerenti).toEqual([{ id: morta.id, motivo: 'scarico non più vigente' }])
  })

  it('righe con entrambi i capi fuori ambito non spariscono', async () => {
    const az = await azienda()
    // entrambe le catene annullate
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    const r1 = await riga(az, s1, c1, 10)
    await annulla(az, s1)
    await annullaInDeroga(c1)
    // carico non di stoccaggio + scarico annullato
    const c2 = await movimento(az, { type: 'CARICO', giorno: '2026-03-02', quantita: 100 })
    const s2 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-12', quantita: 5 })
    const r2 = await riga(az, s2, c2, 5)
    await annulla(az, s2)
    const [a] = await leggi(az)
    expect(a.righeIncoerenti).toEqual(
      expect.arrayContaining([
        { id: r1.id, motivo: 'scarico e carico non più vigenti' },
        { id: r2.id, motivo: 'scarico non più vigente' },
      ])
    )
    expect(a.righeIncoerenti).toHaveLength(2)
  })

  it('filtro per CER sui movimenti; motivi neutri con il filtro, esatti senza', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const c2 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
      cer: CER2,
    })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    const altroRifiuto = await riga(az, s1, c2, 10)
    const tutti = await leggi(az)
    expect(tutti.map(a => a.cerCode).sort()).toEqual([CER, CER2])
    const diCer = tutti.find(a => a.cerCode === CER)!
    expect(diCer.righeIncoerenti).toEqual([
      { id: altroRifiuto.id, motivo: 'carico di un altro rifiuto' },
    ])
    const filtrato = await leggi(az, CER)
    expect(filtrato).toHaveLength(1)
    expect(filtrato[0].cerCode).toBe(CER)
    expect(filtrato[0].carichi.map(c => c.chiave)).toEqual([`M:${c1}`])
    expect(filtrato[0].righeIncoerenti).toEqual([
      { id: altroRifiuto.id, motivo: 'carico non più vigente o di un altro rifiuto' },
    ])
  })

  it('righeDelCarico con scarico rettificato: numero e giorno della testa', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const s1 = await movimento(az, { type: 'SCARICO', giorno: '2026-03-10', quantita: 10 })
    await riga(az, s1, c1, 10)
    const rett = await nelTenant(az.tenantId, () =>
      correggi.rettifica({
        tenantId: az.tenantId,
        userId: undefined as unknown as string,
        movimentoId: s1,
        motivo: 'correzione',
        dati: {
          movementDate: new Date('2026-03-12T10:00:00Z'),
          causale: 'AVVIO_RECUPERO',
          cerCode: CER,
          quantity: 10,
          unit: 'KG',
        },
      })
    )
    const righe = await nelTenant(az.tenantId, () =>
      app.$transaction(tx => righeDelCarico(tx, az.tenantId, c1))
    )
    expect(righe).toHaveLength(1)
    expect(righe[0].scaricoRadiceId).toBe(s1)
    expect(righe[0].giornoScarico).toBe('2026-03-12')
    expect(righe[0].numeroScarico).toBe(
      `${rett.movimento.progressiveNumber}/${rett.movimento.progressiveYear}`
    )
  })

  /**
   * Annulla un carico che copre ancora uno scarico vigente: il caso d'uso lo rifiuta (il saldo
   * andrebbe negativo), quindi l'annotazione di annullamento si inserisce a mano, come un dato
   * storico incoerente.
   */
  async function annullaInDeroga(caricoId: string) {
    const c = await owner.wasteMovement.findUniqueOrThrow({ where: { id: caricoId } })
    await owner.wasteMovement.create({
      data: {
        tenantId: c.tenantId,
        registroId: c.registroId,
        progressiveYear: c.progressiveYear,
        progressiveNumber: c.progressiveNumber + 1000,
        type: c.type,
        movementDate: c.movementDate,
        registrationDate: c.registrationDate,
        causale: c.causale,
        cerCode: c.cerCode,
        quantity: c.quantity,
        unit: c.unit,
        tipoAnnotazione: 'ANNULLAMENTO',
        movimentoRettificatoId: c.id,
        movimentoOriginaleId: c.id,
        motivoAnnotazione: 'prova',
      },
    })
  }
})
