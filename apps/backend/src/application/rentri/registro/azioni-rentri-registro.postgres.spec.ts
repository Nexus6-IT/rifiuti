/**
 * Azioni manuali, verifica D11 e impostazioni del registro (F2-9, Task 9) contro un Postgres reale
 * COME `wasteflow_app` (RLS), con un client RENTRI FINTO in-process. Il proprietario prepara i dati;
 * la pulizia toglie solo gli id creati qui.
 *
 * Garanzia centrale: niente torna `DA_TRASMETTERE` se RENTRI potrebbe averlo gia'.
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
import {
  TransazioneRentriNonTrovataError,
  TrasmissioneRentriIncertaError,
} from '../../../infrastructure/rentri/rentri-api.client'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import {
  IdentificativoGiaUsatoError,
  IdentificativoRegistroNonValidoError,
  MovimentoNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
  TrasmissioneNonModificabileError,
} from './errori-azioni-rentri-registro'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import type { AnnotazionePerRentri } from './mappa-registrazione-rentri'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { VerificaTrasmissioneRentriUseCase } from './verifica-trasmissione-rentri.use-case'

const ID_MOV = (n: number) => `M${String(n).padStart(19, '0')}`

/** Client RENTRI finto: restituisce o lancia quello che il test configura, e conta le chiamate. */
class RentriFinto {
  chiamateDettaglio = 0
  chiamateEsito = 0
  chiamateConta = 0
  dettaglio: ((anno: number, progressivo: number) => unknown) | null = null
  esito: (() => unknown) | null = null
  conta = 0
  async dettaglioMovimentoPerAnnoProgressivo(_reg: string, anno: number, progressivo: number) {
    this.chiamateDettaglio++
    if (!this.dettaglio) throw new Error('dettaglio non configurato')
    const r = this.dettaglio(anno, progressivo)
    if (r instanceof Error) throw r
    return r
  }
  async attendiEsitoMovimenti() {
    this.chiamateEsito++
    if (!this.esito) throw new Error('esito non configurato')
    const r = this.esito()
    if (r instanceof Error) throw r
    return r
  }
  async contaMovimenti() {
    this.chiamateConta++
    return this.conta
  }
}

const non404 = () => new RentriApiError(404, 'Non trovato', 'Registrazione non trovata', false)

