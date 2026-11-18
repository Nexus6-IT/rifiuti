/**
 * Lettore dei movimenti O.R.SO. contro un Postgres reale, collegato COME `wasteflow_app`
 * (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda. Il proprietario (`wasteflow`)
 * prepara i dati e la pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import {
  creaAziendaMud,
  creaFirConFirma,
  creaMovimento,
  creaSoggettoMud,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { leggiMovimentiOrso, type LetturaMovimentiOrso } from './lettore-movimenti-orso'

describe('leggiMovimentiOrso — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let az: AziendaMud
  let altraSedeId: string
  let altroRegistroId: string
  let altraAzienda: AziendaMud

  const da = new Date('2025-03-01T00:00:00Z')
  const a = new Date('2025-04-01T00:00:00Z')

  async function leggi(
    azienda: AziendaMud,
    pesiSpecifici?: Parameters<typeof leggiMovimentiOrso>[1]['pesiSpecifici']
  ): Promise<LetturaMovimentiOrso> {
    return TenantContext.run({ tenantId: azienda.tenantId }, async () => {
      const catalogo = await caricaCatalogoCausali(app, azienda.tenantId)
      return leggiMovimentiOrso(app, {
        tenantId: azienda.tenantId,
        unitaLocaleId: azienda.unitaLocaleId,
        da,
        a,
        catalogo,
        pesiSpecifici,
      })
    })
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    az = await creaAziendaMud(owner, 'OR', { province: 'MI' })
    tenantCreati.push(az.tenantId)
    await owner.rentriUnitaLocale.update({
      where: { id: az.unitaLocaleId },
      data: { provincia: 'MI' },
    })
    // Seconda sede della stessa azienda, con il suo registro: i suoi movimenti non contano.
    const altraSede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: az.tenantId,
        numIscrSito: 'OP0001MS999999-MI0002',
        denominazione: 'Seconda sede',
      },
    })
    altraSedeId = altraSede.id
    const altroRegistro = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Altro', unitaLocaleId: altraSedeId },
    })
    altroRegistroId = altroRegistro.id
    // Altra azienda: mai visibile.
    altraAzienda = await creaAziendaMud(owner, 'OX')
    tenantCreati.push(altraAzienda.tenantId)
  })

  afterAll(async () => {
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('restituisce solo i movimenti vigenti della sede nel periodo (rettifiche, annullamenti)', async () => {
    const ord = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 500,
      giorno: '2025-03-10',
    })
    const rett = await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 450,
      giorno: '2025-03-10',
      rettificatoId: ord.id,
      originaleId: ord.id,
    })
    // Catena annullata: ordinaria + annullamento, nessuno dei due conta.
    const daAnnullare = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '15 01 01',
      quantita: 77,
      giorno: '2025-03-11',
    })
    await creaMovimento(owner, az, {
      tipo: 'ANNULLAMENTO',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '15 01 01',
      quantita: 77,
      giorno: '2025-03-11',
      rettificatoId: daAnnullare.id,
      originaleId: daAnnullare.id,
    })
    // Fuori periodo (prima e alla data di fine, esclusa), altra sede, altra azienda.
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 1,
      giorno: '2025-02-28',
    })
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 2,
      istante: '2025-04-01T00:00:00Z',
      giorno: '2025-04-01',
    })
    await creaMovimento(
      owner,
      { ...az, registroId: altroRegistroId },
      {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 3,
        giorno: '2025-03-12',
      }
    )
    await creaMovimento(owner, altraAzienda, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 4,
      giorno: '2025-03-12',
    })

    const lettura = await leggi(az)
    expect(lettura.provinciaImpianto).toBe('MI')
    const letti = lettura.movimenti
    expect(letti.map(m => [m.id, m.quantita])).toEqual([[rett.id, 450]])
    expect(letti[0]).toMatchObject({
      tipo: 'CARICO',
      cer: '200301',
      pericoloso: false,
      kg: 450,
      ruolo: 'RICEVUTO_DA_TERZI',
      conFir: false,
      provinciaConferitore: null,
    })
  })

  it('scarico: ruolo, operazione dal catalogo e FIR con provincia del conferitore', async () => {
    const dest = { ragioneSociale: 'Dest', partitaIva: partitaIvaUnica() }
    const trasp = { ragioneSociale: 'Trasp', partitaIva: partitaIvaUnica() }
    const destinatarioId = await creaSoggettoMud(owner, az.tenantId, 'DESTINATARIO', dest)
    const trasportatoreId = await creaSoggettoMud(owner, az.tenantId, 'TRASPORTATORE', trasp)
    const firId = await creaFirConFirma(owner, az, {
      numero: 'FIR-ORSO-1',
      giornoTrasporto: '2025-03-15',
      destinatarioId,
      destinatario: dest,
      trasportatoreId,
      trasportatore: trasp,
      cerCode: '16 01 03',
      quantita: 300,
    })
    const sedeBg = await owner.sedeDitta.create({
      data: {
        tenantId: az.tenantId,
        dittaId: (await owner.ditta.findFirstOrThrow({ where: { tenantId: az.tenantId } })).id,
        via: 'Via Prova',
        civico: '1',
        cap: '24100',
        comune: 'Bergamo',
        provincia: 'BG',
      },
    })
    await owner.fIR.update({ where: { id: firId }, data: { producerSedeId: sedeBg.id } })

    const carico = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '16 01 03*',
      quantita: 300,
      giorno: '2025-03-15',
      firId,
    })
    const scarico = await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '16 01 03',
      quantita: 2,
      unita: 'T',
      giorno: '2025-03-20',
    })

    const { movimenti } = await leggi(az)
    const c = movimenti.find(m => m.id === carico.id)
    expect(c).toMatchObject({
      pericoloso: true,
      conFir: true,
      firId,
      provinciaConferitore: 'BG',
    })
    const s = movimenti.find(m => m.id === scarico.id)
    expect(s).toMatchObject({
      tipo: 'SCARICO',
      ruolo: 'AVVIATO',
      operazione: 'R',
      origineOperazione: 'CATALOGO',
      kg: 2000,
      conFir: false,
    })
  })

  it('unità non di massa: kg solo con il peso specifico, altrimenti null', async () => {
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 10,
      unita: 'L',
      giorno: '2025-03-25',
    })
    const senza = (await leggi(az)).movimenti.find(x => x.id === m.id)
    expect(senza?.kg).toBeNull()
    expect(senza?.unita).toBe('L')

    const con = (
      await leggi(az, {
        '130205|L': { cerCode: '13 02 05', unita: 'L', kgPerUnita: 0.9 },
      })
    ).movimenti.find(x => x.id === m.id)
    expect(con?.kg).toBe(9)
  })

  it('descrizione vuota: ripiega sulla descrizione del catalogo CER, tagliata a 100', async () => {
    const codice = '99 88 77'
    const cat = await owner.cERCode.upsert({
      where: { code: codice },
      update: { description: 'D'.repeat(130) },
      create: {
        code: codice,
        description: 'D'.repeat(130),
        category: 'prova',
        subcategory: 'prova',
      },
    })
    try {
      const mov = await creaMovimento(owner, az, {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: codice,
        quantita: 10,
        giorno: '2025-03-12',
      })
      const { movimenti } = await leggi(az)
      expect(movimenti.find(m => m.id === mov.id)?.descrizione).toBe('D'.repeat(100))
    } finally {
      await owner.cERCode.deleteMany({ where: { id: cat.id } })
    }
  })

  it('operazione: ripiega sul codice del FIR se il movimento non lo ha', async () => {
    const dest = { ragioneSociale: 'Dest2', partitaIva: partitaIvaUnica() }
    const trasp = { ragioneSociale: 'Trasp2', partitaIva: partitaIvaUnica() }
    const firId = await creaFirConFirma(owner, az, {
      numero: 'FIR-ORSO-2',
      giornoTrasporto: '2025-03-16',
      destinatarioId: await creaSoggettoMud(owner, az.tenantId, 'DESTINATARIO', dest),
      destinatario: dest,
      trasportatoreId: await creaSoggettoMud(owner, az.tenantId, 'TRASPORTATORE', trasp),
      trasportatore: trasp,
      cerCode: '17 02 01',
      quantita: 40,
      codiceOperazione: 'R13',
    })
    const mov = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '17 02 01',
      quantita: 40,
      giorno: '2025-03-16',
      firId,
    })
    const { movimenti } = await leggi(az)
    expect(movimenti.find(m => m.id === mov.id)?.operationCode).toBe('R13')
  })

  it('provincia del conferitore senza FIR: la ricava dalla sigla fra parentesi dell indirizzo', async () => {
    const conSigla = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '17 02 02',
      quantita: 5,
      giorno: '2025-03-17',
      counterpartAddress: 'Via Roma 1, 24100 Bergamo (bg)',
    })
    const senza = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '17 02 02',
      quantita: 5,
      giorno: '2025-03-18',
      counterpartAddress: 'Via Roma 1, Bergamo',
    })
    const { movimenti } = await leggi(az)
    expect(movimenti.find(m => m.id === conSigla.id)).toMatchObject({
      provinciaConferitore: 'BG',
      provinciaDaIndirizzo: true,
    })
    expect(movimenti.find(m => m.id === senza.id)).toMatchObject({
      provinciaConferitore: null,
      provinciaDaIndirizzo: false,
    })
  })

  it('sedeControparteId: valorizzato se il movimento ha la sede della controparte, null per i movimenti storici', async () => {
    const dittaRiga = await owner.ditta.create({
      data: {
        tenantId: az.tenantId,
        ragioneSociale: 'Comune di Calliano',
        partitaIva: partitaIvaUnica(),
      },
    })
    const ditta = {
      sedeId: (
        await owner.sedeDitta.create({
          data: {
            tenantId: az.tenantId,
            dittaId: dittaRiga.id,
            via: 'Via Roma',
            civico: '1',
            cap: '38060',
            comune: 'Calliano',
            provincia: 'TN',
            principale: true,
          },
        })
      ).id,
    }
    const con = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '17 02 02',
      quantita: 5,
      giorno: '2025-03-19',
      counterpartName: 'Comune di Calliano',
      counterpartSedeId: ditta.sedeId,
    })
    const senza = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '17 02 02',
      quantita: 5,
      giorno: '2025-03-20',
      counterpartName: 'Comune di Calliano',
    })
    const { movimenti } = await leggi(az)
    expect(movimenti.find(m => m.id === con.id)?.sedeControparteId).toBe(ditta.sedeId)
    expect(movimenti.find(m => m.id === senza.id)?.sedeControparteId).toBeNull()
  })

  it('giacenze a fine mese: aperture + carichi - scarichi vigenti, anche di anni precedenti', async () => {
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: az.tenantId,
        numIscrSito: 'OP0001MS999999-MI0003',
        denominazione: 'Sede giacenze',
      },
    })
    const reg = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Giacenze', unitaLocaleId: sede.id },
    })
    const azG = { ...az, unitaLocaleId: sede.id, registroId: reg.id } as AziendaMud
    await creaMovimento(owner, azG, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '15 01 06',
      quantita: 4000,
      giorno: '2024-12-20',
      descrizione: 'Imballaggi misti',
    })
    await creaMovimento(owner, azG, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '15 01 06',
      quantita: 1000,
      giorno: '2025-02-10',
    })
    await creaMovimento(owner, azG, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '15 01 06',
      quantita: 2.5,
      unita: 'T',
      giorno: '2025-03-05',
    })
    const annullata = await creaMovimento(owner, azG, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '15 01 06',
      quantita: 999,
      giorno: '2025-03-06',
    })
    await creaMovimento(owner, azG, {
      tipo: 'ANNULLAMENTO',
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '15 01 06',
      quantita: 999,
      giorno: '2025-03-06',
      rettificatoId: annullata.id,
      originaleId: annullata.id,
    })
    const lettura = await TenantContext.run({ tenantId: az.tenantId }, async () =>
      leggiMovimentiOrso(app, {
        tenantId: az.tenantId,
        unitaLocaleId: sede.id,
        da: new Date('2025-01-01T00:00:00Z'),
        a: new Date('2026-01-01T00:00:00Z'),
        catalogo: await caricaCatalogoCausali(app, az.tenantId),
        anno: 2025,
      })
    )
    const perMese = Object.fromEntries(
      lettura.giacenze.filter(g => g.cer === '150106').map(g => [g.mese, g.kg])
    )
    expect(perMese[1]).toBe(4000)
    expect(perMese[2]).toBe(5000)
    expect(perMese[3]).toBe(2500)
    expect(perMese[12]).toBe(2500)
    expect(lettura.giacenze.find(g => g.cer === '150106')?.descrizione).toBe('Imballaggi misti')
  })

  it('capodanno di Roma: movimenti e giacenze usano i pesi specifici del proprio anno', async () => {
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: az.tenantId,
        numIscrSito: 'OP0001MS999999-MI0004',
        denominazione: 'Sede capodanno',
      },
    })
    const reg = await owner.registroRifiuti.create({
      data: { tenantId: az.tenantId, descrizione: 'Capodanno', unitaLocaleId: sede.id },
    })
    const azC = { ...az, unitaLocaleId: sede.id, registroId: reg.id } as AziendaMud
    const base = {
      type: 'CARICO' as const,
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05',
      quantita: 100,
      unita: 'L',
      giorno: '2025-12-31',
    }
    // 23:30 del 31/12 a Roma (22:30Z) e 00:30 del 01/01 a Roma (23:30Z)
    const prima = await creaMovimento(owner, azC, { ...base, istante: '2025-12-31T22:30:00Z' })
    const dopo = await creaMovimento(owner, azC, { ...base, istante: '2025-12-31T23:30:00Z' })
    const peso = (kg: number) => ({
      '130205|L': { cerCode: '13 02 05', unita: 'L', kgPerUnita: kg },
    })
    const lettura = await TenantContext.run({ tenantId: az.tenantId }, async () =>
      leggiMovimentiOrso(app, {
        tenantId: az.tenantId,
        unitaLocaleId: sede.id,
        da: new Date('2025-12-31T00:00:00Z'),
        a: new Date('2026-01-02T00:00:00Z'),
        catalogo: await caricaCatalogoCausali(app, az.tenantId),
        anno: 2026,
        pesiSpecificiPerAnno: { 2025: peso(0.5), 2026: peso(2) },
      })
    )
    expect(lettura.movimenti.find(x => x.id === prima.id)?.kg).toBe(50)
    expect(lettura.movimenti.find(x => x.id === dopo.id)?.kg).toBe(200)
    // gennaio 2026: 50 kg (peso 2025) + 200 kg (peso 2026)
    expect(lettura.giacenze.find(g => g.cer === '130205' && g.mese === 1)?.kg).toBe(250)
  })

  it('vede solo i movimenti della propria azienda', async () => {
    const lettura = await leggi(altraAzienda)
    expect(lettura.movimenti.map(m => m.quantita)).toEqual([4])
    const vuota = await creaAziendaMud(owner, 'OV')
    tenantCreati.push(vuota.tenantId)
    expect((await leggi(vuota)).movimenti).toEqual([])
  })
})
