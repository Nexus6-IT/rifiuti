/**
 * Preparatori CONOU e COBAT (4.9c-d, B5) contro un Postgres reale, collegato COME `wasteflow_app`
 * dentro il `TenantContext` dell'azienda, con il servizio generico e i tracciati veri.
 * ISTAT di prova: provincia `ZZ` (codice 998) e un comune fittizio, tolti a fine prova.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55450/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { registroTracciati } from '../../domain/comunicazioni/registro-tracciati'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { ComunicazioneConBloccantiError } from './comunicazioni-orso.port'
import type { PreparatoreTracciato, RichiestaComunicazione } from './comunicazioni-tracciato.port'
import { ComunicazioniTracciatoService } from './comunicazioni-tracciato.service'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import { DatiTracciatoService } from './dati-tracciato.service'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import { PreparatoreCobat } from './preparatore-cobat'
import { PreparatoreConou } from './preparatore-conou'

const COD_PROVINCIA = '998'
const COD_COMUNE = '998001'

describe('Preparatori CONOU e COBAT — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ComunicazioniTracciatoService
  let dati: DatiTracciatoService
  let configurazioni: ConfigurazioneComunicazioniService
  let marcatura: MarcaturaConsorziService
  const tenantCreati: string[] = []
  let seme = 700

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  /** Azienda con la sede propria a «Cittaprova» (ZZ), per il blocco ISTAT del COBAT. */
  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'ZZ' })
    tenantCreati.push(az.tenantId)
    await owner.rentriUnitaLocale.update({
      where: { id: az.unitaLocaleId },
      data: {
        indirizzo: 'Via delle Officine',
        civico: '5',
        cap: '24100',
        comune: 'Cittaprova',
        provincia: 'ZZ',
      },
    })
    return az
  }

  async function creaControparti(az: AziendaMud) {
    const nuovaPiva = () => partitaIvaValida(++seme)
    const prod = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Officina Rossi SRL',
      partitaIva: nuovaPiva(),
      via: 'Via Roma',
      civico: '12',
      cap: '24100',
      comune: 'Cittaprova',
      provincia: 'ZZ',
    })
    const tras = await creaDittaConRuolo(owner, az.tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Rapidi SRL',
      partitaIva: nuovaPiva(),
      comune: 'Cittaprova',
      provincia: 'ZZ',
    })
    const dest = await creaDittaConRuolo(owner, az.tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Recuperi SPA',
      partitaIva: nuovaPiva(),
      comune: 'Cittaprova',
      provincia: 'ZZ',
    })
    await owner.anagraficaComunicazioniSede.create({
      data: { tenantId: az.tenantId, sedeDittaId: prod.sedeId, codiceAteco: '45.20.10' },
    })
    return { prod, tras, dest }
  }

  async function creaFir(
    az: AziendaMud,
    c: Awaited<ReturnType<typeof creaControparti>>,
    o: { numero: string; destinatarioNoi?: boolean; cer?: string }
  ): Promise<string> {
    const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: az.tenantId } })
    const fir = await owner.fIR.create({
      data: {
        tenantId: az.tenantId,
        firNumber: o.numero,
        status: 'COMPLETED',
        producerUserId: az.utenteId,
        producerSedeId: c.prod.sedeId,
        receiverSedeId: o.destinatarioNoi ? null : c.dest.sedeId,
        producerCodiceFiscale: '05555555555',
        carrierCodiceFiscale: '09876543210',
        receiverCodiceFiscale: o.destinatarioNoi ? tenant.partitaIva : '11122233344',
        producerPartitaIva: '05555555555',
        producerName: 'Officina Rossi SRL',
        producerAddress: 'Via Roma 12, Cittaprova',
        carrierId: c.tras.ruoloId,
        carrierPartitaIva: '09876543210',
        carrierName: 'Trasporti Rapidi SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverId: c.dest.ruoloId,
        receiverPartitaIva: o.destinatarioNoi ? tenant.partitaIva : '11122233344',
        receiverName: o.destinatarioNoi ? tenant.ragioneSociale : 'Recuperi SPA',
        receiverAddress: 'Via Po 2, Cittaprova',
        cerCode: o.cer ?? '13 02 05*',
        wasteDescription: 'Rifiuto',
        wasteCategory: 'PERICOLOSO',
        quantity: 100,
        wasteOperationType: 'RECOVERY',
        wasteOperationCode: 'R13',
        transportDate: new Date('2026-05-09T08:00:00Z'),
      },
    })
    return fir.id
  }

  const richiesta = (
    az: AziendaMud,
    consorzio: 'CONOU' | 'COBAT',
    extra: Partial<RichiestaComunicazione> = {}
  ): RichiestaComunicazione => ({
    consorzio,
    unitaLocaleId: az.unitaLocaleId,
    da: '2026-05-01',
    a: '2026-05-31',
    ...extra,
  })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    // Fixture ISTAT di prova (nessun dato di produzione): si tolgono per codice a fine prova.
    await owner.istatProvincia.upsert({
      where: { sigla: 'ZZ' },
      create: {
        sigla: 'ZZ',
        code: COD_PROVINCIA,
        name: 'Provincia di prova',
        regione: 'Lombardia',
      },
      update: {},
    })
    await owner.istatComune.upsert({
      where: { code: COD_COMUNE },
      create: { code: COD_COMUNE, name: 'Cittaprova', provinciaSigla: 'ZZ', cap: '24100' },
      update: {},
    })
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    configurazioni = new ConfigurazioneComunicazioniService(app)
    dati = new DatiTracciatoService(app)
    marcatura = new MarcaturaConsorziService(app)
    servizio = new ComunicazioniTracciatoService(
      app,
      marcatura,
      configurazioni,
      [new PreparatoreConou(app), new PreparatoreCobat(app)] as unknown as PreparatoreTracciato[],
      registroTracciati
    )
  })

  afterAll(async () => {
    const where = { tenantId: { in: tenantCreati } }
    await owner.comunicazioneConsorzio.deleteMany({ where })
    await owner.datiTracciatoMovimento.deleteMany({ where })
    await owner.datiConsorzioMovimento.deleteMany({ where })
    await owner.configurazioneComunicazioneSede.deleteMany({ where })
    await owner.anagraficaComunicazioniSede.deleteMany({ where })
    await owner.produttore.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await owner.istatComune.deleteMany({ where: { code: COD_COMUNE } })
    await owner.istatProvincia.deleteMany({ where: { code: COD_PROVINCIA } })
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('CONOU: marcato a mano dentro, escluso a mano fuori, rettifica con i valori della vigente, annullato fuori; l’hash cambia con la percentuale', async () => {
    const az = await nuovaAzienda('C1')
    const c = await creaControparti(az)
    const firId = await creaFir(az, c, { numero: 'ABC123/26' })
    const olio = (giorno: string, quantita: number, cerCode = '13 02 05*') =>
      creaMovimento(owner, az, {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode,
        quantita,
        unita: 'KG',
        giorno,
        firId,
      })
    const m1 = await olio('2026-05-10', 1500)
    const m2 = await olio('2026-05-11', 200, '20 03 01') // non del CONOU: marcato a mano
    const m3 = await olio('2026-05-12', 300) // escluso a mano
    const m4 = await olio('2026-05-13', 70)
    await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 75,
      unita: 'KG',
      giorno: '2026-05-13',
      firId,
      rettificatoId: m4.id,
      originaleId: m4.id,
    })
    const m5 = await olio('2026-05-14', 40)
    await creaMovimento(owner, az, {
      tipo: 'ANNULLAMENTO',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 40,
      unita: 'KG',
      giorno: '2026-05-14',
      firId,
      rettificatoId: m5.id,
      originaleId: m5.id,
    })
    await nel(az, () => marcatura.impostaOverride(az.tenantId, az.utenteId, m2.id, 'CONOU', false))
    await nel(az, () => marcatura.impostaOverride(az.tenantId, az.utenteId, m3.id, 'CONOU', true))
    await nel(az, () =>
      dati.imposta(az.tenantId, az.utenteId, m2.id, 'CONOU', { prodotto: 'A', percentualeOlio: 50 })
    )
    await nel(az, () =>
      configurazioni.imposta(az.tenantId, az.unitaLocaleId, 'CONOU', {
        codiceDeposito: 'BG001',
        predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 84.99 } },
      })
    )

    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az, 'CONOU')))
    expect(a.avvisi.filter(x => x.bloccante)).toEqual([])
    expect(a).toMatchObject({
      tracciato: 'Movi2023',
      versione: 'Movi2023-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      numeroRecord: 3,
      numeroMovimenti: 3,
      bloccanti: false,
    })
    const g = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'CONOU')))
    expect(g.nomeFile).toBe('Movi.txt')
    const f = await nel(az, () => servizio.file(az.tenantId, g.id))
    expect(f.contentType).toBe('text/plain; charset=windows-1252')
    const righe = f.contenuto.toString('latin1').split('\r\n').filter(Boolean)
    expect(righe).toHaveLength(3)
    for (const r of righe) expect(r).toHaveLength(299)
    const cer = righe.map(r => r.slice(268, 274))
    const kg = righe.map(r => r.slice(286, 297).trim())
    const perc = righe.map(r => r.slice(274, 278).trim())
    expect(cer).toEqual(['130205', '200301', '130205'])
    // m4: i 75 kg della rettifica, non i 70 originali; m5 annullato e m3 escluso assenti.
    expect(kg).toEqual(['1500', '200', '75'])
    expect(perc).toEqual(['8499', '5000', '8499'])
    expect(righe[0].slice(0, 16).trim()).toBe('05555555555')
    expect(righe[0].slice(181, 189).trim()).toBe('45.20.10')
    expect(righe[0].slice(189, 198)).toBe("003998001")
    expect(righe[0].slice(198, 208).trim()).toBe('BG001')
    expect(righe[0].slice(216, 222).trim()).toBe('ABC')

    // Cambiare la percentuale cambia l'hash: un'altra comunicazione.
    await nel(az, () =>
      dati.imposta(az.tenantId, az.utenteId, m1.id, 'CONOU', { percentualeOlio: 70 })
    )
    const g2 = await nel(az, () =>
      servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'CONOU'))
    )
    expect(g2.id).not.toBe(g.id)
    expect(g2.hashDati).not.toBe(g.hashDati)
    // Senza modifiche, la stessa comunicazione.
    const g3 = await nel(az, () =>
      servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'CONOU'))
    )
    expect(g3.id).toBe(g2.id)
  })

  it('CONOU: bloccanti (deposito, prodotto, ATECO) per movimento con il punto di correzione; nessun file', async () => {
    const az = await nuovaAzienda('C2')
    const c = await creaControparti(az)
    const firId = await creaFir(az, c, { numero: 'ABC124/26', cer: '13 01 01*' })
    await owner.anagraficaComunicazioniSede.deleteMany({ where: { tenantId: az.tenantId } })
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 01 01*', // piu' prodotti ammessi: nessun predefinito
      quantita: 100,
      giorno: '2026-05-10',
      firId,
    })
    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az, 'CONOU')))
    expect(a.bloccanti).toBe(true)
    const codici = a.avvisi.filter(x => x.bloccante).map(x => x.codice)
    expect(codici).toEqual(
      expect.arrayContaining([
        'CODICE_DEPOSITO_MANCANTE',
        'PRODOTTO_MANCANTE',
        'PERCENTUALE_OLIO_MANCANTE',
        'ATECO_MANCANTE',
      ])
    )
    expect(a.avvisi.find(x => x.codice === 'ATECO_MANCANTE')?.correzione).toEqual({
      tipo: 'ANAGRAFICA_SEDE',
      sedeDittaId: c.prod.sedeId,
    })
    await expect(
      nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'CONOU')))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('CONOU: un periodo a cavallo di due anni e rifiutato', async () => {
    const az = await nuovaAzienda('C3')
    await expect(
      nel(az, () =>
        servizio.anteprima(
          az.tenantId,
          richiesta(az, 'CONOU', { da: '2026-12-01', a: '2027-01-31' })
        )
      )
    ).rejects.toThrow(/stesso anno/)
  })

  it('COBAT: carico da terzi con trasportatore esterno -> record di 1628 byte, tipmov 6; modifica del PGF cambia l’hash', async () => {
    const az = await nuovaAzienda('B1')
    const c = await creaControparti(az)
    const firId = await creaFir(az, c, {
      numero: 'ABC125/26',
      destinatarioNoi: true,
      cer: '16 06 01*',
    })
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '16 06 01*',
      quantita: 1250,
      unita: 'KG',
      giorno: '2026-05-10',
      firId,
      operationCode: 'R13',
    })
    await nel(az, () =>
      configurazioni.imposta(az.tenantId, az.unitaLocaleId, 'COBAT', {
        campagnaPredefinita: { codice: '01', descrizione: 'Campagna prova' },
        pgfPerCer: { '160601': 'A' },
      })
    )
    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az, 'COBAT')))
    expect(a.avvisi.filter(x => x.bloccante)).toEqual([])
    expect(a).toMatchObject({
      tracciato: 'Movcob',
      versione: 'Movcob-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      numeroRecord: 1,
    })
    const g = await nel(az, () => servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'COBAT')))
    expect(g.nomeFile).toBe('Movcob.txt')
    const f = await nel(az, () => servizio.file(az.tenantId, g.id))
    expect(f.contenuto).toHaveLength(1628)
    const testo = f.contenuto.toString('latin1')
    expect(testo.slice(0, 8)).toBe('20260510')
    expect(testo.slice(14, 30).trim()).toBe('09876543210') // codazi: il trasportatore esterno
    expect(testo.slice(30, 31)).toBe('6')
    expect(testo.slice(107, 108)).toBe('5')
    expect(testo.slice(136, 142)).toBe('160601')
    expect(testo.slice(164, 178)).toBe('     1.2500000')
    expect(testo.slice(178, 238).trim()).toBe('Officina Rossi SRL')
    expect(testo.slice(1409, 1628)).toBe(`${' '.repeat(185)}01${'Campagna prova'.padEnd(30)}\r\n`)

    await nel(az, () => dati.imposta(az.tenantId, az.utenteId, m.id, 'COBAT', { pgf: 'B' }))
    const g2 = await nel(az, () =>
      servizio.genera(az.tenantId, az.utenteId, richiesta(az, 'COBAT'))
    )
    expect(g2.hashDati).not.toBe(g.hashDati)
  })

  it('COBAT: senza regione/ISTAT del comune della controparte e bloccante con il link alla sede', async () => {
    const az = await nuovaAzienda('B2')
    const c = await creaControparti(az)
    await owner.sedeDitta.update({ where: { id: c.prod.sedeId }, data: { comune: 'Inesistente' } })
    const firId = await creaFir(az, c, {
      numero: 'ABC126/26',
      destinatarioNoi: true,
      cer: '16 06 01*',
    })
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '16 06 01*',
      quantita: 100,
      giorno: '2026-05-10',
      firId,
    })
    const a = await nel(az, () => servizio.anteprima(az.tenantId, richiesta(az, 'COBAT')))
    expect(a.bloccanti).toBe(true)
    expect(a.avvisi.find(x => x.codice === 'ISTAT_NON_TROVATO')?.correzione).toEqual({
      tipo: 'ANAGRAFICA_SEDE',
      sedeDittaId: c.prod.sedeId,
    })
  })
})
