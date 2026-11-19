/**
 * Collegare o aprire il registro RENTRI da WasteFlow (eREGI E2, T1-T3) contro un Postgres reale
 * COME `wasteflow_app` (RLS), con un client anagrafiche FINTO in-process. Il proprietario prepara i
 * dati e legge l'esito; la pulizia toglie solo le aziende create qui.
 *
 * Garanzie: l'identificativo si salva solo se verificato su RENTRI; l'apertura (POST non
 * idempotente) parte UNA volta sola anche con due richieste parallele, e un esito incerto si
 * risolve per lettura, mai con una seconda POST.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import type {
  RegistroAnagraficoModel,
  RichiestaApriRegistro,
} from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { SOGLIA_STALLO_RENTRI_MS } from '../sync-fir-to-rentri.use-case'
import {
  ApriRegistroRentriUseCase,
  MESSAGGIO_APERTURA_INCERTA,
} from './apri-registro-rentri.use-case'
import { CandidatiRegistroRentriUseCase } from './candidati-registro-rentri.use-case'
import { CollegaRegistroRentriUseCase } from './collega-registro-rentri.use-case'
import {
  AperturaRegistroInCorsoError,
  AperturaRegistroNonRisoltaError,
  IdentificativoGiaUsatoError,
  IdentificativoRegistroNonValidoError,
  OperatoreRentriNonConfiguratoError,
  RegistroGiaCollegatoError,
  RegistroRentriNonCollegabileError,
  RegistroRentriNonTrovatoError,
  RegistroSenzaSedeRentriError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
  TrasmissioneNonModificabileError,
} from './errori-azioni-rentri-registro'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'
import { RegistroNonTrovatoError } from '../../registro/registri.service'

/** Client anagrafiche finto: risponde e lancia quello che il test configura e conta le chiamate. */
class AnagraficheFinto {
  dettagli = new Map<string, RegistroAnagraficoModel | Error>()
  elenco: RegistroAnagraficoModel[] = []
  chiamateApri: RichiestaApriRegistro[] = []
  chiamateElenco = 0
  ritardoApriMs = 0
  apri: (() => { identificativo: string } | Error) | null = null

  async dettaglioRegistro(identificativo: string) {
    const r = this.dettagli.get(identificativo)
    if (r === undefined) throw new RentriApiError(404, 'Non trovato', 'Registro non trovato', false)
    if (r instanceof Error) throw r
    return r
  }
  async apriRegistro(richiesta: RichiestaApriRegistro) {
    this.chiamateApri.push(richiesta)
    if (this.ritardoApriMs) await new Promise(r => setTimeout(r, this.ritardoApriMs))
    const esito = this.apri ? this.apri() : { identificativo: 'RNEW0000001' }
    if (esito instanceof Error) throw esito
    return esito
  }
  async elencaRegistriSito() {
    this.chiamateElenco++
    return {
      risultati: this.elenco,
      paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: this.elenco.length },
    }
  }
}

const minutiFa = (m: number) => new Date(Date.now() - m * 60_000)

