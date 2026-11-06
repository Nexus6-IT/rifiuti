/**
 * Annullo e storno (fase 4.4b1, Task 20): concorrenza contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS FORCE). Le barriere sono vere: l'operazione si ferma DOPO aver preso tutti i
 * suoi lock (numerazione, documento, legami) e il test osserva `pg_stat_activity`
 * (`application_name` di questo processo, `wait_event_type = 'Lock'`), mai uno sleep come
 * sincronizzazione. Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t20c-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import { esitoHttp as esito } from '../../test-support/fatturazione-t19-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'

const FEBBRAIO = { periodoDal: '2026-02-01', periodoAl: '2026-02-28' }

describe('Annullo e storno, concorrenza — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    b.servizio.orologio = () => new Date('2026-05-01T10:00:00Z')
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  /** Azienda con due definitivi (1 e 2) e una seconda elaborazione di febbraio pronta e richiesta. */
  async function scenario() {
    const az = await b.t19.azienda()
    const [d1, d2] = await b.definitivi(az, 2)
    await b.t19.contratto(az, { data: '2026-02-10' })
    const e = await b.t19.pronta(az, FEBBRAIO)
    await b.t19.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
    return { az, d1, d2, e }
  }

  /** Aspetta una sessione in lock, poi esegue `dopo`. */
  const attendi = (finita: () => boolean = () => false) => b.t19.attendiLock(1, finita)

  it('annullo contro definitiva sullo stesso registro (annullo per primo): si serializzano sulla numerazione, il numero annullato viene riusato, nessun doppione, invariante valida', async () => {
    const { az, d2, e } = await scenario()
    const v = await b.versioneDi(d2.id)
    const { esito: esitoAnnullo, risultato } = await b.conOperazioneInPausa(
      () => b.annulla(az, d2.id, { versione: v }),
      async rilascia => {
        let finito = false
        const job = b.t19.eseguiJob(az, e.id).finally(() => (finito = true))
        await attendi(() => finito)
        // La definitiva aspetta sulla numerazione: l'annullo non e ancora finito.
        expect(finito).toBe(false)
        rilascia()
        return job
      }
    )
    expect(esitoAnnullo.status).toBe('fulfilled')
    expect(risultato.esito).toBe('DEFINITIVA')
    expect((await b.t19.documenti(e.id))[0]).toMatchObject({ numero: 2, stato: 'DEFINITIVO' })
    expect((await b.documento(d2.id)).stato).toBe('ANNULLATO')
    expect((await b.t19.numerazioni(az.tenantId))[0].ultimo_numero).toBe(2)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  it('annullo contro definitiva (definitiva per prima): l’annullo aspetta, poi trova il documento non più ultimo: 409 NON_ULTIMO, nessun doppione, invariante valida', async () => {
    const { az, d2, e } = await scenario()
    const v = await b.versioneDi(d2.id)
    const { esito: esitoJob, risultato } = await b.t19.conDefinitivaInPausa(
      az,
      e.id,
      async rilascia => {
        let finito = false
        const p = esito(b.annulla(az, d2.id, { versione: v })).finally(() => (finito = true))
        await attendi(() => finito)
        expect(finito).toBe(false)
        rilascia()
        return p
      }
    )
    expect(esitoJob.esito).toBe('DEFINITIVA')
    expect(risultato).toEqual({
      status: 409,
      codice: 'ANNULLO_NON_AMMESSO',
      details: { motivo: 'NON_ULTIMO' },
    })
    expect((await b.documento(d2.id)).stato).toBe('DEFINITIVO')
    expect((await b.t19.numerazioni(az.tenantId))[0].ultimo_numero).toBe(3)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  it('storno contro definitiva (definitiva per prima): numeri 3 e 4, nessun doppione, invariante valida', async () => {
    const { az, d1, e } = await scenario()
    const v = await b.versioneDi(d1.id)
    const { esito: esitoJob, risultato } = await b.t19.conDefinitivaInPausa(
      az,
      e.id,
      async rilascia => {
        let finito = false
        const p = b
          .storna(az, d1.id, { versione: v, dataDocumento: '2026-04-20' })
          .finally(() => (finito = true))
        await attendi(() => finito)
        expect(finito).toBe(false)
        rilascia()
        return p
      }
    )
    expect(esitoJob.esito).toBe('DEFINITIVA')
    expect(risultato).toMatchObject({ tipoDocumento: 'TD04', numeroTesto: '4' })
    expect((await b.t19.documenti(e.id))[0].numero).toBe(3)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  it('storno contro definitiva (storno per primo): la definitiva aspetta; numeri 3 (storno) e poi la data della serie ferma la definitiva o la numera 4', async () => {
    const { az, d1, e } = await scenario()
    const v = await b.versioneDi(d1.id)
    // Data dello storno uguale a quella della definitiva (05/04): la serie resta ammessa.
    const { esito: esitoStorno, risultato } = await b.conOperazioneInPausa(
      () => b.storna(az, d1.id, { versione: v, dataDocumento: '2026-04-05' }),
      async rilascia => {
        let finito = false
        const job = b.t19.eseguiJob(az, e.id).finally(() => (finito = true))
        await attendi(() => finito)
        expect(finito).toBe(false)
        rilascia()
        return job
      }
    )
    expect(esitoStorno.status).toBe('fulfilled')
    expect(risultato.esito).toBe('DEFINITIVA')
    expect((await b.t19.documenti(e.id))[0].numero).toBe(4)
    expect((await b.stornoDi(d1.id))?.numero).toBe(3)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  it('due annulli dello stesso documento: un 200 e un 409', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    const v = await b.versioneDi(d2.id)
    const { esito: primo, risultato: secondo } = await b.conOperazioneInPausa(
      () => b.annulla(az, d2.id, { versione: v }),
      async rilascia => {
        let finito = false
        const p = esito(b.annulla(az, d2.id, { versione: v })).finally(() => (finito = true))
        await attendi(() => finito)
        rilascia()
        return p
      }
    )
    expect(primo.status).toBe('fulfilled')
    expect(secondo).toMatchObject({ status: 409, codice: 'ANNULLO_NON_AMMESSO' })
    expect((await b.documento(d2.id)).versione).toBe(v + 1)
    expect((await b.t19.numerazioni(az.tenantId))[0].ultimo_numero).toBe(1)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  it('due storni dello stesso documento: un 200 e un 409 STORNO_GIA_PRESENTE', async () => {
    const az = await b.t19.azienda()
    const [d1] = await b.definitivi(az, 1)
    const v = await b.versioneDi(d1.id)
    const { esito: primo, risultato: secondo } = await b.conOperazioneInPausa(
      () => b.storna(az, d1.id, { versione: v }),
      async rilascia => {
        let finito = false
        const p = esito(b.storna(az, d1.id, { versione: v })).finally(() => (finito = true))
        await attendi(() => finito)
        rilascia()
        return p
      }
    )
    expect(primo.status).toBe('fulfilled')
    expect(secondo).toMatchObject({ status: 409, codice: 'STORNO_GIA_PRESENTE' })
    expect((await b.t19.numerazioni(az.tenantId))[0].ultimo_numero).toBe(2)
    await b.t19.verificaSerie(az.tenantId)
  }, 90_000)

  describe('contro l’emissione dell’XML (simulata dal proprietario)', () => {
    /**
     * Il proprietario tiene il documento `FOR UPDATE` e scrive `emesso_il`, come farebbe l'emissione
     * (Task 23); l'annullo aspetta sul documento. Poi commit o rollback.
     */
    async function annulloControEmissione(esitoEmissione: 'commit' | 'rollback') {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const v = await b.versioneDi(d.id)
      let rilascia!: () => void
      const barriera = new Promise<void>(r => (rilascia = r))
      let preso!: () => void
      const ePreso = new Promise<void>(r => (preso = r))
      const tenitore = owner.$transaction(
        async tx => {
          await tx.$queryRawUnsafe(
            `SELECT id FROM documenti_fattura WHERE id = $1::uuid FOR UPDATE`,
            d.id
          )
          await tx.$executeRawUnsafe(
            `UPDATE documenti_fattura SET emesso_il = now() WHERE id = $1::uuid`,
            d.id
          )
          preso()
          await barriera
          if (esitoEmissione === 'rollback') throw new Error('emissione annullata')
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
      const tenitoreFinito = tenitore.catch(() => undefined)
      await ePreso
      let finito = false
      const annullo = esito(b.annulla(az, d.id, { versione: v })).finally(() => (finito = true))
      try {
        await attendi(() => finito)
      } finally {
        rilascia()
      }
      await tenitoreFinito
      return { az, d, risultato: await annullo }
    }

    it('con la transazione che committa: 409 ANNULLO_NON_AMMESSO motivo EMESSO, mai 500', async () => {
      const { az, d, risultato } = await annulloControEmissione('commit')
      expect(risultato).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'EMESSO' },
      })
      expect(await b.documento(d.id)).toMatchObject({ stato: 'DEFINITIVO' })
      expect((await b.documento(d.id)).emesso_il).not.toBeNull()
      expect((await b.legami([d.legameId]))[0].stato).toBe('FATTURATO')
      await b.t19.verificaSerie(az.tenantId)
    }, 90_000)

    it('con la transazione in rollback: ANNULLATO', async () => {
      const { az, d, risultato } = await annulloControEmissione('rollback')
      expect(risultato).toBe('ok')
      expect(await b.documento(d.id)).toMatchObject({ stato: 'ANNULLATO', emesso_il: null })
      expect((await b.legami([d.legameId]))[0].stato).toBe('CONFERMATO')
      await b.t19.verificaSerie(az.tenantId)
    }, 90_000)
  })
})
