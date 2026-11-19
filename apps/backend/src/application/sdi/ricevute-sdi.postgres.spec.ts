/**
 * Ricevute SDI (4.5c) contro un Postgres reale, COME `wasteflow_app` (e `wasteflow_sistema` solo per
 * l'elenco delle aziende nei job). Webhook (firma, timestamp, idempotenza, modulo), inbox ->
 * `notifiche_sdi` -> stato calcolato, polling di ripiego. Il provider e' il `ProviderSdiFake` con
 * `invia` e `notifiche` programmabili; gli orologi sono passati ai servizi, mai sleep.
 */
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `sdi-c-ricevute-${process.pid}`
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

import { createHash } from 'node:crypto'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { SdiEventiJob } from '../../infrastructure/jobs/sdi-eventi.job'
import { SdiRiconciliazioneJob } from '../../infrastructure/jobs/sdi-riconciliazione.job'
import {
  INTESTAZIONE_FIRMA_FAKE,
  ProviderSdiFake,
  firmaWebhookFake,
} from '../../infrastructure/sdi/fake/provider-sdi-fake'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { DocumentiFatturaService } from '../fatturazione/documenti-fattura.service'
import type {
  ContestoProvider,
  EsitoInvio,
  FileDaInviare,
  NotificaSdiGrezza,
} from '../fatturazione/sdi/provider-sdi.port'
import { RegistroProviderSdi } from '../fatturazione/sdi/registro-provider-sdi'
import { XmlDocumentoService } from '../fatturazione/xml-documento.service'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import { ElaboraEventiSdiService } from './elabora-eventi-sdi.service'
import { ElaboraInvioSdiService } from './elabora-invio-sdi.service'
import { InvioSdiService } from './invio-sdi.service'
import { LetturaSdiService } from './lettura-sdi.service'
import { RegistraNotificheSdiService } from './registra-notifiche-sdi.service'
import {
  ATTESA_POLLING_INVIATA_SDI_MS,
  RiconciliaNotificheSdiService,
} from './riconcilia-notifiche-sdi.service'
import { RisoluzioneTenantSdiService } from './risoluzione-tenant-sdi.service'
import { WebhookSdiService } from './webhook-sdi.service'

const SEGRETO = 'segreto-webhook-di-prova'

class ProviderDiProva extends ProviderSdiFake {
  readonly notificheDelProvider = new Map<string, NotificaSdiGrezza[]>()
  chiamateNotifiche = 0
  private n = 0

  async invia(_ctx: ContestoProvider, _f: FileDaInviare): Promise<EsitoInvio> {
    this.n++
    return {
      tipo: 'ACCETTATO',
      idProvider: `prova-${this.n}`,
      idSdi: `sdi-${this.n}`,
      fileFirmato: null,
    }
  }

  async notifiche(_ctx: ContestoProvider, idProvider: string): Promise<NotificaSdiGrezza[]> {
    this.chiamateNotifiche++
    return this.notificheDelProvider.get(idProvider) ?? []
  }
}

const notifica = (
  tipo: NotificaSdiGrezza['tipo'],
  extra: Partial<NotificaSdiGrezza> = {}
): NotificaSdiGrezza => ({
  tipo,
  esitoCommittente: null,
  codiciErrore: [],
  dataRicezioneSdi: new Date('2026-11-19T10:00:00Z'),
  idNotifica: `n-${tipo}-${extra.esitoCommittente ?? ''}`,
  file: null,
  ...extra,
})

const ORE = 3_600_000

