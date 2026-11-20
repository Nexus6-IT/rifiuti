/**
 * Modificare, chiudere e abbandonare l'apertura del registro RENTRI (eREGI E3, T0-T2) contro un
 * Postgres reale COME `wasteflow_app` (RLS), con un client anagrafiche FINTO in-process che conta
 * le chiamate. Il proprietario prepara i dati e legge l'esito; la pulizia toglie solo le aziende
 * create qui.
 *
 * Garanzie: la DELETE di chiusura e' irreversibile e parte una volta sola; dalla prenotazione
 * della chiusura nessun lotto parte piu' verso il registro; le guardie bloccano la chiusura con
 * righe in volo o da trasmettere; un esito incerto si risolve per lettura.
 */
import { PrismaClient, type StatoTrasmissioneRentri } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import type {
  ModificaRegistro,
  RegistroAnagraficoModel,
} from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { SOGLIA_STALLO_RENTRI_MS } from '../sync-fir-to-rentri.use-case'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import { AbbandonaAperturaRegistroRentriUseCase } from './abbandona-apertura-registro-rentri.use-case'
import {
  ChiudiRegistroRentriUseCase,
  MESSAGGIO_RIPRESA_NON_VERIFICATA,
} from './chiudi-registro-rentri.use-case'
import {
  AperturaRegistroInCorsoError,
  ChiusuraRegistroNonConfermataError,
  ChiusuraRegistroNonPossibileError,
  NessunaAperturaDaAbbandonareError,
  RegistroGiaCollegatoError,
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
  RegistroRentriNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
} from './errori-azioni-rentri-registro'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'
import { ModificaRegistroRentriUseCase } from './modifica-registro-rentri.use-case'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'

const ID = 'RAB12CD34E5'

class AnagraficheFinto {
  dettaglio: RegistroAnagraficoModel | Error = {}
  /** Dopo la prima lettura si passa a questo (simula lo stato dopo la scrittura). */
  dettagliSuccessivi: Array<RegistroAnagraficoModel | Error> = []
  put: ((m: ModificaRegistro) => void) | null = null
  delete: (() => void | Promise<void>) | null = null
  chiamatePut: Array<{ id: string; modifica: ModificaRegistro }> = []
  chiamateDelete: string[] = []
  chiamateDettaglio = 0
  /** Dopo una PUT/DELETE le letture pescano da `dettagliSuccessivi` (stato dopo la scrittura). */
  private scritto = false

  async dettaglioRegistro(_id: string) {
    this.chiamateDettaglio++
    const r =
      this.scritto && this.dettagliSuccessivi.length > 0
        ? this.dettagliSuccessivi.shift()!
        : this.dettaglio
    if (r instanceof Error) throw r
    return r
  }
  async modificaRegistro(id: string, modifica: ModificaRegistro) {
    this.chiamatePut.push({ id, modifica })
    this.scritto = true
    this.put?.(modifica)
    return { identificativo: id }
  }
  async chiudiRegistro(id: string) {
    this.chiamateDelete.push(id)
    this.scritto = true
    await this.delete?.()
  }
}