describe('Azioni manuali sul registro verso RENTRI — Postgres reale, ruolo wasteflow_app', () => {
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
  let progressivo = 0

  async function azienda(opzioni: { identificativo?: string | null } = {}) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Azioni RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001AZ${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro di prova',
        identificativoRentri:
          opzioni.identificativo === undefined ? 'RABCDE12345' : opzioni.identificativo,
      },
    })
    return { tenantId: t.id, registroId: registro.id, unitaLocaleId: sede.id }
  }

  async function secondoRegistro(a: { tenantId: string; unitaLocaleId: string }) {
    return owner.registroRifiuti.create({
      data: {
        tenantId: a.tenantId,
        unitaLocaleId: a.unitaLocaleId,
        codice: 'ALTRO',
        descrizione: 'Altro registro',
      },
    })
  }

  async function movimento(
    a: { tenantId: string; registroId: string },
    extra: Record<string, unknown> = {}
  ) {
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
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        quantity: 100,
        ...extra,
      } as never,
    })
  }

  async function riga(
    a: { tenantId: string; registroId: string },
    m: { id: string; type: 'CARICO' | 'SCARICO' },
    dati: Record<string, unknown> = {}
  ) {
    const stato = (dati.stato as StatoTrasmissioneRentri | undefined) ?? 'DA_TRASMETTERE'
    const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI', 'INCERTA'].includes(stato)
    return owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: a.tenantId,
        movimentoId: m.id,
        registroId: a.registroId,
        tipo: m.type,
        origine: 'MANUALE',
        bloccatoInvio: bloccata,
        motivoBlocco: bloccata ? 'prova' : null,
        ...dati,
      } as never,
    })
  }

  const rigaDi = (movimentoId: string) =>
    owner.movimentoTrasmissioneRentri.findUnique({ where: { movimentoId } })
  const audit = (tenantId: string, action: string) =>
    owner.activityLog.findMany({ where: { tenantId, action } })

  let accoda: AccodaTrasmissioneRentriUseCase
  let repo: TrasmissioniRegistroRepository
  let finto: RentriFinto
  let verifica: VerificaTrasmissioneRentriUseCase
  let impostazioni: ImpostazioniRentriRegistroService

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Utente azioni RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    utenteId = (
      await owner.user.create({
        data: {
          tenantId: t.id,
          keycloakId: `keycloak-azioni-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `azioni-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    repo = new TrasmissioniRegistroRepository(app, logger)
    accoda = new AccodaTrasmissioneRentriUseCase(app, logger)
    finto = new RentriFinto()
    verifica = new VerificaTrasmissioneRentriUseCase(
      app,
      repo,
      new LettoreAnnotazioniRentri(logger),
      finto as any,
      logger,
      (a: AnnotazionePerRentri) => ({
        ok: true as const,
        corpo:
          a.tipoAnnotazione === 'ANNULLAMENTO'
            ? { numero_registrazione: { ...a.numero } }
            : {
                riferimenti: { numero_registrazione: { ...a.numero }, causale_operazione: 'DT' },
                rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'kg' } },
              },
      })
    )
    impostazioni = new ImpostazioniRentriRegistroService(app, finto as any, logger)
  })

  beforeEach(() => {
    finto.chiamateDettaglio = 0
    finto.chiamateEsito = 0
    finto.chiamateConta = 0
    finto.dettaglio = null
    finto.esito = null
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  describe('accoda', () => {
    it('movimenti senza riga: DA_TRASMETTERE MANUALE, con audit', async () => {
      const a = await azienda()
      const m1 = await movimento(a)
      const m2 = await movimento(a)
      const r = await accoda.accoda(a.tenantId, utenteId, a.registroId, [m1.id, m2.id])
      expect(r).toMatchObject({ accodate: 2, riaccodate: 0, saltate: 0 })
      for (const m of [m1, m2]) {
        expect(await rigaDi(m.id)).toMatchObject({
          stato: 'DA_TRASMETTERE',
          origine: 'MANUALE',
          bloccatoInvio: false,
          accodatoDa: utenteId,
        })
      }
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_ACCODATI')
      expect(log).toHaveLength(1)
      expect(JSON.stringify(log[0].metadata)).toContain(m1.id)
    })

    it('RIFIUTATA e NON_TRASMISSIBILE tornano DA_TRASMETTERE', async () => {
      const a = await azienda()
      const rif = await movimento(a)
      const non = await movimento(a)
      await riga(a, rif, { stato: 'RIFIUTATA', ultimoErrore: 'x' })
      await riga(a, non, { stato: 'NON_TRASMISSIBILE', ultimoErrore: 'y' })
      const r = await accoda.accoda(a.tenantId, utenteId, a.registroId, [rif.id, non.id])
      expect(r).toMatchObject({ accodate: 0, riaccodate: 2, saltate: 0 })
      expect((await rigaDi(rif.id))?.stato).toBe('DA_TRASMETTERE')
      expect((await rigaDi(non.id))?.stato).toBe('DA_TRASMETTERE')
      expect((await rigaDi(rif.id))?.bloccatoInvio).toBe(false)
    })

    it('TRASMESSA, GIA_SU_RENTRI, INCERTA, IN_INVIO, ATTESA_ESITO saltate e contate: righe intatte', async () => {
      const a = await azienda()
      const stati: StatoTrasmissioneRentri[] = [
        'TRASMESSA',
        'GIA_SU_RENTRI',
        'INCERTA',
        'IN_INVIO',
        'ATTESA_ESITO',
      ]
      const ids: string[] = []
      for (const stato of stati) {
        const m = await movimento(a)
        ids.push(m.id)
        await riga(a, m, {
          stato,
          ...(stato === 'ATTESA_ESITO' ? { transazioneId: randomUUID() } : {}),
        })
      }
      const r = await accoda.accoda(a.tenantId, utenteId, a.registroId, ids)
      expect(r).toMatchObject({ accodate: 0, riaccodate: 0, saltate: 5 })
      expect(r.saltatePerStato).toMatchObject({
        TRASMESSA: 1,
        GIA_SU_RENTRI: 1,
        INCERTA: 1,
        IN_INVIO: 1,
        ATTESA_ESITO: 1,
      })
      for (let i = 0; i < stati.length; i++) expect((await rigaDi(ids[i]))?.stato).toBe(stati[i])
    })

    it("movimento di un altro registro o di un'altra azienda: 404 e nessuna riga", async () => {
      const a = await azienda()
      const b = await azienda()
      const r2 = await secondoRegistro(a)
      const mAltroRegistro = await movimento({ tenantId: a.tenantId, registroId: r2.id })
      const mAltraAzienda = await movimento(b)
      const mio = await movimento(a)
      await expect(
        accoda.accoda(a.tenantId, utenteId, a.registroId, [mio.id, mAltroRegistro.id])
      ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
      await expect(
        accoda.accoda(a.tenantId, utenteId, a.registroId, [mAltraAzienda.id])
      ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
      expect(await rigaDi(mio.id)).toBeNull()
      expect(await rigaDi(mAltraAzienda.id)).toBeNull()
    })

    it("accoda i predecessori non trasmessi della correzione, non quelli gia' trasmessi", async () => {
      const a = await azienda()
      const orig = await movimento(a)
      const rett1 = await movimento(a, {
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: orig.id,
        movimentoOriginaleId: orig.id,
        motivoAnnotazione: 'x',
      })
      const rett2 = await movimento(a, {
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: rett1.id,
        movimentoOriginaleId: orig.id,
        motivoAnnotazione: 'x',
      })
      await riga(a, orig, { stato: 'RIFIUTATA' })
      const r = await accoda.accoda(a.tenantId, utenteId, a.registroId, [rett2.id])
      expect(r.predecessori).toBe(2)
      expect((await rigaDi(orig.id))?.stato).toBe('DA_TRASMETTERE')
      expect(await rigaDi(rett1.id)).toMatchObject({ stato: 'DA_TRASMETTERE', origine: 'MANUALE' })
      expect(await rigaDi(rett2.id)).toMatchObject({ stato: 'DA_TRASMETTERE' })

      const b = await azienda()
      const o2 = await movimento(b)
      const c2 = await movimento(b, {
        tipoAnnotazione: 'RETTIFICA',
        movimentoRettificatoId: o2.id,
        movimentoOriginaleId: o2.id,
        motivoAnnotazione: 'x',
      })
      await riga(b, o2, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(1) })
      await accoda.accoda(b.tenantId, utenteId, b.registroId, [c2.id])
      expect((await rigaDi(o2.id))?.stato).toBe('TRASMESSA')
    })

    it("piu' di 1000 id o nessuno: 400", async () => {
      const a = await azienda()
      await expect(accoda.accoda(a.tenantId, utenteId, a.registroId, [])).rejects.toBeInstanceOf(
        RichiestaTrasmissioneNonValidaError
      )
    })
  })

  describe('accodaStorico', () => {
    it('senza conferma: 400 e nessuna riga', async () => {
      const a = await azienda()
      const m = await movimento(a)
      await expect(
        accoda.accodaStorico(a.tenantId, utenteId, a.registroId, 2026, false)
      ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      expect(await rigaDi(m.id)).toBeNull()
    })

    it("solo l'anno indicato, solo movimenti senza riga", async () => {
      const a = await azienda()
      const nuovo = await movimento(a)
      const altroAnno = await movimento(a, { progressiveYear: 2025 })
      const rifiutato = await movimento(a)
      await riga(a, rifiutato, { stato: 'RIFIUTATA' })
      const r = await accoda.accodaStorico(a.tenantId, utenteId, a.registroId, 2026, true)
      expect(r.accodate).toBe(1)
      expect(await rigaDi(nuovo.id)).toMatchObject({ stato: 'DA_TRASMETTERE', origine: 'MANUALE' })
      expect(await rigaDi(altroAnno.id)).toBeNull()
      expect((await rigaDi(rifiutato.id))?.stato).toBe('RIFIUTATA')
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_ACCODATI')).toHaveLength(1)
    })
  })

  describe('togliDallaCoda', () => {
    it('DA_TRASMETTERE cancellata; TRASMESSA: 409 e riga intatta', async () => {
      const a = await azienda()
      const coda = await movimento(a)
      const trasm = await movimento(a)
      await riga(a, coda)
      await riga(a, trasm, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(2) })
      await accoda.togliDallaCoda(a.tenantId, utenteId, coda.id)
      expect(await rigaDi(coda.id)).toBeNull()
      await expect(accoda.togliDallaCoda(a.tenantId, utenteId, trasm.id)).rejects.toBeInstanceOf(
        TrasmissioneNonModificabileError
      )
      expect((await rigaDi(trasm.id))?.stato).toBe('TRASMESSA')
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_TOLTO_DALLA_CODA')).toHaveLength(1)
    })

    it('INCERTA e IN_INVIO non si tolgono; movimento senza riga: 404', async () => {
      const a = await azienda()
      const inc = await movimento(a)
      const senza = await movimento(a)
      await riga(a, inc, { stato: 'INCERTA' })
      await expect(accoda.togliDallaCoda(a.tenantId, utenteId, inc.id)).rejects.toBeInstanceOf(
        TrasmissioneNonModificabileError
      )
      await expect(accoda.togliDallaCoda(a.tenantId, utenteId, senza.id)).rejects.toBeInstanceOf(
        MovimentoNonTrovatoError
      )
    })
  })

  describe('dichiaraGiaSuRentri', () => {
    it("intervallo: righe GIA_SU_RENTRI bloccate col motivo; TRASMESSA gia' presente non toccata", async () => {
      const a = await azienda()
      const senza = await movimento(a, { progressiveNumber: 501 })
      const rif = await movimento(a, { progressiveNumber: 502 })
      const trasm = await movimento(a, { progressiveNumber: 503 })
      const coda = await movimento(a, { progressiveNumber: 504 })
      const fuori = await movimento(a, { progressiveNumber: 600 })
      await riga(a, rif, { stato: 'RIFIUTATA' })
      await riga(a, trasm, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(3) })
      await riga(a, coda)
      const r = await accoda.dichiaraGiaSuRentri(
        a.tenantId,
        utenteId,
        'ADMIN',
        a.registroId,
        2026,
        501,
        504,
        'Trasmesse con il programma precedente'
      )
      expect(r.dichiarate).toBe(2)
      expect(r.saltate).toBe(2)
      for (const m of [senza, rif]) {
        expect(await rigaDi(m.id)).toMatchObject({
          stato: 'GIA_SU_RENTRI',
          origine: 'DICHIARATA',
          bloccatoInvio: true,
          motivoBlocco: 'Trasmesse con il programma precedente',
        })
      }
      expect((await rigaDi(trasm.id))?.stato).toBe('TRASMESSA')
      expect((await rigaDi(coda.id))?.stato).toBe('DA_TRASMETTERE')
      expect(await rigaDi(fuori.id)).toBeNull()
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_DICHIARATI')
      expect(log).toHaveLength(1)
      expect(JSON.stringify(log[0].metadata)).not.toContain('programma precedente')
    })

    it('solo ADMIN; intervallo oltre 10.000 o motivo vuoto: 400', async () => {
      const a = await azienda()
      await expect(
        accoda.dichiaraGiaSuRentri(a.tenantId, utenteId, 'OPERATOR', a.registroId, 2026, 1, 5, 'x')
      ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
      await expect(
        accoda.dichiaraGiaSuRentri(a.tenantId, utenteId, 'ADMIN', a.registroId, 2026, 1, 10001, 'x')
      ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
      await expect(
        accoda.dichiaraGiaSuRentri(a.tenantId, utenteId, 'ADMIN', a.registroId, 2026, 1, 5, '  ')
      ).rejects.toBeInstanceOf(RichiestaTrasmissioneNonValidaError)
    })
  })

  describe('verifica D11', () => {
    const uguale = (anno: number, progressivo: number, identificativo = ID_MOV(progressivo)) => ({
      riferimenti: {
        numero_registrazione: { anno, progressivo, identificativo },
        causale_operazione: 'DT',
      },
      rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'kg' } },
      annullato: false,
      rettificato: false,
    })

    async function incerta(a: { tenantId: string; registroId: string }, dati = {}) {
      const m = await movimento(a)
      await riga(a, m, { stato: 'INCERTA', ...dati })
      return m
    }

    it('INCERTA trovata e uguale su RENTRI: TRASMESSA con identificativo e audit', async () => {
      const a = await azienda()
      const m = await incerta(a)
      finto.dettaglio = (anno, prog) => uguale(anno, prog, ID_MOV(77))
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('TRASMESSA')
      expect(await rigaDi(m.id)).toMatchObject({
        stato: 'TRASMESSA',
        identificativoRentri: ID_MOV(77),
        bloccatoInvio: true,
      })
      const log = await audit(a.tenantId, 'RENTRI_REGISTRO_VERIFICATA')
      expect(log).toHaveLength(1)
    })

    it('trovata diversa: resta INCERTA col motivo, mai sovrascritta', async () => {
      const a = await azienda()
      const m = await incerta(a)
      finto.dettaglio = (anno, prog) => ({
        ...uguale(anno, prog),
        rifiuto: { codice_eer: '200101', quantita: { valore: 5, unita_misura: 'kg' } },
      })
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('DIVERSA')
      const dopo = await rigaDi(m.id)
      expect(dopo?.stato).toBe('INCERTA')
      expect(dopo?.bloccatoInvio).toBe(true)
      expect(dopo?.motivoBlocco).toContain("occupato su RENTRI da un'altra registrazione")
    })

    it('404: torna DA_TRASMETTERE e sbloccata, con audit', async () => {
      const a = await azienda()
      const m = await incerta(a)
      finto.dettaglio = () => non404()
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('DA_TRASMETTERE')
      expect(await rigaDi(m.id)).toMatchObject({ stato: 'DA_TRASMETTERE', bloccatoInvio: false })
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_VERIFICATA')).toHaveLength(1)
    })

    it('errore tecnico (5xx, timeout, sconosciuto): resta INCERTA, mai DA_TRASMETTERE', async () => {
      const a = await azienda()
      const m = await incerta(a)
      for (const errore of [
        new RentriApiError(503, 'Servizio non disponibile', undefined, true),
        new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA'),
        new Error('boom'),
        new RentriApiError(403, 'Vietato', undefined, false),
      ]) {
        finto.dettaglio = () => errore
        const r = await verifica.verifica(a.tenantId, utenteId, m.id)
        expect(r.esito).toBe('NON_VERIFICABILE')
        expect((await rigaDi(m.id))?.stato).toBe('INCERTA')
      }
    })

    it('su una TRASMESSA con identificativo: 409 e nessuna chiamata a RENTRI', async () => {
      const a = await azienda()
      const m = await movimento(a)
      await riga(a, m, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(5) })
      for (const stato of ['DA_TRASMETTERE', 'RIFIUTATA', 'GIA_SU_RENTRI', 'IN_INVIO'] as const) {
        const x = await movimento(a)
        await riga(a, x, { stato })
        await expect(verifica.verifica(a.tenantId, utenteId, x.id)).rejects.toBeInstanceOf(
          TrasmissioneNonModificabileError
        )
      }
      await expect(verifica.verifica(a.tenantId, utenteId, m.id)).rejects.toBeInstanceOf(
        TrasmissioneNonModificabileError
      )
      expect(finto.chiamateDettaglio).toBe(0)
      expect(finto.chiamateEsito).toBe(0)
    })

    it("movimento di un'altra azienda: 404", async () => {
      const a = await azienda()
      const b = await azienda()
      const m = await incerta(b)
      await expect(verifica.verifica(a.tenantId, utenteId, m.id)).rejects.toBeInstanceOf(
        MovimentoNonTrovatoError
      )
    })

    it("con transazione: rilegge prima l'esito; confermata -> TRASMESSA su tutte le righe incerte", async () => {
      const a = await azienda()
      const transazioneId = randomUUID()
      const m1 = await incerta(a, { transazioneId })
      const m2 = await incerta(a, { transazioneId })
      const num = (m: { progressiveNumber: number }) => ({
        anno: 2026,
        progressivo: m.progressiveNumber,
        identificativo: ID_MOV(m.progressiveNumber),
      })
      finto.esito = () => ({
        errore: false,
        validazione: [],
        numeroRegistrazioni: [num(m1), num(m2)],
      })
      const r = await verifica.verifica(a.tenantId, utenteId, m1.id)
      expect(r.esito).toBe('TRASMESSA')
      expect(finto.chiamateDettaglio).toBe(0)
      expect(await rigaDi(m1.id)).toMatchObject({
        stato: 'TRASMESSA',
        identificativoRentri: ID_MOV(m1.progressiveNumber),
      })
      expect((await rigaDi(m2.id))?.stato).toBe('TRASMESSA')
    })

    it('con transazione: esito definitivo non confermato -> RIFIUTATA (riaccodabile), mai DA_TRASMETTERE da sola', async () => {
      const a = await azienda()
      const transazioneId = randomUUID()
      const m = await incerta(a, { transazioneId })
      finto.esito = () => ({ errore: true, validazione: [], numeroRegistrazioni: [] })
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('RIFIUTATA')
      expect(await rigaDi(m.id)).toMatchObject({ stato: 'RIFIUTATA', bloccatoInvio: false })
    })

    it("con transazione: errore tecnico nella lettura -> resta com'e', nessuna ricerca per numero", async () => {
      const a = await azienda()
      const transazioneId = randomUUID()
      const m = await incerta(a, { transazioneId })
      finto.esito = () => new RentriApiError(503, 'x', undefined, true)
      finto.dettaglio = () => non404()
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('NON_VERIFICABILE')
      expect((await rigaDi(m.id))?.stato).toBe('INCERTA')
      expect(finto.chiamateDettaglio).toBe(0)
    })

    it('con transazione sconosciuta a RENTRI: cerca per numero; 404 -> DA_TRASMETTERE', async () => {
      const a = await azienda()
      const transazioneId = randomUUID()
      const m = await incerta(a, { transazioneId })
      finto.esito = () => new TransazioneRentriNonTrovataError(transazioneId)
      finto.dettaglio = () => non404()
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('DA_TRASMETTERE')
      expect((await rigaDi(m.id))?.stato).toBe('DA_TRASMETTERE')
      expect(finto.chiamateDettaglio).toBe(1)
    })

    it('ATTESA_ESITO senza esito leggibile e numero assente: DA_TRASMETTERE solo col 404 definitivo', async () => {
      const a = await azienda()
      const transazioneId = randomUUID()
      const m = await movimento(a)
      await riga(a, m, { stato: 'ATTESA_ESITO', transazioneId })
      finto.esito = () => new TransazioneRentriNonTrovataError(transazioneId)
      finto.dettaglio = () => new RentriApiError(503, 'x', undefined, true)
      expect((await verifica.verifica(a.tenantId, utenteId, m.id)).esito).toBe('NON_VERIFICABILE')
      expect((await rigaDi(m.id))?.stato).toBe('ATTESA_ESITO')
    })

    it('TRASMESSA con identificativo nullo: lo recupera dal numero, senza cambiare stato', async () => {
      const a = await azienda()
      const m = await movimento(a)
      await riga(a, m, { stato: 'TRASMESSA', identificativoRentri: null })
      finto.dettaglio = (anno, prog) => uguale(anno, prog, ID_MOV(88))
      const r = await verifica.verifica(a.tenantId, utenteId, m.id)
      expect(r.esito).toBe('IDENTIFICATIVO_RECUPERATO')
      expect(await rigaDi(m.id)).toMatchObject({
        stato: 'TRASMESSA',
        identificativoRentri: ID_MOV(88),
      })
      // 404 su una TRASMESSA non la sposta mai
      const x = await movimento(a)
      await riga(a, x, { stato: 'TRASMESSA', identificativoRentri: null })
      finto.dettaglio = () => non404()
      expect((await verifica.verifica(a.tenantId, utenteId, x.id)).esito).toBe('NON_VERIFICABILE')
      expect((await rigaDi(x.id))?.stato).toBe('TRASMESSA')
    })
  })

  describe('impostazioni', () => {
    it('formato errato: 400', async () => {
      const a = await azienda({ identificativo: null })
      for (const brutto of ['abc', 'R123', 'X0123456789', 'RABCDE1234!']) {
        await expect(
          impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
            identificativoRentri: brutto,
          })
        ).rejects.toBeInstanceOf(IdentificativoRegistroNonValidoError)
      }
    })

    it('solo ADMIN', async () => {
      const a = await azienda({ identificativo: null })
      for (const ruolo of ['OPERATOR', 'VIEWER']) {
        await expect(
          impostazioni.imposta(a.tenantId, utenteId, ruolo, a.registroId, {
            identificativoRentri: 'RABCDE12345',
          })
        ).rejects.toBeInstanceOf(RuoloNonAutorizzatoRentriError)
      }
    })

    it('cambio con righe TRASMESSA: 409; con sole RIFIUTATA: consentito', async () => {
      const a = await azienda()
      const m = await movimento(a)
      await riga(a, m, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(9) })
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
          identificativoRentri: 'RZZZZZ99999',
        })
      ).rejects.toBeInstanceOf(TrasmissioneNonModificabileError)
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
          identificativoRentri: null,
        })
      ).rejects.toBeInstanceOf(TrasmissioneNonModificabileError)

      const b = await azienda()
      const r = await movimento(b)
      await riga(b, r, { stato: 'RIFIUTATA' })
      const v = await impostazioni.imposta(b.tenantId, utenteId, 'ADMIN', b.registroId, {
        identificativoRentri: 'RZZZZZ99999',
      })
      expect(v.identificativoRentri).toBe('RZZZZZ99999')
    })

    it("stesso identificativo con righe trasmesse: nessun errore (non e' un cambio)", async () => {
      const a = await azienda()
      const m = await movimento(a)
      await riga(a, m, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(10) })
      const v = await impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        identificativoRentri: 'RABCDE12345',
      })
      expect(v.identificativoRentri).toBe('RABCDE12345')
    })

    it("identificativo gia' usato da un altro registro dell'azienda: 409", async () => {
      const a = await azienda()
      const r2 = await secondoRegistro(a)
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', r2.id, {
          identificativoRentri: 'RABCDE12345',
        })
      ).rejects.toBeInstanceOf(IdentificativoGiaUsatoError)
    })

    it("attivare l'automatico imposta la data a ora, riattivarlo non la sposta; spegnerlo la azzera", async () => {
      const a = await azienda()
      const prima = Date.now()
      const v1 = await impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        invioAutomatico: true,
      })
      expect(v1.invioAutomatico).toBe(true)
      const dal1 = v1.invioAutomaticoDal as Date
      expect(dal1.getTime()).toBeGreaterThanOrEqual(prima - 1000)
      expect(dal1.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
      await new Promise(r => setTimeout(r, 30))
      const v2 = await impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        invioAutomatico: true,
      })
      expect(v2.invioAutomaticoDal).toEqual(dal1)
      const v3 = await impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
        invioAutomatico: false,
      })
      expect(v3).toMatchObject({ invioAutomatico: false, invioAutomaticoDal: null })
      expect(await audit(a.tenantId, 'RENTRI_REGISTRO_IMPOSTAZIONI')).toHaveLength(3)
    })

    it("automatico senza identificativo: 400; togliere l'identificativo spegne l'automatico", async () => {
      const a = await azienda({ identificativo: null })
      await expect(
        impostazioni.imposta(a.tenantId, utenteId, 'ADMIN', a.registroId, {
          invioAutomatico: true,
        })
      ).rejects.toBeInstanceOf(IdentificativoRegistroNonValidoError)
      const b = await azienda()
      await impostazioni.imposta(b.tenantId, utenteId, 'ADMIN', b.registroId, {
        invioAutomatico: true,
      })
      const v = await impostazioni.imposta(b.tenantId, utenteId, 'ADMIN', b.registroId, {
        identificativoRentri: null,
      })
      expect(v).toMatchObject({ identificativoRentri: null, invioAutomatico: false })
    })

    it('leggi: conteggi per stato, non trasmessi e certificato', async () => {
      const a = await azienda()
      const m1 = await movimento(a)
      const m2 = await movimento(a)
      await movimento(a)
      await riga(a, m1, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(11) })
      await riga(a, m2)
      const lista = await impostazioni.leggi(a.tenantId)
      expect(lista).toHaveLength(1)
      expect(lista[0]).toMatchObject({
        registroId: a.registroId,
        identificativoRentri: 'RABCDE12345',
        invioAutomatico: false,
        nonTrasmessi: 1,
        haCertificato: false,
      })
      expect(lista[0].perStato).toMatchObject({ TRASMESSA: 1, DA_TRASMETTERE: 1 })
    })

    it('allineamento: locali, trasmessi e conteggio su RENTRI', async () => {
      const a = await azienda()
      const m1 = await movimento(a)
      const m2 = await movimento(a)
      await movimento(a, { progressiveYear: 2025 })
      await riga(a, m1, { stato: 'TRASMESSA', identificativoRentri: ID_MOV(12) })
      await riga(a, m2, { stato: 'GIA_SU_RENTRI' })
      finto.conta = 7
      const r = await impostazioni.allineamento(a.tenantId, a.registroId, 2026)
      expect(r).toEqual({ locali: 2, trasmessi: 2, suRentri: 7 })
      expect(finto.chiamateConta).toBe(1)
    })

    it('allineamento: errore tecnico di RENTRI -> suRentri null; senza identificativo -> 400', async () => {
      const a = await azienda()
      finto.contaMovimenti = async () => {
        throw new RentriApiError(503, 'x', undefined, true)
      }
      expect((await impostazioni.allineamento(a.tenantId, a.registroId, 2026)).suRentri).toBeNull()
      const b = await azienda({ identificativo: null })
      await expect(
        impostazioni.allineamento(b.tenantId, b.registroId, 2026)
      ).rejects.toBeInstanceOf(IdentificativoRegistroNonValidoError)
    })
  })
})
