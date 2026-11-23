/**
 * ValidaEsportazioneRegistroRentriUseCase (eREGI E6, T2) contro un Postgres reale, COME
 * `wasteflow_app`. Il client RENTRI e' finto: qui si prova la mappatura esito -> stato, la regola
 * «un errore tecnico non e' mai un rifiuto» e la ripresa senza rimandare il file. La validazione
 * contro la fake RENTRI vera e' in `esportazioni-registro-rentri.oracolo.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { gunzipSync } from 'zlib'
import { randomUUID } from 'crypto'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { TransazioneRentriNonTrovataError } from '../../../infrastructure/rentri/rentri-api.client'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import {
  EsitoRentriNonDisponibileError,
  type EsitoMovimentiRentri,
} from '../../../infrastructure/rentri/rentri-registri.client'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import {
  IDENTIFICATIVO_REGISTRO,
  aggiungiAnnotazioni,
  eregiDiProva,
  materialeFirmaDiProva,
  scenarioEsportazioni,
  type ScenarioEsportazioni,
} from '../../../test-support/esportazioni-registro-di-prova'
import {
  EsportazioneNonRivalidabileError,
  EsportazioneNonTrovataError,
} from './errori-esportazioni-registro-rentri'
import { GeneraEsportazioneRegistroRentriUseCase } from './genera-esportazione-registro-rentri.use-case'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import {
  ValidaEsportazioneRegistroRentriUseCase,
  messaggiSalvabili,
  nomeFileEsportazione,
  statoDaEsito,
} from './valida-esportazione-registro-rentri.use-case'

const esito = (
  validazione: EsitoMovimentiRentri['validazione'] = [],
  errore = false
): EsitoMovimentiRentri => ({ errore, validazione, numeroRegistrazioni: [] })

const msg = (tipo: 'Errore' | 'Avvertimento', codice: string, campo: string | null = null) => ({
  indice: null,
  campo,
  tipo,
  codice,
})

describe('statoDaEsito (funzione pura)', () => {
  it('nessun messaggio = VALIDATA; solo avvertimenti = con avvisi; un errore o errore=true = RIFIUTATA', () => {
    expect(statoDaEsito(esito())).toBe('VALIDATA')
    expect(statoDaEsito(esito([msg('Avvertimento', 'a')]))).toBe('VALIDATA_CON_AVVISI')
    expect(statoDaEsito(esito([msg('Avvertimento', 'a'), msg('Errore', 'b')]))).toBe('RIFIUTATA')
    expect(statoDaEsito(esito([], true))).toBe('RIFIUTATA')
  })

  it('i messaggi salvati hanno solo codice, tipo e campo', () => {
    const salvati = messaggiSalvabili({
      ...esito([{ indice: 3, campo: 'Produttore', tipo: 'Errore', codice: 'x' }]),
    })
    expect(salvati).toEqual([{ codice: 'x', tipo: 'Errore', campo: 'Produttore' }])
  })

  it('errore=true senza messaggi di tipo Errore: messaggio sintetico, mai un rifiuto muto', () => {
    expect(messaggiSalvabili(esito([], true))).toEqual([
      { codice: 'ESITO_ERRORE', tipo: 'Errore', campo: null },
    ])
    // Con un messaggio Errore vero non si aggiunge nulla; senza errore nemmeno.
    expect(messaggiSalvabili(esito([msg('Errore', 'x', 'Campo')], true))).toEqual([
      { codice: 'x', tipo: 'Errore', campo: 'Campo' },
    ])
    expect(messaggiSalvabili(esito([msg('Avvertimento', 'a')]))).toHaveLength(1)
    // Con solo avvertimenti ed errore=true il sintetico precede, cosi' non lo taglia il tetto.
    expect(messaggiSalvabili(esito([msg('Avvertimento', 'a')], true))[0]).toEqual({
      codice: 'ESITO_ERRORE',
      tipo: 'Errore',
      campo: null,
    })
  })

  it('nome del file come WinWaste', () => {
    expect(nomeFileEsportazione('R1234ABCDE0', 1, 25, new Date('2026-04-01T23:30:00Z'))).toBe(
      'RENR1234ABCDE0_000001_000025_20260401.SignedR.xml'
    )
  })
})

describe('ValidaEsportazioneRegistroRentriUseCase — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const logger: Record<string, jest.Mock> = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  let validaRegistro: jest.Mock
  let attendiEsitoMovimenti: jest.Mock
  const SALVA_ENV = process.env.RENTRI_REGISTRO_INVII_ATTIVI

  const useCase = () =>
    new ValidaEsportazioneRegistroRentriUseCase(
      app,
      { validaRegistro, attendiEsitoMovimenti } as never,
      logger as never
    )

  async function esportazione(): Promise<{ s: ScenarioEsportazioni; id: string }> {
    const s = await scenarioEsportazioni(owner)
    tenantCreati.push(s.tenantId)
    await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
    const genera = new GeneraEsportazioneRegistroRentriUseCase(
      app,
      new LettoreAnnotazioniRentri(logger as never),
      {
        scaricaVidimazioneXml: async () => ({ nomeFile: null, mime: null, xml: eregiDiProva() }),
      } as never,
      { resolve: async () => materialeFirmaDiProva() } as never,
      {} as never,
      logger as never
    )
    const e = await genera.genera(s.tenantId, s.registroId, { creataDa: null, valida: false })
    if (e.esito !== 'CREATA') throw new Error('esportazione non creata')
    return { s, id: e.esportazione.id }
  }

  const riga = (id: string) => owner.esportazioneRegistroRentri.findUniqueOrThrow({ where: { id } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  beforeEach(() => {
    delete process.env.RENTRI_REGISTRO_INVII_ATTIVI
    validaRegistro = jest.fn().mockResolvedValue({ transazioneId: randomUUID() })
    attendiEsitoMovimenti = jest.fn().mockResolvedValue(esito())
  })

  afterAll(async () => {
    if (SALVA_ENV === undefined) delete process.env.RENTRI_REGISTRO_INVII_ATTIVI
    else process.env.RENTRI_REGISTRO_INVII_ATTIVI = SALVA_ENV
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('esito pulito: VALIDATA; il file inviato e l XML salvato, col nome atteso', async () => {
    const { s, id } = await esportazione()
    const r = await useCase().valida(s.tenantId, id)
    expect(r).toMatchObject({ id, stato: 'VALIDATA', messaggi: [] })

    const salvata = await riga(id)
    expect(salvata.stato).toBe('VALIDATA')
    expect(salvata.transazioneValidazioneId).toBeTruthy()
    const [identificativo, richiesta] = validaRegistro.mock.calls[0]
    expect(identificativo).toBe(IDENTIFICATIVO_REGISTRO)
    expect(Buffer.from(richiesta.fileContentBase64, 'base64').toString('utf8')).toBe(
      gunzipSync(Buffer.from(salvata.xml)).toString('utf8')
    )
    expect(richiesta.mime).toBe('application/xml')
    expect(richiesta.nomeFile).toMatch(/^RENR1234ABCDE0_000001_000003_\d{8}\.SignedR\.xml$/)
  })

  it('solo avvertimenti: VALIDATA_CON_AVVISI, messaggi salvati senza valori', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockResolvedValue(
      esito([msg('Avvertimento', 'firmaNonPresente', 'Signature')])
    )
    const r = await useCase().valida(s.tenantId, id)
    expect(r.stato).toBe('VALIDATA_CON_AVVISI')
    expect((await riga(id)).messaggi).toEqual([
      { codice: 'firmaNonPresente', tipo: 'Avvertimento', campo: 'Signature' },
    ])
  })

  it('almeno un errore: RIFIUTATA, e non si rilancia', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockResolvedValue(esito([msg('Errore', 'catenaDigestNonValida')]))
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('RIFIUTATA')
    await expect(useCase().rivalida(s.tenantId, id)).rejects.toBeInstanceOf(
      EsportazioneNonRivalidabileError
    )
    // Una chiamata a `valida` su un esito definitivo non richiama RENTRI.
    validaRegistro.mockClear()
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('RIFIUTATA')
    expect(validaRegistro).not.toHaveBeenCalled()
  })

  it('errore tecnico nell avvio (5xx, rete): VALIDAZIONE_NON_DISPONIBILE, mai RIFIUTATA', async () => {
    const { s, id } = await esportazione()
    validaRegistro.mockRejectedValue(
      new RentriApiError(503, 'Servizio non disponibile', undefined, true)
    )
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('VALIDAZIONE_NON_DISPONIBILE')
    validaRegistro.mockRejectedValue(new Error('ECONNRESET'))
    expect((await useCase().rivalida(s.tenantId, id)).stato).toBe('VALIDAZIONE_NON_DISPONIBILE')
    expect((await riga(id)).transazioneValidazioneId).toBeNull()
  })

  it('errore tecnico nella lettura dell esito: NON_DISPONIBILE ma la transazione resta (non si rimanda il file)', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockRejectedValueOnce(
      new RentriApiError(502, 'Bad gateway', undefined, true)
    )
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('VALIDAZIONE_NON_DISPONIBILE')
    const transazione = (await riga(id)).transazioneValidazioneId
    expect(transazione).toBeTruthy()

    validaRegistro.mockClear()
    attendiEsitoMovimenti.mockResolvedValue(esito())
    expect((await useCase().rivalida(s.tenantId, id)).stato).toBe('VALIDATA')
    expect(validaRegistro).not.toHaveBeenCalled()
    expect(attendiEsitoMovimenti).toHaveBeenLastCalledWith(
      transazione,
      s.tenantId,
      expect.anything()
    )
  })

  it('RENTRI ancora al lavoro: IN_VALIDAZIONE con la transazione salvata', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockRejectedValueOnce(new EsitoRentriNonDisponibileError('t', 10))
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('IN_VALIDAZIONE')
    expect((await riga(id)).transazioneValidazioneId).toBeTruthy()
    expect((await useCase().rivalida(s.tenantId, id)).stato).toBe('VALIDATA')
  })

  it('transazione sconosciuta a RENTRI: si azzera e la validazione successiva rimanda il file', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockRejectedValueOnce(new EsitoRentriNonDisponibileError('t', 10))
    await useCase().valida(s.tenantId, id)
    attendiEsitoMovimenti.mockRejectedValueOnce(new TransazioneRentriNonTrovataError('t'))
    expect((await useCase().rivalida(s.tenantId, id)).stato).toBe('VALIDAZIONE_NON_DISPONIBILE')
    expect((await riga(id)).transazioneValidazioneId).toBeNull()
    validaRegistro.mockClear()
    expect((await useCase().rivalida(s.tenantId, id)).stato).toBe('VALIDATA')
    expect(validaRegistro).toHaveBeenCalledTimes(1)
  })

  it('interruttore spento: la POST /valida non parte, lo stato resta invariato', async () => {
    const { s, id } = await esportazione()
    process.env.RENTRI_REGISTRO_INVII_ATTIVI = 'false'
    const r = await useCase().valida(s.tenantId, id)
    expect(r.stato).toBe('GENERATA')
    expect(validaRegistro).not.toHaveBeenCalled()
    expect(attendiEsitoMovimenti).not.toHaveBeenCalled()
    expect((await riga(id)).transazioneValidazioneId).toBeNull()
  })

  it('interruttore spento: con la transazione gia salvata l esito si legge comunque (solo GET), senza POST', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockRejectedValueOnce(new EsitoRentriNonDisponibileError('t', 10))
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('IN_VALIDAZIONE')
    const transazione = (await riga(id)).transazioneValidazioneId
    expect(transazione).toBeTruthy()

    process.env.RENTRI_REGISTRO_INVII_ATTIVI = 'false'
    validaRegistro.mockClear()
    const r = await useCase().rivalida(s.tenantId, id)
    expect(r.stato).toBe('VALIDATA')
    expect(validaRegistro).not.toHaveBeenCalled()
    expect(attendiEsitoMovimenti).toHaveBeenLastCalledWith(
      transazione,
      s.tenantId,
      expect.anything()
    )
  })

  it('due validazioni insieme: una sola POST /valida, l altra vede lo stato corrente', async () => {
    const { s, id } = await esportazione()
    validaRegistro.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 300))
      return { transazioneId: randomUUID() }
    })
    const [a, b] = await Promise.all([
      useCase().valida(s.tenantId, id),
      useCase().valida(s.tenantId, id),
    ])
    expect(validaRegistro).toHaveBeenCalledTimes(1)
    expect([a.stato, b.stato]).toContain('VALIDATA')
    expect((await riga(id)).stato).toBe('VALIDATA')
  })

  it('una prenotazione abbandonata (processo caduto prima della POST) si riprende dopo il tempo massimo', async () => {
    const { s, id } = await esportazione()
    // Prenotazione fresca: nessuna seconda POST.
    await owner.esportazioneRegistroRentri.update({
      where: { id },
      data: { stato: 'IN_VALIDAZIONE' },
    })
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('IN_VALIDAZIONE')
    expect(validaRegistro).not.toHaveBeenCalled()
    // Prenotazione vecchia: si riprende.
    await owner.esportazioneRegistroRentri.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 60 * 60_000) },
    })
    expect((await useCase().valida(s.tenantId, id)).stato).toBe('VALIDATA')
    expect(validaRegistro).toHaveBeenCalledTimes(1)
  })

  it('errore=true senza messaggi: RIFIUTATA con il messaggio sintetico salvato', async () => {
    const { s, id } = await esportazione()
    attendiEsitoMovimenti.mockResolvedValue(esito([], true))
    const r = await useCase().valida(s.tenantId, id)
    expect(r.stato).toBe('RIFIUTATA')
    expect(r.messaggi).toEqual([{ codice: 'ESITO_ERRORE', tipo: 'Errore', campo: null }])
  })

  it('esportazione di un altra azienda o inesistente: non trovata', async () => {
    const { id } = await esportazione()
    const altra = await scenarioEsportazioni(owner)
    tenantCreati.push(altra.tenantId)
    await expect(useCase().valida(altra.tenantId, id)).rejects.toBeInstanceOf(
      EsportazioneNonTrovataError
    )
    await expect(useCase().valida(altra.tenantId, randomUUID())).rejects.toBeInstanceOf(
      EsportazioneNonTrovataError
    )
  })

  it('la generazione con valida=true avvia la validazione e un suo guasto non la annulla', async () => {
    const s = await scenarioEsportazioni(owner)
    tenantCreati.push(s.tenantId)
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    const validatore = useCase()
    const genera = new GeneraEsportazioneRegistroRentriUseCase(
      app,
      new LettoreAnnotazioniRentri(logger as never),
      {
        scaricaVidimazioneXml: async () => ({ nomeFile: null, mime: null, xml: eregiDiProva() }),
      } as never,
      { resolve: async () => materialeFirmaDiProva() } as never,
      validatore,
      logger as never
    )
    const e = await genera.genera(s.tenantId, s.registroId, { creataDa: null })
    expect(e.esito).toBe('CREATA')
    if (e.esito !== 'CREATA') return
    expect((await riga(e.esportazione.id)).stato).toBe('VALIDATA')

    await aggiungiAnnotazioni(owner, s, 2026, 3, 3)
    validaRegistro.mockRejectedValue(new Error('rete'))
    const seconda = await genera.genera(s.tenantId, s.registroId, { creataDa: null })
    expect(seconda.esito).toBe('CREATA')
    if (seconda.esito !== 'CREATA') return
    expect((await riga(seconda.esportazione.id)).stato).toBe('VALIDAZIONE_NON_DISPONIBILE')
  })
})