describe('Collegare e aprire il registro RENTRI — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const tenantCreati: string[] = []
  let utenteId = ''
  let n = 0
  let finto: AnagraficheFinto
  let collega: CollegaRegistroRentriUseCase
  let apri: ApriRegistroRentriUseCase
  let candidati: CandidatiRegistroRentriUseCase

  async function azienda(
    opzioni: { senzaSede?: boolean; senzaOperatore?: boolean; identificativo?: string } = {}
  ) {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Collega RENTRI SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    if (!opzioni.senzaOperatore) {
      await owner.rentriCredential.create({
        data: {
          tenantId: t.id,
          clientId: 'client',
          certificatePem: 'pem',
          privateKeyEnc: 'enc',
          numIscrOperatore: 'OP0001',
        },
      })
    }
    const numIscrSito = `OP0001CO${String(++n).padStart(6, '0')}-MI0001`
    const sede = opzioni.senzaSede
      ? null
      : await owner.rentriUnitaLocale.create({
          data: { tenantId: t.id, numIscrSito, denominazione: 'Sede', principale: true },
        })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede?.id ?? null,
        descrizione: 'Registro di prova',
        identificativoRentri: opzioni.identificativo ?? null,
        ...(opzioni.identificativo ? { rentriAttivita: ['Produzione'] } : {}),
      },
    })
    return { tenantId: t.id, registroId: registro.id, numIscrSito, unitaLocaleId: sede?.id ?? null }
  }

  const registroDi = (id: string) => owner.registroRifiuti.findUniqueOrThrow({ where: { id } })
  const audit = (tenantId: string, action: string) =>
    owner.activityLog.findMany({ where: { tenantId, action } })

  const modello = (
    a: { numIscrSito: string },
    extra: Partial<RegistroAnagraficoModel> = {}
  ): RegistroAnagraficoModel => ({
    identificativo: 'RAB12CD34E5',
    descrizione: 'Registro di prova',
    num_iscr_sito: a.numIscrSito,
    attivita: ['Produzione'],
    attivita_rec_smalt: [],
    data_creazione: new Date().toISOString(),
    data_chiusura: null,
    stato: 'Attivo',
    ...extra,
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Utente collega SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    utenteId = (
      await owner.user.create({
        data: {
          tenantId: t.id,
          keycloakId: `keycloak-collega-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `collega-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  beforeEach(() => {
    finto = new AnagraficheFinto()
    const impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
    collega = new CollegaRegistroRentriUseCase(app, finto as any, impostazioni, logger)
    apri = new ApriRegistroRentriUseCase(app, finto as any, impostazioni, logger)
    candidati = new CandidatiRegistroRentriUseCase(app, finto as any)
  })

  afterAll(async () => {
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('collega', () => {
    it("verifica su RENTRI, salva identificativo e attivita, scrive l'audit", async () => {
      const a = await azienda()
      finto.dettagli.set(
        'RAB12CD34E5',
        modello(a, { attivita: ['Recupero', 'Trasporto'], attivita_rec_smalt: ['R13'] })
      )
      const esito = await collega.esegui(
        a.tenantId,
        utenteId,
        'ADMIN',
        a.registroId,
        ' rab12cd34e5 '
      )
      expect(esito.identificativoRentri).toBe('RAB12CD34E5')
      expect(esito.rentriAttivita).toEqual(['Recupero', 'Trasporto'])
      expect(esito.numIscrSito).toBe(a.numIscrSito)
      const r = await registroDi(a.registroId)
      expect(r.identificativoRentri).toBe('RAB12CD34E5')
      expect(r.rentriAttivitaRecSmalt).toEqual(['R13'])
      expect(r.rentriSincronizzatoIl).not.toBeNull()
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_IMPOSTAZIONI')
      expect(log).toHaveLength(1)
      expect(JSON.stringify(log[0].metadata)).toContain('COLLEGAMENTO')
    })

    it('solo ADMIN', async () => {
      const a = await azienda()
      await expect(
        collega.esegui(a.tenantId, utenteId, 'OPERATOR', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
    })

    it('formato errato: nessuna chiamata a RENTRI', async () => {
      const a = await azienda()
      const spia = jest.spyOn(finto, 'dettaglioRegistro')
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'xyz')
      ).rejects.toBeInstanceOf(IdentificativoRegistroNonValidoError)
      expect(spia).not.toHaveBeenCalled()
    })

    it('identificativo inesistente su RENTRI (404): errore di dominio, registro invariato', async () => {
      const a = await azienda()
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RegistroRentriNonTrovatoError)
      expect((await registroDi(a.registroId)).identificativoRentri).toBeNull()
    })

    it('altri errori di RENTRI (5xx) si propagano senza modificare nulla', async () => {
      const a = await azienda()
      const guasto = new RentriApiError(503, undefined, undefined, true)
      finto.dettagli.set('RAB12CD34E5', guasto)
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBe(guasto)
      expect((await registroDi(a.registroId)).identificativoRentri).toBeNull()
    })

    it("registro di un'altra unita' locale: 409", async () => {
      const a = await azienda()
      finto.dettagli.set('RAB12CD34E5', modello(a, { num_iscr_sito: 'OP0001ZZ000001-RM0001' }))
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RegistroRentriNonCollegabileError)
      expect((await registroDi(a.registroId)).identificativoRentri).toBeNull()
    })

    it.each([
      ['data di chiusura', { data_chiusura: '2026-01-01T00:00:00Z' }],
      ['stato Chiuso', { stato: 'Chiuso' as const }],
      ['stato Eliminato', { stato: 'Eliminato' as const }],
    ])('registro chiuso su RENTRI (%s): 409', async (_nome, extra) => {
      const a = await azienda()
      finto.dettagli.set('RAB12CD34E5', modello(a, extra))
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RegistroRentriNonCollegabileError)
    })

    it("identificativo gia' di un altro registro dell'azienda: 409", async () => {
      const a = await azienda({ identificativo: 'RAB12CD34E5' })
      const altro = await owner.registroRifiuti.create({
        data: {
          tenantId: a.tenantId,
          unitaLocaleId: a.unitaLocaleId,
          codice: 'ALTRO',
          descrizione: 'Altro',
        },
      })
      finto.dettagli.set('RAB12CD34E5', modello(a))
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', altro.id, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(IdentificativoGiaUsatoError)
    })

    it('registro senza sede: 409, nessuna chiamata a RENTRI', async () => {
      const a = await azienda({ senzaSede: true })
      const spia = jest.spyOn(finto, 'dettaglioRegistro')
      await expect(
        collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RegistroSenzaSedeRentriError)
      expect(spia).not.toHaveBeenCalled()
    })

    it("registro di un'altra azienda: non trovato", async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(
        collega.esegui(b.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    })

    it("attivita' di RENTRI incoerenti coi vincoli locali: collega lo stesso, dettaglio non noto", async () => {
      const a = await azienda()
      finto.dettagli.set(
        'RAB12CD34E5',
        modello(a, { attivita: ['Recupero'], attivita_rec_smalt: [] })
      )
      const esito = await collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      expect(esito.rentriAttivita).toEqual([])
    })

    it('collegare azzera una prenotazione di apertura rimasta incerta', async () => {
      const a = await azienda()
      await owner.registroRifiuti.update({
        where: { id: a.registroId },
        data: { rentriAperturaRichiestaIl: minutiFa(60), rentriAperturaDescrizione: 'x' },
      })
      finto.dettagli.set('RAB12CD34E5', modello(a))
      const esito = await collega.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, 'RAB12CD34E5')
      expect(esito.aperturaInCorso).toBe(false)
      const r = await registroDi(a.registroId)
      expect(r.rentriAperturaRichiestaIl).toBeNull()
      expect(r.rentriAperturaDescrizione).toBeNull()
    })

    it("l'inserimento a mano durante un'apertura in corso e' rifiutato", async () => {
      const a = await azienda()
      await owner.registroRifiuti.update({
        where: { id: a.registroId },
        data: { rentriAperturaRichiestaIl: new Date() },
      })
      const impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
          identificativoRentri: 'RAB12CD34E5',
        })
      ).rejects.toBeInstanceOf(TrasmissioneNonModificabileError)
    })

    it("togliere l'identificativo a mano azzera i dati letti da RENTRI", async () => {
      const a = await azienda({ identificativo: 'RAB12CD34E5' })
      await owner.registroRifiuti.update({
        where: { id: a.registroId },
        data: { rentriChiusoIl: new Date(), rentriSincronizzatoIl: new Date() },
      })
      const impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
      await impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        identificativoRentri: null,
      })
      const r = await registroDi(a.registroId)
      expect(r.identificativoRentri).toBeNull()
      expect(r.rentriChiusoIl).toBeNull()
      expect(r.rentriAttivita).toEqual([])
    })
  })

  describe('apri', () => {
    const richiesta = { attivita: ['Produzione'], attivitaRecSmalt: [] as string[] }

    it("prenota, invia UNA POST col corpo giusto, salva l'identificativo e azzera la prenotazione", async () => {
      const a = await azienda()
      const esito = await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        ...richiesta,
        descrizione: ' Registro nuovo ',
      })
      expect(esito.esito).toBe('APERTO')
      expect(finto.chiamateApri).toEqual([
        {
          numIscrSito: a.numIscrSito,
          attivita: ['Produzione'],
          attivitaRecSmalt: null,
          descrizione: 'Registro nuovo',
        },
      ])
      const r = await registroDi(a.registroId)
      expect(r.identificativoRentri).toBe('RNEW0000001')
      expect(r.rentriAperturaRichiestaIl).toBeNull()
      expect(r.rentriAttivita).toEqual(['Produzione'])
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_IMPOSTAZIONI')
      expect(JSON.stringify(log[0].metadata)).toContain('APERTURA')
    })

    it('senza descrizione usa quella del registro locale; funziona anche senza numero operatore', async () => {
      const a = await azienda({ senzaOperatore: true })
      await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      expect(finto.chiamateApri[0].descrizione).toBe('Registro di prova')
    })

    it('Recupero con codici R/D: li invia', async () => {
      const a = await azienda()
      await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        attivita: ['Recupero'],
        attivitaRecSmalt: ['R13'],
      })
      expect(finto.chiamateApri[0].attivitaRecSmalt).toEqual(['R13'])
      expect((await registroDi(a.registroId)).rentriAttivitaRecSmalt).toEqual(['R13'])
    })

    it.each([
      ["nessuna attivita'", { attivita: [], attivitaRecSmalt: [] }],
      ["attivita' sconosciuta", { attivita: ['Pirotecnica'], attivitaRecSmalt: [] }],
      ['Recupero senza codici', { attivita: ['Recupero'], attivitaRecSmalt: [] }],
      ['codici senza Recupero/Smaltimento', { attivita: ['Produzione'], attivitaRecSmalt: ['R1'] }],
      ['codice inesistente', { attivita: ['Recupero'], attivitaRecSmalt: ['R14'] }],
      ['descrizione lunga', { ...richiesta, descrizione: 'x'.repeat(251) }],
    ])('richiesta non valida (%s): 400, nessuna prenotazione, nessuna POST', async (_n, dati) => {
      const a = await azienda()
      await expect(
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, dati)
      ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      expect(finto.chiamateApri).toHaveLength(0)
      expect((await registroDi(a.registroId)).rentriAperturaRichiestaIl).toBeNull()
    })

    it('solo ADMIN', async () => {
      const a = await azienda()
      await expect(
        apri.esegui(a.tenantId, utenteId, 'OPERATOR', a.registroId, richiesta)
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
    })

    it("registro gia' collegato: 409, nessuna POST", async () => {
      const a = await azienda({ identificativo: 'RAB12CD34E5' })
      await expect(
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      ).rejects.toBeInstanceOf(RegistroGiaCollegatoError)
      expect(finto.chiamateApri).toHaveLength(0)
    })

    it('registro senza sede: 409', async () => {
      const a = await azienda({ senzaSede: true })
      await expect(
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      ).rejects.toBeInstanceOf(RegistroSenzaSedeRentriError)
    })

    it("rifiuto definitivo dell'ente (400): la prenotazione si azzera e si puo' riprovare", async () => {
      const a = await azienda()
      const rifiuto = new RentriApiError(400, 'Dati non validi', 'attivita', false)
      finto.apri = () => rifiuto
      await expect(
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      ).rejects.toBe(rifiuto)
      const r = await registroDi(a.registroId)
      expect(r.rentriAperturaRichiestaIl).toBeNull()
      expect(r.identificativoRentri).toBeNull()
      finto.apri = null
      const dopo = await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      expect(dopo.esito).toBe('APERTO')
    })

    it('esito incerto: la prenotazione resta, nessuna seconda POST, risposta INCERTO', async () => {
      const a = await azienda()
      finto.apri = () => new TrasmissioneRentriIncertaError('HTTP_5XX', 503)
      const esito = await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      expect(esito).toEqual({ esito: 'INCERTO', messaggio: MESSAGGIO_APERTURA_INCERTA })
      const r = await registroDi(a.registroId)
      expect(r.rentriAperturaRichiestaIl).not.toBeNull()
      expect(r.identificativoRentri).toBeNull()
      // Una nuova richiesta subito dopo non fa partire altre POST.
      await expect(
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
      ).rejects.toBeInstanceOf(AperturaRegistroInCorsoError)
      expect(finto.chiamateApri).toHaveLength(1)
    })

    it("DUE chiamate parallele: una sola POST, l'altra riceve «apertura in corso»", async () => {
      const a = await azienda()
      finto.ritardoApriMs = 300
      const esiti = await Promise.allSettled([
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta),
        apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta),
      ])
      expect(finto.chiamateApri).toHaveLength(1)
      const riusciti = esiti.filter(e => e.status === 'fulfilled')
      const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(riusciti).toHaveLength(1)
      expect(falliti).toHaveLength(1)
      // La seconda attende il lock della prenotazione e poi la trova gia' scritta.
      expect(falliti[0].reason).toBeInstanceOf(AperturaRegistroInCorsoError)
      expect((await registroDi(a.registroId)).identificativoRentri).toBe('RNEW0000001')
    })

    describe('risoluzione di un esito incerto (dopo la soglia di stallo)', () => {
      async function incerto(a: { registroId: string }, extra: Record<string, unknown> = {}) {
        await owner.registroRifiuti.update({
          where: { id: a.registroId },
          data: {
            rentriAperturaRichiestaIl: new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS - 60_000),
            rentriAperturaDescrizione: 'Nuovo registro',
            rentriAttivita: ['Produzione'],
            ...extra,
          },
        })
      }

      it("un solo registro nuovo con stessa descrizione e attivita': lo collega con audit, senza POST", async () => {
        const a = await azienda()
        await incerto(a)
        finto.elenco = [
          modello(a, { identificativo: 'RTROVATO001', descrizione: 'Nuovo registro' }),
          modello(a, { identificativo: 'RALTRO00001', descrizione: 'Un altro' }),
        ]
        const esito = await apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
        expect(esito.esito).toBe('COLLEGATO_DOPO_VERIFICA')
        expect(finto.chiamateApri).toHaveLength(0)
        const r = await registroDi(a.registroId)
        expect(r.identificativoRentri).toBe('RTROVATO001')
        expect(r.rentriAperturaRichiestaIl).toBeNull()
        const log = await audit(a.tenantId, 'RENTRI_REGISTRO_IMPOSTAZIONI')
        expect(JSON.stringify(log[0].metadata)).toContain('APERTURA_RISOLTA')
      })

      it("ignora i registri gia' collegati, chiusi, creati prima della richiesta o con altre attivita'", async () => {
        const a = await azienda()
        await owner.registroRifiuti.create({
          data: {
            tenantId: a.tenantId,
            unitaLocaleId: a.unitaLocaleId,
            codice: 'GIA',
            descrizione: 'gia',
            identificativoRentri: 'RGIACOLLEG1',
          },
        })
        await incerto(a)
        const base = { descrizione: 'Nuovo registro' }
        finto.elenco = [
          modello(a, { ...base, identificativo: 'RGIACOLLEG1' }),
          modello(a, { ...base, identificativo: 'RCHIUSO0001', stato: 'Chiuso' }),
          modello(a, {
            ...base,
            identificativo: 'RVECCHIO001',
            data_creazione: minutiFa(24 * 60).toISOString(),
          }),
          modello(a, { ...base, identificativo: 'RALTREATT01', attivita: ['Trasporto'] }),
        ]
        await expect(
          apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
        ).rejects.toBeInstanceOf(AperturaRegistroNonRisoltaError)
        // Nessun candidato: la prenotazione si azzera e si puo' riprovare.
        expect((await registroDi(a.registroId)).rentriAperturaRichiestaIl).toBeNull()
        expect(finto.chiamateApri).toHaveLength(0)
      })

      it("piu' candidati: errore, la prenotazione resta, si sceglie con «Collega»", async () => {
        const a = await azienda()
        await incerto(a)
        finto.elenco = [
          modello(a, { identificativo: 'RDOPPIO0001', descrizione: 'Nuovo registro' }),
          modello(a, { identificativo: 'RDOPPIO0002', descrizione: 'Nuovo registro' }),
        ]
        await expect(
          apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
        ).rejects.toBeInstanceOf(AperturaRegistroNonRisoltaError)
        expect((await registroDi(a.registroId)).rentriAperturaRichiestaIl).not.toBeNull()
        finto.dettagli.set('RDOPPIO0002', modello(a, { identificativo: 'RDOPPIO0002' }))
        const collegato = await collega.esegui(
          a.tenantId,
          utenteId,
          'ADMIN',
          a.registroId,
          'RDOPPIO0002'
        )
        expect(collegato.identificativoRentri).toBe('RDOPPIO0002')
        expect(collegato.aperturaInCorso).toBe(false)
      })

      it("senza numero operatore la risoluzione non puo' leggere l'elenco: 409 chiaro", async () => {
        const a = await azienda({ senzaOperatore: true })
        await incerto(a)
        await expect(
          apri.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
        ).rejects.toBeInstanceOf(OperatoreRentriNonConfiguratoError)
      })
    })
  })

  describe('candidati', () => {
    it("elenca i registri aperti della sede e segna quelli gia' collegati", async () => {
      const a = await azienda({ identificativo: 'RMIO0000001' })
      const altro = await owner.registroRifiuti.create({
        data: {
          tenantId: a.tenantId,
          unitaLocaleId: a.unitaLocaleId,
          codice: 'ALTRO',
          descrizione: 'Altro',
          identificativoRentri: 'RALTRO00001',
        },
      })
      finto.elenco = [
        modello(a, { identificativo: 'RMIO0000001' }),
        modello(a, { identificativo: 'RALTRO00001' }),
        modello(a, { identificativo: 'RLIBERO0001', attivita: ['Trasporto'] }),
        modello(a, { identificativo: 'RCHIUSO0001', stato: 'Chiuso' }),
      ]
      const lista = await candidati.esegui(a.tenantId, a.registroId)
      expect(lista.map(c => c.identificativo)).toEqual([
        'RMIO0000001',
        'RALTRO00001',
        'RLIBERO0001',
      ])
      expect(lista[0]).toMatchObject({ questoRegistro: true, collegatoA: a.registroId })
      expect(lista[1]).toMatchObject({ questoRegistro: false, collegatoA: altro.id })
      expect(lista[2]).toMatchObject({
        questoRegistro: false,
        collegatoA: null,
        attivita: ['Trasporto'],
      })
    })

    it("senza numero operatore: 409; registro di un'altra azienda: non trovato", async () => {
      const a = await azienda({ senzaOperatore: true })
      await expect(candidati.esegui(a.tenantId, a.registroId)).rejects.toBeInstanceOf(
        OperatoreRentriNonConfiguratoError
      )
      const b = await azienda()
      await expect(candidati.esegui(b.tenantId, a.registroId)).rejects.toBeInstanceOf(
        RegistroNonTrovatoError
      )
    })
  })
})
