/**
 * Configurazione SDI (4.5a, T5) contro un Postgres reale, collegato COME `wasteflow_app`, dentro il
 * `TenantContext`. Il proprietario prepara aziende e utenti e legge lo stato finale.
 */
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { ProviderSdiFake } from '../../infrastructure/sdi/fake/provider-sdi-fake'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { RegistroProviderSdi } from '../fatturazione/sdi/registro-provider-sdi'
import { ConfigurazioneSdiService, hashToken } from './configurazione-sdi.service'

const CHIAVE = 'chiave-di-cifratura-di-prova'
const SEGRETO_CREDENZIALE = 'apikey-SEGRETISSIMA-12345'
const SEGRETO_WEBHOOK = 'wh_sec_SEGRETISSIMO'

describe('ConfigurazioneSdiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ConfigurazioneSdiService
  let senzaChiave: ConfigurazioneSdiService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const registro = new RegistroProviderSdi([new ProviderSdiFake()])
    const config = (chiave: string) => ({ get: () => chiave }) as unknown as ConfigService
    service = new ConfigurazioneSdiService(app, config(CHIAVE), registro)
    senzaChiave = new ConfigurazioneSdiService(app, config(''), registro)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const ids = { in: tenantCreati }
      await owner.activityLog.deleteMany({ where: { tenantId: ids } })
      await owner.user.deleteMany({ where: { tenantId: ids } })
      await owner.tenant.deleteMany({ where: { id: ids } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Sdi config SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-sdi-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `sdi-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const base = { provider: 'fake', ambiente: 'SANDBOX', versione: 0 }
  const crea = (a: { tenantId: string; utenteId: string }, extra = {}) =>
    nel(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, { ...base, ...extra }))
  const riga = (tenantId: string) =>
    owner
      .$queryRawUnsafe<
        {
          credenziali_cifrate: string | null
          webhook_segreto_cifrato: string | null
          webhook_token_sha256: string
          invio_attivo: boolean
          verificata_il: Date | null
          versione: number
        }[]
      >(`SELECT * FROM configurazioni_sdi WHERE tenant_id = $1::uuid`, tenantId)
      .then(r => r[0])

  it('senza riga: non configurata, versione 0, invio spento', async () => {
    const a = await azienda()
    const v = await nel(a.tenantId, () => service.leggi(a.tenantId))
    expect(v).toMatchObject({ configurata: false, invioAttivo: false, versione: 0, provider: null })
  })

  it('creazione: versione 1, invio spento, token in chiaro una volta sola e nel DB solo l hash', async () => {
    const a = await azienda()
    const v = await crea(a)
    expect(v).toMatchObject({
      configurata: true,
      provider: 'fake',
      ambiente: 'SANDBOX',
      versione: 1,
      invioAttivo: false,
    })
    expect(v.webhookToken).toBeTruthy()
    const r = await riga(a.tenantId)
    expect(r.webhook_token_sha256).toBe(hashToken(v.webhookToken!))
    expect(JSON.stringify(r)).not.toContain(v.webhookToken!)
    const letta = await nel(a.tenantId, () => service.leggi(a.tenantId))
    expect(JSON.stringify(letta)).not.toContain(v.webhookToken!)
  })

  it('le credenziali e il segreto sono cifrati nel DB e non compaiono in nessuna risposta, nei log o nell audit', async () => {
    const spie = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(m =>
      jest.spyOn(Logger.prototype, m)
    )
    const consoleSpie = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m =>
      jest.spyOn(console, m).mockImplementation()
    )
    try {
      const a = await azienda()
      const v = await crea(a, {
        credenziali: { apiKey: SEGRETO_CREDENZIALE },
        segretoWebhook: SEGRETO_WEBHOOK,
      })
      expect(v.haCredenziali).toBe(true)
      expect(v.haSegretoWebhook).toBe(true)
      const r = await riga(a.tenantId)
      expect(r.credenziali_cifrate!.split(':')).toHaveLength(3)
      expect(r.credenziali_cifrate).not.toContain(SEGRETO_CREDENZIALE)
      expect(r.webhook_segreto_cifrato).not.toContain(SEGRETO_WEBHOOK)

      const letta = await nel(a.tenantId, () => service.leggi(a.tenantId))
      const verificata = await nel(a.tenantId, () => service.verifica(a.tenantId, a.utenteId))
      const tutte = JSON.stringify([v, letta, verificata])
      expect(tutte).not.toContain(SEGRETO_CREDENZIALE)
      expect(tutte).not.toContain(SEGRETO_WEBHOOK)

      const audit = await owner.activityLog.findMany({ where: { tenantId: a.tenantId } })
      expect(audit.length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(audit)).not.toContain(SEGRETO_CREDENZIALE)
      expect(JSON.stringify(audit)).not.toContain(SEGRETO_WEBHOOK)

      for (const s of [...spie, ...consoleSpie]) {
        expect(JSON.stringify(s.mock.calls)).not.toContain(SEGRETO_CREDENZIALE)
        expect(JSON.stringify(s.mock.calls)).not.toContain(SEGRETO_WEBHOOK)
      }
    } finally {
      for (const s of [...spie, ...consoleSpie]) s.mockRestore()
    }
  })

  it('credenziali senza chiave di cifratura sul server: 503, niente scritto', async () => {
    const a = await azienda()
    await expect(
      nel(a.tenantId, () =>
        senzaChiave.imposta(a.tenantId, a.utenteId, { ...base, credenziali: { apiKey: 'x' } })
      )
    ).rejects.toMatchObject({ response: { error: 'SDI_CHIAVE_CIFRATURA_ASSENTE' } })
    expect(await riga(a.tenantId)).toBeUndefined()
  })

  it('provider o ambiente non validi: 400 con details.errori; fake in produzione: 400', async () => {
    const a = await azienda()
    await expect(crea(a, { provider: 'boh' })).rejects.toMatchObject({
      response: { error: 'CONFIGURAZIONE_SDI_NON_VALIDA' },
    })
    await expect(crea(a, { ambiente: 'COLLAUDO' })).rejects.toMatchObject({
      response: { error: 'CONFIGURAZIONE_SDI_NON_VALIDA' },
    })
    await expect(crea(a, { provider: 'openapi' })).rejects.toMatchObject({
      response: { error: 'PROVIDER_NON_DISPONIBILE' },
    })
    const prima = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(crea(a)).rejects.toMatchObject({
        response: { error: 'PROVIDER_NON_DISPONIBILE' },
      })
    } finally {
      process.env.NODE_ENV = prima
    }
    expect(await riga(a.tenantId)).toBeUndefined()
  })

  it('invio-attivo senza verifica: 409 SDI_NON_VERIFICATO; dopo la verifica si accende e si spegne', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    await expect(
      nel(a.tenantId, () =>
        service.impostaInvioAttivo(a.tenantId, a.utenteId, { attivo: true, versione: v1.versione })
      )
    ).rejects.toMatchObject({ response: { error: 'SDI_NON_VERIFICATO' } })

    const { esito, configurazione } = await nel(a.tenantId, () =>
      service.verifica(a.tenantId, a.utenteId)
    )
    expect(esito.ok).toBe(true)
    expect(configurazione.verificataIl).not.toBeNull()

    const acceso = await nel(a.tenantId, () =>
      service.impostaInvioAttivo(a.tenantId, a.utenteId, {
        attivo: true,
        versione: configurazione.versione,
      })
    )
    expect(acceso.invioAttivo).toBe(true)
    const spento = await nel(a.tenantId, () =>
      service.impostaInvioAttivo(a.tenantId, a.utenteId, {
        attivo: false,
        versione: acceso.versione,
      })
    )
    expect(spento.invioAttivo).toBe(false)
  })

  it('cambiare le credenziali invalida la verifica e spegne l invio', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    const { configurazione } = await nel(a.tenantId, () => service.verifica(a.tenantId, a.utenteId))
    const acceso = await nel(a.tenantId, () =>
      service.impostaInvioAttivo(a.tenantId, a.utenteId, {
        attivo: true,
        versione: configurazione.versione,
      })
    )
    expect(acceso.invioAttivo).toBe(true)
    expect(v1.versione).toBe(1)
    const cambiata = await nel(a.tenantId, () =>
      service.imposta(a.tenantId, a.utenteId, {
        ...base,
        versione: acceso.versione,
        credenziali: { apiKey: 'nuova' },
      })
    )
    expect(cambiata).toMatchObject({ invioAttivo: false, verificataIl: null, haCredenziali: true })
  })

  it('verifica fallita (credenziali rifiutate): non verificata e invio spento', async () => {
    const a = await azienda()
    await crea(a, { credenziali: { apiKey: 'KO' } })
    const { esito, configurazione } = await nel(a.tenantId, () =>
      service.verifica(a.tenantId, a.utenteId)
    )
    expect(esito.ok).toBe(false)
    expect(configurazione).toMatchObject({ verificataIl: null, invioAttivo: false })
    expect(configurazione.ultimoEsitoVerifica).toMatch(/rifiutate/)
  })

  it('il vincolo del DB tiene anche se il servizio venisse aggirato', async () => {
    const a = await azienda()
    await crea(a)
    await expect(
      owner.$executeRawUnsafe(
        `UPDATE configurazioni_sdi SET invio_attivo = true WHERE tenant_id = $1::uuid`,
        a.tenantId
      )
    ).rejects.toThrow(/configurazioni_sdi_invio_se_verificata|23514/)
  })

  it('versione vecchia: 409 VERSIONE_SUPERATA; seconda creazione con versione 0: 409', async () => {
    const a = await azienda()
    await crea(a)
    await expect(crea(a)).rejects.toMatchObject({ response: { error: 'VERSIONE_SUPERATA' } })
    await expect(
      nel(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, { ...base, versione: 7 }))
    ).rejects.toMatchObject({ response: { error: 'VERSIONE_SUPERATA' } })
  })

  it('due creazioni in parallelo: una sola riga, l altra 409', async () => {
    const a = await azienda()
    const esiti = await Promise.allSettled([crea(a), crea(a)])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(
      (esiti.find(e => e.status === 'rejected') as PromiseRejectedResult).reason
    ).toMatchObject({
      response: { error: 'VERSIONE_SUPERATA' },
    })
  })

  it('rigenera il token: nuovo hash, il vecchio non vale piu', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    const prima = (await riga(a.tenantId)).webhook_token_sha256
    const v2 = await nel(a.tenantId, () =>
      service.rigeneraToken(a.tenantId, a.utenteId, v1.versione)
    )
    const dopo = (await riga(a.tenantId)).webhook_token_sha256
    expect(dopo).not.toBe(prima)
    expect(dopo).toBe(hashToken(v2.webhookToken))
    expect(v2.versione).toBe(2)
  })

  it('operazioni senza configurazione: 409 SDI_NON_CONFIGURATO', async () => {
    const a = await azienda()
    await expect(
      nel(a.tenantId, () => service.verifica(a.tenantId, a.utenteId))
    ).rejects.toMatchObject({
      response: { error: 'SDI_NON_CONFIGURATO' },
    })
    await expect(
      nel(a.tenantId, () => service.rigeneraToken(a.tenantId, a.utenteId, 1))
    ).rejects.toMatchObject({ response: { error: 'SDI_NON_CONFIGURATO' } })
  })

  it('onboarding: spunta con data e utente, toglie, rifiuta un passo sconosciuto', async () => {
    const a = await azienda()
    const v1 = await crea(a)
    const v2 = await nel(a.tenantId, () =>
      service.impostaPassoOnboarding(a.tenantId, a.utenteId, {
        passo: 'CONTRATTO_PROVIDER',
        fatto: true,
        versione: v1.versione,
      })
    )
    expect(v2.onboarding.CONTRATTO_PROVIDER.da).toBe(a.utenteId)
    expect(v2.onboarding.CONTRATTO_PROVIDER.il).toMatch(/^\d{4}-/)
    const v3 = await nel(a.tenantId, () =>
      service.impostaPassoOnboarding(a.tenantId, a.utenteId, {
        passo: 'CONTRATTO_PROVIDER',
        fatto: false,
        versione: v2.versione,
      })
    )
    expect(v3.onboarding).toEqual({})
    await expect(
      nel(a.tenantId, () =>
        service.impostaPassoOnboarding(a.tenantId, a.utenteId, {
          passo: 'BOH',
          fatto: true,
          versione: v3.versione,
        })
      )
    ).rejects.toMatchObject({ response: { error: 'PASSO_ONBOARDING_NON_VALIDO' } })
  })

  it('isolamento: un altra azienda non vede la configurazione', async () => {
    const a = await azienda()
    const b = await azienda()
    await crea(a)
    const vistaB = await nel(b.tenantId, () => service.leggi(b.tenantId))
    expect(vistaB.configurata).toBe(false)
    // Con il contesto di B e il tenantId di A la RLS nasconde comunque la riga.
    const incrociata = await nel(b.tenantId, () => service.leggi(a.tenantId)).catch(e => e)
    expect(incrociata).toBeInstanceOf(Error)
  })

  it('chiave di cifratura cambiata: la verifica risponde 409 SDI_CREDENZIALI_NON_DECIFRABILI, non un 500', async () => {
    const a = await azienda()
    await crea(a, { credenziali: { apiKey: 'x' } })
    const altra = new ConfigurazioneSdiService(
      app,
      { get: () => 'un-altra-chiave' } as unknown as ConfigService,
      new RegistroProviderSdi([new ProviderSdiFake()])
    )
    await expect(
      nel(a.tenantId, () => altra.verifica(a.tenantId, a.utenteId))
    ).rejects.toMatchObject({ response: { error: 'SDI_CREDENZIALI_NON_DECIFRABILI' } })
  })
})
