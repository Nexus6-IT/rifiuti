/**
 * SostituisciEsportazioneRegistroRentriUseCase («sostituisci da qui», eREGI E6) contro un Postgres
 * reale, COME `wasteflow_app`: la rifiutata e le successive passano a `SOSTITUITA` senza DELETE, la
 * catena riparte dall'ultimo anello valido con una riga nuova (stesso `precedente_id`) e resta
 * verificabile dai soli dati salvati.
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
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import {
  aggiungiAnnotazioni,
  eregiDiProva,
  materialeFirmaDiProva,
  scenarioEsportazioni,
  type ScenarioEsportazioni,
} from '../../../test-support/esportazioni-registro-di-prova'
import {
  EsportazioneNonSostituibileError,
  EsportazioneNonTrovataError,
  EsportazioneRifiutataInCatenaError,
} from './errori-esportazioni-registro-rentri'
import { EsportazioniRegistroRentriService } from './esportazioni-registro-rentri.service'
import { GeneraEsportazioneRegistroRentriUseCase } from './genera-esportazione-registro-rentri.use-case'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { SostituisciEsportazioneRegistroRentriUseCase } from './sostituisci-esportazione-registro-rentri.use-case'
import { verificaCatenaEsportazioni } from './verifica-catena-esportazioni'

describe('SostituisciEsportazioneRegistroRentriUseCase — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const generaUseCase = () =>
    new GeneraEsportazioneRegistroRentriUseCase(
      app,
      new LettoreAnnotazioniRentri(logger),
      {
        scaricaVidimazioneXml: async () => ({ nomeFile: null, mime: null, xml: eregiDiProva() }),
      } as any,
      { resolve: async () => ({ ...materialeFirmaDiProva(), source: 'tenant' }) } as any,
      { valida: jest.fn() } as any,
      logger
    )
  const sostituisci = () => new SostituisciEsportazioneRegistroRentriUseCase(app, logger)
  const righe = (s: ScenarioEsportazioni) =>
    owner.esportazioneRegistroRentri.findMany({
      where: { registroId: s.registroId },
      orderBy: { createdAt: 'asc' },
    })

  /** Registro con tre esportazioni (1-2, 3-4, 5-6), tutte VALIDATE. */
  async function treEsportazioni() {
    const s = await scenarioEsportazioni(owner)
    tenantCreati.push(s.tenantId)
    const g = generaUseCase()
    for (const [da, a] of [
      [1, 2],
      [3, 4],
      [5, 6],
    ]) {
      await aggiungiAnnotazioni(owner, s, 2026, da, a)
      await g.genera(s.tenantId, s.registroId, { creataDa: null, valida: false })
    }
    await owner.esportazioneRegistroRentri.updateMany({
      where: { registroId: s.registroId },
      data: { stato: 'VALIDATA' },
    })
    return { s, esportazioni: await righe(s) }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('sostituisce la rifiutata e le successive, la catena riparte dall ultimo anello valido', async () => {
    const { s, esportazioni } = await treEsportazioni()
    const [prima, seconda, terza] = esportazioni
    await owner.esportazioneRegistroRentri.update({
      where: { id: seconda.id },
      data: { stato: 'RIFIUTATA' },
    })
    // Finche' il rifiuto e nella catena non si genera.
    await expect(
      generaUseCase().genera(s.tenantId, s.registroId, { creataDa: null, valida: false })
    ).rejects.toBeInstanceOf(EsportazioneRifiutataInCatenaError)

    const esito = await sostituisci().sostituisciDa(s.tenantId, seconda.id)
    expect(esito).toEqual({ sostituite: 2, ultimaValidaId: prima.id })

    const dopo = await righe(s)
    expect(dopo).toHaveLength(3) // nessun DELETE
    expect(dopo.map(r => r.stato)).toEqual(['VALIDATA', 'SOSTITUITA', 'SOSTITUITA'])

    // La generazione riparte da 3: stesso intervallo della sostituita, stessa precedente.
    const nuova = await generaUseCase().genera(s.tenantId, s.registroId, {
      creataDa: null,
      valida: false,
    })
    expect(nuova.esito).toBe('CREATA')
    const tutte = await righe(s)
    expect(tutte).toHaveLength(4)
    const creata = tutte[3]
    expect([creata.progressivoDa, creata.progressivoA]).toEqual([3, 6])
    expect(creata.precedenteId).toBe(prima.id)
    expect(creata.stato).toBe('GENERATA')
    expect(tutte[1].id).not.toBe(creata.id)
    expect(terza.id).toBe(tutte[2].id)

    // La catena viva (prima + nuova) si verifica dai soli dati salvati.
    const registro = await owner.registroRifiuti.findUniqueOrThrow({ where: { id: s.registroId } })
    const viva = [tutte[0], creata].map(r => ({
      anno: r.anno,
      progressivoDa: r.progressivoDa,
      progressivoA: r.progressivoA,
      numeroRegistrazioni: r.numeroRegistrazioni,
      dataCreazione: r.dataCreazione,
      digestValue: r.digestValue,
      sha256File: r.sha256File,
      xml: gunzipSync(Buffer.from(r.xml)).toString('utf8'),
    }))
    expect(await verificaCatenaEsportazioni(registro.eregXml!, viva)).toEqual({
      valida: true,
      errori: [],
    })
  })

  it('sostituendo la prima la catena riparte dall inizio', async () => {
    const { s, esportazioni } = await treEsportazioni()
    await owner.esportazioneRegistroRentri.update({
      where: { id: esportazioni[0].id },
      data: { stato: 'RIFIUTATA' },
    })
    const esito = await sostituisci().sostituisciDa(s.tenantId, esportazioni[0].id)
    expect(esito).toEqual({ sostituite: 3, ultimaValidaId: null })
    const nuova = await generaUseCase().genera(s.tenantId, s.registroId, {
      creataDa: null,
      valida: false,
    })
    expect(nuova.esito).toBe('CREATA')
    const tutte = await righe(s)
    const creata = tutte[3]
    expect([creata.progressivoDa, creata.progressivoA, creata.precedenteId]).toEqual([1, 6, null])
  })

  it('solo una esportazione RIFIUTATA e ancora viva si sostituisce', async () => {
    const { s, esportazioni } = await treEsportazioni()
    // Valida: no.
    await expect(
      sostituisci().sostituisciDa(s.tenantId, esportazioni[1].id)
    ).rejects.toBeInstanceOf(EsportazioneNonSostituibileError)
    // Rifiutata, sostituita una volta: la seconda volta non e piu nella catena viva.
    await owner.esportazioneRegistroRentri.update({
      where: { id: esportazioni[1].id },
      data: { stato: 'RIFIUTATA' },
    })
    await sostituisci().sostituisciDa(s.tenantId, esportazioni[1].id)
    await expect(
      sostituisci().sostituisciDa(s.tenantId, esportazioni[1].id)
    ).rejects.toBeInstanceOf(EsportazioneNonSostituibileError)
    expect((await righe(s)).map(r => r.stato)).toEqual(['VALIDATA', 'SOSTITUITA', 'SOSTITUITA'])
  })

  it('esportazione di un altra azienda o inesistente: non trovata, nulla cambia', async () => {
    const { s, esportazioni } = await treEsportazioni()
    await owner.esportazioneRegistroRentri.update({
      where: { id: esportazioni[2].id },
      data: { stato: 'RIFIUTATA' },
    })
    const altra = await scenarioEsportazioni(owner)
    tenantCreati.push(altra.tenantId)
    await expect(
      sostituisci().sostituisciDa(altra.tenantId, esportazioni[2].id)
    ).rejects.toBeInstanceOf(EsportazioneNonTrovataError)
    expect((await righe(s))[2].stato).toBe('RIFIUTATA')
  })

  it('l elenco mostra prima la catena viva (piu recente in cima), poi le sostituite', async () => {
    const { s, esportazioni } = await treEsportazioni()
    await owner.esportazioneRegistroRentri.update({
      where: { id: esportazioni[1].id },
      data: { stato: 'RIFIUTATA' },
    })
    await sostituisci().sostituisciDa(s.tenantId, esportazioni[1].id)
    await generaUseCase().genera(s.tenantId, s.registroId, { creataDa: null, valida: false })
    const elenco = await new EsportazioniRegistroRentriService(app).elenca(s.tenantId, s.registroId)
    expect(elenco.map(e => e.stato)).toEqual(['GENERATA', 'VALIDATA', 'SOSTITUITA', 'SOSTITUITA'])
    expect(elenco[2].id).toBe(esportazioni[2].id)
    expect(elenco[3].id).toBe(esportazioni[1].id)
  })
})