describe('Modificare e chiudere il registro RENTRI — Postgres reale, ruolo wasteflow_app', () => {
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
  let progressivo = 0
  let finto: AnagraficheFinto
  let modifica: ModificaRegistroRentriUseCase
  let chiudi: ChiudiRegistroRentriUseCase
  let abbandona: AbbandonaAperturaRegistroRentriUseCase
  let repo: TrasmissioniRegistroRepository
  let accoda: AccodaTrasmissioneRentriUseCase

  async function azienda(
    extra: Record<string, unknown> = {},
    opzioni: { collegato?: boolean } = {}
  ) {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Chiudi RENTRI SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001CH${String(++progressivo).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro di prova',
        ...(opzioni.collegato === false
          ? {}
          : { identificativoRentri: ID, rentriAttivita: ['Produzione'] }),
        ...extra,
      },
    })
    return { tenantId: t.id, registroId: registro.id }
  }

  async function riga(
    a: { tenantId: string; registroId: string },
    stato: StatoTrasmissioneRentri,
    extra: Record<string, unknown> = {}
  ) {
    const m = await owner.wasteMovement.create({
      data: {
        tenantId: a.tenantId,
        registroId: a.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
      } as never,
    })
    const partita = ['IN_INVIO', 'ATTESA_ESITO', 'TRASMESSA', 'INCERTA', 'GIA_SU_RENTRI']
    const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA'].includes(stato)
    return owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: a.tenantId,
        movimentoId: m.id,
        registroId: a.registroId,
        tipo: 'CARICO',
        origine: 'MANUALE',
        stato,
        bloccatoInvio: bloccata,
        motivoBlocco: bloccata ? 'prova' : null,
        ...(stato === 'ATTESA_ESITO' || (partita.includes(stato) && stato === 'IN_INVIO' && false)
          ? { transazioneId: randomUUID() }
          : {}),
        ...extra,
      } as never,
    })
  }

  async function movimentoSenzaRiga(a: { tenantId: string; registroId: string }) {
    return owner.wasteMovement.create({
      data: {
        tenantId: a.tenantId,
        registroId: a.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        cerCode: '15 01 01',
        unit: 'KG',
        wastePhysicalState: 'Solido',
        type: 'CARICO',
        movementDate: new Date(),
        registrationDate: new Date(),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
      } as never,
    })
  }

  /** Tiene il lock dei lotti, scrive la prenotazione di chiusura e rilascia: simula `chiudi`. */
  function chiusuraConLock(registroId: string, tenantId: string, attesaMs: number) {
    return owner.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId}))`
      await new Promise(r => setTimeout(r, attesaMs))
      await tx.registroRifiuti.updateMany({
        where: { id: registroId, tenantId },
        data: { rentriChiusuraRichiestaIl: new Date() },
      })
    })
  }

  const registroDi = (id: string) => owner.registroRifiuti.findUniqueOrThrow({ where: { id } })
  const audit = (tenantId: string, action: string) =>
    owner.activityLog.findMany({ where: { tenantId, action } })
  const minutiFa = (m: number) => new Date(Date.now() - m * 60_000)
  const aperto = (extra: Partial<RegistroAnagraficoModel> = {}): RegistroAnagraficoModel => ({
    identificativo: ID,
    descrizione: 'Registro di prova',
    attivita: ['Produzione'],
    attivita_rec_smalt: [],
    data_chiusura: null,
    stato: 'Attivo',
    ...extra,
  })
  const chiusoSuRentri = aperto({ data_chiusura: '2026-06-01T10:00:00Z', stato: 'Chiuso' })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Utente chiudi SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    utenteId = (
      await owner.user.create({
        data: {
          tenantId: t.id,
          keycloakId: `keycloak-chiudi-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `chiudi-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    repo = new TrasmissioniRegistroRepository(app, logger)
    accoda = new AccodaTrasmissioneRentriUseCase(app, logger)
  })

  beforeEach(() => {
    finto = new AnagraficheFinto()
    finto.dettaglio = aperto()
    const impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
    modifica = new ModificaRegistroRentriUseCase(app, finto as any, impostazioni, logger)
    chiudi = new ChiudiRegistroRentriUseCase(app, finto as any, impostazioni, logger)
    abbandona = new AbbandonaAperturaRegistroRentriUseCase(app, impostazioni, logger)
  })

  afterAll(async () => {
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('modifica', () => {
    it('descrizione: PUT con il corpo giusto, registro locale aggiornato, audit prima/dopo', async () => {
      const a = await azienda()
      const r = await modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        descrizione: '  Nuova descrizione  ',
      })
      expect(r.esito).toBe('MODIFICATO')
      expect(finto.chiamatePut).toEqual([
        { id: ID, modifica: { descrizione: 'Nuova descrizione' } },
      ])
      const db = await registroDi(a.registroId)
      expect(db.descrizione).toBe('Nuova descrizione')
      expect(db.rentriSincronizzatoIl).not.toBeNull()
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_MODIFICATO')
      expect(log).toHaveLength(1)
      expect(log[0].metadata).toMatchObject({
        prima: { descrizione: 'Registro di prova' },
        dopo: { descrizione: 'Nuova descrizione' },
      })
    })

    it('codici R/D su un registro di Recupero: li invia con forza e li salva', async () => {
      const a = await azienda({ rentriAttivita: ['Recupero'], rentriAttivitaRecSmalt: ['R1'] })
      finto.dettaglio = aperto({ attivita: ['Recupero'], attivita_rec_smalt: ['R1'] })
      await modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        attivitaRecSmalt: ['R1', 'R13'],
        forza: true,
      })
      expect(finto.chiamatePut[0].modifica).toEqual({
        attivitaRecSmalt: ['R1', 'R13'],
        forza: true,
      })
      expect((await registroDi(a.registroId)).rentriAttivitaRecSmalt).toEqual(['R1', 'R13'])
    })

    it('codici su un registro senza Recupero/Smaltimento: 400, nessuna PUT', async () => {
      const a = await azienda()
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { attivitaRecSmalt: ['R1'] })
      ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      expect(finto.chiamatePut).toHaveLength(0)
    })

    it('richieste non valide: 400 senza chiamare RENTRI', async () => {
      const a = await azienda()
      for (const richiesta of [
        {},
        { descrizione: '   ' },
        { descrizione: 'x'.repeat(251) },
        { attivitaRecSmalt: ['R99'] },
        { attivitaRecSmalt: ['R1', 'R1'] },
      ]) {
        await expect(
          modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, richiesta)
        ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      }
      expect(finto.chiamateDettaglio).toBe(0)
      expect(finto.chiamatePut).toHaveLength(0)
    })

    it('solo ADMIN', async () => {
      const a = await azienda()
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'OPERATOR', a.registroId, { descrizione: 'x' })
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
      expect(finto.chiamatePut).toHaveLength(0)
    })

    it('registro non collegato: 409; di un altra azienda: non trovato', async () => {
      const a = await azienda({}, { collegato: false })
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { descrizione: 'x' })
      ).rejects.toBeInstanceOf(RegistroNonCollegatoRentriError)
      const b = await azienda()
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', b.registroId, { descrizione: 'x' })
      ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    })

    it('registro chiuso o in chiusura nel registro locale: 409, nessuna chiamata', async () => {
      const chiuso = await azienda({ rentriChiusoIl: minutiFa(60) })
      const inChiusura = await azienda({ rentriChiusuraRichiestaIl: minutiFa(1) })
      for (const a of [chiuso, inChiusura]) {
        await expect(
          modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { descrizione: 'x' })
        ).rejects.toBeInstanceOf(RegistroRentriChiusoError)
      }
      expect(finto.chiamateDettaglio).toBe(0)
    })

    it('chiuso sul portale: 409 e il flag locale si allinea (gli invii si fermano)', async () => {
      const a = await azienda({ invioRentriAutomaticoDal: minutiFa(1000) })
      finto.dettaglio = chiusoSuRentri
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { descrizione: 'x' })
      ).rejects.toBeInstanceOf(RegistroRentriChiusoError)
      const db = await registroDi(a.registroId)
      expect(db.rentriChiusoIl?.toISOString()).toBe('2026-06-01T10:00:00.000Z')
      expect(db.invioRentriAutomaticoDal).toBeNull()
      expect(finto.chiamatePut).toHaveLength(0)
      const l = await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSO')
      expect(l).toHaveLength(1)
      expect(l[0].metadata).toMatchObject({ origine: 'PORTALE' })
    })

    it('registro sparito da RENTRI (404): 400, nulla cambia', async () => {
      const a = await azienda()
      finto.dettaglio = new RentriApiError(404, 'Non trovato', 'Registro non trovato', false)
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { descrizione: 'x' })
      ).rejects.toBeInstanceOf(RegistroRentriNonTrovatoError)
    })

    it("rifiuto dell'ente: l'errore sale e il registro locale non cambia", async () => {
      const a = await azienda()
      finto.put = () => {
        throw new RentriApiError(400, 'Codici non ammessi', 'x', false)
      }
      await expect(
        modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, { descrizione: 'Nuova' })
      ).rejects.toBeInstanceOf(RentriApiError)
      expect((await registroDi(a.registroId)).descrizione).toBe('Registro di prova')
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_MODIFICATO')).toHaveLength(0)
    })

    it('esito incerto: se RENTRI mostra i nuovi valori si salva, altrimenti INCERTO senza salvare', async () => {
      const a = await azienda()
      finto.put = () => {
        throw new TrasmissioneRentriIncertaError('TIMEOUT' as never)
      }
      finto.dettagliSuccessivi = [aperto({ descrizione: 'Nuova' })]
      const ok = await modifica.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        descrizione: 'Nuova',
      })
      expect(ok.esito).toBe('MODIFICATO')
      expect((await registroDi(a.registroId)).descrizione).toBe('Nuova')

      const b = await azienda()
      finto.chiamateDettaglio = 0
      finto.dettagliSuccessivi = [aperto({ descrizione: 'Registro di prova' })]
      const no = await modifica.esegui(b.tenantId, utenteId, 'ADMIN', b.registroId, {
        descrizione: 'Altra',
      })
      expect(no.esito).toBe('INCERTO')
      expect((await registroDi(b.registroId)).descrizione).toBe('Registro di prova')
    })
  })

  describe('chiudi', () => {
    it('chiude: DELETE una volta, registro chiuso, invio automatico spento, audit avviata + chiuso', async () => {
      const a = await azienda({ invioRentriAutomaticoDal: minutiFa(1000) })
      await riga(a, 'TRASMESSA')
      await riga(a, 'DA_TRASMETTERE', {
        esclusoIl: new Date(),
        esclusoDa: utenteId,
        motivoEsclusione: 'prova',
      })
      const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID.toLowerCase())
      expect(r.esito).toBe('CHIUSO')
      expect(finto.chiamateDelete).toEqual([ID])
      const db = await registroDi(a.registroId)
      expect(db.rentriChiusoIl).not.toBeNull()
      expect(db.rentriChiusuraRichiestaIl).toBeNull()
      expect(db.invioRentriAutomaticoDal).toBeNull()
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_AVVIATA')).toHaveLength(1)
      const chiusura = await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSO')
      expect(chiusura).toHaveLength(1)
      expect(JSON.stringify(chiusura[0].metadata)).not.toContain(ID)
      if (r.esito === 'CHIUSO') expect(r.impostazioni.rentriChiusoIl).not.toBeNull()
    })

    it('la conferma deve essere l identificativo: 400, nessuna prenotazione ne DELETE', async () => {
      const a = await azienda()
      for (const conferma of ['', 'chiudi', 'RZZZZZ99999']) {
        await expect(
          chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, conferma)
        ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      }
      expect(finto.chiamateDelete).toHaveLength(0)
      expect((await registroDi(a.registroId)).rentriChiusuraRichiestaIl).toBeNull()
    })

    it.each(['IN_INVIO', 'ATTESA_ESITO', 'INCERTA', 'DA_TRASMETTERE'] as const)(
      'una riga %s blocca la chiusura (409 con i conteggi), nessuna DELETE',
      async stato => {
        const a = await azienda()
        await riga(a, stato)
        await riga(a, stato)
        const errore = await chiudi
          .esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
          .catch(e => e)
        expect(errore).toBeInstanceOf(ChiusuraRegistroNonPossibileError)
        expect((errore as ChiusuraRegistroNonPossibileError).conteggi).toEqual({ [stato]: 2 })
        expect(finto.chiamateDelete).toHaveLength(0)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        expect(db.rentriChiusoIl).toBeNull()
      }
    )

    it('solo ADMIN; non collegato; gia chiuso; altra azienda', async () => {
      const a = await azienda()
      await expect(
        chiudi.esegui(a.tenantId, utenteId, 'OPERATOR', a.registroId, ID)
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
      const nc = await azienda({}, { collegato: false })
      await expect(
        chiudi.esegui(nc.tenantId, utenteId, 'ADMIN', nc.registroId, ID)
      ).rejects.toBeInstanceOf(RegistroNonCollegatoRentriError)
      const ch = await azienda({ rentriChiusoIl: minutiFa(5) })
      await expect(
        chiudi.esegui(ch.tenantId, utenteId, 'ADMIN', ch.registroId, ID)
      ).rejects.toBeInstanceOf(RegistroRentriChiusoError)
      await expect(
        chiudi.esegui(a.tenantId, utenteId, 'ADMIN', ch.registroId, ID)
      ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
      expect(finto.chiamateDelete).toHaveLength(0)
    })

    it("rifiuto definitivo dell'ente (4xx): prenotazione annullata, errore rilanciato, audit", async () => {
      const a = await azienda()
      finto.delete = () => {
        throw new RentriApiError(404, 'Non trovato', 'Registro non trovato', false)
      }
      await expect(
        chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
      ).rejects.toBeInstanceOf(RentriApiError)
      const db = await registroDi(a.registroId)
      expect(db.rentriChiusuraRichiestaIl).toBeNull()
      expect(db.rentriChiusoIl).toBeNull()
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')).toHaveLength(1)
    })

    describe('esito incerto della DELETE', () => {
      const incerta = () => {
        throw new TrasmissioneRentriIncertaError('TIMEOUT' as never)
      }

      it('il dettaglio mostra la chiusura: CHIUSO con la data di RENTRI, una sola DELETE', async () => {
        const a = await azienda()
        finto.delete = incerta
        finto.dettagliSuccessivi = [chiusoSuRentri]
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('CHIUSO')
        expect(finto.chiamateDelete).toHaveLength(1)
        expect((await registroDi(a.registroId)).rentriChiusoIl?.toISOString()).toBe(
          '2026-06-01T10:00:00.000Z'
        )
      })

      it('il dettaglio mostra il registro ancora aperto: 409, prenotazione annullata, invii di nuovo possibili', async () => {
        const a = await azienda()
        finto.delete = incerta
        finto.dettagliSuccessivi = [aperto()]
        await expect(
          chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        ).rejects.toBeInstanceOf(ChiusuraRegistroNonConfermataError)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        expect(db.rentriChiusoIl).toBeNull()
      })

      it('anche la rilettura fallisce: INCERTO, la prenotazione RESTA e fermi gli invii; la ripresa legge prima', async () => {
        const a = await azienda()
        await riga(a, 'TRASMESSA')
        finto.delete = incerta
        finto.dettagliSuccessivi = [new Error('rete')]
        const r1 = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r1.esito).toBe('INCERTO')
        expect((await registroDi(a.registroId)).rentriChiusuraRichiestaIl).not.toBeNull()
        // Gli invii sono fermi gia' ora.
        expect(
          await repo.prenota(a.tenantId, a.registroId, async () => ({
            lotto: [],
            nonTrasmissibili: [],
          }))
        ).toEqual({ esito: 'REGISTRO_CHIUSO' })

        // Ripresa: il portale mostra la chiusura, nessuna seconda DELETE.
        finto.chiamateDettaglio = 0
        finto.dettaglio = chiusoSuRentri
        const r2 = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r2.esito).toBe('CHIUSO')
        expect(finto.chiamateDelete).toHaveLength(1)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusoIl).not.toBeNull()
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_AVVIATA')).toHaveLength(1)
      })

      it('I4: nella ripresa la guardia non si rifa: annotazioni nate dopo la prenotazione restano locali', async () => {
        const a = await azienda({
          rentriChiusuraRichiestaIl: minutiFa(30),
          invioRentriAutomaticoDal: minutiFa(1000),
        })
        await movimentoSenzaRiga(a)
        await riga(a, 'DA_TRASMETTERE')
        finto.dettaglio = chiusoSuRentri
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('CHIUSO')
        expect(finto.chiamateDelete).toHaveLength(0)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusoIl).not.toBeNull()
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        // le annotazioni restano nel registro locale, nessuna riga di trasmissione nuova
        expect(await owner.wasteMovement.count({ where: { registroId: a.registroId } })).toBe(2)
        expect(
          await owner.movimentoTrasmissioneRentri.count({ where: { registroId: a.registroId } })
        ).toBe(1)
      })
    })

    describe('I5: ripresa di una chiusura prenotata — macchina a stati sul dettaglio di RENTRI', () => {
      /** Registro con la chiusura prenotata da un tentativo precedente e l'invio automatico attivo. */
      const prenotato = () =>
        azienda({
          rentriChiusuraRichiestaIl: minutiFa(30),
          invioRentriAutomaticoDal: minutiFa(1000),
        })

      it('CHIUSO su RENTRI: conferma senza guardia e senza DELETE, anche con annotazioni nate dopo', async () => {
        const a = await prenotato()
        await movimentoSenzaRiga(a)
        finto.dettaglio = chiusoSuRentri
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('CHIUSO')
        expect(finto.chiamateDelete).toHaveLength(0)
        expect(finto.chiamateDettaglio).toBe(1)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusoIl?.toISOString()).toBe('2026-06-01T10:00:00.000Z')
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')).toHaveLength(0)
      })

      it('APERTO e guardia che passa: la DELETE si rifa una volta, con audit della ripetizione', async () => {
        const a = await prenotato()
        await riga(a, 'TRASMESSA')
        await riga(a, 'DA_TRASMETTERE', {
          esclusoIl: new Date(),
          esclusoDa: utenteId,
          motivoEsclusione: 'prova',
        })
        finto.dettaglio = aperto()
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('CHIUSO')
        expect(finto.chiamateDelete).toEqual([ID])
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_RIPETUTA')).toHaveLength(1)
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')).toHaveLength(0)
        expect((await registroDi(a.registroId)).rentriChiusoIl).not.toBeNull()
      })

      it('APERTO e guardia che blocca: 409 con i conteggi, nessuna DELETE, prenotazione annullata', async () => {
        const a = await prenotato()
        await movimentoSenzaRiga(a)
        await riga(a, 'DA_TRASMETTERE')
        finto.dettaglio = aperto()
        const errore = await chiudi
          .esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
          .catch(e => e)
        expect(errore).toBeInstanceOf(ChiusuraRegistroNonPossibileError)
        expect((errore as ChiusuraRegistroNonPossibileError).conteggi).toEqual({
          SENZA_RIGA: 1,
          DA_TRASMETTERE: 1,
        })
        expect(finto.chiamateDelete).toHaveLength(0)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusuraRichiestaIl).toBeNull()
        expect(db.rentriChiusoIl).toBeNull()
        expect(db.invioRentriAutomaticoDal).not.toBeNull()
        const annullata = await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')
        expect(annullata).toHaveLength(1)
        expect(annullata[0].metadata).toMatchObject({ motivo: 'GUARDIA' })
        // gli invii ripartono: la prenotazione dei lotti non vede piu' la chiusura
        expect(
          await repo.prenota(a.tenantId, a.registroId, async () => ({
            lotto: [],
            nonTrasmissibili: [],
          }))
        ).not.toEqual({ esito: 'REGISTRO_CHIUSO' })
      })

      it('lettura fallita: INCERTO, nessuna DELETE, la prenotazione resta', async () => {
        const a = await prenotato()
        finto.dettaglio = new Error('rete')
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('INCERTO')
        if (r.esito === 'INCERTO') expect(r.messaggio).toBe(MESSAGGIO_RIPRESA_NON_VERIFICATA)
        expect(finto.chiamateDelete).toHaveLength(0)
        const db = await registroDi(a.registroId)
        expect(db.rentriChiusuraRichiestaIl).not.toBeNull()
        expect(db.rentriChiusoIl).toBeNull()
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')).toHaveLength(0)
      })
    })

    it('I2: RIFIUTATA e NON_TRASMISSIBILE bloccano la chiusura (come il termine mensile)', async () => {
      for (const stato of ['RIFIUTATA', 'NON_TRASMISSIBILE'] as const) {
        const a = await azienda()
        await riga(a, stato)
        const errore = await chiudi
          .esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
          .catch(e => e)
        expect(errore).toBeInstanceOf(ChiusuraRegistroNonPossibileError)
        expect((errore as ChiusuraRegistroNonPossibileError).conteggi).toEqual({ [stato]: 1 })
      }
      expect(finto.chiamateDelete).toHaveLength(0)
    })

    it("I2: un'annotazione appena registrata che l'invio automatico adotterebbe blocca (SENZA_RIGA)", async () => {
      const a = await azienda({ invioRentriAutomaticoDal: minutiFa(1000) })
      await movimentoSenzaRiga(a)
      const errore = await chiudi
        .esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        .catch(e => e)
      expect(errore).toBeInstanceOf(ChiusuraRegistroNonPossibileError)
      expect((errore as ChiusuraRegistroNonPossibileError).conteggi).toEqual({ SENZA_RIGA: 1 })
      // senza invio automatico la stessa annotazione non e' "da trasmettere": la chiusura passa
      const b = await azienda()
      await movimentoSenzaRiga(b)
      expect((await chiudi.esegui(b.tenantId, utenteId, 'ADMIN', b.registroId, ID)).esito).toBe(
        'CHIUSO'
      )
    })

    describe('I1: chi crea righe prende il lock dei lotti (nessuna riga dopo il conteggio della chiusura)', () => {
      it('accoda e accodaStorico attendono la chiusura e poi rifiutano', async () => {
        const a = await azienda()
        const m = await movimentoSenzaRiga(a)
        const chiusura = chiusuraConLock(a.registroId, a.tenantId, 400)
        await new Promise(r => setTimeout(r, 100))
        const esiti = await Promise.allSettled([
          accoda.accoda(a.tenantId, utenteId, a.registroId, [m.id]),
          accoda.accodaStorico(a.tenantId, utenteId, a.registroId, 2026, true),
        ])
        await chiusura
        expect(esiti.map(e => e.status)).toEqual(['rejected', 'rejected'])
        expect(
          await owner.movimentoTrasmissioneRentri.count({ where: { tenantId: a.tenantId } })
        ).toBe(0)
      })

      it('adottaAutomatiche e adottaCorrezioni attendono la chiusura e non adottano', async () => {
        const a = await azienda({ invioRentriAutomaticoDal: minutiFa(1000) })
        const orig = await riga(a, 'TRASMESSA')
        await movimentoSenzaRiga(a)
        await owner.wasteMovement.create({
          data: {
            tenantId: a.tenantId,
            registroId: a.registroId,
            progressiveYear: 2026,
            progressiveNumber: ++progressivo,
            cerCode: '15 01 01',
            unit: 'KG',
            wastePhysicalState: 'Solido',
            type: 'CARICO',
            movementDate: new Date(),
            registrationDate: new Date(),
            causale: 'PRODUZIONE_INTERNA',
            quantity: 100,
            tipoAnnotazione: 'RETTIFICA',
            movimentoRettificatoId: orig.movimentoId,
            movimentoOriginaleId: orig.movimentoId,
            motivoAnnotazione: 'x',
          } as never,
        })
        const chiusura = chiusuraConLock(a.registroId, a.tenantId, 400)
        await new Promise(r => setTimeout(r, 100))
        const [auto, corr] = await Promise.all([
          repo.adottaAutomatiche(a.tenantId, 1000),
          repo.adottaCorrezioni(a.tenantId, 1000),
        ])
        await chiusura
        expect([auto, corr]).toEqual([0, 0])
        expect(
          await owner.movimentoTrasmissioneRentri.count({ where: { tenantId: a.tenantId } })
        ).toBe(1)
      })
    })

    describe('I3: un errore della DELETE rilegge sempre il dettaglio prima di annullare', () => {
      it('400 «gia chiuso» ma il dettaglio mostra la chiusura: CHIUSO, invii mai riattivati', async () => {
        const a = await azienda()
        finto.delete = () => {
          throw new RentriApiError(400, 'Registro già chiuso', 'x', false)
        }
        finto.dettagliSuccessivi = [chiusoSuRentri]
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('CHIUSO')
        expect((await registroDi(a.registroId)).rentriChiusoIl).not.toBeNull()
        expect(await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSURA_ANNULLATA')).toHaveLength(0)
      })

      it('400 e rilettura che fallisce: la prenotazione RESTA, esito INCERTO', async () => {
        const a = await azienda()
        finto.dettaglio = new Error('rete')
        finto.delete = () => {
          throw new RentriApiError(400, 'Registro già chiuso', 'x', false)
        }
        const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
        expect(r.esito).toBe('INCERTO')
        expect(finto.chiamateDelete).toEqual([ID])
        expect((await registroDi(a.registroId)).rentriChiusuraRichiestaIl).not.toBeNull()
      })
    })

    it("M1: se l'identificativo cambia mentre la DELETE e in volo, il registro nuovo NON risulta chiuso", async () => {
      const a = await azienda()
      finto.delete = async () => {
        await owner.registroRifiuti.update({
          where: { id: a.registroId },
          data: {
            identificativoRentri: 'RNUOVO00001',
            rentriChiusuraRichiestaIl: null,
            rentriAttivita: [],
          },
        })
      }
      const r = await chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID)
      expect(r.esito).toBe('CHIUSO')
      const db = await registroDi(a.registroId)
      expect(db.identificativoRentri).toBe('RNUOVO00001')
      expect(db.rentriChiusoIl).toBeNull()
      expect(
        (await audit(a.tenantId, 'RENTRI_REGISTRO_CHIUSO')).some(l =>
          JSON.stringify(l.metadata).includes('collegamentoCambiato')
        )
      ).toBe(true)
    })

    it('con la chiusura prenotata nessun lotto parte e accoda e invio automatico sono rifiutati', async () => {
      const a = await azienda({ rentriChiusuraRichiestaIl: minutiFa(1) })
      const m = await riga(a, 'RIFIUTATA')
      expect(
        await repo.prenota(a.tenantId, a.registroId, async () => ({
          lotto: [m.movimentoId],
          nonTrasmissibili: [],
        }))
      ).toEqual({ esito: 'REGISTRO_CHIUSO' })
      const impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, { invioAutomatico: true })
      ).rejects.toThrow(/chiuso su RENTRI/)
      expect((await impostazioni.leggi(a.tenantId))[0].chiusuraInCorso).toBe(true)
    })

    it('chiudi e prenota in concorrenza: o il lotto e gia prenotato (409) o la prenotazione vede la chiusura', async () => {
      for (let giro = 0; giro < 8; giro++) {
        const a = await azienda()
        const r = await riga(a, 'DA_TRASMETTERE')
        const [c, p] = await Promise.allSettled([
          chiudi.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId, ID),
          repo.prenota(a.tenantId, a.registroId, async () => ({
            lotto: [r.movimentoId],
            nonTrasmissibili: [],
          })),
        ])
        const prenotato = p.status === 'fulfilled' && p.value.esito === 'PRENOTATO'
        if (prenotato) {
          // Il lotto e' gia' in volo: la chiusura lo vede e rifiuta.
          expect(c.status).toBe('rejected')
          expect(c.status === 'rejected' && c.reason).toBeInstanceOf(
            ChiusuraRegistroNonPossibileError
          )
        } else {
          // La chiusura ha il lock (GIA_IN_CORSO: il giro successivo trova la chiusura prenotata).
          expect(['REGISTRO_CHIUSO', 'GIA_IN_CORSO']).toContain(
            p.status === 'fulfilled' && p.value.esito
          )
        }
        const db = await registroDi(a.registroId)
        // Mai un registro chiuso con un lotto in volo.
        if (db.rentriChiusoIl !== null) {
          expect(
            await owner.movimentoTrasmissioneRentri.count({
              where: { registroId: a.registroId, stato: 'IN_INVIO' },
            })
          ).toBe(0)
        }
      }
    })
  })

  describe('abbandona apertura', () => {
    it("dopo la soglia di stallo azzera la prenotazione e scrive l'audit", async () => {
      const a = await azienda(
        {
          rentriAperturaRichiestaIl: new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS - 60_000),
          rentriAperturaDescrizione: 'Registro di prova',
          rentriAttivita: ['Produzione'],
        },
        { collegato: false }
      )
      const r = await abbandona.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId)
      expect(r.aperturaInCorso).toBe(false)
      const db = await registroDi(a.registroId)
      expect(db).toMatchObject({
        rentriAperturaRichiestaIl: null,
        rentriAperturaDescrizione: null,
        rentriAttivita: [],
      })
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_APERTURA_ABBANDONATA')).toHaveLength(1)
    })

    it('troppo presto: 409 e la prenotazione resta (la POST potrebbe essere in volo)', async () => {
      const a = await azienda({ rentriAperturaRichiestaIl: minutiFa(0) }, { collegato: false })
      await expect(
        abbandona.esegui(a.tenantId, utenteId, 'ADMIN', a.registroId)
      ).rejects.toBeInstanceOf(AperturaRegistroInCorsoError)
      expect((await registroDi(a.registroId)).rentriAperturaRichiestaIl).not.toBeNull()
    })

    it('nessuna apertura, registro collegato, ruolo e azienda sbagliati', async () => {
      const senza = await azienda({}, { collegato: false })
      await expect(
        abbandona.esegui(senza.tenantId, utenteId, 'ADMIN', senza.registroId)
      ).rejects.toBeInstanceOf(NessunaAperturaDaAbbandonareError)
      const collegato = await azienda()
      await expect(
        abbandona.esegui(collegato.tenantId, utenteId, 'ADMIN', collegato.registroId)
      ).rejects.toBeInstanceOf(RegistroGiaCollegatoError)
      await expect(
        abbandona.esegui(senza.tenantId, utenteId, 'VIEWER', senza.registroId)
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
      await expect(
        abbandona.esegui(senza.tenantId, utenteId, 'ADMIN', collegato.registroId)
      ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    })
  })
})
