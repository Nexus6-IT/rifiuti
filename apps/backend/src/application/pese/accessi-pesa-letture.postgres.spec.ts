/**
 * Pesate dalle letture dello strumento (4.8b, D12-D14) contro un Postgres reale, COME
 * `wasteflow_app` (RLS ENABLE+FORCE, trigger veri). Il proprietario prepara aziende, agenti,
 * strumenti e letture firmate; la pulizia cancella SOLO le aziende create qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaAgenteAttivoDiProva,
  creaAziendaPesaDiProva,
  creaLetturaDiProva,
  creaStrumentoDiProva,
  type AgenteDiProva,
  type AziendaPesaDiProva,
} from '../../test-support/agenti-pesa-di-test'
import { RegistriService } from '../registro/registri.service'
import type { AperturaAccessoDati, UtentePesa } from './accessi-pesa.tipi'
import { AccessiPesaService } from './accessi-pesa.service'
import { AllegatiPesaService } from './allegati-pesa.service'
import { AutomezziService } from './automezzi.service'
import { CollegamentiAccessoService } from './collegamenti-accesso.service'
import {
  CollegamentoNonValidoError,
  FirNonTrovatoError,
  RegolaPesataError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { StrumentiPesaService } from './strumenti-pesa.service'

interface Scenario {
  a: AziendaPesaDiProva
  agente: AgenteDiProva
  strumento: string
}

describe('Accessi di pesa da letture dello strumento — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let accessi: AccessiPesaService
  let collegamenti: CollegamentiAccessoService
  const tenantCreati: string[] = []

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    accessi = new AccessiPesaService(
      app,
      new RegistriService(app, logger),
      new StrumentiPesaService(app),
      new AutomezziService(app),
      new AllegatiPesaService(app)
    )
    collegamenti = new CollegamentiAccessoService(app)
  })
  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect()])
  })

  async function scenario(simulazione = false): Promise<Scenario> {
    const a = await creaAziendaPesaDiProva(owner, { simulazione })
    tenantCreati.push(a.tenantId)
    const agente = await creaAgenteAttivoDiProva(owner, a)
    const strumento = await creaStrumentoDiProva(owner, a, { agenteId: agente.id })
    return { a, agente, strumento }
  }
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())
  const op = (s: Scenario): UtentePesa => ({ id: s.a.utenteId, ruolo: 'ADMIN' })
  const lettura = (s: Scenario, o: Parameters<typeof creaLetturaDiProva>[4] = {}) =>
    creaLetturaDiProva(owner, s.agente, s.a.tenantId, s.strumento, o)
  const apertura = (
    letturaId: string,
    extra: Partial<AperturaAccessoDati> = {}
  ): AperturaAccessoDati => ({
    chiaveIdempotenza: randomUUID(),
    verso: 'CARICO',
    modo: 'DOPPIA',
    pesata: { letturaId },
    ...extra,
  })
  const apri = (s: Scenario, d: AperturaAccessoDati) =>
    nelTenant(s.a.tenantId, () => accessi.apri(s.a.tenantId, op(s), d))
  const seconda = (s: Scenario, accessoId: string, letturaId: string) =>
    nelTenant(s.a.tenantId, () =>
      accessi.secondaPesata(s.a.tenantId, op(s), accessoId, {
        chiaveIdempotenza: randomUUID(),
        pesata: { letturaId },
      })
    )

  it('apertura DOPPIA con una lettura: pesata STRUMENTO con firma, alibi e ora della lettura, impronta p2 integra, firma valida', async () => {
    const s = await scenario()
    const ora = new Date(Date.now() - 120_000)
    const l = await lettura(s, { alibiId: 'AL-77', pesoKg: '24880.00', oraStrumento: ora })

    const v = await apri(s, apertura(l))

    expect(v.stato).toBe('APERTO')
    const p = v.pesate[0]
    expect(p).toMatchObject({
      fonte: 'STRUMENTO',
      pesoOriginaleKg: 24880,
      alibiId: 'AL-77',
      letturaId: l,
      firmaValida: true,
      integra: true,
    })
    expect(p.oraStrumento).toBe(ora.toISOString())
    const riga = await owner.pesata.findFirstOrThrow({ where: { letturaId: l } })
    expect(riga.impronta).toMatch(/^[0-9a-f]{64}$/)
    expect(riga.firmaAgente).toBeTruthy()
    expect(riga.motivoManuale).toBeNull()
    const audit = await owner.activityLog.findFirstOrThrow({
      where: { tenantId: s.a.tenantId, action: 'PESA_ACCESSO_APERTO' },
    })
    expect(audit.metadata).toMatchObject({ letturaId: l })
  })

  it('seconda pesata con un’altra lettura: accesso CHIUSO, netto DUE_PESATE, nessun avviso manuale', async () => {
    const s = await scenario()
    const l1 = await lettura(s, { pesoKg: '24880.00', oraAgente: new Date(Date.now() - 600_000) })
    const l2 = await lettura(s, { pesoKg: '12540.00', oraAgente: new Date(Date.now() - 60_000) })
    const v1 = await apri(s, apertura(l1))

    const v2 = await seconda(s, v1.id, l2)

    expect(v2.stato).toBe('CHIUSO')
    expect(v2.netto).toMatchObject({
      stato: 'CALCOLATO',
      nettoKg: 12340,
      qualita: 'DUE_PESATE',
      manuale: false,
      simulato: false,
    })
    expect(v2.avvisi.some(m => m.includes('a mano'))).toBe(false)
    expect(v2.pesate.every(p => p.firmaValida && p.integra)).toBe(true)
  })

  it('stessa lettura in due aperture parallele: una 201, l’altra 409; nessuna pesata doppia', async () => {
    const s = await scenario()
    const l = await lettura(s)
    const esiti = await Promise.allSettled([apri(s, apertura(l)), apri(s, apertura(l))])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const persa = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(persa.reason).toBeInstanceOf(StatoAccessoNonValidoError)
    expect(persa.reason.message).toContain('già stata usata')
    expect(await owner.pesata.count({ where: { letturaId: l } })).toBe(1)
  })

  it('lettura già usata in un altro accesso: 409; di un’altra azienda: 404', async () => {
    const s = await scenario()
    const l = await lettura(s)
    await apri(s, apertura(l))
    await expect(apri(s, apertura(l))).rejects.toBeInstanceOf(StatoAccessoNonValidoError)

    const altra = await scenario()
    const lAltrui = await lettura(altra)
    await expect(apri(s, apertura(lAltrui))).rejects.toThrow('Lettura non trovata.')
  })

  it('lettura di 25 ore prima: 422; seconda lettura più vecchia della prima: 422', async () => {
    const s = await scenario()
    const vecchia = await lettura(s, { oraAgente: new Date(Date.now() - 25 * 3600_000) })
    await expect(apri(s, apertura(vecchia))).rejects.toBeInstanceOf(RegolaPesataError)

    const l1 = await lettura(s, { oraAgente: new Date(Date.now() - 60_000) })
    const precedente = await lettura(s, { oraAgente: new Date(Date.now() - 600_000) })
    const v = await apri(s, apertura(l1))
    await expect(seconda(s, v.id, precedente)).rejects.toThrow(/successiva alla prima/)
  })

  it('lettura di uno strumento di un’altra sede: 422; strumento disattivato: 422', async () => {
    const s = await scenario()
    const altraSede = await owner.registroRifiuti.create({
      data: { tenantId: s.a.tenantId, descrizione: 'Registro B', codice: 'B' },
    })
    const strumentoB = await creaStrumentoDiProva(owner, s.a, {
      agenteId: s.agente.id,
      registroId: altraSede.id,
    })
    const lB = await creaLetturaDiProva(owner, s.agente, s.a.tenantId, strumentoB)
    await expect(apri(s, apertura(lB, { registroId: s.a.registroId }))).rejects.toThrow(
      /un’altra sede/
    )

    const l = await lettura(s)
    await owner.strumentoPesa.update({ where: { id: s.strumento }, data: { attivo: false } })
    await expect(apri(s, apertura(l, { registroId: s.a.registroId }))).rejects.toThrow(
      /non è attivo/
    )
  })

  it('lettura simulata con simulazione ammessa: fonte SIMULATA, netto simulato; permesso tolto: uso 422 e collegamento 422', async () => {
    const s = await scenario(true)
    const l1 = await lettura(s, { simulata: true, alibiId: 'SIM-1', pesoKg: '24880.00' })
    const l2 = await lettura(s, { simulata: true, alibiId: 'SIM-2', pesoKg: '12540.00' })
    const l3 = await lettura(s, { simulata: true, alibiId: 'SIM-3' })
    const v1 = await apri(s, apertura(l1))
    const v2 = await seconda(s, v1.id, l2)
    expect(v2.pesate.map(p => p.fonte)).toEqual(['SIMULATA', 'SIMULATA'])
    expect(v2.netto.simulato).toBe(true)
    expect(v2.netto.avvisi).toContain('Pesata simulata: non è un peso reale.')

    // con il permesso il collegamento supera il controllo (poi il FIR inesistente non si trova)
    await expect(
      nelTenant(s.a.tenantId, () =>
        collegamenti.collegaFir(s.a.tenantId, op(s), v2.id, randomUUID())
      )
    ).rejects.toBeInstanceOf(FirNonTrovatoError)

    await owner.tenant.update({
      where: { id: s.a.tenantId },
      data: { peseSimulazioneAmmessa: false },
    })
    await expect(apri(s, apertura(l3))).rejects.toThrow(/simulazione non è ammessa/)
    await expect(
      nelTenant(s.a.tenantId, () =>
        collegamenti.collegaFir(s.a.tenantId, op(s), v2.id, randomUUID())
      )
    ).rejects.toBeInstanceOf(CollegamentoNonValidoError)
    await expect(
      nelTenant(s.a.tenantId, () =>
        collegamenti.collegaMovimento(s.a.tenantId, op(s), v2.id, randomUUID())
      )
    ).rejects.toThrow('Accesso con pesate simulate: non si usa nei documenti.')
  })

  it('stessa chiaveIdempotenza dell’interfaccia due volte: giaRegistrata, una sola pesata', async () => {
    const s = await scenario()
    const l = await lettura(s)
    const d = apertura(l)
    const v1 = await apri(s, d)
    const v2 = await apri(s, d)
    expect(v2.giaRegistrata).toBe(true)
    expect(v2.id).toBe(v1.id)
    expect(await owner.pesata.count({ where: { letturaId: l } })).toBe(1)
  })

  it('una pesata manuale di 4.8a (senza lettura) resta accettata: payload invariato', async () => {
    const s = await scenario()
    const v = await apri(s, {
      chiaveIdempotenza: randomUUID(),
      verso: 'CARICO',
      modo: 'SINGOLA',
      pesata: {
        pesoKg: 8120,
        strumentoEsterno: 'Pesa del cliente',
        motivo: 'display guasto',
        stabileDichiarato: true,
      },
    })
    expect(v.pesate[0]).toMatchObject({ fonte: 'MANUALE', letturaId: null, firmaValida: null })
    expect(v.netto.manuale).toBe(true)
  })
})
