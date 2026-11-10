/**
 * Servizio O.R.SO. contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE)
 * dentro il `TenantContext` dell'azienda. Il proprietario prepara i dati e la pulizia toglie solo
 * le righe create qui, per `tenantId`.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { validateXML } from 'xmllint-wasm'
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
  creaFirConFirma,
  creaMovimento,
  creaSoggettoMud,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { ComunicazioniOrsoService } from './comunicazioni-orso.service'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from './comunicazioni-orso.port'

const XSD = readFileSync(
  join(__dirname, '../../domain/comunicazioni/orso/__fixtures__/ImpiantoMesi.xsd'),
  'utf8'
)

describe('ComunicazioniOrsoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ComunicazioniOrsoService
  const tenantCreati: string[] = []
  let contatoreFir = 0

  const nelTenant = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string, provincia: string | null = 'MI') {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    await owner.rentriUnitaLocale.update({
      where: { id: az.unitaLocaleId },
      data: { provincia },
    })
    return az
  }

  /** Carico con FIR il cui produttore sta in `provincia`, con descrizione e operazione. */
  async function caricoConFir(az: AziendaMud, provincia: string, kg: number, giorno: string) {
    const dest = { ragioneSociale: 'Dest', partitaIva: partitaIvaUnica() }
    const trasp = { ragioneSociale: 'Trasp', partitaIva: partitaIvaUnica() }
    const destinatarioId = await creaSoggettoMud(owner, az.tenantId, 'DESTINATARIO', dest)
    const trasportatoreId = await creaSoggettoMud(owner, az.tenantId, 'TRASPORTATORE', trasp)
    const firId = await creaFirConFirma(owner, az, {
      numero: `FIR-ORSO-S-${++contatoreFir}-${Date.now()}`,
      giornoTrasporto: giorno,
      destinatarioId,
      destinatario: dest,
      trasportatoreId,
      trasportatore: trasp,
      cerCode: '20 03 01',
      quantita: kg,
    })
    const ditta = await owner.ditta.findFirstOrThrow({ where: { tenantId: az.tenantId } })
    const sede = await owner.sedeDitta.create({
      data: {
        tenantId: az.tenantId,
        dittaId: ditta.id,
        via: 'Via Prova',
        civico: '1',
        cap: '20100',
        comune: 'Comune',
        provincia,
      },
    })
    await owner.fIR.update({ where: { id: firId }, data: { producerSedeId: sede.id } })
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: kg,
      unita: 'KG',
      giorno,
      firId,
      operationCode: 'R13',
    })
    await owner.wasteMovement.update({
      where: { id: m.id },
      data: { wasteDescription: 'Rifiuti urbani indifferenziati' },
    })
    return m.id
  }

  async function scarico(
    az: AziendaMud,
    kg: number,
    giorno: string,
    descrizione = 'Scarti',
    cer = '19 12 12'
  ) {
    const m = await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: cer,
      quantita: kg,
      unita: 'KG',
      giorno,
    })
    await owner.wasteMovement.update({
      where: { id: m.id },
      data: { wasteDescription: descrizione },
    })
    return m.id
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    servizio = new ComunicazioniOrsoService(app)
  })

  afterAll(async () => {
    // L'istantanea punta ai movimenti (NO ACTION): prima le comunicazioni, poi il resto.
    await owner.comunicazioneConsorzio.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('con un carico senza provincia del conferitore l’anteprima è bloccante e non si genera', async () => {
    const az = await nuovaAzienda('O1')
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 100,
      giorno: '2025-03-10',
    })
    await owner.wasteMovement.update({
      where: { id: m.id },
      data: { wasteDescription: 'Urbani', operationCode: 'R13' },
    })
    const p = { unitaLocaleId: az.unitaLocaleId, anno: 2025 }
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, p.unitaLocaleId, p.anno))
    expect(a.bloccanti).toBe(true)
    expect(a.avvisi.find(x => x.codice === 'PROVINCIA_CONFERITORE_MANCANTE')?.movimentoIds).toEqual(
      [m.id]
    )
    const errore = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, p.unitaLocaleId, p.anno)
    ).catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(ComunicazioneConBloccantiError)
    expect((errore as ComunicazioneConBloccantiError).avvisi.map(x => x.codice)).toContain(
      'PROVINCIA_CONFERITORE_MANCANTE'
    )
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('sede senza provincia: avviso bloccante dedicato', async () => {
    const az = await nuovaAzienda('O2', null)
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.unitaLocale.provincia).toBeNull()
    expect(a.avvisi.map(x => x.codice)).toContain('PROVINCIA_IMPIANTO_MANCANTE')
    expect(a.bloccanti).toBe(true)
  })

  it('descrizione vuota: ripiega sul catalogo CER, bloccante solo se manca anche lì', async () => {
    const az = await nuovaAzienda('O3')
    await caricoConFir(az, 'MI', 100, '2025-03-10')
    await scarico(az, 50, '2025-03-11', '   ') // CER 19 12 12 nel catalogo: nessun blocco
    const ok = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(ok.avvisi.map(x => x.codice)).not.toContain('DESCRIZIONE_VUOTA')
    await scarico(az, 50, '2025-03-12', '   ', '99 99 99') // CER fuori catalogo
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.avvisi.map(x => x.codice)).toContain('DESCRIZIONE_VUOTA')
    expect(a.bloccanti).toBe(true)
  })

  it('anteprima, generazione idempotente, file, invio e modifica dopo l’invio', async () => {
    const az = await nuovaAzienda('O4')
    const p = { unitaLocaleId: az.unitaLocaleId, anno: 2025 }
    const c1 = await caricoConFir(az, 'BG', 300, '2025-03-10')
    const c2 = await caricoConFir(az, 'MI', 200, '2025-03-11')
    const s1 = await scarico(az, 100, '2025-03-20')

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, p.unitaLocaleId, p.anno))
    expect(a.bloccanti).toBe(false)
    expect(a.mesi).toHaveLength(12)
    expect(a.mesi[2].ricevuti).toEqual([
      expect.objectContaining({ cer: '200301', totT: '0.5', extraT: '0.3', conFir: true }),
    ])
    expect(a.mesi[2].prodotti[0]).toMatchObject({ cer: '191212', totT: '0.1' })
    expect(a.ultima).toBeUndefined()

    const g1 = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, p.unitaLocaleId, p.anno)
    )
    expect(g1).toMatchObject({
      consorzio: 'ORSO',
      stato: 'GENERATA',
      periodoDa: '2025-01-01',
      periodoA: '2025-12-31',
      hashDati: a.hashDati,
      generataDa: az.utenteId,
      modificataDopoInvio: false,
    })
    expect(g1.nomeFile).toMatch(/^ORSO_ImpiantoMesi_2025_.+\.xml$/)
    const g2 = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, p.unitaLocaleId, p.anno)
    )
    expect(g2.id).toBe(g1.id)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(1)

    const snapshot = await owner.comunicazioneConsorzioMovimento.findMany({
      where: { comunicazioneId: g1.id },
    })
    expect(snapshot.map(s => s.movimentoId).sort()).toEqual([c1, c2, s1].sort())
    expect(Number(snapshot.find(s => s.movimentoId === c1)?.quantitaKg)).toBe(300)

    const f = await nelTenant(az, () => servizio.file(az.tenantId, g1.id))
    expect(f.nomeFile).toBe(g1.nomeFile)
    expect(f.xml).toContain('<ImpiantoMesi')
    expect(f.xml).toContain('<Mese value="3">')
    // Tutti i 12 mesi dell'anno passato (anche i vuoti), Extra sempre presente, XSD rispettato.
    expect(f.xml.match(/<Mese value=/g)).toHaveLength(12)
    expect(f.xml).toContain('Extra')
    const esito = await validateXML({
      xml: [{ fileName: 'f.xml', contents: f.xml }],
      schema: [XSD],
    })
    expect(esito.errors).toEqual([])

    const inviata = await nelTenant(az, () =>
      servizio.segnaInviata(az.tenantId, az.utenteId, g1.id)
    )
    expect(inviata).toMatchObject({
      stato: 'INVIATA',
      inviataDa: az.utenteId,
      modificataDopoInvio: false,
    })
    expect(inviata.inviataIl).toBeDefined()
    const ripetuta = await nelTenant(az, () =>
      servizio.segnaInviata(az.tenantId, az.utenteId, g1.id)
    )
    expect(ripetuta.inviataIl).toBe(inviata.inviataIl)

    // Un nuovo scarico nell'anno cambia i dati: la comunicazione inviata risulta modificata.
    await scarico(az, 40, '2025-04-02')
    const elenco = await nelTenant(az, () =>
      servizio.elenca(az.tenantId, { unitaLocaleId: az.unitaLocaleId, anno: 2025 })
    )
    expect(elenco).toHaveLength(1)
    expect(elenco[0].modificataDopoInvio).toBe(true)
    const a2 = await nelTenant(az, () => servizio.anteprima(az.tenantId, p.unitaLocaleId, p.anno))
    expect(a2.ultima?.modificataDopoInvio).toBe(true)
    expect(a2.hashDati).not.toBe(g1.hashDati)

    // Rigenerando con i dati nuovi nasce una seconda comunicazione.
    const g3 = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, p.unitaLocaleId, p.anno)
    )
    expect(g3.id).not.toBe(g1.id)
  })

  it('un anno senza movimenti si può dichiarare: 12 mesi vuoti validi sull XSD', async () => {
    const az = await nuovaAzienda('O5')
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2024))
    expect(a.bloccanti).toBe(false)
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2024)
    )
    const f = await nelTenant(az, () => servizio.file(az.tenantId, g.id))
    expect(f.xml.match(/<Mese value="\d+"/g)).toHaveLength(12)
    const esito = await validateXML({
      xml: [{ fileName: 'f.xml', contents: f.xml }],
      schema: [XSD],
    })
    expect(esito.errors).toEqual([])
  })

  it('la giacenza a fine mese entra nel file come QuantitaTrattataInternamente', async () => {
    const az = await nuovaAzienda('O6')
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '15 01 06',
      quantita: 5000,
      giorno: '2025-01-10',
      descrizione: 'Imballaggi misti',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '15 01 06',
      quantita: 2000,
      giorno: '2025-03-12',
      descrizione: 'Imballaggi misti',
      operationCode: 'R13',
    })
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.bloccanti).toBe(false)
    // Gennaio: nessuna uscita ma 5 t in giacenza; marzo: 2 t uscite, 3 t in giacenza.
    expect(a.mesi[0].prodotti).toEqual([
      expect.objectContaining({ cer: '150106', totT: '0', giacenzaFineMeseT: '5' }),
    ])
    expect(a.mesi[2].prodotti).toEqual([
      expect.objectContaining({ cer: '150106', totT: '2', giacenzaFineMeseT: '3' }),
    ])
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    const f = await nelTenant(az, () => servizio.file(az.tenantId, g.id))
    expect(f.xml).toContain('QuantitaTrattataInternamente="3"')
  })

  it('segna inviata: due richieste insieme lasciano chi e quando della prima', async () => {
    const az = await nuovaAzienda('O7')
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2024)
    )
    const [x, y] = await Promise.all([
      nelTenant(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id)),
      nelTenant(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, g.id)),
    ])
    expect(x.inviataIl).toBe(y.inviataIl)
    expect(x.stato).toBe('INVIATA')
  })

  it('un’altra azienda non vede né scarica le comunicazioni (RLS)', async () => {
    const az = await nuovaAzienda('O5')
    await caricoConFir(az, 'MI', 100, '2025-05-10')
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    const altra = await nuovaAzienda('O6')
    expect(await nelTenant(altra, () => servizio.elenca(altra.tenantId))).toEqual([])
    await expect(
      nelTenant(altra, () => servizio.file(altra.tenantId, g.id))
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    await expect(
      nelTenant(altra, () => servizio.segnaInviata(altra.tenantId, altra.utenteId, g.id))
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    await expect(
      nelTenant(altra, () => servizio.anteprima(altra.tenantId, az.unitaLocaleId, 2025))
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
  })
})
