/**
 * Riconciliazione (I8 T1-T5) contro Postgres reale COME `wasteflow_app`: giacenze caricate con la CLI di
 * caricamento dal pacchetto sintetico (FIXTURE SINTETICHE: nessun `.bak`), movimenti importati creati
 * col proprietario, rapporto sorgente dall'analizzatore (o scritto a mano per i movimenti). Prove: un
 * rapporto chiudibile e uno non chiudibile per una differenza iniettata, accettazione una per una con
 * motivo, versioni, campione riproducibile, verbale, chiusura, e che la verifica RENTRI non invia mai.
 */
import { PrismaClient } from '@prisma/client'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { eseguiCli } from '../../../cli/migrazione-carica'
import { eseguiCli as eseguiRiconcilia } from '../../../cli/migrazione-riconcilia'
import { scegliCampione } from '../../../domain/migrazione/riconciliazione/campione'
import { hashCanonico } from '../../../domain/migrazione/riconciliazione/hash-rapporto'
import { SorgenteRiconciliazione } from '../../../domain/migrazione/riconciliazione/confronti'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import { mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import {
  creaMovimentoImportato,
  lottoDiProva,
} from '../../../test-support/migrazione/movimento-importato'
import { scriviStagingGiacenzeProva } from '../../../test-support/migrazione/staging-giacenze-di-prova'
import { analizzaArchivio } from '../analisi/analizza-archivio'
import { CaricaPacchettoService } from '../caricamento/carica-pacchetto.service'
import { LottiImportService } from '../caricamento/lotti-import.service'
import { apriPacchetto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { preparaGiacenze } from '../pacchetto/prepara-giacenze'
import { preparaPacchetto } from '../pacchetto/prepara-pacchetto'
import { apriStaging } from '../staging/lettore-staging'
import {
  AccettazioneNonConsentitaError,
  ArchivioDiversoError,
  CampioneNonValidoError,
  LottoNonCompletatoError,
  RapportoChiusoError,
  RapportoNonChiudibileError,
  VersioneCambiataError,
} from './errori'
import { RiconciliazioneService } from './riconciliazione.service'
import { LettoreRentri } from './verifica-rentri'

const REGISTRO_RENTRI = 'R0000000001'
const MOVIMENTO_RENTRI = 'M0000000000000000001'
const CER_CATALOGO = ['15 01 01', '20 03 01', '13 02 05*', '15 01 02']

describe('Riconciliazione dell import — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: CaricaPacchettoService
  let riconcilia: RiconciliazioneService
  const logger: any = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let radice: string
  let contatore = 0
  const seme = 8_950_000 + (Date.now() % 40_000)

  interface Az {
    tenantId: string
    operatoreId: string
    registroA: string
    registroB: string
  }

  async function azienda(): Promise<Az> {
    contatore++
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Riconcilia I8 SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-ric-i8-${seme}-${contatore}`,
        fiscalCode: `RICI8${seme}${contatore}`.slice(0, 16),
        firstName: 'Operatore',
        lastName: 'Import',
        email: `ric-i8-${seme}-${contatore}@example.test`,
      },
    })
    const a = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro A' },
    })
    const b = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro B', codice: 'ALTRO_REGISTRO' },
    })
    return { tenantId: t.id, operatoreId: u.id, registroA: a.id, registroB: b.id }
  }

  /** Carica le giacenze di prova nell'azienda e restituisce rapporto sorgente, giacenze attese e lotto. */
  async function caricaGiacenze(az: Az) {
    const st = await scriviStagingGiacenzeProva(
      await mkdtemp(join(radice, 'st-')),
      seme * 10 + contatore
    )
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: az.tenantId,
      registri: [
        { legacy: 'REG1', registroId: az.registroA },
        { legacy: '001', registroId: az.registroA },
        { legacy: '002', registroId: az.registroB },
      ],
      unitaLocali: [],
      causali: [],
      agganci: [],
    })
    const staging = await apriStaging(st.cartella)
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await preparaPacchetto(staging, mappa, cartella)
    const pacchetto = await apriPacchetto(cartella)
    const out: string[] = []
    const codice = await eseguiCli(
      [
        '--tenant',
        az.tenantId,
        '--pacchetto',
        pacchetto.cartella,
        '--ambito',
        'GIACENZE',
        '--operatore',
        az.operatoreId,
      ],
      { scrivi: m => out.push(m), errore: m => out.push(m) },
      servizio
    )
    expect(codice).toBe(0)
    const lotto = await owner.lottoImport.findFirstOrThrow({
      where: { tenantId: az.tenantId, ambito: 'GIACENZE' },
    })
    const sorgente = await analizzaArchivio(staging)
    const attese = (await preparaGiacenze(staging, mappa)).giacenze.map(g => ({
      cer: g.cerCode,
      kg: g.quantita,
    }))
    return { lottoId: lotto.id, sorgente, attese, hashSorgente: hashCanonico(sorgente) }
  }

  /** Rapporto sorgente scritto a mano per i confronti del registro (I7 non c'e' ancora). */
  const sorgenteMovimenti = (carichi: number, scarichi: number): SorgenteRiconciliazione => ({
    archivio: 'WW00012026',
    confronto1: {
      movimentiPerOper: [
        { oper: '10', tipo: 'CARICO', attivi: carichi, annullati: 0 },
        { oper: '11', tipo: 'SCARICO', attivi: scarichi, annullati: 0 },
      ],
      formulariPerStato: [],
    },
    confronto2: {
      righe: [
        {
          anno: 2026,
          cer: '15 01 01',
          tipo: 'CARICO',
          movimenti: carichi,
          kgnum: carichi * 10,
          mcnum: 0,
        },
      ],
    },
    confronto4: {
      registri: [{ anno: 2026, conteggio: carichi + scarichi, buchiTotali: 0, duplicati: [] }],
    },
    confronto5: { renRegistrazioni: { presente: false } },
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const lotti = new LottiImportService(app, logger)
    servizio = new CaricaPacchettoService(app, lotti, logger)
    riconcilia = new RiconciliazioneService(app, logger)
    radice = await mkdtemp(join(tmpdir(), 'riconcilia-i8-'))
    for (const code of CER_CATALOGO) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
  })
  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    }
    await cancellaAziendeDiProva(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  const PDF = Buffer.from('%PDF-1.4\n% verbale di prova firmato\n')

  it('giacenze caricate: rapporto chiudibile, confronti del registro non applicabili, chiusura e verbale', async () => {
    const az = await azienda()
    const c = await caricaGiacenze(az)
    const { rapporto, nuovaVersione } = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [c.lottoId],
      sorgente: c.sorgente,
      hashSorgente: c.hashSorgente,
      giacenzeAttese: c.attese,
      creatoDa: az.operatoreId,
    })
    expect(nuovaVersione).toBe(true)
    expect(rapporto.versione).toBe(1)
    expect(rapporto.esiti.confronti.map(x => [x.numero, x.esito])).toEqual([
      [1, 'OK'],
      [2, 'NON_APPLICABILE'],
      [3, 'OK'],
      [4, 'NON_APPLICABILE'],
      [5, 'NON_APPLICABILE'],
    ])
    expect(rapporto.campioni).toHaveLength(0)
    expect(rapporto.valutazione.chiudibile).toBe(true)

    // Lo stesso calcolo non crea una versione nuova (stessa impronta).
    const ancora = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [],
      radiceId: rapporto.radiceId,
      sorgente: c.sorgente,
      hashSorgente: c.hashSorgente,
      giacenzeAttese: c.attese,
    })
    expect(ancora.nuovaVersione).toBe(false)
    expect(ancora.rapporto.versione).toBe(1)

    const conVerbale = await riconcilia.caricaVerbale({
      tenantId: az.tenantId,
      radiceId: rapporto.radiceId,
      versione: 1,
      nomeFile: '../verbale firmato.pdf',
      contenuto: PDF,
      utenteId: az.operatoreId,
    })
    expect(conVerbale.verbali).toHaveLength(1)
    expect(conVerbale.verbali[0].nomeFile).toBe('.._verbale firmato.pdf')
    const chiuso = await riconcilia.chiudi({
      tenantId: az.tenantId,
      radiceId: rapporto.radiceId,
      versione: 1,
      utenteId: az.operatoreId,
    })
    expect(chiuso.stato).toBe('CHIUSO')
    await expect(
      riconcilia.chiudi({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        utenteId: az.operatoreId,
      })
    ).rejects.toBeInstanceOf(RapportoChiusoError)
    // Un rapporto chiuso non si ricalcola.
    await expect(
      riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [],
        radiceId: rapporto.radiceId,
        sorgente: c.sorgente,
        hashSorgente: c.hashSorgente,
      })
    ).rejects.toBeInstanceOf(RapportoChiusoError)
  })

  it('anagrafiche caricate: le righe con l id del lotto sono quelle inserite dal caricatore', async () => {
    const az = await azienda()
    // Lo staging delle giacenze contiene anche le anagrafiche (e MOVIMENTI completi per l'analizzatore).
    const prova = await scriviStagingGiacenzeProva(
      await mkdtemp(join(radice, 'st-')),
      seme * 10 + contatore * 13
    )
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: az.tenantId,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: [],
    })
    const staging = await apriStaging(prova.cartella)
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await preparaPacchetto(staging, mappa, cartella)
    const pacchetto = await apriPacchetto(cartella)
    const codice = await eseguiCli(
      ['--tenant', az.tenantId, '--pacchetto', pacchetto.cartella, '--ambito', 'ANAGRAFICHE'],
      { scrivi: () => undefined, errore: () => undefined },
      servizio
    )
    expect(codice).toBe(0)
    const lotto = await owner.lottoImport.findFirstOrThrow({
      where: { tenantId: az.tenantId, ambito: 'ANAGRAFICHE' },
    })
    const sorgente = await analizzaArchivio(staging)
    const { rapporto } = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [lotto.id],
      sorgente,
      hashSorgente: hashCanonico(sorgente),
    })
    const voce = rapporto.esiti.confronti[0].voci.find(v => v.chiave === 'lotto-anagrafiche')
    expect(voce).toMatchObject({ esito: 'OK' })
    expect(voce!.sorgente).toBeGreaterThan(0)
    expect(voce!.sorgente).toBe(voce!.destinazione)
    expect(rapporto.valutazione.chiudibile).toBe(true)
    // Una riga importata cancellata dal proprietario (trigger spenti per la sessione) e' una differenza.
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`)
      await tx.automezzo.deleteMany({ where: { tenantId: az.tenantId } })
    })
    const dopo = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [],
      radiceId: rapporto.radiceId,
      sorgente,
      hashSorgente: hashCanonico(sorgente),
    })
    expect(dopo.rapporto.valutazione.differenzeAperte).toEqual(['1:lotto-anagrafiche'])
  })

  it('CLI migrazione:riconcilia: rapporto chiudibile sui dati sintetici e non chiudibile con una differenza iniettata', async () => {
    const az = await azienda()
    const c = await caricaGiacenze(az)
    const dir = await mkdtemp(join(radice, 'ric-'))
    const fSorgente = join(dir, 'sorgente.json')
    const fAttese = join(dir, 'attese.json')
    await writeFile(fSorgente, JSON.stringify(c.sorgente))
    await writeFile(fAttese, JSON.stringify(c.attese))
    const esegui = async (...extra: string[]) => {
      const out: string[] = []
      const err: string[] = []
      const codice = await eseguiRiconcilia(
        [
          '--tenant',
          az.tenantId,
          '--rapporto-sorgente',
          fSorgente,
          '--giacenze-attese',
          fAttese,
          '--operatore',
          az.operatoreId,
          ...extra,
        ],
        { scrivi: m => out.push(m), errore: m => err.push(m) },
        riconcilia
      )
      return { codice, out: out.join('\n'), err: err.join('\n') }
    }
    // Senza --lotti: i lotti COMPLETATO dell'archivio del rapporto sorgente.
    const pulito = await esegui('--seme', 'seme-cli')
    expect(pulito.codice).toBe(0)
    expect(pulito.out).toContain('versione 1 APERTO')
    expect(pulito.out).toContain('chiudibile: si (differenze aperte: 0)')
    expect(pulito.out).not.toContain('DIFFERENZA')
    const radiceId = /rapporto (\S+) versione 1/.exec(pulito.out)![1]

    const riga = await owner.giacenzaIniziale.findFirstOrThrow({
      where: { tenantId: az.tenantId, cerCode: '15 01 02' },
    })
    await owner.giacenzaIniziale.update({
      where: { id: riga.id },
      data: { quantita: Number(riga.quantita) - 1 },
    })
    const rotto = await esegui('--rapporto', radiceId)
    expect(rotto.codice).toBe(0)
    expect(rotto.out).toContain('versione 2 APERTO')
    expect(rotto.out).toContain('DIFFERENZA 3:cer|15 01 02 sorgente=80 destinazione=79')
    expect(rotto.out).toContain('chiudibile: no (differenze aperte: 1)')
    // Ripetuto senza cambiamenti: nessuna versione nuova.
    const uguale = await esegui('--rapporto', radiceId)
    expect(uguale.out).toContain('versione 2 APERTO (invariato)')
    // Nessun valore di record nell'output: solo codici e conteggi.
    expect(pulito.out + rotto.out).not.toMatch(/Registro A|Riconcilia I8/)
  })

  it('una differenza iniettata rende il rapporto non chiudibile; si accetta una per una con motivo', async () => {
    const az = await azienda()
    const c = await caricaGiacenze(az)
    // Differenza iniettata: una giacenza importata viene corretta a mano di 5 kg.
    const riga = await owner.giacenzaIniziale.findFirstOrThrow({
      where: { tenantId: az.tenantId, cerCode: '20 03 01' },
    })
    await owner.giacenzaIniziale.update({
      where: { id: riga.id },
      data: { quantita: Number(riga.quantita) + 5 },
    })
    const { rapporto } = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [c.lottoId],
      sorgente: c.sorgente,
      hashSorgente: c.hashSorgente,
      giacenzeAttese: c.attese,
    })
    expect(rapporto.valutazione.chiudibile).toBe(false)
    expect(rapporto.valutazione.differenzeAperte).toEqual(['3:cer|20 03 01'])
    await expect(
      riconcilia.chiudi({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        utenteId: az.operatoreId,
      })
    ).rejects.toBeInstanceOf(RapportoNonChiudibileError)

    // Motivo troppo corto: rifiutato. Chiave inesistente: rifiutata.
    await expect(
      riconcilia.accettaDifferenza({
        ruolo: 'SUPER_ADMIN',
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        chiave: '3:cer|20 03 01',
        motivo: 'no',
        utenteId: az.operatoreId,
      })
    ).rejects.toThrow(/motivo/)
    await expect(
      riconcilia.accettaDifferenza({
        ruolo: 'SUPER_ADMIN',
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        chiave: '3:cer|99 99 99',
        motivo: 'conteggio manuale in magazzino',
        utenteId: az.operatoreId,
      })
    ).rejects.toThrow(/nessuna differenza/)

    const v2 = await riconcilia.accettaDifferenza({
      ruolo: 'SUPER_ADMIN',
      tenantId: az.tenantId,
      radiceId: rapporto.radiceId,
      versione: 1,
      chiave: '3:cer|20 03 01',
      motivo: 'conteggio fisico in magazzino al taglio',
      utenteId: az.operatoreId,
    })
    expect(v2.versione).toBe(2)
    expect(v2.valutazione.chiudibile).toBe(true)
    expect(v2.hashRapporto).not.toBe(rapporto.hashRapporto)
    expect(Object.keys(v2.esiti.accettazioni)).toEqual(['3:cer|20 03 01'])
    // Chi aveva letto la versione 1 riceve un conflitto, non un'accettazione silenziosa.
    await expect(
      riconcilia.chiudi({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        utenteId: az.operatoreId,
      })
    ).rejects.toBeInstanceOf(VersioneCambiataError)

    // Se il dato cambia ancora, l'accettazione non vale piu' (valori diversi).
    await owner.giacenzaIniziale.update({
      where: { id: riga.id },
      data: { quantita: Number(riga.quantita) + 9 },
    })
    const ricalcolo = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [],
      radiceId: rapporto.radiceId,
      sorgente: c.sorgente,
      hashSorgente: c.hashSorgente,
      giacenzeAttese: c.attese,
    })
    expect(ricalcolo.nuovaVersione).toBe(true)
    expect(ricalcolo.rapporto.versione).toBe(3)
    expect(ricalcolo.rapporto.valutazione.differenzeAperte).toEqual(['3:cer|20 03 01'])
  })

  it('senza la giacenza attesa il confronto 3 e NON_VERIFICATO e blocca finche non si accetta', async () => {
    const az = await azienda()
    const c = await caricaGiacenze(az)
    const { rapporto } = await riconcilia.genera({
      tenantId: az.tenantId,
      lottiIds: [c.lottoId],
      sorgente: c.sorgente,
      hashSorgente: c.hashSorgente,
    })
    expect(rapporto.esiti.confronti[2].esito).toBe('NON_VERIFICATO')
    expect(rapporto.valutazione.differenzeAperte).toEqual(['3:non-verificato'])
  })

  describe('movimenti importati: confronti del registro, campione, RENTRI in sola lettura', () => {
    async function conMovimenti(n: number, conIdentificativo = false) {
      const az = await azienda()
      const lottoId = await lottoDiProva(owner, az.tenantId)
      await owner.lottoImport.update({
        where: { id: lottoId },
        data: {
          conteggi: { lette: n, inserite: n, saltate: 0, scartate: 0, blocchi: 1 },
          stato: 'COMPLETATO',
        },
      })
      const ids: string[] = []
      for (let i = 0; i < n; i++) {
        const { movimentoId } = await creaMovimentoImportato(owner, {
          tenantId: az.tenantId,
          registroId: az.registroA,
          lottoId,
        })
        ids.push(movimentoId)
      }
      if (conIdentificativo) {
        await owner.registroRifiuti.update({
          where: { id: az.registroA },
          data: { identificativoRentri: REGISTRO_RENTRI },
        })
        await owner.movimentoTrasmissioneRentri.updateMany({
          where: { tenantId: az.tenantId },
          data: { identificativoRentri: MOVIMENTO_RENTRI },
        })
      }
      return { az, lottoId, ids }
    }

    it('conteggi coerenti e totali uguali: chiudibile solo dopo l esito di ogni campione', async () => {
      const { az, lottoId } = await conMovimenti(4)
      // 4 carichi da 10 kg, CER 15 01 01, anno 2026; nessuno scarico. Numerazione: 900001.. senza buchi
      // consecutivi dichiarati? i progressivi sono consecutivi: 0 buchi.
      const sorgente = sorgenteMovimenti(4, 0)
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 3,
        seme: 'seme-di-prova',
      })
      expect(rapporto.esiti.confronti.map(x => [x.numero, x.esito])).toEqual([
        [1, 'OK'],
        [2, 'OK'],
        [3, 'NON_APPLICABILE'],
        [4, 'OK'],
        [5, 'OK'],
      ])
      expect(rapporto.campioni.filter(x => x.tipo === 'MOVIMENTO')).toHaveLength(3)
      expect(rapporto.valutazione.campioniSenzaEsito).toBe(3)
      expect(rapporto.valutazione.chiudibile).toBe(false)

      // Il campione e' riproducibile: stessa regola della funzione pura, calcolata sugli stessi id.
      const tutti = (
        await owner.wasteMovement.findMany({
          where: { tenantId: az.tenantId },
          select: { id: true },
        })
      ).map(m => m.id)
      expect(rapporto.campioni.map(x => x.riferimentoId).sort()).toEqual(
        scegliCampione('seme-di-prova', tutti, 3).sort()
      )

      for (const [i, camp] of rapporto.campioni.entries()) {
        await riconcilia.registraEsitoCampione({
          tenantId: az.tenantId,
          radiceId: rapporto.radiceId,
          campioneId: camp.id,
          esito: i === 0 ? 'NON_CORRISPONDE' : 'CORRISPONDE',
          nota: i === 0 ? 'quantita diversa' : null,
          utenteId: az.operatoreId,
        })
      }
      // Un campione non corrispondente blocca e non si accetta: si corregge l'esito o i dati.
      let letto = await riconcilia.leggi(az.tenantId, rapporto.radiceId)
      expect(letto.valutazione.campioniNonCorrispondono).toBe(1)
      await expect(
        riconcilia.chiudi({
          tenantId: az.tenantId,
          radiceId: rapporto.radiceId,
          versione: 1,
          utenteId: az.operatoreId,
        })
      ).rejects.toBeInstanceOf(RapportoNonChiudibileError)
      await riconcilia.registraEsitoCampione({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        campioneId: rapporto.campioni[0].id,
        esito: 'CORRISPONDE',
        utenteId: az.operatoreId,
      })
      letto = await riconcilia.chiudi({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        utenteId: az.operatoreId,
      })
      expect(letto.stato).toBe('CHIUSO')
      // Dopo la chiusura l'esito non cambia piu'.
      await expect(
        riconcilia.registraEsitoCampione({
          tenantId: az.tenantId,
          radiceId: rapporto.radiceId,
          campioneId: rapporto.campioni[0].id,
          esito: 'NON_CORRISPONDE',
          utenteId: az.operatoreId,
        })
      ).rejects.toBeInstanceOf(RapportoChiusoError)
    })

    it('un movimento in piu o in meno nel registro e una differenza che blocca la chiusura', async () => {
      const { az, lottoId } = await conMovimenti(3)
      const sorgente = sorgenteMovimenti(4, 0) // WinWaste dichiara 4 carichi, qui ce ne sono 3
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
      })
      expect(rapporto.valutazione.chiudibile).toBe(false)
      expect(rapporto.valutazione.differenzeAperte).toEqual(
        expect.arrayContaining([
          '1:movimenti-carico',
          '2:2026|15 01 01|CARICO|kg',
          '4:anno|2026|conteggio',
        ])
      )
    })

    it('un movimento importato non bloccato all invio e una differenza del confronto 5', async () => {
      const { az, lottoId, ids } = await conMovimenti(2)
      // Il trigger impedisce di uscire da DA_RICONCILIARE: si prova con una riga mancante (rimossa dal
      // proprietario disattivando il trigger solo per la sessione).
      await owner.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`)
        await tx.movimentoTrasmissioneRentri.deleteMany({ where: { movimentoId: ids[0] } })
      })
      const sorgente = sorgenteMovimenti(2, 0)
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
      })
      expect(rapporto.valutazione.differenzeAperte).toContain('5:non-bloccati')
    })

    it('RENTRI: identificativi verificati in sola lettura, mai una POST; assente = differenza', async () => {
      const { az, lottoId } = await conMovimenti(1, true)
      const chiamate: string[] = []
      let risposta: 'ok' | 404 = 'ok'
      const base: LettoreRentri = {
        async dettaglioMovimentoPerIdentificativo(registro, movimento) {
          chiamate.push(`${registro}/${movimento}`)
          if (risposta === 'ok') return {}
          throw Object.assign(new Error('non trovato'), { status: 404 })
        },
      }
      const lettore = new Proxy(base, {
        get(t, p) {
          if (p in t) return (t as never)[p]
          return () => {
            throw new Error(`metodo vietato: ${String(p)}`)
          }
        },
      })
      const sorgente: SorgenteRiconciliazione = {
        ...sorgenteMovimenti(1, 0),
        confronto5: { renRegistrazioni: { presente: true, conIdRentri: 1 } },
      }
      const genera = (extra: Record<string, unknown> = {}) =>
        riconcilia.genera({
          tenantId: az.tenantId,
          lottiIds: [lottoId],
          sorgente,
          hashSorgente: hashCanonico(sorgente),
          dimensioneCampione: 1,
          lettoreRentri: lettore,
          pausaRentriMs: 0,
          ...extra,
        })
      const ok = await genera()
      expect(chiamate).toEqual([`${REGISTRO_RENTRI}/${MOVIMENTO_RENTRI}`])
      expect(ok.rapporto.esiti.confronti[4].esito).toBe('OK')

      risposta = 404
      const assente = await genera({ radiceId: ok.rapporto.radiceId, lottiIds: [] })
      expect(assente.rapporto.valutazione.differenzeAperte).toEqual(
        expect.arrayContaining(['5:verifica-presenti', '5:verifica-assenti'])
      )
      // Nessun identificativo da verificare con un lettore assente: NON_VERIFICATO.
      const senza = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
        radiceId: ok.rapporto.radiceId,
      })
      expect(senza.rapporto.esiti.confronti[4].esito).toBe('NON_VERIFICATO')
    })

    it('B1: un lotto FALLITO, ANNULLATO o IN_CORSO non da mai un rapporto', async () => {
      const sorgente = sorgenteMovimenti(2, 0)
      for (const stato of ['FALLITO', 'ANNULLATO', 'IN_CORSO'] as const) {
        const { az, lottoId } = await conMovimenti(2)
        await owner.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`)
          await tx.lottoImport.update({ where: { id: lottoId }, data: { stato } })
        })
        await expect(
          riconcilia.genera({
            tenantId: az.tenantId,
            lottiIds: [lottoId],
            sorgente,
            hashSorgente: hashCanonico(sorgente),
          })
        ).rejects.toBeInstanceOf(LottoNonCompletatoError)
        expect(
          await owner.rapportoRiconciliazione.count({ where: { tenantId: az.tenantId } })
        ).toBe(0)
      }
    })

    it('M4: l archivio del rapporto sorgente deve essere quello dei lotti', async () => {
      const { az, lottoId } = await conMovimenti(1)
      const altro = { ...sorgenteMovimenti(1, 0), archivio: 'WW00022026' }
      await expect(
        riconcilia.genera({
          tenantId: az.tenantId,
          lottiIds: [lottoId],
          sorgente: altro,
          hashSorgente: hashCanonico(altro),
        })
      ).rejects.toBeInstanceOf(ArchivioDiversoError)
    })

    it('M2: un campione di 0 righe e rifiutato', async () => {
      const { az, lottoId } = await conMovimenti(1)
      const sorgente = sorgenteMovimenti(1, 0)
      await expect(
        riconcilia.genera({
          tenantId: az.tenantId,
          lottiIds: [lottoId],
          sorgente,
          hashSorgente: hashCanonico(sorgente),
          dimensioneCampione: 0,
        })
      ).rejects.toBeInstanceOf(CampioneNonValidoError)
    })

    it('B-1: l esito di un campione si da solo dal suo rapporto', async () => {
      const { az, lottoId } = await conMovimenti(2)
      const sorgente = sorgenteMovimenti(2, 0)
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
      })
      await expect(
        riconcilia.registraEsitoCampione({
          tenantId: az.tenantId,
          radiceId: '99999999-9999-4999-8999-999999999999',
          campioneId: rapporto.campioni[0].id,
          esito: 'CORRISPONDE',
          utenteId: az.operatoreId,
        })
      ).rejects.toThrow(/campione inesistente/)
    })

    it('M3: il non verificato lo accetta solo il SUPER_ADMIN e ogni ricalcolo annulla l accettazione', async () => {
      const { az, lottoId } = await conMovimenti(1, true)
      const sorgente: SorgenteRiconciliazione = {
        ...sorgenteMovimenti(1, 0),
        confronto5: { renRegistrazioni: { presente: true, conIdRentri: 1 } },
      }
      // Nessun lettore RENTRI: confronto 5 NON_VERIFICATO.
      const genera = (radiceId?: string) =>
        riconcilia.genera({
          tenantId: az.tenantId,
          lottiIds: radiceId ? [] : [lottoId],
          sorgente,
          hashSorgente: hashCanonico(sorgente),
          dimensioneCampione: 1,
          radiceId,
        })
      const { rapporto } = await genera()
      const base = {
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        versione: 1,
        chiave: '5:non-verificato',
        motivo: 'verifica RENTRI rimandata allo sblocco',
        utenteId: az.operatoreId,
      }
      await expect(
        riconcilia.accettaDifferenza({ ...base, ruolo: 'ADMIN' })
      ).rejects.toBeInstanceOf(AccettazioneNonConsentitaError)
      const v2 = await riconcilia.accettaDifferenza({ ...base, ruolo: 'SUPER_ADMIN' })
      expect(v2.esiti.accettazioni['5:non-verificato']).toMatchObject({ ruolo: 'SUPER_ADMIN' })
      expect(v2.valutazione.differenzeAperte).not.toContain('5:non-verificato')
      // Il ricalcolo (anche senza cambiamenti nei dati) annulla l'accettazione.
      const ricalcolo = await genera(rapporto.radiceId)
      expect(ricalcolo.nuovaVersione).toBe(true)
      expect(ricalcolo.rapporto.esiti.accettazioni['5:non-verificato']).toBeUndefined()
      expect(ricalcolo.rapporto.valutazione.differenzeAperte).toContain('5:non-verificato')
    })

    it('M1: la chiusura aspetta chi tiene la radice e poi vede l esito del campione', async () => {
      const { az, lottoId } = await conMovimenti(2)
      const sorgente = sorgenteMovimenti(2, 0)
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
      })
      await riconcilia.registraEsitoCampione({
        tenantId: az.tenantId,
        radiceId: rapporto.radiceId,
        campioneId: rapporto.campioni[0].id,
        esito: 'CORRISPONDE',
        utenteId: az.operatoreId,
      })
      let rilascia!: () => void
      const tenuto = new Promise<void>(r => (rilascia = r))
      let bloccato!: () => void
      const èBloccato = new Promise<void>(r => (bloccato = r))
      // Un altro scrittore tiene la radice e, prima di rilasciarla, segna un campione non corrispondente.
      const altro = owner.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM rapporti_riconciliazione WHERE id = ${rapporto.radiceId}::uuid FOR UPDATE`
          bloccato()
          await tenuto
          await tx.campioneRiconciliazione.update({
            where: { id: rapporto.campioni[0].id },
            data: { esito: 'NON_CORRISPONDE', esitoIl: new Date() },
          })
        },
        { timeout: 20000 }
      )
      await èBloccato
      let finita = false
      const chiusura = riconcilia
        .chiudi({
          tenantId: az.tenantId,
          radiceId: rapporto.radiceId,
          versione: 1,
          utenteId: az.operatoreId,
        })
        .then(
          () => (finita = true),
          e => ((finita = true), e)
        )
      await new Promise(r => setTimeout(r, 500))
      expect(finita).toBe(false) // aspetta il lock
      rilascia()
      await altro
      const esito = await chiusura
      expect(esito).toBeInstanceOf(RapportoNonChiudibileError) // vede il campione non corrispondente
      expect((await riconcilia.leggi(az.tenantId, rapporto.radiceId)).stato).toBe('APERTO')
    })

    it('un altra azienda non vede ne il rapporto ne i lotti', async () => {
      const { az, lottoId } = await conMovimenti(1)
      const altra = await azienda()
      const sorgente = sorgenteMovimenti(1, 0)
      await expect(
        riconcilia.genera({
          tenantId: altra.tenantId,
          lottiIds: [lottoId],
          sorgente,
          hashSorgente: hashCanonico(sorgente),
        })
      ).rejects.toThrow(/lotti inesistenti/)
      const { rapporto } = await riconcilia.genera({
        tenantId: az.tenantId,
        lottiIds: [lottoId],
        sorgente,
        hashSorgente: hashCanonico(sorgente),
        dimensioneCampione: 1,
      })
      await expect(riconcilia.leggi(altra.tenantId, rapporto.radiceId)).rejects.toThrow(
        /inesistente/
      )
    })
  })
})
