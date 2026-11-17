/**
 * Configurazione delle comunicazioni per sede (4.9c-f, A4) contro un Postgres reale, collegato
 * COME `wasteflow_app` dentro il `TenantContext` dell'azienda.
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
import {
  creaAziendaMud,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import {
  ConfigurazioneComunicazioniNonValidaError,
  UnitaLocaleNonTrovataError,
} from './configurazione-comunicazioni.port'

describe('Configurazione comunicazioni sede — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ConfigurazioneComunicazioniService
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
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new ConfigurazioneComunicazioniService(app)
  })

  afterAll(async () => {
    const where = { tenantId: { in: tenantCreati } }
    await owner.configurazioneComunicazioneSede.deleteMany({ where })
    await owner.autorizzazioneImpianto.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('senza riga restituisce i predefiniti (salvata = false); imposta e rilegge', async () => {
    const az = await nuovaAzienda('K1')
    const prima = await nel(az, () => servizio.leggi(az.tenantId, az.unitaLocaleId, 'ORSO'))
    expect(prima).toEqual({
      unitaLocaleId: az.unitaLocaleId,
      consorzio: 'ORSO',
      salvata: false,
      dati: { modalita: 'NORMALE' },
    })
    const v = await nel(az, () =>
      servizio.imposta(az.tenantId, az.unitaLocaleId, 'ORSO', { modalita: 'DETTAGLIATA' })
    )
    expect(v).toEqual({ ...prima, salvata: true, dati: { modalita: 'DETTAGLIATA' } })
    expect(await nel(az, () => servizio.leggi(az.tenantId, az.unitaLocaleId, 'ORSO'))).toEqual(v)
    // Un'altra riga per (sede, consorzio): sostituzione, non duplicato.
    await nel(az, () => servizio.imposta(az.tenantId, az.unitaLocaleId, 'ORSO', {}))
    expect(
      await owner.configurazioneComunicazioneSede.count({ where: { tenantId: az.tenantId } })
    ).toBe(1)
    expect(
      (await nel(az, () => servizio.leggi(az.tenantId, az.unitaLocaleId, 'ORSO'))).dati
    ).toEqual({
      modalita: 'NORMALE',
    })
  })

  it('salva i dati completati coi predefiniti, per CONOU e COBAT', async () => {
    const az = await nuovaAzienda('K2')
    const conou = await nel(az, () =>
      servizio.imposta(az.tenantId, az.unitaLocaleId, 'CONOU', {
        codiceDeposito: 'DEP001',
        predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 90 } },
      })
    )
    expect(conou.dati.predefinitiPerCer['130205']).toEqual({ prodotto: 'A', percentualeOlio: 90 })
    const cobat = await nel(az, () => servizio.imposta(az.tenantId, az.unitaLocaleId, 'COBAT', {}))
    expect(cobat.dati).toEqual({
      campagnaPredefinita: { codice: '00', descrizione: '' },
      pgfPerCer: {},
    })
    const riga = await owner.configurazioneComunicazioneSede.findFirstOrThrow({
      where: { tenantId: az.tenantId, consorzio: 'COBAT' },
    })
    expect(riga.versioneSchema).toBe(1)
  })

  it('dati non validi o consorzio sconosciuto: errore con l’elenco, nessuna riga scritta', async () => {
    const az = await nuovaAzienda('K3')
    const err = await nel(az, () =>
      servizio.imposta(az.tenantId, az.unitaLocaleId, 'CONOU', { codiceDeposito: 'A', extra: 1 })
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigurazioneComunicazioniNonValidaError)
    expect((err as ConfigurazioneComunicazioniNonValidaError).errori).toEqual([
      'extra: campo sconosciuto',
      'codiceDeposito: da 3 a 10 caratteri alfanumerici',
    ])
    await expect(
      nel(az, () => servizio.imposta(az.tenantId, az.unitaLocaleId, 'COREPLA' as never, {}))
    ).rejects.toBeInstanceOf(ConfigurazioneComunicazioniNonValidaError)
    expect(
      await owner.configurazioneComunicazioneSede.count({ where: { tenantId: az.tenantId } })
    ).toBe(0)
  })

  it('O.R.R.: l’autorizzazione deve essere dell’azienda', async () => {
    const a = await nuovaAzienda('K4a')
    const b = await nuovaAzienda('K4b')
    const aut = await owner.autorizzazioneImpianto.create({
      data: { tenantId: b.tenantId, estremi: 'AUT-B' },
    })
    await expect(
      nel(a, () =>
        servizio.imposta(a.tenantId, a.unitaLocaleId, 'ORR', { autorizzazioneImpiantoId: aut.id })
      )
    ).rejects.toBeInstanceOf(ConfigurazioneComunicazioniNonValidaError)
    const propria = await owner.autorizzazioneImpianto.create({
      data: { tenantId: a.tenantId, estremi: 'AUT-A' },
    })
    const v = await nel(a, () =>
      servizio.imposta(a.tenantId, a.unitaLocaleId, 'ORR', {
        tipoImpianto: 'STO',
        autorizzazioneImpiantoId: propria.id,
      })
    )
    expect(v.dati.autorizzazioneImpiantoId).toBe(propria.id)
  })

  it('una sede di un’altra azienda: UnitaLocaleNonTrovataError e nessuna riga scritta', async () => {
    const a = await nuovaAzienda('K5a')
    const b = await nuovaAzienda('K5b')
    await expect(
      nel(a, () => servizio.leggi(a.tenantId, b.unitaLocaleId, 'CONOU'))
    ).rejects.toBeInstanceOf(UnitaLocaleNonTrovataError)
    await expect(
      nel(a, () => servizio.imposta(a.tenantId, b.unitaLocaleId, 'CONOU', {}))
    ).rejects.toBeInstanceOf(UnitaLocaleNonTrovataError)
    expect(
      await owner.configurazioneComunicazioneSede.count({
        where: { tenantId: { in: [a.tenantId, b.tenantId] } },
      })
    ).toBe(0)
  })
})
