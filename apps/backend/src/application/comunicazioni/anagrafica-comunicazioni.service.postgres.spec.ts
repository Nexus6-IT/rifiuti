/**
 * Anagrafica delle sedi delle ditte per le comunicazioni (4.9c-f, A4) contro un Postgres reale,
 * collegato COME `wasteflow_app` dentro il `TenantContext` dell'azienda.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
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
import { creaDittaConRuolo } from '../../test-support/anagrafiche-di-test'
import {
  creaAziendaMud,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { AnagraficaComunicazioniService } from './anagrafica-comunicazioni.service'
import {
  AnagraficaComunicazioniNonValidaError,
  SedeDittaNonTrovataError,
} from './anagrafica-comunicazioni.port'

// Comuni di prova con codici ISTAT che non esistono davvero (provincia `ZZ`): si tolgono per codice.
const COMUNI_DI_PROVA = [
  { code: '990001', name: 'Testopoli', provinciaSigla: 'ZZ' },
  { code: '990002', name: 'Doppione', provinciaSigla: 'ZZ' },
  { code: '990003', name: 'Doppione', provinciaSigla: 'ZZ' },
]

describe('Anagrafica comunicazioni sede — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: AnagraficaComunicazioniService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    for (const c of COMUNI_DI_PROVA) {
      await owner.istatComune.upsert({ where: { code: c.code }, create: c, update: c })
    }
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new AnagraficaComunicazioniService(app)
  })

  afterAll(async () => {
    await owner.anagraficaComunicazioniSede.deleteMany({
      where: { tenantId: { in: tenantCreati } },
    })
    await owner.produttore.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await pulisciAziendeMud(owner, tenantCreati)
    await owner.istatComune.deleteMany({
      where: { code: { in: COMUNI_DI_PROVA.map(c => c.code) } },
    })
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('senza riga restituisce i valori di partenza; imposta, rilegge e sostituisce per intero', async () => {
    const az = await nuovaAzienda('A1')
    const { sedeId } = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE')
    expect(await nel(az, () => servizio.leggi(az.tenantId, sedeId))).toEqual({
      sedeDittaId: sedeId,
      eComune: false,
      codiceIstatComune: null,
      codiceAteco: null,
      codiceOrso: null,
      alboDataIscrizione: null,
      alboClassi: null,
      autorizzazioneData: null,
      legaleRappresentanteCognome: null,
      legaleRappresentanteNome: null,
      esclusaOrr: false,
    })
    const v = await nel(az, () =>
      servizio.imposta(az.tenantId, sedeId, {
        eComune: true,
        codiceIstatComune: '990001',
        codiceAteco: '38.11.00',
        codiceOrso: '123456',
        alboDataIscrizione: '2020-02-29',
        alboClassi: '1D 4F',
        autorizzazioneData: '2021-03-04',
        legaleRappresentanteCognome: 'Rossi',
        legaleRappresentanteNome: 'Mario',
        esclusaOrr: true,
      })
    )
    expect(v).toMatchObject({
      eComune: true,
      codiceIstatComune: '990001',
      alboDataIscrizione: '2020-02-29',
      autorizzazioneData: '2021-03-04',
      esclusaOrr: true,
    })
    expect(await nel(az, () => servizio.leggi(az.tenantId, sedeId))).toEqual(v)
    // Sostituzione: i campi omessi tornano al valore di partenza.
    const solo = await nel(az, () =>
      servizio.imposta(az.tenantId, sedeId, { codiceAteco: '381100' })
    )
    expect(solo).toMatchObject({
      eComune: false,
      codiceIstatComune: null,
      codiceAteco: '381100',
      esclusaOrr: false,
    })
    expect(
      await owner.anagraficaComunicazioniSede.count({ where: { tenantId: az.tenantId } })
    ).toBe(1)
  })

  it('valida ATECO, ISTAT (formato ed esistenza), codice ARPA, date e lunghezze; stringhe vuote = assente', async () => {
    const az = await nuovaAzienda('A2')
    const { sedeId } = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE')
    const err = await nel(az, () =>
      servizio.imposta(az.tenantId, sedeId, {
        codiceIstatComune: '063049',
        codiceAteco: '38.11',
        codiceOrso: '12345678A',
        alboDataIscrizione: '2021-02-30',
        legaleRappresentanteCognome: 'x'.repeat(26),
      })
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnagraficaComunicazioniNonValidaError)
    expect((err as AnagraficaComunicazioniNonValidaError).errori).toEqual([
      'codiceIstatComune: il codice non esiste fra i comuni ISTAT',
      'codiceAteco: formato NN.NN.NN oppure 6 cifre',
      'codiceOrso: da 1 a 9 cifre',
      'alboDataIscrizione: giorno AAAA-MM-GG',
      'legaleRappresentanteCognome: al massimo 25 caratteri',
    ])
    await expect(
      nel(az, () => servizio.imposta(az.tenantId, sedeId, { codiceIstatComune: '6304' }))
    ).rejects.toBeInstanceOf(AnagraficaComunicazioniNonValidaError)
    const vuoto = await nel(az, () =>
      servizio.imposta(az.tenantId, sedeId, { codiceAteco: '  ', codiceOrso: '' })
    )
    expect(vuoto.codiceAteco).toBeNull()
    expect(vuoto.codiceOrso).toBeNull()
  })

  it('risolviIstat: forzatura > nome e provincia; ambiguo, assente o mancante → null con il motivo', async () => {
    const az = await nuovaAzienda('A3')
    const trovata = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      comune: 'TESTOPOLI',
      provincia: 'zz',
    })
    // La sigla in minuscolo non e' una sigla valida per la sede, ma il confronto la normalizza.
    expect(await nel(az, () => servizio.risolviIstat(az.tenantId, trovata.sedeId))).toEqual({
      codice: '990001',
      origine: 'DA_NOME',
    })
    const ambigua = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      comune: 'Doppione',
      provincia: 'ZZ',
    })
    expect(await nel(az, () => servizio.risolviIstat(az.tenantId, ambigua.sedeId))).toEqual({
      codice: null,
      motivo: 'COMUNE_AMBIGUO',
    })
    const assente = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      comune: 'Inesistente',
      provincia: 'ZZ',
    })
    expect(await nel(az, () => servizio.risolviIstat(az.tenantId, assente.sedeId))).toEqual({
      codice: null,
      motivo: 'COMUNE_NON_TROVATO',
    })
    // La forzatura vince sul nome (anche per il comune ambiguo).
    await nel(az, () =>
      servizio.imposta(az.tenantId, ambigua.sedeId, { codiceIstatComune: '990003' })
    )
    expect(await nel(az, () => servizio.risolviIstat(az.tenantId, ambigua.sedeId))).toEqual({
      codice: '990003',
      origine: 'FORZATO',
    })
  })

  it('una sede di un’altra azienda: SedeDittaNonTrovataError e nessuna riga scritta', async () => {
    const a = await nuovaAzienda('A4a')
    const b = await nuovaAzienda('A4b')
    const { sedeId } = await creaDittaConRuolo(owner, b.tenantId, 'PRODUTTORE')
    await expect(nel(a, () => servizio.leggi(a.tenantId, sedeId))).rejects.toBeInstanceOf(
      SedeDittaNonTrovataError
    )
    await expect(
      nel(a, () => servizio.imposta(a.tenantId, sedeId, { codiceAteco: '38.11.00' }))
    ).rejects.toBeInstanceOf(SedeDittaNonTrovataError)
    await expect(nel(a, () => servizio.risolviIstat(a.tenantId, sedeId))).rejects.toBeInstanceOf(
      SedeDittaNonTrovataError
    )
    expect(
      await owner.anagraficaComunicazioniSede.count({
        where: { tenantId: { in: [a.tenantId, b.tenantId] } },
      })
    ).toBe(0)
  })
})
