/**
 * Elaborazioni di fatturazione (fase 4.4b1, Task 18): avvio, concorrenza, ricalcolo, scarto,
 * esclusione e dettaglio contro un Postgres reale, collegato COME `wasteflow_app` (RLS FORCE)
 * dentro il `TenantContext`. Il proprietario prepara gli scenari; la pulizia e' solo per id esatti
 * (`pulisciTenantDiTest`). La coda e' finta (`add` registrato): il job lo esegue il test chiamando
 * `eseguiAnteprima`, come farebbe il worker.
 */
import { HttpException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t18-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaAziendaT18,
  creaContrattoT18,
  creaLegameConfermatoT18,
  inserisciElaborazioneT18,
  type AziendaT18,
} from '../../test-support/fatturazione-t18-di-test'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { ElaborazioneAttivaError, eseguiAnteprima } from './anteprima'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { ElaborazioniService } from './elaborazioni.service'
import type { ParametriElaborazione } from './selezione-fatturazione'

const P: ParametriElaborazione = {
  periodoDal: '2026-03-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}
const ADESSO = '2026-04-10T10:00:00.000Z'

interface Esito {
  status: number
  codice?: string
}
const esito = async (p: Promise<unknown>): Promise<Esito | 'ok'> => {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof HttpException) {
      return { status: e.getStatus(), codice: (e.getResponse() as { error?: string }).error }
    }
    throw e
  }
}

