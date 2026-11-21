/**
 * Web push P7 contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE):
 * sottoscrizioni per utente, preferenze, invio solo ai destinatari giusti e solo dell'azienda.
 */
import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import { creaAziendaCampo, type AziendaCampo } from '../../test-support/campo-di-test'
import { PushEndpointNonAmmessoError, PushNonDisponibileError } from './errori-campo'
import {
  ENV_VAPID_PRIVATE_KEY,
  ENV_VAPID_PUBLIC_KEY,
  ENV_VAPID_SUBJECT,
  MAX_SOTTOSCRIZIONI_PER_UTENTE,
  PushCampoService,
  type InvioPush,
  type RichiestaPush,
} from './push-campo.service'
import { generaChiaviVapid } from './vapid'

const ep = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}-${crypto.randomUUID()}`

describe('Web push P7 — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const creati: string[] = []
  const chiavi = generaChiaviVapid()

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  /** Invio finto: registra le richieste e risponde con lo status deciso per endpoint. */
  function invioFinto(status: (endpoint: string) => number | Error = () => 201) {
    const richieste: RichiestaPush[] = []
    const invio: InvioPush = {
      async invia(r) {
        richieste.push(r)
        const s = status(r.endpoint)
        if (s instanceof Error) throw s
        return { status: s }
      },
    }
    return { invio, richieste }
  }
  const servizio = (invio?: InvioPush, conChiavi = true) =>
    new PushCampoService(
      app,
      new ConfigService(
        conChiavi
          ? {
              [ENV_VAPID_PUBLIC_KEY]: chiavi.pubblica,
              [ENV_VAPID_PRIVATE_KEY]: chiavi.privata,
              [ENV_VAPID_SUBJECT]: 'mailto:test@example.test',
            }
          : {}
      ),
      invio
    )
  const righe = (a: AziendaCampo) =>
    owner.sottoscrizionePush.findMany({ where: { tenantId: a.t }, orderBy: { creataIl: 'asc' } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia push campo: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('funzione spenta senza chiavi', () => {
    it('nessun errore: non disponibile, chiave nulla, sottoscrizione rifiutata, invio vuoto', async () => {
      const a = await azienda()
      const { invio, richieste } = invioFinto()
      const s = servizio(invio, false)
      expect(s.disponibile()).toBe(false)
      expect(s.chiavePubblica()).toBeNull()
      await expect(
        nelTenant(a.t, () => s.sottoscrivi(a.t, a.utente1, ep('x')))
      ).rejects.toBeInstanceOf(PushNonDisponibileError)
      expect(await righe(a)).toHaveLength(0)
      expect(await nelTenant(a.t, () => s.notificaGiroModificato(a.t, [a.autista1]))).toEqual({
        inviate: 0,
        rimosse: 0,
        fallite: 0,
      })
      expect(richieste).toHaveLength(0)
    })

    it('annulla funziona anche a funzione spenta (si puo sempre ripulire)', async () => {
      const a = await azienda()
      const e = ep('p')
      await servizio().sottoscrivi(a.t, a.utente1, e)
      await servizio(undefined, false).annulla(a.t, a.utente1, e)
      expect(await righe(a)).toHaveLength(0)
    })
  })

  describe('sottoscrizioni', () => {
    it('crea, e lo stesso endpoint non si duplica ma passa al nuovo utente (telefono a un collega)', async () => {
      const a = await azienda()
      const s = servizio()
      const e = ep('tel')
      await s.sottoscrivi(a.t, a.utente1, e)
      await s.sottoscrivi(a.t, a.utente1, e)
      expect(await righe(a)).toHaveLength(1)
      await s.sottoscrivi(a.t, a.utente2, e)
      const dopo = await righe(a)
      expect(dopo).toHaveLength(1)
      expect(dopo[0].utenteId).toBe(a.utente2)
    })

    it('rifiuta endpoint non ammessi (http, localhost, host sconosciuto) senza scrivere', async () => {
      const a = await azienda()
      const s = servizio()
      for (const e of [
        'http://fcm.googleapis.com/x/abcdefgh',
        'https://localhost/abcdefghijk',
        'https://example.org/abcdefghijk',
      ]) {
        await expect(s.sottoscrivi(a.t, a.utente1, e)).rejects.toBeInstanceOf(
          PushEndpointNonAmmessoError
        )
      }
      expect(await righe(a)).toHaveLength(0)
    })

    it(`tetto di ${MAX_SOTTOSCRIZIONI_PER_UTENTE} dispositivi per utente: restano i piu recenti`, async () => {
      const a = await azienda()
      const s = servizio()
      const tutti: string[] = []
      for (let i = 0; i < MAX_SOTTOSCRIZIONI_PER_UTENTE + 2; i++) {
        const e = ep(`d${i}`)
        tutti.push(e)
        await s.sottoscrivi(a.t, a.utente1, e)
      }
      const rimaste = (await righe(a)).map(r => r.endpoint).sort()
      expect(rimaste).toHaveLength(MAX_SOTTOSCRIZIONI_PER_UTENTE)
      expect(rimaste).toEqual(tutti.slice(2).sort())
    })

    it('annulla toglie solo il dispositivo dell utente: non quello di un collega, ne altre aziende', async () => {
      const a = await azienda()
      const b = await azienda()
      const s = servizio()
      const mio = ep('mio')
      const altro = ep('altro')
      await s.sottoscrivi(a.t, a.utente1, mio)
      await s.sottoscrivi(a.t, a.utente2, altro)
      await s.annulla(a.t, a.utente1, altro) // non e suo
      expect(await righe(a)).toHaveLength(2)
      await s.annulla(b.t, b.utente1, mio) // altra azienda: RLS
      expect(await righe(a)).toHaveLength(2)
      await s.annulla(a.t, a.utente1, mio)
      await s.annulla(a.t, a.utente1, mio) // idempotente
      expect((await righe(a)).map(r => r.endpoint)).toEqual([altro])
    })

    it('RLS: senza contesto azienda il ruolo applicativo non vede ne scrive; con l azienda sbagliata non vede', async () => {
      const a = await azienda()
      const b = await azienda()
      await servizio().sottoscrivi(a.t, a.utente1, ep('rls'))
      expect(await app.sottoscrizionePush.count()).toBe(0)
      expect(await nelTenant(b.t, () => app.sottoscrizionePush.count())).toBe(0)
      expect(await nelTenant(a.t, () => app.sottoscrizionePush.count())).toBe(1)
      await expect(
        nelTenant(b.t, () =>
          app.$executeRawUnsafe(
            `INSERT INTO sottoscrizioni_push (tenant_id, utente_id, endpoint) VALUES ('${a.t}', '${a.utente1}', 'https://fcm.googleapis.com/fcm/send/intruso-123456')`
          )
        )
      ).rejects.toThrow()
    })

    it('la chiave esterna composta rifiuta un utente di un altra azienda', async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(servizio().sottoscrivi(a.t, b.utente1, ep('x'))).rejects.toThrow()
      expect(await righe(a)).toHaveLength(0)
    })

    it('CHECK: solo https e lunghezza ragionevole (anche per il proprietario)', async () => {
      const a = await azienda()
      await expect(
        owner.sottoscrizionePush.create({
          data: {
            tenantId: a.t,
            utenteId: a.utente1,
            endpoint: 'http://x.example/abcdefghijklmnop',
          },
        })
      ).rejects.toThrow()
      await expect(
        owner.sottoscrizionePush.create({
          data: { tenantId: a.t, utenteId: a.utente1, endpoint: 'https://x/' + 'a'.repeat(2100) },
        })
      ).rejects.toThrow()
    })
  })

  describe('preferenze', () => {
    it('predefinito acceso; si spegne e si riaccende per utente, senza toccare gli altri', async () => {
      const a = await azienda()
      const s = servizio()
      expect(await s.preferenze(a.t, a.utente1)).toEqual({ giroModificato: true })
      expect(await s.impostaPreferenze(a.t, a.utente1, { giroModificato: false })).toEqual({
        giroModificato: false,
      })
      expect(await s.preferenze(a.t, a.utente1)).toEqual({ giroModificato: false })
      expect(await s.preferenze(a.t, a.utente2)).toEqual({ giroModificato: true })
      await s.impostaPreferenze(a.t, a.utente1, { giroModificato: true })
      expect(await s.preferenze(a.t, a.utente1)).toEqual({ giroModificato: true })
    })
  })

  describe('invio', () => {
    it('arriva solo ai dispositivi dell autista interessato, senza payload e con firma VAPID', async () => {
      const a = await azienda()
      const { invio, richieste } = invioFinto()
      const s = servizio(invio)
      const e1 = ep('a1')
      const e1b = ep('a1b')
      const e2 = ep('a2')
      await s.sottoscrivi(a.t, a.utente1, e1)
      await s.sottoscrivi(a.t, a.utente1, e1b)
      await s.sottoscrivi(a.t, a.utente2, e2)
      const esito = await s.notificaGiroModificato(a.t, [a.autista1, a.autista1])
      expect(esito).toEqual({ inviate: 2, rimosse: 0, fallite: 0 })
      expect(richieste.map(r => r.endpoint).sort()).toEqual([e1, e1b].sort())
      for (const r of richieste) {
        expect(Object.keys(r).sort()).toEqual(['authorization', 'endpoint', 'ttl'])
        expect(r.authorization).toMatch(/^vapid t=.+, k=.+$/)
        expect(JSON.stringify(r)).not.toContain(a.autista1)
        expect(JSON.stringify(r)).not.toContain(a.utente1)
        expect(JSON.stringify(r)).not.toContain(a.t)
      }
      const dopo = await righe(a)
      expect(dopo.filter(r => r.ultimoInvioIl !== null)).toHaveLength(2)
    })

    it('rispetta la preferenza spenta e un autista senza dispositivi', async () => {
      const a = await azienda()
      const { invio, richieste } = invioFinto()
      const s = servizio(invio)
      await s.sottoscrivi(a.t, a.utente1, ep('p1'))
      await s.sottoscrivi(a.t, a.utente2, ep('p2'))
      await s.impostaPreferenze(a.t, a.utente1, { giroModificato: false })
      const esito = await s.notificaGiroModificato(a.t, [a.autista1, a.autista2])
      expect(esito.inviate).toBe(1)
      expect(richieste).toHaveLength(1)
      expect(await s.notificaGiroModificato(a.t, [])).toEqual({
        inviate: 0,
        rimosse: 0,
        fallite: 0,
      })
    })

    it('non invia a un autista disattivato ne a uno senza utente collegato', async () => {
      const a = await azienda()
      const { invio, richieste } = invioFinto()
      const s = servizio(invio)
      await s.sottoscrivi(a.t, a.utente1, ep('dis'))
      await owner.autista.update({ where: { id: a.autista1 }, data: { attivo: false } })
      const senza = await owner.autista.create({
        data: { tenantId: a.t, nome: 'Senza', cognome: 'Utente', creatoDa: a.admin },
      })
      await s.notificaGiroModificato(a.t, [a.autista1, senza.id])
      expect(richieste).toHaveLength(0)
    })

    it('mai verso dispositivi di un altra azienda, anche passando gli id autista di quella', async () => {
      const a = await azienda()
      const b = await azienda()
      const { invio, richieste } = invioFinto()
      const s = servizio(invio)
      await s.sottoscrivi(b.t, b.utente1, ep('b1'))
      await s.notificaGiroModificato(a.t, [b.autista1])
      expect(richieste).toHaveLength(0)
      expect(await s.notificaGiroModificato(b.t, [b.autista1])).toMatchObject({ inviate: 1 })
    })

    it('404 e 410 tolgono la sottoscrizione; 5xx e rete caduta restano e contano come fallite', async () => {
      const a = await azienda()
      const morto = ep('gone')
      const sparito = ep('nf')
      const lento = ep('503')
      const giu = ep('rete')
      const { invio } = invioFinto(e =>
        e === morto ? 410 : e === sparito ? 404 : e === lento ? 503 : new Error('ECONNRESET')
      )
      const s = servizio(invio)
      for (const e of [morto, sparito, lento, giu]) await s.sottoscrivi(a.t, a.utente1, e)
      const esito = await s.notificaGiroModificato(a.t, [a.autista1])
      expect(esito).toEqual({ inviate: 0, rimosse: 2, fallite: 2 })
      expect((await righe(a)).map(r => r.endpoint).sort()).toEqual([lento, giu].sort())
    })

    it('un errore imprevisto non esce mai verso il chiamante', async () => {
      const a = await azienda()
      const s = servizio(invioFinto().invio)
      await s.sottoscrivi(a.t, a.utente1, ep('x'))
      const rotto = new PushCampoService(
        {
          autista: { findMany: () => Promise.reject(new Error('db giu')) },
        } as unknown as PrismaService,
        new ConfigService({
          [ENV_VAPID_PUBLIC_KEY]: chiavi.pubblica,
          [ENV_VAPID_PRIVATE_KEY]: chiavi.privata,
          [ENV_VAPID_SUBJECT]: 'mailto:test@example.test',
        }),
        invioFinto().invio
      )
      await expect(rotto.notificaGiroModificato(a.t, [a.autista1])).resolves.toEqual({
        inviate: 0,
        rimosse: 0,
        fallite: 0,
      })
    })

    it('un endpoint gia in tabella ma non ammesso (inserito dal proprietario) non viene mai chiamato', async () => {
      const a = await azienda()
      const { invio, richieste } = invioFinto()
      await owner.sottoscrizionePush.create({
        data: {
          tenantId: a.t,
          utenteId: a.utente1,
          endpoint: 'https://interno.example.org/hook-123456',
        },
      })
      const esito = await servizio(invio).notificaGiroModificato(a.t, [a.autista1])
      expect(richieste).toHaveLength(0)
      expect(esito.fallite).toBe(1)
    })
  })

  it('cancellare l utente toglie sottoscrizioni e preferenze (cascata)', async () => {
    const a = await azienda()
    const s = servizio()
    await s.sottoscrivi(a.t, a.utente2, ep('c'))
    await s.impostaPreferenze(a.t, a.utente2, { giroModificato: false })
    await owner.autista.delete({ where: { id: a.autista2 } }).catch(() => undefined)
    await owner.user.delete({ where: { id: a.utente2 } })
    expect(await owner.sottoscrizionePush.count({ where: { utenteId: a.utente2 } })).toBe(0)
    expect(await owner.preferenzaPush.count({ where: { utenteId: a.utente2 } })).toBe(0)
  })
})
