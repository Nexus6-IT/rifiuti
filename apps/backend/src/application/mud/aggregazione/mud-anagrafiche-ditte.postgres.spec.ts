/**
 * MUD e contratti che leggono le anagrafiche da ditta e sede (F2-10, Task 3b-1, I2/I7) contro un
 * Postgres reale, collegato COME `wasteflow_app`, dentro il `TenantContext`.
 *
 * Il caso importante e' la ditta con nome divergente: la riga di ruolo si chiama in un modo, la
 * ditta in un altro. Il MUD continua a usare il nome della RIGA DI RUOLO (I2), perche' le
 * integrazioni salvate sono agganciate alla chiave di quel nome; i contratti, invece, mostrano il
 * nome attuale della ditta (D10).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_OMOCODICO,
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'
import { ContractService } from '../../contracts/contract.service'
import { MudAggregazioneService } from './mud-aggregazione.service'
import { chiaveDestinatario } from './mud-integrazioni'

type Privati = {
  caricaDestinatari(
    tenantId: string,
    ids: string[]
  ): Promise<
    Map<
      string,
      { ragioneSociale: string; partitaIVA: string; via: string; istatProvincia?: string }
    >
  >
  caricaTrasportatori(
    tenantId: string,
    fir: Array<{ carrierId: string | null }>
  ): Promise<Map<string, { ragioneSociale: string; partitaIVA: string }>>
}

describe('MUD e contratti su ditte e sedi — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let mud: Privati
  let contratti: ContractService
  let tenantId: string

  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const referenceData = { findComuneByName: async () => ({ code: '058091' }) }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    mud = new MudAggregazioneService(
      app,
      referenceData as never,
      logger as never
    ) as unknown as Privati
    contratti = new ContractService(app, logger as never)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `MD${Date.now()}`.slice(-11),
        ragioneSociale: 'MUD ditte test SRL',
        country: 'IT',
      },
    })
    tenantId = t.id
  })

  afterAll(async () => {
    await owner.contract.deleteMany({ where: { tenantId } })
    await owner.produttore.deleteMany({ where: { tenantId } })
    await owner.trasportatore.deleteMany({ where: { tenantId } })
    await owner.destinatario.deleteMany({ where: { tenantId } })
    await owner.sedeDitta.deleteMany({ where: { tenantId } })
    await owner.ditta.deleteMany({ where: { tenantId } })
    await owner.tenant.deleteMany({ where: { id: tenantId } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  const nelTenant = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId }, async () => fn())

  it('destinatario: nome della riga di ruolo, integrazione ancora agganciata, CF ?? P.IVA, sede', async () => {
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Destinatario Storico SPA',
      partitaIva: partitaIvaValida(Date.now() + 21),
      codiceFiscale: CF_PERSONA_VALIDO,
      via: 'Via Vecchia',
    })
    // La ditta cambia nome (fusa con un'altra, nome divergente) e la sede cambia via
    await owner.ditta.update({ where: { id: d.dittaId }, data: { ragioneSociale: 'Gruppo Nuovo' } })
    await owner.sedeDitta.update({ where: { id: d.sedeId }, data: { via: 'Via Sede Nuova' } })

    const info = await nelTenant(() => mud.caricaDestinatari(tenantId, [d.ruoloId]))
    const riga = info.get(d.ruoloId)

    expect(riga?.ragioneSociale).toBe('Destinatario Storico SPA')
    expect(riga?.partitaIVA).toBe(CF_PERSONA_VALIDO)
    expect(riga?.via).toBe('Via Sede Nuova')
    expect(riga?.istatProvincia).toBe('058')

    // Un'integrazione salvata con la chiave del nome di ruolo resta agganciata
    const integrazioni: Record<string, { nazione: string }> = {
      [chiaveDestinatario('Destinatario Storico SPA')]: { nazione: 'IT' },
    }
    expect(integrazioni[chiaveDestinatario(riga?.ragioneSociale ?? '')]).toBeDefined()
    expect(integrazioni[chiaveDestinatario('Gruppo Nuovo')]).toBeUndefined()
  })

  it('destinatario senza codice fiscale: il soggetto porta la P.IVA', async () => {
    const piva = partitaIvaValida(Date.now() + 22)
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', { partitaIva: piva })

    const info = await nelTenant(() => mud.caricaDestinatari(tenantId, [d.ruoloId]))

    expect(info.get(d.ruoloId)?.partitaIVA).toBe(piva)
  })

  it('trasportatore: nome della riga di ruolo, CF ?? P.IVA', async () => {
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Storici SRL',
      partitaIva: partitaIvaValida(Date.now() + 23),
      codiceFiscale: CF_PERSONA_OMOCODICO,
      numeroDocumento: 'MI/123456',
    })
    await owner.ditta.update({ where: { id: t.dittaId }, data: { ragioneSociale: 'Altro Nome' } })

    const info = await nelTenant(() =>
      mud.caricaTrasportatori(tenantId, [{ carrierId: t.ruoloId }])
    )
    const riga = info.get(t.ruoloId)

    expect(riga?.ragioneSociale).toBe('Trasporti Storici SRL')
    expect(riga?.partitaIVA).toBe(CF_PERSONA_OMOCODICO)
  })

  it('contratto: se la ditta cambia nome la lista mostra il nome nuovo', async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore Prima',
      partitaIva: partitaIvaValida(Date.now() + 24),
    })
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Contratto',
      partitaIva: null,
      codiceFiscale: CF_PERSONA_ALTRO,
      numeroDocumento: 'MI/654321',
    })
    await owner.contract.create({
      data: {
        tenantId,
        contractNumber: `C-${Date.now()}`,
        producerId: p.ruoloId,
        counterpartyId: t.ruoloId,
        counterpartyType: 'TRANSPORTER',
        contractType: 'WASTE_TRANSPORT',
        pricingModel: 'FLAT_RATE',
        startDate: new Date(),
        cerCodes: [],
      },
    })
    await owner.ditta.update({
      where: { id: p.dittaId },
      data: { ragioneSociale: 'Produttore Dopo' },
    })

    const lista = await nelTenant(() => contratti.list(tenantId))

    expect(lista).toHaveLength(1)
    expect(lista[0].producer?.ragioneSociale).toBe('Produttore Dopo')
    // Una controparte con solo il codice fiscale: nessuna P.IVA, il CF e' disponibile
    expect(lista[0].counterparty).toMatchObject({
      ragioneSociale: 'Trasporti Contratto',
      partitaIVA: null,
      codiceFiscale: CF_PERSONA_ALTRO,
    })
  })
})