describe('ElaborazioniService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ElaborazioniService
  let coda: { add: jest.Mock }
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
  })
  beforeEach(() => {
    coda = { add: jest.fn().mockResolvedValue(undefined) }
    servizio = new ElaborazioniService(app, new DocumentiFatturaService(app), coda as never)
    servizio.orologio = () => new Date(ADESSO)
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const azienda = (o: { cedente?: boolean; predefinito?: boolean } = {}) =>
    creaAziendaT18(owner, tenantCreati, o)

  /** Azienda con un contratto e un legame confermato nel periodo di `P`. */
  async function aziendaConLegame() {
    const az = await azienda()
    const c = await creaContrattoT18(owner, az)
    await creaLegameConfermatoT18(owner, az, c)
    return { az, c }
  }

  const avvia = (az: AziendaT18, p: Partial<ParametriElaborazione> = {}) =>
    nel(az.tenantId, () => servizio.avvia(az.tenantId, az.utenteId, { ...P, ...p }))
  const esegui = (az: AziendaT18, id: string, versione?: number) =>
    nel(az.tenantId, () => eseguiAnteprima(app, az.tenantId, id, versione))
  const leggi = async (id: string) =>
    (
      await owner.$queryRawUnsafe<
        {
          stato: string
          versione: number
          job_id: string | null
          esito: unknown
          errore_tecnico: string | null
          impronta: string | null
        }[]
      >(
        `SELECT stato::text, versione, job_id, esito, errore_tecnico, impronta
         FROM elaborazioni_fatturazione WHERE id = $1::uuid`,
        id
      )
    )[0]
  const statoDi = async (id: string) => (await leggi(id)).stato
  const bozze = (id: string) =>
    owner.$queryRawUnsafe<{ id: string; escluso: boolean; stato: string }[]>(
      `SELECT id::text, escluso_da_definitiva AS escluso, stato::text FROM documenti_fattura
       WHERE elaborazione_id = $1::uuid ORDER BY id`,
      id
    )

  describe('avvia', () => {
    it('avvio valido: IN_CODA, job accodato con tenant, elaborazione e jobId «anteprima-<id>-v1» salvato in job_id', async () => {
      const { az } = await aziendaConLegame()
      const { id } = await avvia(az)
      const r = await leggi(id)
      expect(r).toMatchObject({ stato: 'IN_CODA', versione: 1, job_id: `anteprima-${id}-v1` })
      expect(coda.add).toHaveBeenCalledTimes(1)
      const [nome, dati, opzioni] = coda.add.mock.calls[0]
      expect(nome).toBe('anteprima')
      expect(dati).toEqual({
        tenantId: az.tenantId,
        elaborazioneId: id,
        tipo: 'anteprima',
        versione: 1,
      })
      expect(opzioni).toMatchObject({ jobId: `anteprima-${id}-v1`, attempts: 2 })
      expect(opzioni.jobId).not.toContain(':')
    })

    it('se la coda non risponde l’elaborazione non resta IN_CODA: FALLITA e 503', async () => {
      const { az } = await aziendaConLegame()
      coda.add.mockRejectedValue(new Error('redis giu'))
      expect(await esito(avvia(az))).toEqual({ status: 503, codice: 'CODA_NON_DISPONIBILE' })
      const [{ id }] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM elaborazioni_fatturazione WHERE tenant_id = $1::uuid`,
        az.tenantId
      )
      expect(await leggi(id)).toMatchObject({
        stato: 'FALLITA',
        errore_tecnico: "Impossibile accodare l'elaborazione",
      })
    })

    it('cedente incompleto: 400 CEDENTE_INCOMPLETO', async () => {
      const az = await azienda({ cedente: false })
      expect(await esito(avvia(az))).toEqual({ status: 400, codice: 'CEDENTE_INCOMPLETO' })
    })

    it('dataDocumento di oggi alle 00:30 italiane (23:30 UTC di ieri): accettata; domani: DATA_FUTURA', async () => {
      const { az } = await aziendaConLegame()
      // Gennaio: Roma e' UTC+1. 23:30 UTC del 14 sono le 00:30 del 15.
      servizio.orologio = () => new Date('2026-01-14T23:30:00.000Z')
      const gennaio = { periodoDal: '2026-01-02', periodoAl: '2026-01-10' }
      expect(await esito(avvia(az, { ...gennaio, dataDocumento: '2026-01-15' }))).toBe('ok')
      // L'avvio precedente e' IN_CODA: per provare il rifiuto del domani serve un tenant libero.
      const altra = await azienda()
      expect(await esito(avvia(altra, { ...gennaio, dataDocumento: '2026-01-16' }))).toEqual({
        status: 400,
        codice: 'DATA_FUTURA',
      })
    })

    it.each(['IN_CODA', 'IN_CORSO', 'IN_DEFINITIVA'])(
      'una seconda elaborazione mentre una e’ %s: 409 ELABORAZIONE_IN_CORSO',
      async stato => {
        const az = await azienda()
        await inserisciElaborazioneT18(owner, az.tenantId, stato)
        expect(await esito(avvia(az))).toEqual({ status: 409, codice: 'ELABORAZIONE_IN_CORSO' })
        expect(coda.add).not.toHaveBeenCalled()
      }
    )

    it.each(['ANTEPRIMA_PRONTA', 'FALLITA', 'SCARTATA', 'DEFINITIVA'])(
      'una elaborazione %s non impedisce un nuovo avvio',
      async stato => {
        const az = await azienda()
        await inserisciElaborazioneT18(owner, az.tenantId, stato)
        expect(await esito(avvia(az))).toBe('ok')
      }
    )

    it('un altro tenant non vede e non blocca', async () => {
      const a = await azienda()
      const b = await azienda()
      await inserisciElaborazioneT18(owner, a.tenantId, 'IN_CORSO')
      expect(await esito(avvia(b))).toBe('ok')
    })

    it('due avvii in parallelo: nessun 500; alla fine ogni elaborazione accettata e’ pronta, una alla volta', async () => {
      const { az } = await aziendaConLegame()
      const avvii = await Promise.allSettled([avvia(az), avvia(az)])
      const ids: string[] = []
      for (const a of avvii) {
        if (a.status === 'fulfilled') ids.push(a.value.id)
        else {
          expect(a.reason).toBeInstanceOf(HttpException)
          expect((a.reason as HttpException).getStatus()).toBe(409)
        }
      }
      expect(ids.length).toBeGreaterThanOrEqual(1)

      // Si eseguono i due job insieme: l'indice unico ne lascia passare uno, l'altro viene
      // rinviato (ElaborazioneAttivaError) e si riprova quando il primo e' pronto.
      const giro1 = await Promise.allSettled(ids.map(id => esegui(az, id)))
      for (const g of giro1) {
        if (g.status === 'rejected') expect(g.reason).toBeInstanceOf(ElaborazioneAttivaError)
      }
      const inCorso = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM elaborazioni_fatturazione
         WHERE tenant_id = $1::uuid AND stato = 'IN_CORSO'`,
        az.tenantId
      )
      expect(inCorso[0].n).toBe(0)
      for (const id of ids) {
        if ((await statoDi(id)) === 'IN_CODA') await esegui(az, id)
        expect(await statoDi(id)).toBe('ANTEPRIMA_PRONTA')
      }
    })

    it('un job mentre un’altra elaborazione e’ IN_CORSO (23505): ElaborazioneAttivaError, resta IN_CODA; poi arriva a pronta', async () => {
      const { az } = await aziendaConLegame()
      const corso = await inserisciElaborazioneT18(owner, az.tenantId, 'IN_CORSO')
      const attesa = await inserisciElaborazioneT18(owner, az.tenantId, 'IN_CODA')
      await expect(esegui(az, attesa)).rejects.toBeInstanceOf(ElaborazioneAttivaError)
      expect(await statoDi(attesa)).toBe('IN_CODA')
      await owner.$executeRawUnsafe(
        `UPDATE elaborazioni_fatturazione SET stato = 'ANTEPRIMA_PRONTA' WHERE id = $1::uuid`,
        corso
      )
      await esegui(az, attesa)
      expect(await statoDi(attesa)).toBe('ANTEPRIMA_PRONTA')
    })

    it('primo tentativo fallito dopo il passaggio a IN_CORSO gia’ confermato: il secondo accetta il proprio IN_CORSO e arriva a pronta (Q30)', async () => {
      const { az } = await aziendaConLegame()
      const { id } = await avvia(az)
      // Il primo `$transaction` e' il passaggio a IN_CORSO, il secondo la selezione: guasto qui.
      let chiamate = 0
      const guasto = new Proxy(app, {
        get(t, p, r) {
          if (p === '$transaction') {
            return (...a: unknown[]) =>
              chiamate++ === 1
                ? Promise.reject(new Error('guasto iniettato'))
                : (t.$transaction as (...x: unknown[]) => unknown)(...a)
          }
          return Reflect.get(t, p, r)
        },
      })
      await expect(
        nel(az.tenantId, () => eseguiAnteprima(guasto, az.tenantId, id, 1))
      ).rejects.toThrow('guasto iniettato')
      expect(await statoDi(id)).toBe('IN_CORSO')
      await esegui(az, id, 1)
      expect(await statoDi(id)).toBe('ANTEPRIMA_PRONTA')
    })

    it('un job con una versione vecchia esce senza scrivere', async () => {
      const { az } = await aziendaConLegame()
      const { id } = await avvia(az)
      await esegui(az, id, 7)
      expect(await statoDi(id)).toBe('IN_CODA')
      expect(await bozze(id)).toHaveLength(0)
    })

    it('job di un tenant che non e’ il proprietario: non vede l’elaborazione (RLS), nulla scritto altrove', async () => {
      const { az } = await aziendaConLegame()
      const altra = await azienda()
      const { id } = await avvia(az)
      await expect(esegui(altra, id, 1)).rejects.toThrow('Elaborazione non trovata')
      expect(await statoDi(id)).toBe('IN_CODA')
    })
  })

  describe('ricalcola, scarta, escludi', () => {
    async function pronta() {
      const { az, c } = await aziendaConLegame()
      const { id } = await avvia(az)
      await esegui(az, id, 1)
      return { az, c, id }
    }

    it('ricalcola: le bozze precedenti spariscono, nessun duplicato; nuovo job «anteprima-<id>-v2» eseguito (Q5)', async () => {
      const { az, id } = await pronta()
      const prima = await bozze(id)
      expect(prima).toHaveLength(1)
      await nel(az.tenantId, () => servizio.ricalcola(az.tenantId, az.utenteId, id, 1))
      expect(await leggi(id)).toMatchObject({
        stato: 'IN_CODA',
        versione: 2,
        job_id: `anteprima-${id}-v2`,
      })
      expect(coda.add).toHaveBeenLastCalledWith(
        'anteprima',
        { tenantId: az.tenantId, elaborazioneId: id, tipo: 'anteprima', versione: 2 },
        expect.objectContaining({ jobId: `anteprima-${id}-v2` })
      )
      await esegui(az, id, 2)
      const dopo = await bozze(id)
      expect(dopo).toHaveLength(1)
      expect(dopo[0].id).not.toBe(prima[0].id)
      expect(await statoDi(id)).toBe('ANTEPRIMA_PRONTA')
    })

    it('dopo ANTEPRIMA_SUPERATA (esito scritto col proprietario) e ricalcola: errore null (Q17)', async () => {
      const { az, id } = await pronta()
      await owner.$executeRawUnsafe(
        `UPDATE elaborazioni_fatturazione SET esito = $2::jsonb WHERE id = $1::uuid`,
        id,
        JSON.stringify({
          codice: 'ANTEPRIMA_SUPERATA',
          differenze: { nuovi: 1, cambiati: 2, fatturatiDaAltri: 0 },
        })
      )
      const prima = await nel(az.tenantId, () => servizio.dettaglio(az.tenantId, id))
      expect(prima.errore).toEqual({
        codice: 'ANTEPRIMA_SUPERATA',
        differenze: { nuovi: 1, cambiati: 2, fatturatiDaAltri: 0 },
      })
      await nel(az.tenantId, () => servizio.ricalcola(az.tenantId, az.utenteId, id, 1))
      await esegui(az, id, 2)
      const dopo = await nel(az.tenantId, () => servizio.dettaglio(az.tenantId, id))
      expect(dopo.errore).toBeNull()
      expect((await leggi(id)).esito).toBeNull()
    })

    it('ricalcola con la versione sbagliata: 409 VERSIONE_SUPERATA', async () => {
      const { az, id } = await pronta()
      expect(
        await esito(nel(az.tenantId, () => servizio.ricalcola(az.tenantId, az.utenteId, id, 5)))
      ).toEqual({ status: 409, codice: 'VERSIONE_SUPERATA' })
    })

    it('ricalcola con un’altra elaborazione attiva del tenant: 409 ELABORAZIONE_IN_CORSO sincrono, nulla accodato', async () => {
      const { az, id } = await pronta()
      coda.add.mockClear()
      await inserisciElaborazioneT18(owner, az.tenantId, 'IN_CODA')
      expect(
        await esito(nel(az.tenantId, () => servizio.ricalcola(az.tenantId, az.utenteId, id, 1)))
      ).toEqual({ status: 409, codice: 'ELABORAZIONE_IN_CORSO' })
      expect(coda.add).not.toHaveBeenCalled()
      expect(await statoDi(id)).toBe('ANTEPRIMA_PRONTA')
    })

    it('ricalcola e scarta su IN_DEFINITIVA: 409 ELABORAZIONE_GIA_IN_DEFINITIVA', async () => {
      const { az, id } = await pronta()
      await owner.$executeRawUnsafe(
        `UPDATE elaborazioni_fatturazione SET stato = 'IN_DEFINITIVA' WHERE id = $1::uuid`,
        id
      )
      const atteso = { status: 409, codice: 'ELABORAZIONE_GIA_IN_DEFINITIVA' }
      expect(
        await esito(nel(az.tenantId, () => servizio.ricalcola(az.tenantId, az.utenteId, id, 1)))
      ).toEqual(atteso)
      expect(
        await esito(nel(az.tenantId, () => servizio.scarta(az.tenantId, az.utenteId, id, 1)))
      ).toEqual(atteso)
      expect(await bozze(id)).toHaveLength(1)
    })

    it('scarta: SCARTATA, bozze cancellate, risponde { id }', async () => {
      const { az, id } = await pronta()
      const r = await nel(az.tenantId, () => servizio.scarta(az.tenantId, az.utenteId, id, 1))
      expect(r).toEqual({ id })
      expect(await statoDi(id)).toBe('SCARTATA')
      expect(await bozze(id)).toHaveLength(0)
    })

    it('escludi e riammetti: escluso_da_definitiva; la risposta e’ la riga del documento', async () => {
      const { az, id } = await pronta()
      const [b] = await bozze(id)
      const r = await nel(az.tenantId, () => servizio.escludi(az.tenantId, id, b.id, true))
      expect(r).toMatchObject({ id: b.id, stato: 'BOZZA', esclusoDaDefinitiva: true })
      expect((await bozze(id))[0].escluso).toBe(true)
      const r2 = await nel(az.tenantId, () => servizio.escludi(az.tenantId, id, b.id, false))
      expect(r2.esclusoDaDefinitiva).toBe(false)
      expect((await bozze(id))[0].escluso).toBe(false)
    })

    it('escludi su un DEFINITIVO: 409; su un documento di un’altra elaborazione: 404', async () => {
      const { az, c, id } = await pronta()
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: az.tab.registroId,
        anno: 2025,
        elaborazioneId: id,
      })
      expect(
        await esito(nel(az.tenantId, () => servizio.escludi(az.tenantId, id, documentoId, true)))
      ).toEqual({ status: 409, codice: 'DOCUMENTO_NON_IN_BOZZA' })
      const altraId = await inserisciElaborazioneT18(owner, az.tenantId, 'ANTEPRIMA_PRONTA')
      const [b] = await bozze(id)
      expect(
        await esito(nel(az.tenantId, () => servizio.escludi(az.tenantId, altraId, b.id, true)))
      ).toEqual({ status: 404, codice: 'DOCUMENTO_NON_TROVATO' })
      expect(c.contrattoId).toBeTruthy()
    })

    it('escludi durante IN_DEFINITIVA: 409 ELABORAZIONE_GIA_IN_DEFINITIVA, documento invariato', async () => {
      const { az, id } = await pronta()
      const [b] = await bozze(id)
      await owner.$executeRawUnsafe(
        `UPDATE elaborazioni_fatturazione SET stato = 'IN_DEFINITIVA' WHERE id = $1::uuid`,
        id
      )
      expect(
        await esito(nel(az.tenantId, () => servizio.escludi(az.tenantId, id, b.id, true)))
      ).toEqual({ status: 409, codice: 'ELABORAZIONE_GIA_IN_DEFINITIVA' })
      expect((await bozze(id))[0].escluso).toBe(false)
    })

    it('escludi aspetta il blocco dell’elaborazione: e’ il primo anello dell’ordine dei lock', async () => {
      const { az, id } = await pronta()
      const [b] = await bozze(id)
      let rilascia!: () => void
      const aperta = new Promise<void>(r => (rilascia = r))
      let preso!: () => void
      const bloccato = new Promise<void>(r => (preso = r))
      const tenitore = owner.$transaction(
        async tx => {
          await tx.$queryRawUnsafe(
            `SELECT 1 FROM elaborazioni_fatturazione WHERE id = $1::uuid FOR UPDATE`,
            id
          )
          preso()
          await aperta
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
      await bloccato
      let finita = false
      const richiesta = nel(az.tenantId, () =>
        servizio.escludi(az.tenantId, id, b.id, true)
      ).finally(() => (finita = true))
      // Barriera su pg_stat_activity: la sessione di questo processo e' in attesa di un lock.
      const scadenza = Date.now() + 20_000
      for (;;) {
        const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND application_name = $1
             AND wait_event_type = 'Lock'`,
          NOME_APPLICAZIONE
        )
        if (n >= 1) break
        if (finita || Date.now() > scadenza)
          throw new Error('la richiesta non ha aspettato il lock')
        await new Promise(r => setTimeout(r, 50))
      }
      expect(finita).toBe(false)
      rilascia()
      await tenitore
      await richiesta
      expect((await bozze(id))[0].escluso).toBe(true)
    })
  })

  describe('lista e dettaglio', () => {
    it('lista: solo le elaborazioni del tenant, filtro per stato, dimensione 100 accettata', async () => {
      const a = await azienda()
      const b = await azienda()
      await inserisciElaborazioneT18(owner, a.tenantId, 'SCARTATA')
      await inserisciElaborazioneT18(owner, a.tenantId, 'FALLITA')
      await inserisciElaborazioneT18(owner, b.tenantId, 'FALLITA')
      const tutte = await nel(a.tenantId, () =>
        servizio.lista(a.tenantId, { pagina: 1, dimensione: 100 })
      )
      expect(tutte.totale).toBe(2)
      expect(tutte.elementi.map(e => e.stato).sort()).toEqual(['FALLITA', 'SCARTATA'])
      const fallite = await nel(a.tenantId, () =>
        servizio.lista(a.tenantId, { pagina: 1, dimensione: 100, stato: 'FALLITA' })
      )
      expect(fallite.elementi).toHaveLength(1)
      expect(Object.keys(fallite.elementi[0]).sort()).toEqual(
        [
          'avvisi',
          'createdAt',
          'dataDocumento',
          'documenti',
          'errori',
          'id',
          'periodoAl',
          'periodoDal',
          'stato',
          'totale',
        ].sort()
      )
    })

    it('documenti: le bozze dell’elaborazione, con filtro per errori; un’altra azienda: 404', async () => {
      const { az, c } = await (async () => {
        const x = await aziendaConLegame()
        return x
      })()
      const senzaCond = await creaContrattoT18(owner, az, { senzaCondizione: true })
      await creaLegameConfermatoT18(owner, az, senzaCond)
      const { id } = await avvia(az)
      await esegui(az, id, 1)
      const tutti = await nel(az.tenantId, () =>
        servizio.documenti(az.tenantId, id, { pagina: 1, dimensione: 100 })
      )
      expect(tutti.totale).toBe(2)
      const conErrori = await nel(az.tenantId, () =>
        servizio.documenti(az.tenantId, id, { pagina: 1, dimensione: 100, conErrori: true })
      )
      expect(conErrori.elementi).toHaveLength(1)
      expect(conErrori.elementi[0].errori.map(e => e.codice)).toContain(
        'SENZA_CONDIZIONE_PAGAMENTO'
      )
      expect(conErrori.elementi[0].errori[0].messaggio).not.toBe('')
      const altra = await azienda()
      expect(
        await esito(
          nel(altra.tenantId, () =>
            servizio.documenti(altra.tenantId, id, { pagina: 1, dimensione: 10 })
          )
        )
      ).toEqual({ status: 404, codice: 'ELABORAZIONE_NON_TROVATA' })
      expect(c.contrattoId).toBeTruthy()
    })

    it('dettaglio: definitiveAttive false di default e true dopo l’accensione col proprietario', async () => {
      const az = await azienda()
      const id = await inserisciElaborazioneT18(owner, az.tenantId, 'FALLITA')
      const d = await nel(az.tenantId, () => servizio.dettaglio(az.tenantId, id))
      expect(d.definitiveAttive).toBe(false)
      await owner.$executeRawUnsafe(
        `INSERT INTO impostazioni_fatturazione (tenant_id, definitive_attive, updated_at)
         VALUES ($1::uuid, true, now())
         ON CONFLICT (tenant_id) DO UPDATE SET definitive_attive = true`,
        az.tenantId
      )
      const dopo = await nel(az.tenantId, () => servizio.dettaglio(az.tenantId, id))
      expect(dopo.definitiveAttive).toBe(true)
    })

    it('dettaglio: errore null senza esito; erroreTecnico di una FALLITA; tutte le chiavi del modello', async () => {
      const az = await azienda()
      const id = await inserisciElaborazioneT18(owner, az.tenantId, 'FALLITA')
      await owner.$executeRawUnsafe(
        `UPDATE elaborazioni_fatturazione SET errore_tecnico = 'Errore tecnico di prova' WHERE id = $1::uuid`,
        id
      )
      const d = await nel(az.tenantId, () => servizio.dettaglio(az.tenantId, id))
      expect(d.errore).toBeNull()
      expect(d.erroreTecnico).toBe('Errore tecnico di prova')
      expect(Object.keys(d).sort()).toEqual(
        [
          'avvisi',
          'createdAt',
          'dataDocumento',
          'documenti',
          'errori',
          'id',
          'periodoAl',
          'periodoDal',
          'stato',
          'totale',
          'raggruppamento',
          'includiArretrati',
          'filtri',
          'impronta',
          'versione',
          'definitiveAttive',
          'erroriGenerali',
          'erroriPeriodo',
          'numerazionePrevista',
          'totaliPerRegistro',
          'documentiNonGenerati',
          'errore',
          'erroreTecnico',
        ].sort()
      )
    })

    it('dettaglio di un’altra azienda: 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const id = await inserisciElaborazioneT18(owner, a.tenantId, 'FALLITA')
      expect(await esito(nel(b.tenantId, () => servizio.dettaglio(b.tenantId, id)))).toEqual({
        status: 404,
        codice: 'ELABORAZIONE_NON_TROVATA',
      })
    })
  })
})
