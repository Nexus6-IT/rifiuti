/**
 * Abbinamento dell'agente contro un Postgres reale: il servizio gira COME `wasteflow_app` (RLS) e
 * trova l'agente dal codice COL ruolo di sistema (azienda ignota). Il proprietario prepara i dati
 * e rilegge; la pulizia cancella SOLO le aziende create qui, per id esatto.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo, clientComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

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
import { hashSegreto, generaCodice } from '../../../domain/pese/agenti/credenziali-agente'
import {
  coppiaChiavi,
  creaAgenteAttivoDiProva,
  creaAgenteInAttesaDiProva,
  creaAziendaPesaDiProva,
  creaStrumentoDiProva,
} from '../../../test-support/agenti-pesa-di-test'
import { CodiceAbbinamentoNonValidoError, DatiPesaNonValidiError } from '../errori-pese'
import { AbbinamentoAgenteService } from './abbinamento-agente.service'
import { RisoluzioneAgenteService } from './risoluzione-agente.service'

describe('AbbinamentoAgenteService (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
    urlProprietario
  )
  let app: PrismaService
  let servizio: AbbinamentoAgenteService
  const tenantCreati: string[] = []

  const azienda = async (simulazione = false) => {
    const a = await creaAziendaPesaDiProva(owner, { simulazione })
    tenantCreati.push(a.tenantId)
    return a
  }
  const dati = (codice: string, chiave = coppiaChiavi().pubblicaB64) => ({
    codice,
    chiavePubblica: chiave,
    nomeHost: 'PC-PESA-01',
    versione: '1.0.0',
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new AbbinamentoAgenteService(
      app,
      new RisoluzioneAgenteService(sistema as unknown as PrismaSistemaService)
    )
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), sistema.$disconnect(), app.$disconnect()])
  })

  it('codice valido: agente ATTIVO, token restituito una volta, solo l’hash nel database, audit senza utente', async () => {
    const a = await azienda(true)
    const codice = generaCodice()
    const id = await creaAgenteInAttesaDiProva(owner, a, codice)
    const strumento = await creaStrumentoDiProva(owner, a, { agenteId: id })
    const chiavi = coppiaChiavi()

    const r = await servizio.abbina(dati(codice.toLowerCase(), chiavi.pubblicaB64))

    expect(r.agenteId).toBe(id)
    expect(r.token).toMatch(/^wfpa_[A-Za-z0-9_-]{43}$/)
    expect(r.azienda).toEqual({ ragioneSociale: 'Agente Pesa SRL' })
    expect(r.simulazioneAmmessa).toBe(true)
    expect(r.strumenti.map(s => s.id)).toEqual([strumento])
    const riga = await owner.agentePesa.findUniqueOrThrow({ where: { id } })
    expect(riga).toMatchObject({
      stato: 'ATTIVO',
      tokenSha256: hashSegreto(r.token),
      chiavePubblica: chiavi.pubblicaB64,
      codiceSha256: null,
      codiceScadeIl: null,
      nomeHost: 'PC-PESA-01',
      versioneAgente: '1.0.0',
    })
    expect(JSON.stringify(riga)).not.toContain(r.token)
    const audit = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'PESA_AGENTE_ABBINATO' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBeNull()
    expect(JSON.stringify(audit[0])).not.toContain(r.token)
    expect(audit[0].metadata).toMatchObject({ agenteId: id, nomeHost: 'PC-PESA-01' })
  })

  it('due abbinamenti in parallelo con lo stesso codice: uno solo vince', async () => {
    const a = await azienda()
    const codice = generaCodice()
    await creaAgenteInAttesaDiProva(owner, a, codice)

    const esiti = await Promise.allSettled([
      servizio.abbina(dati(codice)),
      servizio.abbina(dati(codice)),
    ])

    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const persa = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(persa.reason).toBeInstanceOf(CodiceAbbinamentoNonValidoError)
  })

  it('codice scaduto (orologio spostato): non valido', async () => {
    const a = await azienda()
    const codice = generaCodice()
    await creaAgenteInAttesaDiProva(owner, a, codice)
    const prima = servizio.orologio
    servizio.orologio = () => new Date(Date.now() + 16 * 60_000)
    try {
      await expect(servizio.abbina(dati(codice))).rejects.toBeInstanceOf(
        CodiceAbbinamentoNonValidoError
      )
    } finally {
      servizio.orologio = prima
    }
  })

  it('agente revocato col suo vecchio codice: non valido (il codice non c’e più)', async () => {
    const a = await azienda()
    const codice = generaCodice()
    const id = await creaAgenteInAttesaDiProva(owner, a, codice)
    await owner.agentePesa.update({
      where: { id },
      data: {
        stato: 'REVOCATO',
        revocatoDa: a.utenteId,
        revocatoIl: new Date(),
        motivoRevoca: 'sostituito',
        codiceSha256: null,
        codiceScadeIl: null,
      },
    })
    await expect(servizio.abbina(dati(codice))).rejects.toBeInstanceOf(
      CodiceAbbinamentoNonValidoError
    )
  })

  it('codice ignoto, scaduto e già usato hanno lo stesso errore e lo stesso messaggio', async () => {
    const a = await azienda()
    const usato = generaCodice()
    await creaAgenteInAttesaDiProva(owner, a, usato)
    await servizio.abbina(dati(usato))
    const scaduto = generaCodice()
    await creaAgenteInAttesaDiProva(owner, a, scaduto, new Date(Date.now() - 60_000))

    const errori = await Promise.all(
      [generaCodice(), scaduto, usato, 'non-un-codice'].map(c =>
        servizio.abbina(dati(c)).then(
          () => null,
          (e: Error) => e
        )
      )
    )

    for (const e of errori) {
      expect(e).toBeInstanceOf(CodiceAbbinamentoNonValidoError)
      expect(e?.message).toBe('Codice di abbinamento non valido o scaduto.')
    }
  })

  it('chiave pubblica di lunghezza sbagliata: 400 e il codice NON viene consumato', async () => {
    const a = await azienda()
    const codice = generaCodice()
    const id = await creaAgenteInAttesaDiProva(owner, a, codice)

    await expect(
      servizio.abbina(dati(codice, Buffer.alloc(31, 1).toString('base64')))
    ).rejects.toBeInstanceOf(DatiPesaNonValidiError)

    expect((await owner.agentePesa.findUniqueOrThrow({ where: { id } })).stato).toBe('IN_ATTESA')
  })

  it('configurazione: solo gli strumenti attivi assegnati a QUELL’agente, non quelli di altri', async () => {
    const a = await azienda()
    const mio = await creaAgenteAttivoDiProva(owner, a)
    const altro = await creaAgenteAttivoDiProva(owner, a)
    const s1 = await creaStrumentoDiProva(owner, a, { agenteId: mio.id })
    await creaStrumentoDiProva(owner, a, { agenteId: mio.id, attivo: false })
    await creaStrumentoDiProva(owner, a, { agenteId: altro.id })
    await creaStrumentoDiProva(owner, a)

    const c = await servizio.configurazione({ id: mio.id, tenantId: a.tenantId })

    expect(c.strumenti.map(s => s.id)).toEqual([s1])
    expect(c).toMatchObject({
      agenteId: mio.id,
      simulazioneAmmessa: false,
      intervalloBattitoS: 60,
      lottoMassimo: 50,
    })
    expect(new Date(c.oraServer).toISOString()).toBe(c.oraServer)
  })
})
