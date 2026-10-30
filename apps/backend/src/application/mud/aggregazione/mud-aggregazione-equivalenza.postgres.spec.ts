/**
 * Equivalenza dell'aggregazione MUD con l'oracolo di a2bf11e (D11) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda.
 *
 * Un'azienda con una sede, giacenze iniziali, ~30 movimenti su due anni (vigenti, una
 * rettifica, un annullamento, causali di sistema e una aziendale) e tre FIR. Le quantità attese
 * sono scritte a mano: non si ricavano dal codice sotto test.
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
import { MudAggregazioneOracoloA2bf11e } from './mud-aggregazione-a2bf11e.oracolo-spec'
import {
  creaApertura,
  creaAziendaMud,
  creaCausaleAzienda,
  creaFirConFirma,
  creaMovimento,
  creaSoggettoMud,
  pulisciAziendeMud,
  type AziendaMud,
  type DatiSoggettoMud,
} from './mud-seed.postgres-spec'

describe('MudAggregazione: equivalenza con a2bf11e — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: MudAggregazioneService
  let oracolo: MudAggregazioneOracoloA2bf11e
  const tenantCreati: string[] = []
  let az: AziendaMud

  const CER_INERTI = '17 04 05'
  const CER_URBANI = '20 03 01'
  const CER_IMBALLAGGI = '15 01 01'

  const nelTenant = <R>(fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, async () => await fn())

  // Stessa normalizzazione dell'equivalenza unitaria: i controlli come multiinsieme, salvo il
  // messaggio di CAUSALE_ESCLUSA (D13, l'unica differenza ammessa).
  const chiave = (c: any): string =>
    JSON.stringify([
      c.codice,
      c.codice === 'CAUSALE_ESCLUSA' ? '' : c.messaggio,
      c.gravita,
      c.movimenti ?? null,
      c.fir ?? null,
      c.integrazione ?? null,
      c.kgNonDichiarati ?? null,
    ])
  const normalizza = (a: any) => ({
    righe: a.righe,
    movimentiPerCer: a.movimentiPerCer,
    pericolosiPerCer: a.pericolosiPerCer,
    dichiarante: a.dichiarante,
    mudNonDovuto: a.mudNonDovuto,
    integrazioni: a.integrazioni,
    controlli: a.controlli.map(chiave).sort(),
  })

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toMatch(
      /@(127\.0\.0\.1|localhost):(55432|55436)\/wasteflow_ci\b/
    )
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const referenceData: any = { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) }
    servizio = new MudAggregazioneService(app, referenceData, logger)
    oracolo = new MudAggregazioneOracoloA2bf11e(app, referenceData, logger, servizio)

    az = await creaAziendaMud(owner, 'EQ')
    tenantCreati.push(az.tenantId)

    const destinatario: DatiSoggettoMud = {
      ragioneSociale: 'Recuperi Nord Srl',
      partitaIva: '09876543210',
    }
    const trasportatore: DatiSoggettoMud = {
      ragioneSociale: 'Trasporti Veloci Srl',
      partitaIva: '01112223334',
    }
    const destinatarioId = await creaSoggettoMud(owner, az.tenantId, 'DESTINATARIO', destinatario)
    const trasportatoreId = await creaSoggettoMud(
      owner,
      az.tenantId,
      'TRASPORTATORE',
      trasportatore
    )
    const fir = (numero: string, giornoTrasporto: string, cerCode: string, quantita: number) =>
      creaFirConFirma(owner, az, {
        numero,
        giornoTrasporto,
        destinatarioId,
        destinatario,
        trasportatoreId,
        trasportatore,
        cerCode,
        quantita,
      })
    const f1 = await fir('FIR-2025-000001', '2025-06-01', CER_INERTI, 600)
    const f2 = await fir('FIR-2025-000002', '2025-09-15', CER_INERTI, 200)
    const f3 = await fir('FIR-2026-000003', '2026-03-01', CER_INERTI, 50)

    // Giacenza iniziale: 1 tonnellata di 17 04 05 al 1/1/2025 (1000 kg).
    await creaApertura(owner, az, {
      cerCode: CER_INERTI,
      quantita: 1,
      unita: 'T',
      data: '2025-01-01',
    })
    const azBio = await creaCausaleAzienda(owner, az.tenantId, {
      codice: 'AZ_BIO',
      verso: 'CARICO',
      ruolo: 'PRODOTTO',
      dal: '2025-01-01',
    })

    const carico = (
      giorno: string,
      cerCode: string,
      quantita: number,
      causale = 'PRODUZIONE_INTERNA'
    ) => creaMovimento(owner, az, { type: 'CARICO', causale, cerCode, quantita, giorno })

    // --- 2025 ---
    await carico('2025-02-10', CER_INERTI, 1000)
    // 500 kg rettificati a 400
    const daRettificare = await carico('2025-03-10', CER_INERTI, 500)
    await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: CER_INERTI,
      quantita: 400,
      giorno: '2025-03-10',
      rettificatoId: daRettificare.id,
      originaleId: daRettificare.id,
    })
    // 300 kg annullati
    const daAnnullare = await carico('2025-04-10', CER_INERTI, 300)
    await creaMovimento(owner, az, {
      tipo: 'ANNULLAMENTO',
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: CER_INERTI,
      quantita: 300,
      giorno: '2025-04-10',
      rettificatoId: daAnnullare.id,
      originaleId: daAnnullare.id,
    })
    await carico('2025-04-20', CER_URBANI, 250)
    await carico('2025-04-21', CER_URBANI, 50, 'RECUPERO_PARZIALE')
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'AZ_BIO',
      causaleAziendaId: azBio,
      cerCode: CER_URBANI,
      quantita: 80,
      giorno: '2025-04-22',
    })
    await carico('2025-05-02', CER_IMBALLAGGI, 20, 'INGRESSO_ESTERNO')
    await carico('2025-05-03', CER_IMBALLAGGI, 7, 'ALTRO_CARICO')
    for (let mese = 1; mese <= 12; mese++) {
      await carico(`2025-${String(mese).padStart(2, '0')}-25`, CER_URBANI, 10)
    }
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: CER_INERTI,
      quantita: 600,
      giorno: '2025-06-01',
      firId: f1,
      operationCode: 'R13',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'CONFERIMENTO_TRASPORTATORE',
      cerCode: CER_INERTI,
      quantita: 200,
      giorno: '2025-09-15',
      firId: f2,
      operationCode: 'R13',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_SMALTIMENTO',
      cerCode: CER_URBANI,
      quantita: 100,
      giorno: '2025-10-05',
      counterpartName: 'Smaltimenti Sud Srl',
    })

    // --- 2026 ---
    await carico('2026-02-01', CER_INERTI, 100)
    await carico('2026-02-15', CER_URBANI, 40)
    // stesso FIR dell'anno prima, scaricato di nuovo
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: CER_INERTI,
      quantita: 50,
      giorno: '2026-03-01',
      firId: f1,
      operationCode: 'R13',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: CER_INERTI,
      quantita: 50,
      giorno: '2026-03-02',
      firId: f3,
      operationCode: 'R13',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'ALTRO_SCARICO',
      cerCode: CER_URBANI,
      quantita: 5,
      giorno: '2026-04-01',
    })
  })

  afterAll(async () => {
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it.each([2025, 2026])('anno %i: righe, conteggi e controlli identici all’oracolo', async anno => {
    const attuale = await nelTenant(() => servizio.aggrega(az.tenantId, anno))
    const storico = await nelTenant(() => oracolo.aggrega(az.tenantId, anno))
    expect(attuale.righe.length).toBeGreaterThan(0)
    expect(normalizza(attuale)).toEqual(normalizza(storico))
  })

  it('2025: quantità attese scritte a mano', async () => {
    const r = await nelTenant(() => servizio.aggrega(az.tenantId, 2025))
    const riga = (cer: string) => r.righe.find(x => x.cerCode === cer)
    // 1000 + 400 (rettifica di 500); i 300 annullati non contano
    expect(riga('170405')).toMatchObject({ prodottoKg: 1400, recuperoKg: 800, smaltimentoKg: 0 })
    // 250 + 50 + 80 (causale aziendale) + 12 x 10; smaltimento 100
    expect(riga('200301')).toMatchObject({ prodottoKg: 500, recuperoKg: 0, smaltimentoKg: 100 })
    // saldi al 31/12: 17 04 05 = 1000 + 1000 + 400 - 600 - 200 = 1600; 20 03 01 = 500 - 100 = 400;
    // 15 01 01 = 20 + 7 = 27
    const giacenze = r.controlli.find(c => c.codice === 'GIACENZE_NON_CALCOLATE')
    expect(giacenze?.kgNonDichiarati).toBe(2027)
  })

  it('2026: il FIR dell’anno prima scaricato di nuovo è segnalato, con le quantità a mano', async () => {
    const r = await nelTenant(() => servizio.aggrega(az.tenantId, 2026))
    expect(r.controlli.map(c => c.codice)).toContain('FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')
    const riga = (cer: string) => r.righe.find(x => x.cerCode === cer)
    // prodotto 100; avviato 50 + 50 (due FIR)
    expect(riga('170405')).toMatchObject({ prodottoKg: 100, recuperoKg: 100 })
    expect(riga('200301')).toMatchObject({ prodottoKg: 40 })
  })
})
