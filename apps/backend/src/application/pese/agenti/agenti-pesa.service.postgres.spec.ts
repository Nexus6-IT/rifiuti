/**
 * Gestione degli agenti e elenco delle letture contro un Postgres reale, COME `wasteflow_app`
 * (RLS). Il proprietario prepara i dati; la pulizia cancella SOLO le aziende create qui.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo, urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

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
import type { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'
import { hashSegreto, normalizzaCodice } from '../../../domain/pese/agenti/credenziali-agente'
import {
  creaAgenteAttivoDiProva,
  creaAziendaPesaDiProva,
  creaLetturaDiProva,
  creaStrumentoDiProva,
} from '../../../test-support/agenti-pesa-di-test'
import {
  AgentePesaNonTrovatoError,
  DatiPesaNonValidiError,
  RegolaPesataError,
  StatoAccessoNonValidoError,
} from '../errori-pese'
import { AbbinamentoAgenteService } from './abbinamento-agente.service'
import { AgentiPesaService } from './agenti-pesa.service'
import { BattitoAgenteService } from './battito-agente.service'
import { LetturePesaService } from './letture-pesa.service'
import { RisoluzioneAgenteService } from './risoluzione-agente.service'

describe('AgentiPesaService e LetturePesaService (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
    urlProprietario
  )
  let app: PrismaService
  let agenti: AgentiPesaService
  let letture: LetturePesaService
  let risoluzione: RisoluzioneAgenteService
  let abbinamento: AbbinamentoAgenteService
  const tenantCreati: string[] = []

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    agenti = new AgentiPesaService(app, new BattitoAgenteService(app))
    letture = new LetturePesaService(app)
    risoluzione = new RisoluzioneAgenteService(sistema as unknown as PrismaSistemaService)
    abbinamento = new AbbinamentoAgenteService(app, risoluzione)
  })
  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), sistema.$disconnect(), app.$disconnect()])
  })

  const azienda = async (simulazione = false) => {
    const a = await creaAziendaPesaDiProva(owner, { simulazione })
    tenantCreati.push(a.tenantId)
    return a
  }

  it('crea un agente: codice mostrato UNA volta, solo l’hash nel database, audit senza il codice', async () => {
    const a = await azienda()
    const r = await agenti.crea(a.tenantId, a.utenteId, {
      descrizione: '  PC pesa ingresso ',
      registroId: a.registroId,
    })

    expect(r.codice).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    expect(r.agente).toMatchObject({
      descrizione: 'PC pesa ingresso',
      stato: 'IN_ATTESA',
      inLinea: false,
    })
    expect(new Date(r.scadeIl).getTime()).toBeGreaterThan(Date.now())
    const riga = await owner.agentePesa.findUniqueOrThrow({ where: { id: r.agente.id } })
    expect(riga.codiceSha256).toBe(hashSegreto(normalizzaCodice(r.codice) as string))
    const audit = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'PESA_AGENTE_CREATO' },
    })
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit)).not.toContain(r.codice)
    // il codice appena creato abbina davvero un agente
    const ab = await abbinamento.abbina({
      codice: r.codice,
      chiavePubblica: (await import('../../../test-support/agenti-pesa-di-test')).coppiaChiavi()
        .pubblicaB64,
      nomeHost: 'PC',
      versione: '1',
    })
    expect(ab.agenteId).toBe(r.agente.id)
  })

  it('descrizione vuota 400; registro di un’altra azienda 404', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(agenti.crea(a.tenantId, a.utenteId, { descrizione: '  ' })).rejects.toBeInstanceOf(
      DatiPesaNonValidiError
    )
    await expect(
      agenti.crea(a.tenantId, a.utenteId, { descrizione: 'PC', registroId: b.registroId })
    ).rejects.toThrow()
  })

  it('nuovo codice: ok per IN_ATTESA (il vecchio non vale più), 409 per un agente ATTIVO', async () => {
    const a = await azienda()
    const c1 = await agenti.crea(a.tenantId, a.utenteId, { descrizione: 'PC' })
    const c2 = await agenti.nuovoCodice(a.tenantId, a.utenteId, c1.agente.id)
    expect(c2.codice).not.toBe(c1.codice)
    const riga = await owner.agentePesa.findUniqueOrThrow({ where: { id: c1.agente.id } })
    expect(riga.codiceSha256).toBe(hashSegreto(normalizzaCodice(c2.codice) as string))

    const attivo = await creaAgenteAttivoDiProva(owner, a)
    await expect(agenti.nuovoCodice(a.tenantId, a.utenteId, attivo.id)).rejects.toBeInstanceOf(
      StatoAccessoNonValidoError
    )
    await expect(
      agenti.nuovoCodice(a.tenantId, a.utenteId, '00000000-0000-4000-8000-000000000000')
    ).rejects.toBeInstanceOf(AgentePesaNonTrovatoError)
  })

  it('revoca: il token resta riconoscibile ma REVOCATO; seconda revoca 409; strumento a un revocato 422', async () => {
    const a = await azienda()
    const ag = await creaAgenteAttivoDiProva(owner, a)
    const strumento = await creaStrumentoDiProva(owner, a)

    const v = await agenti.revoca(a.tenantId, a.utenteId, ag.id, 'PC sostituito')
    expect(v).toMatchObject({ stato: 'REVOCATO', motivoRevoca: 'PC sostituito' })
    await expect(risoluzione.daToken(hashSegreto(ag.token))).resolves.toMatchObject({
      id: ag.id,
      stato: 'REVOCATO',
    })
    await expect(agenti.revoca(a.tenantId, a.utenteId, ag.id, 'ancora')).rejects.toBeInstanceOf(
      StatoAccessoNonValidoError
    )
    await expect(agenti.revoca(a.tenantId, a.utenteId, ag.id, ' ')).rejects.toBeInstanceOf(
      DatiPesaNonValidiError
    )
    await expect(
      agenti.assegnaStrumento(a.tenantId, a.utenteId, strumento, ag.id)
    ).rejects.toBeInstanceOf(RegolaPesataError)
    const audit = await owner.activityLog.count({
      where: { tenantId: a.tenantId, action: 'PESA_AGENTE_REVOCATO' },
    })
    expect(audit).toBe(1)
  })

  it('assegna e libera uno strumento; un agente di un’altra azienda è rifiutato; elenco con strumenti e impronta a gruppi', async () => {
    const a = await azienda()
    const b = await azienda()
    const ag = await creaAgenteAttivoDiProva(owner, a)
    const altro = await creaAgenteAttivoDiProva(owner, b)
    const strumento = await creaStrumentoDiProva(owner, a)

    await agenti.assegnaStrumento(a.tenantId, a.utenteId, strumento, ag.id)
    expect(
      (await owner.strumentoPesa.findUniqueOrThrow({ where: { id: strumento } })).agenteId
    ).toBe(ag.id)
    const elenco = await agenti.elenca(a.tenantId, { vediDatiTecnici: true })
    expect(elenco).toHaveLength(1)
    expect(elenco[0].strumenti.map(s => s.id)).toEqual([strumento])
    expect(elenco[0].improntaChiave).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/)

    await expect(
      agenti.assegnaStrumento(a.tenantId, a.utenteId, strumento, altro.id)
    ).rejects.toBeInstanceOf(RegolaPesataError)
    await agenti.assegnaStrumento(a.tenantId, a.utenteId, strumento, null)
    expect(
      (await owner.strumentoPesa.findUniqueOrThrow({ where: { id: strumento } })).agenteId
    ).toBeNull()
  })

  it('nome host e IP si vedono solo con vediDatiTecnici', async () => {
    const a = await azienda()
    const ag = await creaAgenteAttivoDiProva(owner, a)
    await owner.agentePesa.update({
      where: { id: ag.id },
      data: { nomeHost: 'PC-PESA', ultimoIp: '10.0.0.7' },
    })
    const [pieno] = await agenti.elenca(a.tenantId, { vediDatiTecnici: true })
    const [ridotto] = await agenti.elenca(a.tenantId, { vediDatiTecnici: false })
    expect(pieno).toMatchObject({ nomeHost: 'PC-PESA', ultimoIp: '10.0.0.7' })
    expect(ridotto).toMatchObject({ nomeHost: null, ultimoIp: null })
  })

  it('elenco letture: libere della sede, non quelle di un’altra sede né già usate né di un’altra azienda', async () => {
    const a = await azienda()
    const altraSede = await owner.registroRifiuti.create({
      data: { tenantId: a.tenantId, descrizione: 'Registro B', codice: 'B' },
    })
    const ag = await creaAgenteAttivoDiProva(owner, a)
    const sA = await creaStrumentoDiProva(owner, a, { agenteId: ag.id })
    const sB = await creaStrumentoDiProva(owner, a, { agenteId: ag.id, registroId: altraSede.id })
    const sLibero = await creaStrumentoDiProva(owner, a, { agenteId: ag.id, registroId: null })
    const lA = await creaLetturaDiProva(owner, ag, a.tenantId, sA, { sequenza: 1 })
    await creaLetturaDiProva(owner, ag, a.tenantId, sB, { sequenza: 2 })
    const lLibero = await creaLetturaDiProva(owner, ag, a.tenantId, sLibero, { sequenza: 3 })
    const vecchia = await creaLetturaDiProva(owner, ag, a.tenantId, sA, {
      sequenza: 4,
      oraAgente: new Date(Date.now() - 30 * 3600_000),
    })
    const estranea = await azienda()
    const agE = await creaAgenteAttivoDiProva(owner, estranea)
    const sE = await creaStrumentoDiProva(owner, estranea, { agenteId: agE.id })
    await creaLetturaDiProva(owner, agE, estranea.tenantId, sE)

    const r = await letture.elenca(a.tenantId, { registroId: a.registroId })

    const ids = r.map(x => x.id)
    expect(ids).toContain(lA)
    expect(ids).toContain(lLibero)
    expect(ids).not.toContain(vecchia)
    expect(r).toHaveLength(2)
    expect(r.every(x => x.firmaValida && x.utilizzabile && x.usataIn === null)).toBe(true)

    const tutte = await letture.elenca(a.tenantId, {
      registroId: a.registroId,
      dal: new Date(Date.now() - 48 * 3600_000),
    })
    const oltre = tutte.find(x => x.id === vecchia)
    expect(oltre).toMatchObject({ utilizzabile: false })
    expect(oltre?.avvisi.some(m => m.includes('ore fa'))).toBe(true)
  })
})
