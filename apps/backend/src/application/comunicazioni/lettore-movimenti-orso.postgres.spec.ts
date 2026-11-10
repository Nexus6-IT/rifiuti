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

  it('vede solo i movimenti della propria azienda', async () => {
    const lettura = await leggi(altraAzienda)
    expect(lettura.movimenti.map(m => m.quantita)).toEqual([4])
    const vuota = await creaAziendaMud(owner, 'OV')
    tenantCreati.push(vuota.tenantId)
    expect((await leggi(vuota)).movimenti).toEqual([])
  })
})
