/**
 * Elaborazione degli invii allo SDI (4.5b, T2) contro un Postgres reale, COME `wasteflow_app`.
 * Il provider e' il `ProviderSdiFake` con gli esiti di `invia` e di `cerca` programmabili, cosi' ogni
 * scenario e' deterministico (l'esito del fake vero dipende dalla P.IVA del cessionario) e le chiamate
 * si contano. Gli orologi sono passati al giro (`ora`), mai sleep.
 */
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `sdi-b-elabora-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { SdiInvioJob } from '../../infrastructure/jobs/sdi-invio.job'
import { ProviderSdiFake } from '../../infrastructure/sdi/fake/provider-sdi-fake'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from '../fatturazione/documenti-fattura.service'
import type {
  ContestoProvider,
  EsitoInvio,
  FileDaInviare,
  InvioTrovato,
} from '../fatturazione/sdi/provider-sdi.port'
import { RegistroProviderSdi } from '../fatturazione/sdi/registro-provider-sdi'
import { XmlDocumentoService } from '../fatturazione/xml-documento.service'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import {
  ATTESA_RICONCILIAZIONE_SDI_MS,
  ElaboraInvioSdiService,
  SOGLIA_STALLO_INVIO_SDI_MS,
} from './elabora-invio-sdi.service'
import { InvioSdiService } from './invio-sdi.service'

/** Provider con esiti programmati: niente dipendenza dalla P.IVA del cessionario. */
class ProviderDiProva extends ProviderSdiFake {
  readonly chiamate: FileDaInviare[] = []
  readonly ricerche: { chiaveIdempotenza: string; nomeFile: string }[] = []
  readonly esiti: EsitoInvio[] = []
  /** Chiavi di idempotenza che `cerca` trova (con l'id provider). */
  readonly arrivati = new Map<string, InvioTrovato>()
  cercaFallisce = false
  private n = 0

  async invia(_ctx: ContestoProvider, f: FileDaInviare): Promise<EsitoInvio> {
    this.chiamate.push(f)
    const programmato = this.esiti.shift()
    if (programmato) return programmato
    this.n++
    return {
      tipo: 'ACCETTATO',
      idProvider: `prova-${this.n}`,
      idSdi: `sdi-${this.n}`,
      fileFirmato: null,
    }
  }

  async cerca(
    _ctx: ContestoProvider,
    q: { chiaveIdempotenza: string; nomeFile: string }
  ): Promise<InvioTrovato | null> {
    this.ricerche.push(q)
    if (this.cercaFallisce) throw new Error('provider non raggiungibile')
    return this.arrivati.get(q.chiaveIdempotenza) ?? null
  }
}

const MIN = 60_000

describe('ElaboraInvioSdiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let provider: ProviderDiProva
  let configurazione: ConfigurazioneSdiService
  let accodamento: InvioSdiService
  let elabora: ElaboraInvioSdiService
  const tenantCreati: string[] = []
  const invii = process.env.SDI_INVII_ATTIVI
  const T0 = new Date()
  const dopo = (ms: number) => new Date(T0.getTime() + ms)

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    process.env.SDI_INVII_ATTIVI = 'true'
    b.reset()
    provider = new ProviderDiProva()
    const registro = new RegistroProviderSdi([provider])
    configurazione = new ConfigurazioneSdiService(
      app,
      { get: () => 'chiave-di-cifratura-di-prova' } as unknown as ConfigService,
      registro
    )
    accodamento = new InvioSdiService(
      app,
      configurazione,
      registro,
      new XmlDocumentoService(app, new DocumentiFatturaService(app))
    )
    elabora = new ElaboraInvioSdiService(app, configurazione, registro)
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    if (invii === undefined) delete process.env.SDI_INVII_ATTIVI
    else process.env.SDI_INVII_ATTIVI = invii
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  async function aziendaSdi(): Promise<AziendaT18> {
    const az = await b.t19.azienda()
    await configurazione.imposta(az.tenantId, az.utenteId, {
      provider: 'fake',
      ambiente: 'SANDBOX',
      versione: 0,
    })
    const v = await configurazione.verifica(az.tenantId, az.utenteId)
    expect(v.esito.ok).toBe(true)
    await configurazione.impostaInvioAttivo(az.tenantId, az.utenteId, {
      attivo: true,
      versione: v.configurazione.versione,
    })
    return az
  }

  /** `n` documenti definitivi accodati: restituisce gli id delle trasmissioni. */
  async function accodati(az: AziendaT18, n = 1): Promise<string[]> {
    const docs = await b.definitivi(az, n)
    const r = await accodamento.accoda(az.tenantId, az.utenteId, { ids: docs.map(d => d.id) })
    expect(r.saltate).toEqual([])
    return r.accodate.map(a => a.trasmissioneId)
  }

  const giro = (az: AziendaT18, ora: Date, invii = true) =>
    elabora.giroAzienda(az.tenantId, ora, { invii })

  async function riga(id: string) {
    const [r] = await owner.$queryRawUnsafe<
      {
        stato: string
        tentativi: number
        id_provider: string | null
        id_sdi: string | null
        ultimo_errore_codice: string | null
        prossimo_tentativo_il: Date | null
        inviata_il: Date | null
        chiusa_il: Date | null
        documento_id: string
        nome_file: string
      }[]
    >(
      `SELECT stato::text, tentativi::int, id_provider, id_sdi, ultimo_errore_codice,
              prossimo_tentativo_il, inviata_il, chiusa_il, documento_id::text, nome_file
       FROM trasmissioni_sdi WHERE id = $1::uuid`,
      id
    )
    return r
  }

  it('ACCETTATO: DA_INVIARE -> INVIATA con id del provider, un solo invia con nome file, XML e chiave = id trasmissione', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    const esito = await giro(az, T0)
    expect(esito).toMatchObject({ inviate: 1, rifiutate: 0, errori: 0 })
    expect(provider.chiamate).toHaveLength(1)
    const c = provider.chiamate[0]
    const r = await riga(id)
    expect(c.chiaveIdempotenza).toBe(id)
    expect(c.nomeFile).toBe(r.nome_file)
    expect(c.firma).toBe(false)
    expect(c.xml.toString('utf8')).toContain('FatturaElettronica')
    expect(r).toMatchObject({
      stato: 'INVIATA',
      tentativi: 1,
      id_provider: 'prova-1',
      id_sdi: 'sdi-1',
      ultimo_errore_codice: null,
    })
    expect(r.inviata_il).not.toBeNull()
    // Un secondo giro non rimanda nulla.
    await giro(az, dopo(MIN))
    expect(provider.chiamate).toHaveLength(1)
  }, 90_000)

  it('RIFIUTATO: ERRORE_INVIO subito, con codice, chiusa_il e un avviso in-app agli amministratori', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'RIFIUTATO', codice: 'PIVA_NON_CONFIGURATA', messaggio: 'no' })
    const esito = await giro(az, T0)
    expect(esito.rifiutate).toBe(1)
    const r = await riga(id)
    expect(r).toMatchObject({ stato: 'ERRORE_INVIO', ultimo_errore_codice: 'PIVA_NON_CONFIGURATA' })
    expect(r.chiusa_il).not.toBeNull()
    const avvisi = await owner.notification.findMany({
      where: { tenantId: az.tenantId, relatedEntityId: r.documento_id },
    })
    expect(avvisi).toHaveLength(1)
    expect(avvisi[0]).toMatchObject({ userId: az.utenteId, severity: 'ERROR', isRead: false })
    expect(avvisi[0].message).toContain(r.nome_file)
  }, 90_000)

  it('TRANSITORIO x5: backoff 1/5/15/60 minuti rispettato, alla quinta ERRORE_INVIO TENTATIVI_ESAURITI', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    for (let i = 0; i < 5; i++) provider.esiti.push({ tipo: 'TRANSITORIO', codice: 'HTTP_503' })

    await giro(az, T0)
    let r = await riga(id)
    expect(r).toMatchObject({ stato: 'DA_INVIARE', tentativi: 1, ultimo_errore_codice: 'HTTP_503' })
    expect(r.prossimo_tentativo_il!.getTime()).toBe(T0.getTime() + 1 * MIN)
    // Prima della scadenza non riparte.
    await giro(az, dopo(30_000))
    expect(provider.chiamate).toHaveLength(1)

    const attese = [1, 5, 15, 60]
    let ora = T0.getTime()
    for (let n = 2; n <= 5; n++) {
      ora += attese[n - 2] * MIN
      await giro(az, new Date(ora))
      r = await riga(id)
      expect(r.tentativi).toBe(n)
      if (n < 5) {
        expect(r.stato).toBe('DA_INVIARE')
        expect(r.prossimo_tentativo_il!.getTime()).toBe(ora + attese[n - 1] * MIN)
      }
    }
    expect(provider.chiamate).toHaveLength(5)
    expect(r).toMatchObject({ stato: 'ERRORE_INVIO', ultimo_errore_codice: 'TENTATIVI_ESAURITI' })
    expect(r.chiusa_il).not.toBeNull()
    // Chiusa: nessun altro tentativo, nemmeno molto dopo.
    await giro(az, new Date(ora + 24 * 60 * MIN))
    expect(provider.chiamate).toHaveLength(5)
    // Ogni tentativo usa la stessa chiave di idempotenza.
    expect(new Set(provider.chiamate.map(c => c.chiaveIdempotenza))).toEqual(new Set([id]))
  }, 120_000)

  it('INCERTO: INCERTA; dopo l attesa cerca() trova l invio -> INVIATA senza un secondo invia', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'INCERTO' })
    provider.arrivati.set(id, { idProvider: 'trovato-1', idSdi: 'sdi-t' })
    await giro(az, T0)
    expect((await riga(id)).stato).toBe('INCERTA')
    // Troppo presto: il provider puo' essere in ritardo, non si cerca ancora.
    await giro(az, dopo(ATTESA_RICONCILIAZIONE_SDI_MS - 1000))
    expect(provider.ricerche).toHaveLength(0)
    const esito = await giro(az, dopo(ATTESA_RICONCILIAZIONE_SDI_MS + 1000))
    expect(esito.riconciliate).toBe(1)
    expect(await riga(id)).toMatchObject({
      stato: 'INVIATA',
      id_provider: 'trovato-1',
      id_sdi: 'sdi-t',
    })
    expect(provider.chiamate).toHaveLength(1)
  }, 90_000)

  it('INCERTO e cerca() non trova: DA_INVIARE e il giro dopo rimanda con la stessa chiave', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'INCERTO' })
    await giro(az, T0)
    await giro(az, dopo(3 * MIN))
    // Riconciliata (assente) e, nello stesso giro, rimandata.
    expect(provider.ricerche).toHaveLength(1)
    expect(provider.chiamate).toHaveLength(2)
    expect(new Set(provider.chiamate.map(c => c.chiaveIdempotenza))).toEqual(new Set([id]))
    expect(await riga(id)).toMatchObject({ stato: 'INVIATA', tentativi: 2 })
  }, 90_000)

  it('cerca() che fallisce (provider giu): la trasmissione resta INCERTA, l errore si conta, nessun invio', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'INCERTO' })
    await giro(az, T0)
    provider.cercaFallisce = true
    const esito = await giro(az, dopo(3 * MIN))
    expect(esito.errori).toBe(1)
    expect((await riga(id)).stato).toBe('INCERTA')
    expect(provider.chiamate).toHaveLength(1)
  }, 90_000)

  it('eccezione dell adattatore in invia: INCERTA (mai «non inviato»)', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    jest.spyOn(provider, 'invia').mockRejectedValueOnce(new Error('socket hang up'))
    await giro(az, T0)
    expect((await riga(id)).stato).toBe('INCERTA')
  }, 90_000)

  it('stallo: IN_INVIO fermo da oltre 15 minuti diventa INCERTA e poi si riconcilia', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    await owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = 'IN_INVIO', tentativi = 1, updated_at = $2::timestamptz
       WHERE id = $1::uuid`,
      id,
      T0.toISOString()
    )
    // Non ancora stallato.
    await giro(az, dopo(SOGLIA_STALLO_INVIO_SDI_MS - 1000))
    expect((await riga(id)).stato).toBe('IN_INVIO')
    const esito = await giro(az, dopo(SOGLIA_STALLO_INVIO_SDI_MS + 1000))
    expect(esito.stalli).toBe(1)
    expect((await riga(id)).stato).toBe('INCERTA')
    expect(provider.chiamate).toHaveLength(0)
  }, 90_000)

  it('due istanze del job in parallelo sullo stesso documento: UN solo invia()', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    const altra = new ElaboraInvioSdiService(
      app,
      configurazione,
      new RegistroProviderSdi([provider])
    )
    const [x, y] = await Promise.all([
      elabora.giroAzienda(az.tenantId, T0, { invii: true }),
      altra.giroAzienda(az.tenantId, T0, { invii: true }),
    ])
    expect(provider.chiamate).toHaveLength(1)
    expect(x.inviate + y.inviate).toBe(1)
    expect(await riga(id)).toMatchObject({ stato: 'INVIATA', tentativi: 1 })
  }, 90_000)

  it('due istanze in parallelo su piu documenti: ogni trasmissione inviata esattamente una volta', async () => {
    const az = await aziendaSdi()
    const ids = await accodati(az, 4)
    const altra = new ElaboraInvioSdiService(
      app,
      configurazione,
      new RegistroProviderSdi([provider])
    )
    await Promise.all([
      elabora.giroAzienda(az.tenantId, T0, { invii: true }),
      altra.giroAzienda(az.tenantId, T0, { invii: true }),
    ])
    expect(provider.chiamate).toHaveLength(4)
    expect(provider.chiamate.map(c => c.chiaveIdempotenza).sort()).toEqual([...ids].sort())
    for (const id of ids) expect((await riga(id)).tentativi).toBe(1)
  }, 120_000)

  it('interruttore globale spento: nessun invia(), ma la riconciliazione prosegue', async () => {
    const az = await aziendaSdi()
    const [daInviare, incerta] = await accodati(az, 2)
    // La seconda e' gia' INCERTA (invio avvenuto prima dello spegnimento).
    await owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = 'IN_INVIO' WHERE id = $1::uuid`,
      incerta
    )
    await owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = 'INCERTA', updated_at = $2::timestamptz WHERE id = $1::uuid`,
      incerta,
      T0.toISOString()
    )
    provider.arrivati.set(incerta, { idProvider: 'gia-arrivato', idSdi: null })
    const esito = await giro(az, dopo(5 * MIN), false)
    expect(provider.chiamate).toHaveLength(0)
    expect(esito.riconciliate).toBe(1)
    expect((await riga(incerta)).stato).toBe('INVIATA')
    expect((await riga(daInviare)).stato).toBe('DA_INVIARE')
  }, 90_000)

  it('invio_attivo spento sulla configurazione: nessun invia()', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    await owner.$executeRawUnsafe(
      `UPDATE configurazioni_sdi SET invio_attivo = false WHERE tenant_id = $1::uuid`,
      az.tenantId
    )
    await giro(az, T0)
    expect(provider.chiamate).toHaveLength(0)
    expect((await riga(id)).stato).toBe('DA_INVIARE')
  }, 90_000)

  it('XML alterato dopo l accodamento (impronta diversa): ERRORE_INVIO XML_ALTERATO, nessun invia()', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    const { documento_id: documentoId } = await riga(id)
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
      await tx.$executeRawUnsafe(
        `UPDATE documenti_fattura SET xml = convert_to('<alterato/>', 'UTF8') WHERE id = $1::uuid`,
        documentoId
      )
    })
    await giro(az, T0)
    expect(provider.chiamate).toHaveLength(0)
    expect(await riga(id)).toMatchObject({
      stato: 'ERRORE_INVIO',
      ultimo_errore_codice: 'XML_ALTERATO',
    })
  }, 90_000)

  it('configurazione cambiata dopo l accodamento (altro ambiente): ERRORE_INVIO CONFIGURAZIONE_CAMBIATA, nessun invia()', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    await owner.$executeRawUnsafe(
      `UPDATE configurazioni_sdi SET ambiente = 'PRODUZIONE' WHERE tenant_id = $1::uuid`,
      az.tenantId
    )
    await giro(az, T0)
    expect(provider.chiamate).toHaveLength(0)
    expect(await riga(id)).toMatchObject({
      stato: 'ERRORE_INVIO',
      ultimo_errore_codice: 'CONFIGURAZIONE_CAMBIATA',
    })
  }, 90_000)

  it('riprova dopo ERRORE_INVIO: prima di inviare di nuovo cerca() per nome file; se il file e gia al provider non lo rimanda', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'RIFIUTATO', codice: 'RETE', messaggio: 'x' })
    await giro(az, T0)
    expect((await riga(id)).stato).toBe('ERRORE_INVIO')
    const { documento_id: documentoId } = await riga(id)
    const nuova = await accodamento.riprova(az.tenantId, az.utenteId, documentoId)
    provider.arrivati.set(nuova.trasmissioneId, { idProvider: 'era-gia-li', idSdi: 'sdi-x' })
    await giro(az, dopo(MIN))
    expect(provider.ricerche).toHaveLength(1)
    expect(provider.chiamate).toHaveLength(1) // solo il primo tentativo
    expect(await riga(nuova.trasmissioneId)).toMatchObject({
      stato: 'INVIATA',
      id_provider: 'era-gia-li',
    })
  }, 90_000)

  it('riprova dopo ERRORE_INVIO con il file assente dal provider: lo invia', async () => {
    const az = await aziendaSdi()
    const [id] = await accodati(az)
    provider.esiti.push({ tipo: 'RIFIUTATO', codice: 'RETE', messaggio: 'x' })
    await giro(az, T0)
    const { documento_id: documentoId } = await riga(id)
    const nuova = await accodamento.riprova(az.tenantId, az.utenteId, documentoId)
    await giro(az, dopo(MIN))
    expect(provider.ricerche).toHaveLength(1)
    expect(provider.chiamate).toHaveLength(2)
    expect((await riga(nuova.trasmissioneId)).stato).toBe('INVIATA')
  }, 90_000)

  it('isolamento: il giro di un azienda non tocca le trasmissioni di un altra', async () => {
    const a = await aziendaSdi()
    const altra = await aziendaSdi()
    const [ida] = await accodati(a)
    const [idb] = await accodati(altra)
    await giro(a, T0)
    expect((await riga(ida)).stato).toBe('INVIATA')
    expect((await riga(idb)).stato).toBe('DA_INVIARE')
  }, 120_000)

  it('azienda senza configurazione: giro vuoto', async () => {
    const az = await b.t19.azienda()
    expect(await giro(az, T0)).toEqual({
      stalli: 0,
      riconciliate: 0,
      inviate: 0,
      rifiutate: 0,
      ritentate: 0,
      incerte: 0,
      errori: 0,
    })
  }, 60_000)

  it('il job (client di sistema reale) elenca solo le aziende con una configurazione SDI e invia le loro trasmissioni', async () => {
    const sistema = new PrismaSistemaService()
    try {
      const configurata = await aziendaSdi()
      const senza = await b.t19.azienda()
      const [id] = await accodati(configurata)
      const moduli = { tenantConModulo: jest.fn(async (ids: readonly string[]) => new Set(ids)) }
      const job = new SdiInvioJob(sistema, moduli as unknown as ModuliAttiviService, elabora)
      const spia = jest.spyOn(elabora, 'giroAzienda')
      const esito = await job.eseguiInvio()
      expect(esito).not.toBeNull()
      const interrogate = moduli.tenantConModulo.mock.calls[0][0]
      expect(interrogate).toContain(configurata.tenantId)
      expect(interrogate).not.toContain(senza.tenantId)
      expect(spia.mock.calls.map(c => c[0])).toContain(configurata.tenantId)
      expect(spia.mock.calls.map(c => c[0])).not.toContain(senza.tenantId)
      // Con l'interruttore acceso (beforeEach) la trasmissione parte.
      expect((await riga(id)).stato).toBe('INVIATA')
    } finally {
      await sistema.$disconnect()
    }
  }, 120_000)
})
