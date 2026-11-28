/**
 * eREGI E7: `piuVecchiaNonConfermataPerRegistro` contro un Postgres reale, COME `wasteflow_app` (RLS)
 * dentro il `TenantContext`. Il proprietario prepara i dati.
 */
import { PrismaClient, type StatoTrasmissioneRentri } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import {
  scenarioEsportazioni,
  type ScenarioEsportazioni,
} from '../../../test-support/esportazioni-registro-di-prova'
import { piuVecchiaNonConfermataPerRegistro } from './limite-esportazione-mensile'

describe('piuVecchiaNonConfermataPerRegistro — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let progressivo = 0

  async function scenario(): Promise<ScenarioEsportazioni> {
    const s = await scenarioEsportazioni(owner)
    tenantCreati.push(s.tenantId)
    // L'invio automatico parte da molto tempo fa: le annotazioni senza riga contano come da trasmettere.
    await owner.registroRifiuti.update({
      where: { id: s.registroId },
      data: { invioRentriAutomaticoDal: new Date('2020-01-01T00:00:00Z') },
    })
    return s
  }

  async function movimento(s: ScenarioEsportazioni, data: string, stato?: StatoTrasmissioneRentri) {
    const m = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: s.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date(data),
        registrationDate: new Date(data),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
      } as never,
    })
    if (stato) {
      const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA'].includes(stato)
      await owner.movimentoTrasmissioneRentri.create({
        data: {
          tenantId: s.tenantId,
          movimentoId: m.id,
          registroId: s.registroId,
          tipo: 'CARICO',
          origine: 'MANUALE',
          stato,
          bloccatoInvio: bloccata,
          motivoBlocco: bloccata ? 'prova' : null,
          ...(stato === 'ATTESA_ESITO' ? { transazioneId: randomUUID() } : {}),
        } as never,
      })
    }
    return m
  }

  const leggi = (s: ScenarioEsportazioni) =>
    TenantContext.run({ tenantId: s.tenantId }, async () =>
      app.$transaction(tx => piuVecchiaNonConfermataPerRegistro(tx, s.tenantId))
    )

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('tutto confermato: nessuna annotazione non confermata', async () => {
    const s = await scenario()
    await movimento(s, '2026-01-10T10:00:00Z', 'TRASMESSA')
    await movimento(s, '2026-02-10T10:00:00Z', 'GIA_SU_RENTRI')
    expect((await leggi(s)).get(s.registroId)).toBeUndefined()
  })

  it('una riga rifiutata o incerta pesa con la sua data', async () => {
    const s = await scenario()
    await movimento(s, '2026-01-10T10:00:00Z', 'TRASMESSA')
    await movimento(s, '2026-03-05T10:00:00Z', 'RIFIUTATA')
    await movimento(s, '2026-02-05T10:00:00Z', 'INCERTA')
    expect((await leggi(s)).get(s.registroId)?.toISOString()).toBe('2026-02-05T10:00:00.000Z')
  })

  it('un annotazione senza riga di trasmissione conta come non confermata', async () => {
    const s = await scenario()
    await movimento(s, '2026-01-10T10:00:00Z', 'TRASMESSA')
    await movimento(s, '2026-02-20T10:00:00Z')
    expect((await leggi(s)).get(s.registroId)?.toISOString()).toBe('2026-02-20T10:00:00.000Z')
  })

  it('un invio in corso (IN_INVIO, ATTESA_ESITO) non e confermato: pesa con la sua data', async () => {
    const s = await scenario()
    await movimento(s, '2026-04-10T10:00:00Z', 'TRASMESSA')
    await movimento(s, '2026-03-15T10:00:00Z', 'ATTESA_ESITO')
    expect((await leggi(s)).get(s.registroId)?.toISOString()).toBe('2026-03-15T10:00:00.000Z')
  })

  it("una riga esclusa dall'invio e una NON_TRASMISSIBILE non fermano il limite", async () => {
    const s = await scenario()
    const esclusa = await movimento(s, '2026-01-10T10:00:00Z', 'DA_TRASMETTERE')
    await owner.movimentoTrasmissioneRentri.update({
      where: { movimentoId: esclusa.id },
      data: { esclusoIl: new Date(), motivoEsclusione: 'si trasmette dal portale' },
    })
    await movimento(s, '2026-02-10T10:00:00Z', 'NON_TRASMISSIBILE')
    expect((await leggi(s)).get(s.registroId)).toBeUndefined()
    // Una rifiutata (si puo ritrasmettere) continua invece a pesare.
    await movimento(s, '2026-03-10T10:00:00Z', 'RIFIUTATA')
    expect((await leggi(s)).get(s.registroId)?.toISOString()).toBe('2026-03-10T10:00:00.000Z')
  })

  it('un altra azienda non vede i registri di questa (RLS)', async () => {
    const a = await scenario()
    const b = await scenario()
    await movimento(a, '2026-02-20T10:00:00Z', 'RIFIUTATA')
    const dalB = await leggi(b)
    expect(dalB.has(a.registroId)).toBe(false)
  })
})
