/**
 * Giacenze al 31/12 per sede e CER (Fase 2 pezzo 8, D8 e D9) contro un Postgres reale, collegato
 * COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda.
 *
 * Solo il database vero prova il confine dell'anno italiano, le somme Decimal, la vigenza di
 * rettifiche e annullamenti e le aperture del registro. L'azienda ha due sedi (principale e
 * deposito) e tre registri (uno senza sede); un'altra azienda ha dati che non devono comparire.
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
import {
  creaApertura,
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from './mud-seed.postgres-spec'

describe('Giacenze MUD al 31/12 per sede — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: MudAggregazioneService
  const tenantCreati: string[] = []
  let az: AziendaMud
  let altra: AziendaMud

  const nelTenant = <R>(fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, async () => await fn())

  const INDIRIZZO = {
    indirizzo: 'Via Po',
    civico: '3',
    cap: '20100',
    comune: 'Milano',
    provincia: 'MI',
  }

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toMatch(
      /@(127\.0\.0\.1|localhost):[0-9]{1,5}\/wasteflow_ci\b/
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

    az = await creaAziendaMud(owner, 'GI')
    altra = await creaAziendaMud(owner, 'GJ')
    tenantCreati.push(az.tenantId, altra.tenantId)

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
    const regDeposito = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Registro deposito', unitaLocaleId: deposito.id },
    })
    const regSenzaSede = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Registro senza sede', unitaLocaleId: null },
    })
    const inRegistro = (registroId: string): AziendaMud => ({ ...az, registroId })
    const principale = az
    const depositoAz = inRegistro(regDeposito.id)
    const senzaSede = inRegistro(regSenzaSede.id)

    const carico = (
      conto: AziendaMud,
      giorno: string,
      cerCode: string,
      quantita: number,
      extra: { causale?: string; unita?: string; istante?: string } = {}
    ) =>
      creaMovimento(owner, conto, {
        type: 'CARICO',
        causale: extra.causale ?? 'PRODUZIONE_INTERNA',
        cerCode,
        quantita,
        giorno,
        unita: extra.unita,
        istante: extra.istante,
      })

    // --- sede principale ---
    // aperture: 1 t al 31/12/2025 (dentro), 999 kg al 1/1/2026 (fuori dal 2025)
    await creaApertura(owner, principale, {
      cerCode: '17 04 05',
      quantita: 1,
      unita: 'T',
      data: '2025-12-31',
    })
    await creaApertura(owner, principale, {
      cerCode: '17 04 05',
      quantita: 999,
      unita: 'KG',
      data: '2026-01-01',
    })
    await carico(principale, '2025-06-10', '17 04 05', 500)
    // avvio a recupero di 200 kg
    await creaMovimento(owner, principale, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '17 04 05',
      quantita: 200,
      giorno: '2025-07-01',
      operationCode: 'R13',
      counterpartName: 'Recuperi Nord Srl',
    })
    // 23:30 UTC del 31/12/2025 = 00:30 del 1/1/2026 in Italia: appartiene al 2026
    await creaMovimento(owner, principale, {
      type: 'SCARICO',
      causale: 'ALTRO_SCARICO',
      cerCode: '17 04 05',
      quantita: 50,
      giorno: '2025-12-31',
      istante: '2025-12-31T23:30:00Z',
    })
    // Decimal: 350,35 (rettifica di 400) + 0,10 + 0,20; l'annullato (90) non conta
    const daRettificare = await carico(principale, '2025-03-10', '20 03 01', 400)
    await creaMovimento(owner, principale, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '20 03 01',
      quantita: 350.35,
      giorno: '2025-03-10',
      rettificatoId: daRettificare.id,
      originaleId: daRettificare.id,
    })
    const daAnnullare = await carico(principale, '2025-04-10', '20 03 01', 90)
    await creaMovimento(owner, principale, {
      tipo: 'ANNULLAMENTO',
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '20 03 01',
      quantita: 90,
      giorno: '2025-04-10',
      rettificatoId: daAnnullare.id,
      originaleId: daAnnullare.id,
    })
    await carico(principale, '2025-05-01', '20 03 01', 0.1)
    await carico(principale, '2025-05-02', '20 03 01', 0.2)
    // 15 01 01: 20 kg prodotti nel 2025 e 30 kg ricevuti da terzi nel 2024 → non dichiarata
    await carico(principale, '2025-05-03', '15 01 01', 20)
    await carico(principale, '2024-11-10', '15 01 01', 30, { causale: 'INGRESSO_ESTERNO' })

    // --- deposito: 2 t di 17 04 05; 500 litri di 15 01 01 senza peso (fuori dal saldo) ---
    await carico(depositoAz, '2025-06-11', '17 04 05', 2, { unita: 'T' })
    await carico(depositoAz, '2025-06-12', '15 01 01', 500, { unita: 'LITRI' })

    // --- registro senza sede: 5 kg di 17 04 05, seguono la principale ---
    await carico(senzaSede, '2025-06-13', '17 04 05', 5)

    // --- un'altra azienda: non deve comparire ---
    await carico(altra, '2025-06-10', '17 04 05', 999)
  })

  afterAll(async () => {
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  const riga = (r: any, d: number, cer: string) =>
    r.dichiarazioni[d].righe.find((x: any) => x.cerCode === cer)

  it('2025: giacenze attese scritte a mano, sede per sede', async () => {
    const r = await nelTenant(() => service.aggrega(az.tenantId, 2025))

    expect(r.dichiarazioni.map(d => d.unitaLocale.denominazione)).toEqual([
      'Sede principale',
      'Deposito',
    ])
    // principale, 17 04 05: apertura 1.000 (31/12 dentro, 1/1 fuori) + 500 + 5 (registro senza
    // sede) - 200 = 1.305; lo scarico delle 23:30 UTC del 31/12 è del 2026; avviati solo a recupero
    expect(riga(r, 0, '170405')).toMatchObject({
      prodottoKg: 505,
      recuperoKg: 200,
      smaltimentoKg: 0,
      giacenzaRecuperoKg: 1305,
    })
    expect('giacenzaSmaltimentoKg' in riga(r, 0, '170405')).toBe(false)
    // principale, 20 03 01: 350,35 (rettifica) + 0,10 + 0,20 = 350,65; 400 e 90 non vigenti
    expect(riga(r, 0, '200301')).toMatchObject({
      prodottoKg: 350.65,
      giacenzaSmaltimentoKg: 350.65,
    })
    expect('giacenzaRecuperoKg' in riga(r, 0, '200301')).toBe(false)
    // principale, 15 01 01: ha una riga ma il CER è ricevuto da terzi (2024): non si scrive
    expect(riga(r, 0, '150101')).toEqual(expect.objectContaining({ prodottoKg: 20 }))
    expect('giacenzaRecuperoKg' in riga(r, 0, '150101')).toBe(false)
    expect('giacenzaSmaltimentoKg' in riga(r, 0, '150101')).toBe(false)
    // deposito: 2 t = 2.000 kg di 17 04 05; i 500 litri non fanno saldo né riga
    expect(riga(r, 1, '170405')).toMatchObject({ prodottoKg: 2000, giacenzaSmaltimentoKg: 2000 })
    expect(r.dichiarazioni[1].righe.map(x => x.cerCode)).toEqual(['170405'])

    const nonDichiarate = r.controlli.filter(c => c.codice === 'GIACENZE_NON_DICHIARATE')
    expect(nonDichiarate).toHaveLength(1)
    expect(nonDichiarate[0].sede).toBe('Sede principale')
    expect(nonDichiarate[0].kgNonDichiarati).toBe(50)
    expect(nonDichiarate[0].messaggio).toContain('(CER 15 01 01: 50 kg, ricevuto anche da terzi)')
    const stimate = r.controlli.filter(c => c.codice === 'GIACENZA_DESTINAZIONE_NON_INDICATA')
    expect(
      stimate
        .map(
          c =>
            `${c.sede}|${c.integrazione && 'chiave' in c.integrazione ? c.integrazione.chiave.split('|')[1] : ''}`
        )
        .sort()
    ).toEqual(['Deposito|170405', 'Sede principale|200301'])
    expect(r.controlli.map(c => c.codice)).not.toContain('GIACENZE_NON_CALCOLATE')
    expect(r.controlli.map(c => c.codice)).not.toContain('GIACENZA_RIPARTITA')
  })

  it('2026: il confine dell’anno italiano porta lo scarico delle 23:30 UTC nel 2026', async () => {
    // nessun movimento dichiarabile nel 2026 → nessuna dichiarazione, tutto non dichiarato.
    // principale, 17 04 05: apertura 1.000 + apertura 999 (1/1/2026, ora dentro) + 500 + 5 - 200
    // - 50 = 2.254; il deposito ha 2.000. Con lo scarico nel 2025 il valore sarebbe 2.304.
    const r = await nelTenant(() => service.aggrega(az.tenantId, 2026))

    expect(r.dichiarazioni).toEqual([])
    const nonDichiarate = r.controlli.filter(c => c.codice === 'GIACENZE_NON_DICHIARATE')
    expect(nonDichiarate).toHaveLength(2)
    const principale = nonDichiarate.find(c => c.messaggio.includes('CER 17 04 05: 2.254 kg'))
    expect(principale).toBeDefined()
    // 2.254 + 350,65 + 50 (15 01 01: 20 + 30 ricevuti nel 2024) = 2.654,65
    expect(principale?.kgNonDichiarati).toBe(2654.65)
    const deposito = nonDichiarate.find(c => c.messaggio.includes('CER 17 04 05: 2.000 kg'))
    expect(deposito?.kgNonDichiarati).toBe(2000)
    expect(r.controlli.map(c => c.codice)).toContain('NESSUN_RIFIUTO_DICHIARABILE')
  })

  it('versione 1: stesso elenco di sempre, registri sommati, senza righe di giacenza', async () => {
    const r = await nelTenant(() => service.aggrega(az.tenantId, 2025, { versioneCalcolo: 1 }))

    const g = r.controlli.filter(c => c.codice === 'GIACENZE_NON_CALCOLATE')
    expect(g).toHaveLength(1)
    // 1.305 + 2.000 (17 04 05) + 350,65 + 50 (15 01 01) = 3.705,65
    expect(g[0].kgNonDichiarati).toBe(3705.65)
    expect(g[0].messaggio).toContain('CER 17 04 05: 3.305 kg')
    expect(r.righe.every(x => x.giacenzaRecuperoKg === undefined)).toBe(true)
  })
})