describe('Ricevute SDI — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let b: BancoT20
  let provider: ProviderDiProva
  let configurazione: ConfigurazioneSdiService
  let accodamento: InvioSdiService
  let elaboraInvio: ElaboraInvioSdiService
  let webhook: WebhookSdiService
  let eventi: ElaboraEventiSdiService
  let polling: RiconciliaNotificheSdiService
  let moduli: { moduliAttivi: jest.Mock; tenantConModulo: jest.Mock }
  const tenantCreati: string[] = []
  const invii = process.env.SDI_INVII_ATTIVI
  const modalita = process.env.MODULI_BACKEND_MODALITA
  const T0 = new Date('2026-11-19T10:00:30Z')
  const dopo = (ms: number) => new Date(T0.getTime() + ms)

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    sistema = new PrismaSistemaService()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    process.env.SDI_INVII_ATTIVI = 'true'
    delete process.env.MODULI_BACKEND_MODALITA
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
    elaboraInvio = new ElaboraInvioSdiService(app, configurazione, registro)
    moduli = {
      moduliAttivi: jest.fn().mockResolvedValue(['sdi']),
      tenantConModulo: jest.fn(async (ids: string[]) => new Set(ids)),
    }
    webhook = new WebhookSdiService(
      new RisoluzioneTenantSdiService(sistema),
      moduli as unknown as ModuliAttiviService,
      configurazione,
      registro,
      app
    )
    webhook.orologio = () => T0
    const registra = new RegistraNotificheSdiService(app)
    eventi = new ElaboraEventiSdiService(app, registra)
    polling = new RiconciliaNotificheSdiService(app, configurazione, registro, registra)
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    if (invii === undefined) delete process.env.SDI_INVII_ATTIVI
    else process.env.SDI_INVII_ATTIVI = invii
    if (modalita === undefined) delete process.env.MODULI_BACKEND_MODALITA
    else process.env.MODULI_BACKEND_MODALITA = modalita
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
    await sistema?.$disconnect()
  }, 180_000)

  /** Azienda con SDI configurata (provider fake, segreto del webhook) e una trasmissione INVIATA. */
  async function aziendaConInviata(): Promise<{
    az: AziendaT18
    token: string
    trasmissioneId: string
    idProvider: string
  }> {
    const az = await b.t19.azienda()
    const creata = await configurazione.imposta(az.tenantId, az.utenteId, {
      provider: 'fake',
      ambiente: 'SANDBOX',
      segretoWebhook: SEGRETO,
      versione: 0,
    })
    const v = await configurazione.verifica(az.tenantId, az.utenteId)
    await configurazione.impostaInvioAttivo(az.tenantId, az.utenteId, {
      attivo: true,
      versione: v.configurazione.versione,
    })
    const [doc] = await b.definitivi(az, 1)
    const r = await accodamento.accoda(az.tenantId, az.utenteId, { ids: [doc.id] })
    await elaboraInvio.giroAzienda(az.tenantId, T0, { invii: true })
    const trasmissioneId = r.accodate[0].trasmissioneId
    const [t] = await owner.$queryRawUnsafe<{ stato: string; id_provider: string }[]>(
      `SELECT stato::text, id_provider FROM trasmissioni_sdi WHERE id = $1::uuid`,
      trasmissioneId
    )
    expect(t.stato).toBe('INVIATA')
    return { az, token: creata.webhookToken!, trasmissioneId, idProvider: t.id_provider }
  }

  const stato = async (id: string) =>
    (
      await owner.$queryRawUnsafe<{ stato: string }[]>(
        `SELECT stato::text FROM trasmissioni_sdi WHERE id = $1::uuid`,
        id
      )
    )[0].stato

  const nNotifiche = async (id: string) =>
    (
      await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM notifiche_sdi WHERE trasmissione_id = $1::uuid`,
        id
      )
    )[0].n

  function corpoWebhook(idEvento: string, idProvider: string, n: NotificaSdiGrezza): Buffer {
    return Buffer.from(
      JSON.stringify({
        id: idEvento,
        idProvider,
        notifica: {
          tipo: n.tipo,
          esitoCommittente: n.esitoCommittente,
          codiciErrore: n.codiciErrore,
          dataRicezioneSdi: n.dataRicezioneSdi?.toISOString() ?? null,
          idNotifica: n.idNotifica,
        },
      })
    )
  }
  const firma = (corpo: Buffer, t = Math.floor(T0.getTime() / 1000), segreto = SEGRETO) => ({
    [INTESTAZIONE_FIRMA_FAKE]: firmaWebhookFake(corpo, segreto, t),
  })

  const nEventi = async (tenantId: string) =>
    (
      await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM eventi_sdi_ricevuti WHERE tenant_id = $1::uuid`,
        tenantId
      )
    )[0].n

  describe('webhook', () => {
    it('firma errata -> NON_AUTENTICO e nessun evento', async () => {
      const { az, token, idProvider } = await aziendaConInviata()
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      const r = await webhook.ricevi('fake', token, firma(corpo, undefined, 'altro-segreto'), corpo)
      expect(r.tipo).toBe('NON_AUTENTICO')
      expect(await nEventi(az.tenantId)).toBe(0)
    }, 90_000)

    it('timestamp vecchio -> NON_AUTENTICO', async () => {
      const { az, token, idProvider } = await aziendaConInviata()
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      const vecchio = Math.floor(T0.getTime() / 1000) - 3600
      const r = await webhook.ricevi('fake', token, firma(corpo, vecchio), corpo)
      expect(r.tipo).toBe('NON_AUTENTICO')
      expect(await nEventi(az.tenantId)).toBe(0)
    }, 90_000)

    it('token sconosciuto, mal formato o provider diverso -> NON_TROVATO', async () => {
      const { token, idProvider } = await aziendaConInviata()
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      const h = firma(corpo)
      expect((await webhook.ricevi('fake', 'A'.repeat(43), h, corpo)).tipo).toBe('NON_TROVATO')
      expect((await webhook.ricevi('fake', 'corto', h, corpo)).tipo).toBe('NON_TROVATO')
      expect((await webhook.ricevi('openapi', token, h, corpo)).tipo).toBe('NON_TROVATO')
      expect((await webhook.ricevi('sconosciuto', token, h, corpo)).tipo).toBe('NON_TROVATO')
    }, 90_000)

    it('stesso evento due volte -> UN solo inserimento, due RICEVUTO', async () => {
      const { az, token, idProvider } = await aziendaConInviata()
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      const h = firma(corpo)
      expect((await webhook.ricevi('fake', token, h, corpo)).tipo).toBe('RICEVUTO')
      expect((await webhook.ricevi('fake', token, h, corpo)).tipo).toBe('RICEVUTO')
      expect(await nEventi(az.tenantId)).toBe(1)
    }, 90_000)

    it('azienda senza il modulo sdi -> NON_TROVATO; in modalita registra passa con un avviso', async () => {
      const { az, token, idProvider } = await aziendaConInviata()
      moduli.moduliAttivi.mockResolvedValue([])
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      const h = firma(corpo)
      expect((await webhook.ricevi('fake', token, h, corpo)).tipo).toBe('NON_TROVATO')
      expect(await nEventi(az.tenantId)).toBe(0)
      process.env.MODULI_BACKEND_MODALITA = 'registra'
      expect((await webhook.ricevi('fake', token, h, corpo)).tipo).toBe('RICEVUTO')
      expect(await nEventi(az.tenantId)).toBe(1)
    }, 90_000)

    it('senza segreto configurato non si accetta nulla alla cieca', async () => {
      const { az, token, idProvider } = await aziendaConInviata()
      await owner.$executeRawUnsafe(
        `UPDATE configurazioni_sdi SET webhook_segreto_cifrato = NULL WHERE tenant_id = $1::uuid`,
        az.tenantId
      )
      const corpo = corpoWebhook('e-1', idProvider, notifica('RC'))
      expect((await webhook.ricevi('fake', token, firma(corpo), corpo)).tipo).toBe('NON_AUTENTICO')
    }, 90_000)

    it("il token di un'azienda non scrive nell'altra", async () => {
      const a = await aziendaConInviata()
      const b2 = await aziendaConInviata()
      const corpo = corpoWebhook('e-1', a.idProvider, notifica('RC'))
      await webhook.ricevi('fake', b2.token, firma(corpo), corpo)
      expect(await nEventi(a.az.tenantId)).toBe(0)
      expect(await nEventi(b2.az.tenantId)).toBe(1)
    }, 120_000)
  })

  describe('eventi -> notifiche -> stato', () => {
    async function ricevi(
      x: { token: string; idProvider: string },
      idEvento: string,
      n: NotificaSdiGrezza
    ) {
      const corpo = corpoWebhook(idEvento, x.idProvider, n)
      expect((await webhook.ricevi('fake', x.token, firma(corpo), corpo)).tipo).toBe('RICEVUTO')
    }

    it('RC via webhook: INVIATA -> CONSEGNATA, evento chiuso, una notifica con fonte WEBHOOK', async () => {
      const x = await aziendaConInviata()
      await ricevi(x, 'e-1', notifica('RC'))
      const esito = await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      expect(esito).toMatchObject({ elaborati: 1, errori: 0 })
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
      const n = await owner.$queryRawUnsafe<{ tipo: string; fonte: string }[]>(
        `SELECT tipo, fonte FROM notifiche_sdi WHERE trasmissione_id = $1::uuid`,
        x.trasmissioneId
      )
      expect(n).toEqual([{ tipo: 'RC', fonte: 'WEBHOOK' }])
      // Rielaborare non cambia nulla.
      expect((await eventi.giroAzienda(x.az.tenantId, dopo(2000))).elaborati).toBe(0)
    }, 120_000)

    it('NE prima di RC: stato finale ACCETTATA, la RC tardiva non lo fa regredire', async () => {
      const x = await aziendaConInviata()
      await ricevi(x, 'e-ne', notifica('NE', { esitoCommittente: 'EC01' }))
      await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      expect(await stato(x.trasmissioneId)).toBe('ACCETTATA')
      await ricevi(x, 'e-rc', notifica('RC'))
      await eventi.giroAzienda(x.az.tenantId, dopo(2000))
      expect(await stato(x.trasmissioneId)).toBe('ACCETTATA')
      expect(await nNotifiche(x.trasmissioneId)).toBe(2)
    }, 120_000)

    it('NS dopo RC: avviso NOTIFICHE_INCOERENTI, stato NON regredito a SCARTATA', async () => {
      const x = await aziendaConInviata()
      await ricevi(x, 'e-rc', notifica('RC'))
      await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      const registra = new RegistraNotificheSdiService(app)
      const r = await registra.registra(
        x.az.tenantId,
        x.trasmissioneId,
        [notifica('NS', { codiciErrore: ['00404'] })],
        'WEBHOOK',
        dopo(2000)
      )
      expect(r).toMatchObject({ statoPrima: 'CONSEGNATA', statoDopo: 'CONSEGNATA' })
      expect(r?.avvisi).toContain('NOTIFICHE_INCOERENTI')
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
      expect(await nNotifiche(x.trasmissioneId)).toBe(2)
    }, 120_000)

    it('NS senza consegna: SCARTATA con chiusa_il e avviso PROBABILMENTE_GIA_INVIATA per 00404', async () => {
      const x = await aziendaConInviata()
      await ricevi(x, 'e-ns', notifica('NS', { codiciErrore: ['00404'] }))
      await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      expect(await stato(x.trasmissioneId)).toBe('SCARTATA')
      const [t] = await owner.$queryRawUnsafe<{ chiusa_il: Date | null }[]>(
        `SELECT chiusa_il FROM trasmissioni_sdi WHERE id = $1::uuid`,
        x.trasmissioneId
      )
      expect(t.chiusa_il).not.toBeNull()
    }, 120_000)

    it('evento per un invio ancora ignoto: resta IN_ATTESA e dopo 24 ore si chiude come sconosciuto', async () => {
      const x = await aziendaConInviata()
      await ricevi({ token: x.token, idProvider: 'non-esiste' }, 'e-x', notifica('RC'))
      const e1 = await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      expect(e1).toMatchObject({ elaborati: 0, inAttesa: 1 })
      const e2 = await eventi.giroAzienda(x.az.tenantId, new Date(Date.now() + 25 * ORE))
      expect(e2).toMatchObject({ scartati: 1 })
      const [ev] = await owner.$queryRawUnsafe<
        { esito_elaborazione: string; elaborato_il: Date | null }[]
      >(
        `SELECT esito_elaborazione, elaborato_il FROM eventi_sdi_ricevuti WHERE tenant_id = $1::uuid`,
        x.az.tenantId
      )
      expect(ev.esito_elaborazione).toBe('TRASMISSIONE_SCONOSCIUTA')
      expect(ev.elaborato_il).not.toBeNull()
    }, 120_000)

    it('corpo non valido: evento chiuso come CORPO_NON_VALIDO, senza bloccare gli altri', async () => {
      const x = await aziendaConInviata()
      await owner.$executeRawUnsafe(
        `INSERT INTO eventi_sdi_ricevuti (tenant_id, provider, id_evento_provider, corpo, ricevuto_il)
         VALUES ($1::uuid, 'fake', 'rotto', '{"x":1}'::jsonb, $2::timestamptz)`,
        x.az.tenantId,
        T0
      )
      await ricevi(x, 'e-ok', notifica('RC'))
      const e = await eventi.giroAzienda(x.az.tenantId, dopo(1000))
      expect(e).toMatchObject({ elaborati: 1, scartati: 1 })
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
    }, 120_000)

    it('SdiEventiJob: elenca le aziende con eventi da elaborare e li elabora', async () => {
      const x = await aziendaConInviata()
      await ricevi(x, 'e-1', notifica('RC'))
      const job = new SdiEventiJob(sistema, eventi)
      job.orologio = () => dopo(1000)
      const esito = await job.eseguiEventi()
      expect(esito?.elaborati).toBeGreaterThanOrEqual(1)
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
    }, 120_000)
  })

  describe('polling di ripiego', () => {
    it('webhook perso: prima di 2 ore non interroga, dopo 2 ore porta a CONSEGNATA', async () => {
      const x = await aziendaConInviata()
      provider.notificheDelProvider.set(x.idProvider, [notifica('RC')])
      const prima = await polling.giroAzienda(
        x.az.tenantId,
        dopo(ATTESA_POLLING_INVIATA_SDI_MS - 60_000)
      )
      expect(prima.controllate).toBe(0)
      expect(provider.chiamateNotifiche).toBe(0)
      const dopo2h = await polling.giroAzienda(
        x.az.tenantId,
        dopo(ATTESA_POLLING_INVIATA_SDI_MS + 60_000)
      )
      expect(dopo2h).toMatchObject({ controllate: 1, aggiornate: 1, errori: 0 })
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
      const [n] = await owner.$queryRawUnsafe<{ fonte: string }[]>(
        `SELECT fonte FROM notifiche_sdi WHERE trasmissione_id = $1::uuid`,
        x.trasmissioneId
      )
      expect(n.fonte).toBe('POLLING')
    }, 120_000)

    it('senza novita: si interroga una volta per finestra, non a ogni giro', async () => {
      const x = await aziendaConInviata()
      const t1 = dopo(ATTESA_POLLING_INVIATA_SDI_MS + 60_000)
      await polling.giroAzienda(x.az.tenantId, t1)
      await polling.giroAzienda(x.az.tenantId, new Date(t1.getTime() + 15 * 60_000))
      expect(provider.chiamateNotifiche).toBe(1)
      await polling.giroAzienda(
        x.az.tenantId,
        new Date(t1.getTime() + ATTESA_POLLING_INVIATA_SDI_MS + 1000)
      )
      expect(provider.chiamateNotifiche).toBe(2)
      expect(await stato(x.trasmissioneId)).toBe('INVIATA')
    }, 120_000)

    it("provider non raggiungibile: la trasmissione resta com'e' e l'errore e contato", async () => {
      const x = await aziendaConInviata()
      jest.spyOn(provider, 'notifiche').mockRejectedValue(new Error('rete'))
      const e = await polling.giroAzienda(x.az.tenantId, dopo(3 * ORE))
      expect(e).toMatchObject({ controllate: 0, errori: 1 })
      expect(await stato(x.trasmissioneId)).toBe('INVIATA')
    }, 120_000)

    it('una CONSEGNATA di FPR12 non si interroga (solo la PA aspetta DT ed esiti)', async () => {
      const x = await aziendaConInviata()
      provider.notificheDelProvider.set(x.idProvider, [notifica('RC')])
      await polling.giroAzienda(x.az.tenantId, dopo(3 * ORE))
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
      const chiamate = provider.chiamateNotifiche
      await polling.giroAzienda(x.az.tenantId, dopo(40 * 24 * ORE))
      expect(provider.chiamateNotifiche).toBe(chiamate)
    }, 120_000)

    it('SdiRiconciliazioneJob: filtra per modulo e porta a CONSEGNATA', async () => {
      const x = await aziendaConInviata()
      provider.notificheDelProvider.set(x.idProvider, [notifica('RC')])
      const job = new SdiRiconciliazioneJob(
        sistema,
        moduli as unknown as ModuliAttiviService,
        polling
      )
      job.orologio = () => dopo(3 * ORE)
      moduli.tenantConModulo.mockImplementation(async () => new Set<string>())
      expect((await job.eseguiRiconciliazione())?.controllate).toBe(0)
      moduli.tenantConModulo.mockImplementation(async (ids: string[]) => new Set(ids))
      await job.eseguiRiconciliazione()
      expect(await stato(x.trasmissioneId)).toBe('CONSEGNATA')
    }, 120_000)
  })

  describe('isolamento e protezioni', () => {
    it('le ricevute sono di solo inserimento: UPDATE e DELETE come wasteflow_app sono negati', async () => {
      const x = await aziendaConInviata()
      const registra = new RegistraNotificheSdiService(app)
      await registra.registra(x.az.tenantId, x.trasmissioneId, [notifica('RC')], 'POLLING', T0)
      await expect(app.$executeRawUnsafe(`UPDATE notifiche_sdi SET tipo = 'MC'`)).rejects.toThrow()
    }, 120_000)

    it("registrare notifiche di un'altra azienda: trasmissione non trovata (RLS)", async () => {
      const a = await aziendaConInviata()
      const altra = await b.t19.azienda()
      const registra = new RegistraNotificheSdiService(app)
      const r = await registra.registra(
        altra.tenantId,
        a.trasmissioneId,
        [notifica('RC')],
        'POLLING',
        T0
      )
      expect(r).toBeNull()
      expect(await nNotifiche(a.trasmissioneId)).toBe(0)
    }, 120_000)

    it("la chiave di dedup usa il sha del file quando manca l'id della notifica", async () => {
      const x = await aziendaConInviata()
      const registra = new RegistraNotificheSdiService(app)
      const file = Buffer.from('<ricevuta/>')
      const n = notifica('RC', { idNotifica: null, file })
      await registra.registra(x.az.tenantId, x.trasmissioneId, [n, n], 'WEBHOOK', T0)
      expect(await nNotifiche(x.trasmissioneId)).toBe(1)
      const [r] = await owner.$queryRawUnsafe<{ chiave_dedup: string; file_sha256: string }[]>(
        `SELECT chiave_dedup, file_sha256 FROM notifiche_sdi WHERE trasmissione_id = $1::uuid`,
        x.trasmissioneId
      )
      const sha = createHash('sha256').update(file).digest('hex')
      expect(r).toEqual({ chiave_dedup: `sha:${sha}`, file_sha256: sha })
    }, 120_000)
  })

  describe('lettura per il frontend', () => {
    it('cronologia con codici in italiano, avvisi e file scaricabile; altra azienda: 404', async () => {
      const x = await aziendaConInviata()
      const registra = new RegistraNotificheSdiService(app)
      await registra.registra(
        x.az.tenantId,
        x.trasmissioneId,
        [notifica('NS', { codiciErrore: ['00404'], file: Buffer.from('<ns/>') })],
        'WEBHOOK',
        T0
      )
      const lettura = new LetturaSdiService(app)
      const [doc] = await owner.$queryRawUnsafe<{ documento_id: string }[]>(
        `SELECT documento_id::text FROM trasmissioni_sdi WHERE id = $1::uuid`,
        x.trasmissioneId
      )
      const r = await lettura.delDocumento(x.az.tenantId, doc.documento_id)
      expect(r.trasmissioni).toHaveLength(1)
      const t = r.trasmissioni[0]
      expect(t).toMatchObject({ stato: 'SCARTATA', esitoFiscale: 'NON_EMESSA' })
      expect(t.avvisi).toContain('PROBABILMENTE_GIA_INVIATA')
      expect(t.notifiche[0].codiciErrore[0].descrizione).toContain('duplicata')
      expect(t.notifiche[0].haFile).toBe(true)
      expect(JSON.stringify(r)).not.toContain('<ns/>')
      const f = await lettura.fileRicevuta(x.az.tenantId, doc.documento_id, t.notifiche[0].id)
      expect(f.contenuto.toString()).toBe('<ns/>')
      expect(f.nomeFile).toMatch(/_NS\.xml$/)
      const altra = await b.t19.azienda()
      await expect(lettura.delDocumento(altra.tenantId, doc.documento_id)).rejects.toThrow()
      await expect(
        lettura.fileRicevuta(altra.tenantId, doc.documento_id, t.notifiche[0].id)
      ).rejects.toThrow()
    }, 120_000)
  })
})
