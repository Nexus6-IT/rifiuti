/**
 * Servizio degli abbinamenti (4.6, Task 8) contro un Postgres reale, COME `wasteflow_app` dentro
 * il `TenantContext`. I dati si costruiscono con i casi d'uso veri; la pulizia e' per id esatti.
 */
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
import { RegistriService, RegistroNonTrovatoError } from '../registro/registri.service'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import { AbbinamentiService } from './abbinamenti.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('AbbinamentiService - Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 11'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let registra: RegistraMovimentoUseCase
  let servizio: AbbinamentiService
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  const utentiCreati: string[] = []
  let n = 0

  type Az = { tenantId: string; registroId: string; userId: string }
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `AS${suffisso}`,
        ragioneSociale: 'Servizio abbinamenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-abb-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `abb-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    utentiCreati.push(u.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001AS${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id, userId: u.id }
  }

  async function movimento(
    az: Az,
    o: { type: 'CARICO' | 'SCARICO'; giorno: string; quantita: number; op?: string }
  ): Promise<string> {
    const r = await nelTenant(az.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          az.tenantId,
          undefined as unknown as string,
          o.type,
          new Date(`${o.giorno}T10:00:00Z`),
          new Date(),
          o.type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO',
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
    return r.value.id
  }

  const vista = (az: Az, ruolo: 'ADMIN' | 'OPERATOR' | 'VIEWER' = 'ADMIN') =>
    nelTenant(az.tenantId, () => servizio.vista(az.tenantId, az.registroId, '2026-06-01', ruolo))

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    registra = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    servizio = new AbbinamentiService(app, registri, loggerStub as never)
    if ((await owner.cERCode.count({ where: { code: CER } })) === 0) cerCreati.push(CER)
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.abbinamentoCaricoScarico.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.registroProgressivoIniziale.deleteMany({
        where: { tenantId: { in: tenantCreati } },
      })
      await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      if (utentiCreati.length > 0)
        await owner.user.deleteMany({ where: { id: { in: utentiCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('vista: stati, residui, eta con `oggi` fisso e ruolo', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    await movimento(az, { type: 'CARICO', giorno: '2026-03-10', quantita: 100, op: 'R13' })
    await movimento(az, { type: 'SCARICO', giorno: '2026-03-20', quantita: 130 })
    const s2 = await movimento(az, { type: 'SCARICO', giorno: '2026-04-01', quantita: 50 })
    const c2 = (await vista(az)).ambiti[0].carichi[1].id
    await nelTenant(az.tenantId, () =>
      servizio.salvaManuale(az.tenantId, az.userId, s2, [{ caricoId: c2, quantita: 20 }])
    )
    const v = await vista(az, 'OPERATOR')
    expect(v).toMatchObject({
      registroId: az.registroId,
      oggi: '2026-06-01',
      puoModificare: true,
      puoRicalcolare: false,
    })
    expect(v.ambiti).toHaveLength(1)
    const a = v.ambiti[0]
    expect(a).toMatchObject({
      cerCode: '99 99 11',
      famiglia: 'KG',
      unita: 'kg',
      classi: ['R13'],
      differenzeFifo: 1,
    })
    expect(a.carichi.map(c => [c.abbinato, c.residuo, c.stato])).toEqual([
      [100, 0, 'ESAURITO'],
      [50, 50, 'APERTO'],
    ])
    // il secondo scarico e stato abbinato a mano solo in parte; scarichi dal piu recente
    expect(a.scarichi.map(s => [s.quantita, s.abbinato, s.stato])).toEqual([
      [50, 20, 'PARZIALE'],
      [130, 130, 'ABBINATO'],
    ])
    expect((await vista(az, 'VIEWER')).puoModificare).toBe(false)
    expect((await vista(az, 'ADMIN')).puoRicalcolare).toBe(true)
  })

  it('un carico con residuo ha eta in giorni; i registri ordinari non hanno ambiti', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    const v = await vista(az)
    expect(v.ambiti[0].carichi[0]).toMatchObject({ residuo: 100, etaGiorni: 92, stato: 'APERTO' })
    const az2 = await azienda()
    await movimento(az2, { type: 'CARICO', giorno: '2026-03-01', quantita: 100 })
    expect((await vista(az2)).ambiti).toEqual([])
  })

  it('override diverso dal FIFO: differenzeFifo 1, `differenze` elenca manuale contro FIFO, `proposta` esclude lo scarico', async () => {
    const az = await azienda()
    const c1 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-01',
      quantita: 100,
      op: 'R13',
    })
    const c2 = await movimento(az, {
      type: 'CARICO',
      giorno: '2026-03-10',
      quantita: 100,
      op: 'R13',
    })
    const s = await movimento(az, { type: 'SCARICO', giorno: '2026-03-20', quantita: 60 })
    const esito = await nelTenant(az.tenantId, () =>
      servizio.salvaManuale(az.tenantId, az.userId, s, [{ caricoId: c2, quantita: 60 }])
    )
    expect(esito.scarico).toMatchObject({ id: s, abbinato: 60, stato: 'ABBINATO' })
    expect(esito.scarico.righe.map(r => r.origine)).toEqual(['MANUALE'])

    const v = await vista(az)
    expect(v.ambiti[0].differenzeFifo).toBe(1)
    const dif = await nelTenant(az.tenantId, () => servizio.differenze(az.tenantId, az.registroId))
    expect(dif.map(d => [d.carico.id, d.persistita, d.fifo])).toEqual(
      [
        [c1, 0, 60],
        [c2, 60, 0],
      ].sort((x, y) => ((x[0] as string) < (y[0] as string) ? -1 : 1))
    )
    expect(dif[0].scarico.id).toBe(s)
    const filtrate = await nelTenant(az.tenantId, () =>
      servizio.differenze(az.tenantId, az.registroId, '99 99 12')
    )
    expect(filtrate).toEqual([])

    const p = await nelTenant(az.tenantId, () => servizio.proposta(az.tenantId, s))
    // con lo scarico escluso entrambi i carichi sono interi
    expect(p.candidati.map(c => [c.id, c.residuo])).toEqual([
      [c1, 100],
      [c2, 100],
    ])
    expect(p.proposta).toEqual([{ carico: expect.objectContaining({ id: c1 }), quantita: 60 }])
    expect(p.scoperto).toBe(0)
  })

  it('elenco vuoto: scollega e avvisa che il ricalcolo riabbina; il ricalcolo NON_ABBINATI lo riabbina', async () => {
    const az = await azienda()
    await movimento(az, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    const s = await movimento(az, { type: 'SCARICO', giorno: '2026-03-20', quantita: 60 })
    const esito = await nelTenant(az.tenantId, () =>
      servizio.salvaManuale(az.tenantId, az.userId, s, [])
    )
    expect(esito.scarico.stato).toBe('NON_ABBINATO')
    expect(esito.avvisi.join(' ')).toContain('riabbinerà')
    const r = await nelTenant(az.tenantId, () =>
      servizio.ricalcola(az.tenantId, az.userId, {
        registroId: az.registroId,
        modalita: 'NON_ABBINATI',
      })
    )
    expect(r.scarichiAbbinati).toBe(1)
    expect((await vista(az)).ambiti[0].scarichi[0].stato).toBe('ABBINATO')
  })

  it('scarico o registro di un altra azienda: 404', async () => {
    const a = await azienda()
    const b = await azienda()
    await movimento(a, { type: 'CARICO', giorno: '2026-03-01', quantita: 100, op: 'R13' })
    const s = await movimento(a, { type: 'SCARICO', giorno: '2026-03-20', quantita: 60 })
    await expect(nelTenant(b.tenantId, () => servizio.proposta(b.tenantId, s))).rejects.toThrow(
      'Scarico non trovato'
    )
    await expect(
      nelTenant(b.tenantId, () => servizio.salvaManuale(b.tenantId, b.userId, s, []))
    ).rejects.toThrow('Scarico non trovato')
    await expect(
      nelTenant(b.tenantId, () => servizio.vista(b.tenantId, a.registroId, '2026-06-01', 'ADMIN'))
    ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    await expect(
      nelTenant(b.tenantId, () => servizio.differenze(b.tenantId, a.registroId))
    ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
  })
})
