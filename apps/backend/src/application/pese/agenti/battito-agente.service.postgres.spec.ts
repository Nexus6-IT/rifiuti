/** Battito dell'agente contro un Postgres reale, COME `wasteflow_app` (RLS). */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import {
  creaAgenteAttivoDiProva,
  creaAziendaPesaDiProva,
  creaStrumentoDiProva,
} from '../../../test-support/agenti-pesa-di-test'
import {
  BattitoAgenteService,
  MS_MINIMI_TRA_SCRITTURE,
  type DatiBattito,
} from './battito-agente.service'

describe('BattitoAgenteService (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })
  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect()])
  })

  async function scenario(simulazione = false) {
    const a = await creaAziendaPesaDiProva(owner, { simulazione })
    tenantCreati.push(a.tenantId)
    const agente = await creaAgenteAttivoDiProva(owner, a)
    const strumento = await creaStrumentoDiProva(owner, a, { agenteId: agente.id })
    return { a, agente, strumento, ref: { id: agente.id, tenantId: a.tenantId } }
  }
  const dati = (strumentoId: string, extra: Partial<DatiBattito> = {}): DatiBattito => ({
    versione: '1.2.3',
    oraAgente: new Date().toISOString(),
    codaInAttesa: 4,
    lettureScartate: 1,
    ultimaSequenza: 41,
    strumenti: [{ strumentoId, stato: 'OK' }],
    ...extra,
  })
  const riga = (id: string) => owner.agentePesa.findUniqueOrThrow({ where: { id } })

  it('primo battito: aggiorna le colonne e lo scarto dell’orologio (agente avanti di 90 s → 90.000)', async () => {
    const s = await scenario(true)
    const servizio = new BattitoAgenteService(app)
    const ricezione = new Date()
    const r = await servizio.registra(
      s.ref,
      dati(s.strumento, { oraAgente: new Date(ricezione.getTime() + 90_000).toISOString() }),
      '10.1.2.3',
      ricezione
    )

    expect(r).toMatchObject({ simulazioneAmmessa: true, revocato: false })
    expect(new Date(r.oraServer).toISOString()).toBe(r.oraServer)
    const a = await riga(s.agente.id)
    expect(a).toMatchObject({
      ultimoIp: '10.1.2.3',
      versioneAgente: '1.2.3',
      scartoOrologioMs: 90_000,
      codaInAttesa: 4,
      lettureScartate: 1,
      ultimaSequenza: 41n,
    })
    expect(a.ultimoContattoIl?.getTime()).toBe(ricezione.getTime())
  })

  it('secondo battito dopo 10 s: nessuna scrittura, ma lo stato degli strumenti si aggiorna in memoria', async () => {
    const s = await scenario()
    const servizio = new BattitoAgenteService(app)
    let t = 1_000_000
    servizio.orologio = () => t
    const primo = new Date()
    await servizio.registra(s.ref, dati(s.strumento), '10.0.0.1', primo)
    const spia = jest.spyOn(app.agentePesa, 'updateMany')

    t += 10_000
    await servizio.registra(
      s.ref,
      dati(s.strumento, {
        codaInAttesa: 99,
        strumenti: [{ strumentoId: s.strumento, stato: 'ERRORE', ultimoErrore: 'porta chiusa' }],
      }),
      '10.0.0.1',
      new Date(primo.getTime() + 10_000)
    )

    expect(spia).not.toHaveBeenCalled()
    expect((await riga(s.agente.id)).codaInAttesa).toBe(4)
    expect(servizio.statoStrumenti(s.agente.id).get(s.strumento)).toEqual({
      stato: 'ERRORE',
      ultimoErrore: 'porta chiusa',
    })

    t += MS_MINIMI_TRA_SCRITTURE
    await servizio.registra(s.ref, dati(s.strumento, { codaInAttesa: 7 }), '10.0.0.1', new Date())
    expect((await riga(s.agente.id)).codaInAttesa).toBe(7)
    spia.mockRestore()
  })

  it('l’ultima sequenza non regredisce con un battito in ritardo', async () => {
    const s = await scenario()
    const servizio = new BattitoAgenteService(app)
    let t = 0
    servizio.orologio = () => (t += MS_MINIMI_TRA_SCRITTURE)
    await servizio.registra(s.ref, dati(s.strumento, { ultimaSequenza: 50 }), null, new Date())
    await servizio.registra(s.ref, dati(s.strumento, { ultimaSequenza: 30 }), null, new Date())
    expect((await riga(s.agente.id)).ultimaSequenza).toBe(50n)
  })
})
