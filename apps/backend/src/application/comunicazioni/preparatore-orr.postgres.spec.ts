/**
 * Preparatore O.R.R. Campania (4.9f D3) col servizio generico contro un Postgres reale, collegato
 * COME `wasteflow_app` dentro il `TenantContext` dell'azienda: sede campana, FIR, anagrafiche,
 * configurazione, file da 718 byte per riga, idempotenza, hash, isolamento fra aziende.
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
import { registroTracciati } from '../../domain/comunicazioni/registro-tracciati'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo } from '../../test-support/anagrafiche-di-test'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from './comunicazioni-orso.port'
import {
  RichiestaComunicazioneNonValidaError,
  type PreparatoreTracciato,
  type RichiestaComunicazione,
} from './comunicazioni-tracciato.port'
import { ComunicazioniTracciatoService } from './comunicazioni-tracciato.service'
import { ConfigurazioneComunicazioniService } from './configurazione-comunicazioni.service'
import { DatiTracciatoService } from './dati-tracciato.service'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import { PreparatoreOrr } from './preparatore-orr'

const COMUNE_ISTAT = '063049'

describe('Preparatore O.R.R. Campania — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ComunicazioniTracciatoService
  let configurazioni: ConfigurazioneComunicazioniService
  let datiTracciato: DatiTracciatoService
  const tenantCreati: string[] = []
  let comuneCreato = false

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  interface Scenario {
    az: AziendaMud
    partitaIva: string
    sedeProduttoreId: string
    sedeTrasportatoreId: string
    movimentoId: string
    firId: string
    autorizzazioneId: string
  }

  /** Azienda campana con un FIR in ingresso (produttore e trasportatore terzi) e il suo impianto. */
  async function nuovoScenario(
    sigla: string,
    o: { trasportatoreSiamoNoi?: boolean; provincia?: string } = {}
  ): Promise<Scenario> {
    const az = await creaAziendaMud(owner, sigla, {
      city: 'Napoli',
      province: o.provincia ?? 'NA',
      atecoCode: '381100',
    })
    tenantCreati.push(az.tenantId)
    const tenant = await owner.tenant.update({
      where: { id: az.tenantId },
      data: { address: 'Corso Umberto', civico: '5', postalCode: '80133' },
    })
    await owner.rentriUnitaLocale.update({
      where: { id: az.unitaLocaleId },
      data: {
        provincia: o.provincia ?? 'NA',
        comune: 'Napoli',
        cap: '80100',
        indirizzo: 'Z.I. Asi',
        civico: '8',
        progressivoMud: 1,
      },
    })
    const prod = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Rossi Imballaggi S.r.l.',
      comune: 'Napoli',
      provincia: 'NA',
      cap: '80100',
    })
    const tras = await creaDittaConRuolo(owner, az.tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Veloci S.p.A.',
      comune: 'Napoli',
      provincia: 'NA',
      cap: '80100',
      numeroDocumento: 'NA012345',
    })
    await owner.anagraficaComunicazioniSede.createMany({
      data: [
        { tenantId: az.tenantId, sedeDittaId: prod.sedeId, codiceAteco: '38.21.09' },
        {
          tenantId: az.tenantId,
          sedeDittaId: tras.sedeId,
          alboDataIscrizione: new Date('2020-03-15T00:00:00Z'),
          alboClassi: '1 2 4',
        },
      ],
    })
    const aut = await owner.autorizzazioneImpianto.create({
      data: {
        tenantId: az.tenantId,
        estremi: 'AUT-2019-0042',
        dataRilascio: new Date('2019-06-10T00:00:00Z'),
      },
    })
    const fir = await owner.fIR.create({
      data: {
        tenantId: az.tenantId,
        firNumber: 'AB1234567890123',
        status: 'COMPLETED',
        producerUserId: az.utenteId,
        producerSedeId: prod.sedeId,
        producerCodiceFiscale: 'PRDCFS80A01H501U',
        carrierCodiceFiscale: 'TRSCFS80A01H501U',
        receiverCodiceFiscale: 'DSTCFS80A01H501U',
        producerPartitaIva: '01234567890',
        producerName: 'Rossi Imballaggi S.r.l.',
        producerAddress: 'Via Roma 1, Napoli',
        carrierId: tras.ruoloId,
        carrierPartitaIva: o.trasportatoreSiamoNoi ? tenant.partitaIva : '11111111119',
        carrierName: 'Trasporti Veloci S.p.A.',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: tenant.partitaIva,
        receiverName: 'Impianto',
        receiverAddress: 'Z.I. Asi 8, Napoli',
        cerCode: '15 01 10*',
        wasteDescription: 'Imballaggi',
        wasteCategory: 'PERICOLOSO',
        quantity: 1250.5,
        wasteOperationType: 'RECOVERY',
        wasteOperationCode: 'R13',
        transportDate: new Date('2026-05-10T08:00:00Z'),
      },
    })
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '15 01 10*',
      quantita: 1250.5,
      unita: 'KG',
      giorno: '2026-05-10',
      firId: fir.id,
      operationCode: 'R13',
    })
    await nel(az, () =>
      configurazioni.imposta(az.tenantId, az.unitaLocaleId, 'ORR', {
        tipoImpianto: 'STO',
        autorizzazioneImpiantoId: aut.id,
      })
    )
    return {
      az,
      partitaIva: tenant.partitaIva,
      sedeProduttoreId: prod.sedeId,
      sedeTrasportatoreId: tras.sedeId,
      movimentoId: m.id,
      firId: fir.id,
      autorizzazioneId: aut.id,
    }
  }

  const richiesta = (
    az: AziendaMud,
    attivita: string,
    extra: Partial<RichiestaComunicazione> = {}
  ): RichiestaComunicazione => ({
    consorzio: 'ORR',
    unitaLocaleId: az.unitaLocaleId,
    da: '2026-05-01',
    a: '2026-05-31',
    parametri: { attivita },
    ...extra,
  })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    // Il database di test puo' non avere i comuni ISTAT: serve Napoli per la sede propria.
    if (!(await owner.istatComune.findUnique({ where: { code: COMUNE_ISTAT } }))) {
      await owner.istatComune.create({
        data: { code: COMUNE_ISTAT, name: 'Napoli', provinciaSigla: 'NA' },
      })
      comuneCreato = true
    }
    configurazioni = new ConfigurazioneComunicazioniService(app)
    datiTracciato = new DatiTracciatoService(app)
    servizio = new ComunicazioniTracciatoService(
      app,
      new MarcaturaConsorziService(app),
      configurazioni,
      [new PreparatoreOrr(app) as unknown as PreparatoreTracciato],
      registroTracciati
    )
  })

  afterAll(async () => {
    const where = { tenantId: { in: tenantCreati } }
    await owner.comunicazioneConsorzio.deleteMany({ where })
    await owner.datiTracciatoMovimento.deleteMany({ where })
    await owner.configurazioneComunicazioneSede.deleteMany({ where })
    await owner.anagraficaComunicazioniSede.deleteMany({ where })
    await owner.fIR.deleteMany({ where })
    await owner.autorizzazioneImpianto.deleteMany({ where })
    await owner.produttore.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    if (comuneCreato) await owner.istatComune.delete({ where: { code: COMUNE_ISTAT } })
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('un carattere fuori Windows-1252 nella ragione sociale del produttore -> avviso CARATTERI_NON_RAPPRESENTABILI collegato al movimento, nessun file', async () => {
    const s = await nuovoScenario('O9')
    const sede = await owner.sedeDitta.findUniqueOrThrow({ where: { id: s.sedeProduttoreId } })
    await owner.ditta.update({
      where: { id: sede.dittaId },
      data: { ragioneSociale: 'Rossi \u{1F600} S.r.l.' },
    })
    const a = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO')))
    expect(a.bloccanti).toBe(true)
    const avviso = a.avvisi.find(x => x.codice === 'CARATTERI_NON_RAPPRESENTABILI')
    expect(avviso).toBeDefined()
    expect(avviso?.movimentoIds).toEqual([s.movimentoId])
    await expect(
      nel(s.az, () => servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO')))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
  })

  it('anteprima e file STO: 718 byte per riga in Windows-1252, nome file, e13 e autorizzazione dell’impianto', async () => {
    const s = await nuovoScenario('O1')
    const a = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO')))
    expect(a.avvisi.filter(x => x.bloccante)).toEqual([])
    expect(a).toMatchObject({
      consorzio: 'ORR',
      tracciato: 'xrec718-STO',
      versione: 'xrec718-ww1',
      affidabilita: 'RICAVATO_WINWASTE',
      numeroRecord: 1,
      numeroMovimenti: 1,
      bloccanti: false,
    })
    const g = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    expect(g).toMatchObject({
      nomeFile: 'N0001MG26S.txt',
      stato: 'GENERATA',
      affidabilita: 'RICAVATO_WINWASTE',
    })
    const f = await nel(s.az, () => servizio.file(s.az.tenantId, g.id))
    expect(f.contentType).toBe('text/plain; charset=windows-1252')
    expect(f.contenuto.length).toBe(718)
    const riga = f.contenuto.toString('latin1')
    expect(riga.slice(0, 6)).toBe('202605')
    expect(riga.slice(6, 21)).toBe('AB1234567890123')
    expect(riga.slice(21, 29)).toBe('20260510')
    expect(riga.slice(29, 32)).toBe('STO')
    expect(riga.slice(32, 38)).toBe('150110')
    expect(riga.slice(38, 49)).toBe('00001250500')
    expect(riga.slice(52, 55)).toBe('R13')
    expect(riga.slice(55, 56)).toBe('0')
    expect(riga.slice(56, 101).trimEnd()).toBe('Rossi Imballaggi S.r.l.')
    expect(riga.slice(245, 253)).toBe('38.21.09')
    expect(riga.slice(500, 545).trimEnd()).toBe('MUD O1 SRL')
    expect(riga.slice(689, 697)).toBe('20190610')
    expect(riga.slice(697, 713).trimEnd()).toBe('AUT-2019-0042')
    expect(riga.slice(713, 716)).toBe('STO')
    expect(riga.slice(716, 718)).toBe('\r\n')
    // Manifest: tracciato da confermare, con le inferenze.
    const man = await nel(s.az, () => servizio.manifest(s.az.tenantId, g.id))
    expect(man.nomeFile).toBe('N0001MG26S.txt.manifest.txt')
    expect(man.testo).toContain('da confermare con un file reale')
    expect(man.testo).toContain('MOLTIPLICATORE_QUANTITA_ORR')
  })

  it('stesso movimento trasportato da noi: file T con e13 derivato da R13', async () => {
    const s = await nuovoScenario('O2', { trasportatoreSiamoNoi: true })
    const g = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'TRA'))
    )
    expect(g.nomeFile).toBe('N0001MG26T.txt')
    const f = await nel(s.az, () => servizio.file(s.az.tenantId, g.id))
    const riga = f.contenuto.toString('latin1')
    expect(riga.slice(29, 32)).toBe('TRA')
    expect(riga.slice(256, 257)).toBe('0')
    expect(riga.slice(446, 454)).toBe('20200315')
    expect(riga.slice(454, 470).trimEnd()).toBe('NA012345')
    expect(riga.slice(470, 500).trimEnd()).toBe('1 2 4')
    expect(riga.slice(713, 716)).toBe('STO')
    // E anche nel file di stoccaggio (ricevuto da terzi), ma non nei file REC o SMA.
    const sto = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO')))
    expect(sto.numeroRecord).toBe(1)
    const rec = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'REC')))
    expect(rec.numeroRecord).toBe(0)
  })

  it('idempotenza e hash: rigenerare restituisce la stessa comunicazione; un dato di anagrafica o di configurazione cambia l’hash', async () => {
    const s = await nuovoScenario('O3')
    const g1 = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    const g2 = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    expect(g2.id).toBe(g1.id)
    await owner.anagraficaComunicazioniSede.update({
      where: { tenantId_sedeDittaId: { tenantId: s.az.tenantId, sedeDittaId: s.sedeProduttoreId } },
      data: { codiceAteco: '38.22.00' },
    })
    const g3 = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    expect(g3.id).not.toBe(g1.id)
    expect(g3.hashDati).not.toBe(g1.hashDati)
    const aut2 = await owner.autorizzazioneImpianto.create({
      data: {
        tenantId: s.az.tenantId,
        estremi: 'AUT-NUOVA-1',
        dataRilascio: new Date('2024-01-02T00:00:00Z'),
      },
    })
    await nel(s.az, () =>
      configurazioni.imposta(s.az.tenantId, s.az.unitaLocaleId, 'ORR', {
        tipoImpianto: 'STO',
        autorizzazioneImpiantoId: aut2.id,
      })
    )
    const g4 = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    expect(g4.hashDati).not.toBe(g3.hashDati)
  })

  it('segna inviata con conferma, poi modificata dopo l’invio se cambia un dato', async () => {
    const s = await nuovoScenario('O4')
    const g = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO'))
    )
    const inviata = await nel(s.az, () =>
      servizio.segnaInviata(s.az.tenantId, s.az.utenteId, g.id, true)
    )
    expect(inviata.stato).toBe('INVIATA')
    await owner.anagraficaComunicazioniSede.update({
      where: { tenantId_sedeDittaId: { tenantId: s.az.tenantId, sedeDittaId: s.sedeProduttoreId } },
      data: { codiceAteco: '38.22.00' },
    })
    const dopo = await nel(s.az, () => servizio.segnaInviata(s.az.tenantId, s.az.utenteId, g.id))
    expect(dopo.modificataDopoInvio).toBe(true)
  })

  it('un errore bloccante impedisce il file e porta il link alla correzione', async () => {
    const s = await nuovoScenario('O5')
    await owner.anagraficaComunicazioniSede.update({
      where: { tenantId_sedeDittaId: { tenantId: s.az.tenantId, sedeDittaId: s.sedeProduttoreId } },
      data: { codiceAteco: null },
    })
    const a = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO')))
    expect(a.bloccanti).toBe(true)
    const ateco = a.avvisi.find(x => x.codice === 'ATECO_PRODUTTORE')
    expect(ateco?.correzione).toEqual({ tipo: 'ANAGRAFICA_SEDE', sedeDittaId: s.sedeProduttoreId })
    expect(ateco?.movimentoIds).toEqual([s.movimentoId])
    await expect(
      nel(s.az, () => servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'STO')))
    ).rejects.toBeInstanceOf(ComunicazioneConBloccantiError)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: s.az.tenantId } })).toBe(0)
  })

  it('sede fuori dalla Campania e periodo non a mesi interi: rifiutati', async () => {
    const fuori = await nuovoScenario('O6', { provincia: 'MI' })
    const a = await nel(fuori.az, () =>
      servizio.anteprima(fuori.az.tenantId, richiesta(fuori.az, 'STO'))
    )
    expect(a.avvisi.map(x => x.codice)).toContain('SEDE_NON_IN_CAMPANIA')
    expect(a.bloccanti).toBe(true)
    const s = await nuovoScenario('O7')
    await expect(
      nel(s.az, () =>
        servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO', { a: '2026-05-20' }))
      )
    ).rejects.toBeInstanceOf(RichiestaComunicazioneNonValidaError)
    await expect(
      nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'XXX')))
    ).rejects.toBeInstanceOf(RichiestaComunicazioneNonValidaError)
  })

  it('un movimento senza dati O.R.R. FRA resta in STO; con il flag FRA passa nel file FRA (dati del tracciato sulla radice)', async () => {
    const s = await nuovoScenario('O8')
    await nel(s.az, () =>
      datiTracciato.imposta(s.az.tenantId, s.az.utenteId, s.movimentoId, 'ORR', { attivita: 'FRA' })
    )
    const fra = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'FRA')))
    expect(fra.numeroRecord).toBe(1)
    const sto = await nel(s.az, () => servizio.anteprima(s.az.tenantId, richiesta(s.az, 'STO')))
    expect(sto.numeroRecord).toBe(0)
    const g = await nel(s.az, () =>
      servizio.genera(s.az.tenantId, s.az.utenteId, richiesta(s.az, 'FRA'))
    )
    const f = await nel(s.az, () => servizio.file(s.az.tenantId, g.id))
    expect(f.contenuto.toString('latin1').slice(713, 716)).toBe('FRA')
  })

  it('isolamento: una sede di un’altra azienda risponde 404 e non scrive nulla', async () => {
    const a = await nuovoScenario('O9')
    const b = await nuovoScenario('OA')
    await expect(
      nel(a.az, () =>
        servizio.genera(a.az.tenantId, a.az.utenteId, {
          ...richiesta(a.az, 'STO'),
          unitaLocaleId: b.az.unitaLocaleId,
        })
      )
    ).rejects.toBeInstanceOf(ComunicazioneNonTrovataError)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: b.az.tenantId } })).toBe(0)
    expect(await owner.comunicazioneConsorzio.count({ where: { tenantId: a.az.tenantId } })).toBe(0)
  })
})
