/**
 * Dichiarazioni MUD per unità locale (Fase 2 pezzo 8, versione 2) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`) prepara due aziende; la prima ha tre sedi (una cessata), quattro
 * registri (uno senza sede) e movimenti in ciascuno, la seconda ha dati che non devono comparire.
 * Le attese sono scritte a mano: nessun valore si ricava dal codice sotto test.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55436/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
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
import { MudAggregazioneService } from './mud-aggregazione.service'
import { haBloccanti } from './mud-controlli'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from './mud-seed.postgres-spec'

describe('MudAggregazione per unità locale — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: MudAggregazioneService
  const tenantCreati: string[] = []
  let az: AziendaMud
  let altra: AziendaMud
  let sedeDeposito: string
  let sedeCessata: string

  const INDIRIZZO = {
    indirizzo: 'Via Po',
    civico: '3',
    cap: '20100',
    comune: 'Milano',
    provincia: 'MI',
  }

  const nelTenant = <R>(fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toMatch(
      /@(127\.0\.0\.1|localhost):(55432|55436)\/wasteflow_ci\b/
    )
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() }
    service = new MudAggregazioneService(
      app,
      { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) } as any,
      logger
    )

    az = await creaAziendaMud(owner, 'SD')
    altra = await creaAziendaMud(owner, 'SE')
    tenantCreati.push(az.tenantId, altra.tenantId)

    // sede principale (dall'helper) con l'indirizzo; le altre due le crea il test
    await owner.rentriUnitaLocale.update({ where: { id: az.unitaLocaleId }, data: INDIRIZZO })
    const deposito = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: az.tenantId,
        numIscrSito: 'OP0002MS000002-MI0002',
        denominazione: 'Deposito',
        principale: false,
        ...INDIRIZZO,
      },
    })
    const cessata = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: az.tenantId,
        numIscrSito: 'OP0003MS000003-MI0003',
        denominazione: 'Ex magazzino',
        principale: false,
        attiva: false,
        ...INDIRIZZO,
      },
    })
    sedeDeposito = deposito.id
    sedeCessata = cessata.id
    const regDeposito = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Registro deposito', unitaLocaleId: deposito.id },
    })
    const regCessata = await owner.registroRifiuti.create({
      data: {
        tenantId: az.tenantId,
        descrizione: 'Registro ex magazzino',
        unitaLocaleId: cessata.id,
      },
    })
    const regSenzaSede = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Registro senza sede', unitaLocaleId: null },
    })

    const carico = (registroId: string, cerCode: string, quantita: number) =>
      creaMovimento(
        owner,
        { ...az, registroId },
        { type: 'CARICO', causale: 'PRODUZIONE_INTERNA', cerCode, quantita, giorno: '2025-06-10' }
      )
    // sede principale: 17 04 05 = 100, 15 01 01 = 20
    await carico(az.registroId, '17 04 05', 100)
    await carico(az.registroId, '15 01 01', 20)
    // deposito: 17 04 05 = 60, 20 03 01 = 10
    await carico(regDeposito.id, '17 04 05', 60)
    await carico(regDeposito.id, '20 03 01', 10)
    // sede cessata: 15 01 01 = 8
    await carico(regCessata.id, '15 01 01', 8)
    // registro senza sede: 17 04 05 = 5, finisce sulla principale
    await carico(regSenzaSede.id, '17 04 05', 5)
    // un'altra azienda: non deve comparire
    await creaMovimento(owner, altra, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '17 04 05',
      quantita: 99,
      giorno: '2025-06-10',
    })
    await creaMovimento(owner, altra, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '13 02 05*',
      quantita: 7,
      giorno: '2025-06-10',
    })
  })

  afterAll(async () => {
    await pulisciAziendeMud(owner, tenantCreati)
    await owner.$disconnect()
    await app.onModuleDestroy()
  })

  it("i progressivi MUD assegnati dalla migration seguono l'ordine di creazione", async () => {
    const sedi = await owner.rentriUnitaLocale.findMany({
      where: { tenantId: az.tenantId },
      select: { id: true, progressivoMud: true },
    })
    const p = new Map(sedi.map(s => [s.id, s.progressivoMud]))
    expect(p.get(az.unitaLocaleId)).toBe(1)
    expect(p.get(sedeDeposito)).toBe(2)
    expect(p.get(sedeCessata)).toBe(3)
  })

  it('tre dichiarazioni in ordine di codice, con righe e controlli attesi', async () => {
    const r = await nelTenant(() => service.aggrega(az.tenantId, 2025))

    expect(r.versioneCalcolo).toBe(2)
    expect(r.dichiarazioni.map(d => d.codice)).toEqual([
      '000000000000001',
      '000000000000002',
      '000000000000003',
    ])
    expect(r.dichiarazioni.map(d => d.unitaLocale.denominazione)).toEqual([
      'Sede principale',
      'Deposito',
      'Ex magazzino',
    ])
    const riga = (d: number) =>
      r.dichiarazioni[d].righe.map(x => [x.cerCode, x.prodottoKg, x.recuperoKg, x.smaltimentoKg])
    // principale: 100 + 5 del registro senza sede
    expect(riga(0)).toEqual([
      ['150101', 20, 0, 0],
      ['170405', 105, 0, 0],
    ])
    expect(riga(1)).toEqual([
      ['170405', 60, 0, 0],
      ['200301', 10, 0, 0],
    ])
    expect(riga(2)).toEqual([['150101', 8, 0, 0]])
    expect(r.righe).toHaveLength(5)
    expect(r.movimentiPerCer).toEqual({ '150101': 2, '170405': 3, '200301': 1 })
    // nulla dell'altra azienda (99 kg di 17 04 05, 7 kg di 13 02 05*)
    expect(r.pericolosiPerCer).toEqual({})
    expect(Object.keys(r.movimentiPerCer)).not.toContain('130205')

    // AU e AR/INT: nessuna autorizzazione, ma la scelta delle schede è la principale / la prima
    expect(r.dichiarazioni.map(d => d.conAutorizzazioni)).toEqual([true, false, false])
    expect(r.dichiarazioni.map(d => d.conAllegatiAzienda)).toEqual([true, false, false])

    const codici = r.controlli.map(c => c.codice)
    expect(codici).not.toContain('PIU_UNITA_LOCALI')
    expect(codici).not.toContain('AUTORIZZAZIONI_SULLA_PRINCIPALE')
    const senzaSede = r.controlli.filter(c => c.codice === 'MOVIMENTI_SENZA_SEDE')
    expect(senzaSede).toHaveLength(1)
    expect(senzaSede[0].movimenti).toHaveLength(1)
    expect(senzaSede[0].messaggio).toContain('principale Sede principale (')
    // giacenze (D8): nessuno scarico, quindi il saldo di ogni sede è la somma dei suoi carichi e,
    // senza avvii, va tutto a smaltimento; i 5 kg del registro senza sede seguono i movimenti
    // sulla principale (105 = 100 + 5)
    const smalt = (d: number) => r.dichiarazioni[d].righe.map(x => x.giacenzaSmaltimentoKg)
    expect(smalt(0)).toEqual([20, 105])
    expect(smalt(1)).toEqual([60, 10])
    expect(smalt(2)).toEqual([8])
    expect(
      r.dichiarazioni.flatMap(d => d.righe).every(x => x.giacenzaRecuperoKg === undefined)
    ).toBe(true)
    const stimate = r.controlli.filter(c => c.codice === 'GIACENZA_DESTINAZIONE_NON_INDICATA')
    expect(stimate).toHaveLength(5)
    expect(stimate.map(c => c.sede).sort()).toEqual([
      'Deposito',
      'Deposito',
      'Ex magazzino',
      'Sede principale',
      'Sede principale',
    ])
    expect(codici).not.toContain('GIACENZE_NON_CALCOLATE')
    expect(codici).not.toContain('GIACENZE_NON_DICHIARATE')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  it('versione 1: tutto sulla principale, una dichiarazione fusa e PIU_UNITA_LOCALI per le attive', async () => {
    const r = await nelTenant(() => service.aggrega(az.tenantId, 2025, { versioneCalcolo: 1 }))

    expect(r.dichiarazioni).toHaveLength(1)
    expect(r.dichiarazioni[0].codice).toBe('000000000000001')
    expect(r.righe.map(x => [x.cerCode, x.prodottoKg])).toEqual([
      ['150101', 28],
      ['170405', 165],
      ['200301', 10],
    ])
    // le attive sono due (la terza è cessata)
    const piu = r.controlli.filter(c => c.codice === 'PIU_UNITA_LOCALI')
    expect(piu).toHaveLength(1)
    expect(piu[0].messaggio).toContain('Deposito')
    expect(piu[0].messaggio).not.toContain('Ex magazzino')
  })

  it("l'altra azienda ha solo i suoi dati", async () => {
    const r = await TenantContext.run({ tenantId: altra.tenantId }, async () =>
      service.aggrega(altra.tenantId, 2025)
    )

    expect(r.dichiarazioni).toHaveLength(1)
    expect(r.righe.map(x => [x.cerCode, x.prodottoKg])).toEqual([
      ['130205', 7],
      ['170405', 99],
    ])
    expect(r.pericolosiPerCer).toEqual({ '130205': true })
  })
})
