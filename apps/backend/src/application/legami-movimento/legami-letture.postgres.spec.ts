/**
 * Letture del legame per l'API (Task 22): `dettaglio` (con `candidati` e il dettaglio del cliente
 * disattivato del FIR) e `perMovimento` (movimento qualunque della catena), contro un Postgres
 * reale come `wasteflow_app`. Pulizia per id esatti.
 */
import { HttpException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL += `&application_name=legami-t22-${process.pid}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { LegamiService } from './conferma-legame.service'
import { PropostaLegameService } from './proposta-legame.service'

describe('LegamiService: letture per l`API (dettaglio, perMovimento) — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: LegamiService
  const tenantCreati: string[] = []
  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new LegamiService(app, new PropostaLegameService(app))
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  async function scenario(): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV: 1,
      onTenantCreato: id => tenantCreati.push(id),
    })
    await owner.impostazioneFatturazione.create({
      data: { tenantId: s.tenantId, fatturazioneDa: new Date('2026-01-01T00:00:00Z') },
    })
    return s
  }

  async function errore(p: Promise<unknown>): Promise<{ status: number; body: any }> {
    try {
      await p
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() }
      throw e
    }
    throw new Error('attesa un`eccezione')
  }

  it('dettaglio: la vista del legame piu` i candidati (contratti, elenchi, righe) per le scelte', async () => {
    const s = await scenario()
    const l = await creaLegameDiTest(owner, s.tenantId, {
      movimentoOriginaleId: s.movimentoId,
      registroId: s.registroId,
      verso: 'CARICO',
      stato: 'PROPOSTO',
      clienteId: s.clienteId,
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: '2' }],
    })
    const v = await nel(s.tenantId, () => service.dettaglio(s.tenantId, l.legameId))
    expect(v.id).toBe(l.legameId)
    expect(v.stato).toBe('PROPOSTO')
    expect(v.cliente?.id).toBe(s.clienteId)
    expect(v.righe).toHaveLength(1)
    expect(v.candidati?.contratti.map(c => c.id)).toContain(s.contrattoId)
    expect(v.candidati?.elenchi.map(c => c.id)).toContain(s.elencoId)
    expect(v.candidati?.righe.map(c => c.id)).toEqual(expect.arrayContaining([s.rigaCerId]))
  })

  it('dettaglio: un legame fatturato non porta candidati (nessuna scelta possibile)', async () => {
    const s = await scenario()
    const l = await creaLegameDiTest(owner, s.tenantId, {
      movimentoOriginaleId: s.movimentoId,
      registroId: s.registroId,
      verso: 'CARICO',
      stato: 'FATTURATO',
      clienteId: s.clienteId,
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: '2' }],
    })
    const v = await nel(s.tenantId, () => service.dettaglio(s.tenantId, l.legameId))
    expect(v.stato).toBe('FATTURATO')
    expect(v.candidati).toBeUndefined()
  })

  it('dettaglio (m6): senza cliente e col cliente del FIR disattivato dice «cliente disattivato»', async () => {
    const s = await scenario()
    const l = await creaLegameDiTest(owner, s.tenantId, {
      movimentoOriginaleId: s.movimentoId,
      registroId: s.registroId,
      verso: 'CARICO',
      stato: 'DA_COLLEGARE',
    })
    await owner.$executeRaw`UPDATE legami_movimento SET motivi = ARRAY['SENZA_CLIENTE'] WHERE id = ${l.legameId}::uuid`
    const prima = await nel(s.tenantId, () => service.dettaglio(s.tenantId, l.legameId))
    expect(prima.cliente).toBeNull()
    expect(prima.dettaglioCliente).toBeNull()
    await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
    const dopo = await nel(s.tenantId, () => service.dettaglio(s.tenantId, l.legameId))
    expect(dopo.cliente).toBeNull()
    expect(dopo.dettaglioCliente).toBe('cliente disattivato')
  })

  it('dettaglio: id inesistente o di un`altra azienda = 404 LEGAME_MOVIMENTO_NON_TROVATO', async () => {
    const s = await scenario()
    const altra = await scenario()
    const l = await creaLegameDiTest(owner, altra.tenantId, {
      movimentoOriginaleId: altra.movimentoId,
      registroId: altra.registroId,
      verso: 'CARICO',
    })
    for (const id of [l.legameId, '00000000-0000-4000-8000-000000000000', 'non-un-uuid']) {
      const e = await errore(nel(s.tenantId, () => service.dettaglio(s.tenantId, id)))
      expect([e.status, e.body.error]).toEqual([404, 'LEGAME_MOVIMENTO_NON_TROVATO'])
    }
  })

  it('perMovimento: trova il legame dalla radice e da un movimento successivo della catena', async () => {
    const s = await scenario()
    const l = await creaLegameDiTest(owner, s.tenantId, {
      movimentoOriginaleId: s.movimentoId,
      registroId: s.registroId,
      verso: 'CARICO',
      stato: 'PROPOSTO',
      clienteId: s.clienteId,
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: '2' }],
    })
    const rettifica = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: s.registroId,
        progressiveYear: 2026,
        progressiveNumber: 900,
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantity: '90',
        unit: 'KG',
        tipoAnnotazione: 'RETTIFICA',
        movimentoOriginaleId: s.movimentoId,
        motivoAnnotazione: 'correzione di prova',
        movimentoRettificatoId: s.movimentoId,
      },
    })
    for (const id of [s.movimentoId, rettifica.id]) {
      const v = await nel(s.tenantId, () => service.perMovimento(s.tenantId, id))
      expect(v.id).toBe(l.legameId)
    }
  })

  it('perMovimento: catena senza legame, movimento altrui o id non valido = 404', async () => {
    const s = await scenario()
    const altra = await scenario()
    const senza = await creaMovimentoDiTest(owner, s.tenantId, { movementDate: '2026-03-05' })
    const casi = [senza.movimentoId, altra.movimentoId, '00000000-0000-4000-8000-000000000000', 'x']
    for (const id of casi) {
      const e = await errore(nel(s.tenantId, () => service.perMovimento(s.tenantId, id)))
      expect([e.status, e.body.error]).toEqual([404, 'LEGAME_MOVIMENTO_NON_TROVATO'])
    }
  })
})
