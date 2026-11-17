/**
 * O.R.SO. modalità dettagliata (4.9e) contro un Postgres reale, collegato COME `wasteflow_app`
 * (RLS ENABLE+FORCE). I dati si preparano con il proprietario; ISTAT forzato nell'anagrafica
 * della sede (le tabelle ISTAT del database di test sono vuote).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { validateXML } from 'xmllint-wasm'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55451/wasteflow_ci?schema=public'
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
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { ComunicazioniOrsoService } from './comunicazioni-orso.service'
import { ComunicazioneConBloccantiError } from './comunicazioni-orso.port'

const XSD = readFileSync(
  join(__dirname, '../../domain/comunicazioni/orso/__fixtures__/ImpiantoMesi.xsd'),
  'utf8'
)

describe('ComunicazioniOrsoService, modalità dettagliata: Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ComunicazioniOrsoService
  const tenantCreati: string[] = []
  let contatore = 0

  const nelTenant = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    await owner.rentriUnitaLocale.update({
      where: { id: az.unitaLocaleId },
      data: { provincia: 'MI' },
    })
    return az
  }

  const dettagliata = (az: AziendaMud) =>
    owner.configurazioneComunicazioneSede.upsert({
      where: {
        tenantId_unitaLocaleId_consorzio: {
          tenantId: az.tenantId,
          unitaLocaleId: az.unitaLocaleId,
          consorzio: 'ORSO',
        },
      },
      create: {
        tenantId: az.tenantId,
        unitaLocaleId: az.unitaLocaleId,
        consorzio: 'ORSO',
        dati: { modalita: 'DETTAGLIATA' },
        versioneSchema: 1,
      },
      update: { dati: { modalita: 'DETTAGLIATA' } },
    })

  /** Sede di una ditta con i dati per le comunicazioni (ISTAT forzato, codice ARPA, comune). */
  async function sedeSoggetto(
    az: AziendaMud,
    nome: string,
    ana: { istat?: string; arpa?: string; comune?: boolean } = { istat: '015146' }
  ) {
    const ditta = await owner.ditta.create({
      data: {
        tenantId: az.tenantId,
        ragioneSociale: nome,
        partitaIva: partitaIvaUnica(),
      },
    })
    const sede = await owner.sedeDitta.create({
      data: {
        tenantId: az.tenantId,
        dittaId: ditta.id,
        via: 'Via Prova',
        civico: '1',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
        principale: true,
      },
    })
    if (ana.istat || ana.arpa || ana.comune) {
      await owner.anagraficaComunicazioniSede.create({
        data: {
          tenantId: az.tenantId,
          sedeDittaId: sede.id,
          codiceIstatComune: ana.istat ?? null,
          codiceOrso: ana.arpa ?? null,
          eComune: ana.comune ?? false,
        },
      })
    }
    return sede.id
  }

  async function movimentoConFir(
    az: AziendaMud,
    tipo: 'CARICO' | 'SCARICO',
    sedeId: string,
    kg: number,
    giorno: string
  ) {
    const dest = { ragioneSociale: 'Dest', partitaIva: partitaIvaUnica() }
    const trasp = { ragioneSociale: 'Trasp', partitaIva: partitaIvaUnica() }
    const destinatarioId = await creaSoggettoMud(owner, az.tenantId, 'DESTINATARIO', dest)
    const trasportatoreId = await creaSoggettoMud(owner, az.tenantId, 'TRASPORTATORE', trasp)
    const firId = await creaFirConFirma(owner, az, {
      numero: `FIR-ORSO-D-${++contatore}-${Date.now()}`,
      giornoTrasporto: giorno,
      destinatarioId,
      destinatario: dest,
      trasportatoreId,
      trasportatore: trasp,
      cerCode: '20 03 01',
      quantita: kg,
    })
    await owner.fIR.update({
      where: { id: firId },
      data: tipo === 'CARICO' ? { producerSedeId: sedeId } : { receiverSedeId: sedeId },
    })
    const m = await creaMovimento(owner, az, {
      type: tipo,
      causale: tipo === 'CARICO' ? 'INGRESSO_ESTERNO' : 'AVVIO_RECUPERO',
      cerCode: '20 03 01',
      quantita: kg,
      unita: 'KG',
      giorno,
      firId,
      operationCode: 'R13',
    })
    await owner.wasteMovement.update({
      where: { id: m.id },
      data: { wasteDescription: 'Rifiuti urbani' },
    })
    return m.id
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new ComunicazioniOrsoService(app)
  })

  afterAll(async () => {
    await owner.comunicazioneConsorzio.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.produttore.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('anteprima, file valido sull XSD con I e NuovoImpianto, idempotenza e nome file', async () => {
    const az = await nuovaAzienda('OD1')
    const arpa = await sedeSoggetto(az, 'Impianto ARPA', { arpa: '4321' })
    const nuova = await sedeSoggetto(az, 'Rossi Rifiuti S.r.l.', { istat: '015146' })
    const dest = await sedeSoggetto(az, 'Destinazione Nord', { istat: '016024' })
    await movimentoConFir(az, 'CARICO', arpa, 1500, '2025-03-10')
    await movimentoConFir(az, 'CARICO', nuova, 500, '2025-03-11')
    await movimentoConFir(az, 'SCARICO', dest, 700, '2025-03-20')
    await dettagliata(az)

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.avvisi).toEqual([])
    expect(a.bloccanti).toBe(false)
    expect(a).toMatchObject({
      modalita: 'DETTAGLIATA',
      nuoviImpianti: 2,
      affidabilita: 'UFFICIALE',
    })
    expect(a.notaAffidabilita).toMatch(/ricavata da WinWaste/)
    expect(a.mesi[2].ricevuti[0].soggetti?.map(s => [s.ts, s.s, s.qT])).toEqual([
      ['I', '4321', '1.5'],
      ['Inew', '1', '0.5'],
    ])
    expect(a.mesi[2].prodotti[0].soggetti?.map(s => [s.ts, s.s])).toEqual([['Inew', '2']])

    const g1 = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    expect(g1).toMatchObject({ tracciato: 'ImpiantoMesi', versione: '1-dettagliata' })
    expect(g1.nomeFile).toMatch(/^ORSO_ImpiantoMesi_2025_.+_dettagliata\.xml$/)
    const g2 = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    expect(g2.id).toBe(g1.id)

    const f = await nelTenant(az, () => servizio.file(az.tenantId, g1.id))
    expect(f.xml).toContain('ts="I" s="4321"')
    expect(f.xml).toContain('<NuovoImpianto id="1" RagioneSociale="Rossi Rifiuti S.r.l."')
    expect(f.xml).toContain('<Out q="0.7" ts="Inew" s="2"/>')
    expect(f.xml).not.toMatch(/ts="(Tot|Extra)"/)
    const esito = await validateXML({
      xml: [{ fileName: 'f.xml', contents: f.xml }],
      schema: [XSD],
    })
    expect(esito.errors).toEqual([])
  })

  it('passare da normale a dettagliata non tocca le comunicazioni già generate e inviate', async () => {
    const az = await nuovaAzienda('OD2')
    const sede = await sedeSoggetto(az, 'Conferitore', { arpa: '77' })
    await movimentoConFir(az, 'CARICO', sede, 1000, '2025-04-10')
    const normale = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    expect(normale.versione).toBe('1')
    await nelTenant(az, () => servizio.segnaInviata(az.tenantId, az.utenteId, normale.id))

    await dettagliata(az)
    const det = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    expect(det.id).not.toBe(normale.id)
    expect(det.versione).toBe('1-dettagliata')
    expect(det.hashDati).not.toBe(normale.hashDati)

    const elenco = await nelTenant(az, () =>
      servizio.elenca(az.tenantId, { unitaLocaleId: az.unitaLocaleId, anno: 2025 })
    )
    expect(elenco).toHaveLength(2)
    // La normale inviata non risulta «modificata» solo perché la sede ora è dettagliata.
    expect(elenco.find(r => r.id === normale.id)).toMatchObject({
      stato: 'INVIATA',
      modificataDopoInvio: false,
    })
    const fn = await nelTenant(az, () => servizio.file(az.tenantId, normale.id))
    expect(fn.xml).toContain('ts="Tot"')
    // L'anteprima mostra solo l'ultima della modalità di adesso.
    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.ultima?.id).toBe(det.id)
  })

  it('movimento senza FIR e sede con ISTAT non risolvibile: bloccanti spiegati, nessun file', async () => {
    const az = await nuovaAzienda('OD3')
    await dettagliata(az)
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
    const senzaIstat = await sedeSoggetto(az, 'Sede ignota', {})
    const m2 = await movimentoConFir(az, 'CARICO', senzaIstat, 200, '2025-03-12')

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.bloccanti).toBe(true)
    const nonId = a.avvisi.find(x => x.codice === 'SOGGETTO_NON_IDENTIFICATO')
    expect(nonId?.movimentoIds).toEqual([m.id])
    const istat = a.avvisi.find(x => x.codice === 'ISTAT_SOGGETTO_NON_VALIDO')
    expect(istat?.movimentoIds).toEqual([m2])
    expect(istat?.messaggio).toContain('Sede ignota (Milano)')
    // La provincia del conferitore non serve in modalità dettagliata.
    expect(a.avvisi.map(x => x.codice)).not.toContain('PROVINCIA_CONFERITORE_MANCANTE')
    await expect(
      nelTenant(az, () => servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('un comune conferitore diventa C con il suo ISTAT', async () => {
    const az = await nuovaAzienda('OD4')
    await dettagliata(az)
    const comune = await sedeSoggetto(az, 'Comune di Prova', { istat: '015146', comune: true })
    await movimentoConFir(az, 'CARICO', comune, 300, '2025-05-10')
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    const f = await nelTenant(az, () => servizio.file(az.tenantId, g.id))
    expect(f.xml).toContain('ts="C" s="015146"')
    expect(f.xml).not.toContain('NuovoImpianto')
  })

  it('FIR creati prima del 31/10 (sede NULL): soggetto dal produttore e dal destinatario di anagrafica', async () => {
    const az = await nuovaAzienda('OD5')
    await dettagliata(az)
    const prod = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore Storico',
      comune: 'Milano',
      provincia: 'MI',
    })
    const dest = await creaDittaConRuolo(owner, az.tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Destinatario Storico',
      comune: 'Milano',
      provincia: 'MI',
    })
    for (const [sedeId, istat] of [
      [prod.sedeId, '015146'],
      [dest.sedeId, '016024'],
    ]) {
      await owner.anagraficaComunicazioniSede.create({
        data: { tenantId: az.tenantId, sedeDittaId: sedeId, codiceIstatComune: istat },
      })
    }
    const firDi = async (tipo: 'CARICO' | 'SCARICO', kg: number, giorno: string) => {
      const trasp = { ragioneSociale: 'Trasp', partitaIva: partitaIvaUnica() }
      const trasportatoreId = await creaSoggettoMud(owner, az.tenantId, 'TRASPORTATORE', trasp)
      const firId = await creaFirConFirma(owner, az, {
        numero: `FIR-ORSO-S-${++contatore}-${Date.now()}`,
        giornoTrasporto: giorno,
        destinatarioId: dest.ruoloId,
        destinatario: { ragioneSociale: 'Destinatario Storico', partitaIva: partitaIvaUnica() },
        trasportatoreId,
        trasportatore: trasp,
        cerCode: '20 03 01',
        quantita: kg,
      })
      // Come un FIR di prima della migration: colonne di sede NULL, solo i riferimenti di anagrafica.
      await owner.fIR.update({
        where: { id: firId },
        data: { producerId: prod.ruoloId, producerSedeId: null, receiverSedeId: null },
      })
      const m = await creaMovimento(owner, az, {
        type: tipo,
        causale: tipo === 'CARICO' ? 'INGRESSO_ESTERNO' : 'AVVIO_RECUPERO',
        cerCode: '20 03 01',
        quantita: kg,
        unita: 'KG',
        giorno,
        firId,
        operationCode: 'R13',
      })
      await owner.wasteMovement.update({
        where: { id: m.id },
        data: { wasteDescription: 'Rifiuti urbani' },
      })
    }
    await firDi('CARICO', 800, '2025-06-10')
    await firDi('SCARICO', 300, '2025-06-20')

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.avvisi).toEqual([])
    expect(a.mesi[5].ricevuti[0].soggetti?.map(s => s.ts)).toEqual(['Inew'])
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    const f = await nelTenant(az, () => servizio.file(az.tenantId, g.id))
    expect(f.xml).toContain('RagioneSociale="Produttore Storico"')
    expect(f.xml).toContain('RagioneSociale="Destinatario Storico"')
    const esito = await validateXML({
      xml: [{ fileName: 'f.xml', contents: f.xml }],
      schema: [XSD],
    })
    expect(esito.errors).toEqual([])
  })

  it('movimenti senza FIR: soggetto dalla controparte del registro, f=0, file valido sull XSD', async () => {
    const az = await nuovaAzienda('OD6')
    await dettagliata(az)
    await sedeSoggetto(az, 'Comune di Prova', { istat: '015146', comune: true })
    await sedeSoggetto(az, 'Rossi Rifiuti S.r.l.', { istat: '015146' })
    await sedeSoggetto(az, 'Destinazione Nord', { arpa: '999' })
    const senzaFir = async (
      tipo: 'CARICO' | 'SCARICO',
      nome: string,
      kg: number,
      giorno: string
    ) => {
      const m = await creaMovimento(owner, az, {
        type: tipo,
        causale: tipo === 'CARICO' ? 'INGRESSO_ESTERNO' : 'AVVIO_RECUPERO',
        cerCode: '20 03 01',
        quantita: kg,
        giorno,
        operationCode: 'R13',
        counterpartName: nome,
        counterpartAddress: 'Via Prova 1, Milano (MI)',
      })
      await owner.wasteMovement.update({
        where: { id: m.id },
        data: { wasteDescription: 'Rifiuti urbani' },
      })
      return m.id
    }
    await senzaFir('CARICO', 'COMUNE DI PROVA', 1000, '2025-07-10')
    await senzaFir('CARICO', ' rossi  rifiuti s.r.l. ', 400, '2025-07-11')
    await senzaFir('SCARICO', 'Destinazione Nord', 600, '2025-07-20')

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.avvisi).toEqual([])
    expect(a.mesi[6].ricevuti[0].soggetti?.map(s => s.ts)).toEqual(['C', 'Inew'])
    const g = await nelTenant(az, () =>
      servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025)
    )
    const f = await nelTenant(az, () => servizio.file(az.tenantId, g.id))
    expect(f.xml).toMatch(/<In [^>]*f="0"[^>]*ts="C" s="015146"/)
    expect(f.xml).not.toContain('f="1"')
    expect(f.xml).toContain('ts="I" s="999"')
    const esito = await validateXML({
      xml: [{ fileName: 'f.xml', contents: f.xml }],
      schema: [XSD],
    })
    expect(esito.errors).toEqual([])
  })

  it('movimento senza FIR con controparte sconosciuta o ambigua: bloccante con messaggio chiaro', async () => {
    const az = await nuovaAzienda('OD7')
    await dettagliata(az)
    await sedeSoggetto(az, 'Doppia Sede', { arpa: '12' })
    const ditta = await owner.sedeDitta.findFirstOrThrow({
      where: { tenantId: az.tenantId, ditta: { ragioneSociale: 'Doppia Sede' } },
    })
    await owner.sedeDitta.create({
      data: {
        tenantId: az.tenantId,
        dittaId: ditta.dittaId,
        via: 'Via Altra',
        civico: '2',
        cap: '40100',
        comune: 'Bologna',
        provincia: 'BO',
        principale: false,
      },
    })
    const mov = async (nome: string | null, indirizzo: string | null, giorno: string) => {
      const m = await creaMovimento(owner, az, {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 100,
        giorno,
        operationCode: 'R13',
        counterpartName: nome ?? undefined,
        counterpartAddress: indirizzo ?? undefined,
      })
      await owner.wasteMovement.update({
        where: { id: m.id },
        data: { wasteDescription: 'Rifiuti urbani' },
      })
      return m.id
    }
    const ignota = await mov('Ditta Inesistente', null, '2025-08-10')
    const ambigua = await mov('Doppia Sede', null, '2025-08-11')
    const nessuna = await mov(null, null, '2025-08-12')

    const a = await nelTenant(az, () => servizio.anteprima(az.tenantId, az.unitaLocaleId, 2025))
    expect(a.bloccanti).toBe(true)
    const nonId = a.avvisi.find(x => x.codice === 'SOGGETTO_NON_IDENTIFICATO')
    expect([...(nonId?.movimentoIds ?? [])].sort()).toEqual([ignota, ambigua, nessuna].sort())
    expect(nonId?.messaggio).toMatch(/controparte del movimento/)
    expect(nonId?.messaggio).toMatch(/ragione sociale/)
    await expect(
      nelTenant(az, () => servizio.genera(az.tenantId, az.utenteId, az.unitaLocaleId, 2025))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
  })
})
