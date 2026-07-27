import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriCodificheClient } from '../../infrastructure/rentri/codifiche/rentri-codifiche.client'
import { RentriAuthService } from '../../infrastructure/rentri/rentri-auth.service'
import { RentriConfig } from '../../infrastructure/rentri/rentri-config'
import { RentriCodificheSempliciSyncService } from './rentri-codifiche-semplici-sync.service'
import { RentriTerritorialiSyncService } from './rentri-territoriali-sync.service'
/* eslint-disable @typescript-eslint/no-var-requires */
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica REALE (non mockata) di
 * {@link RentriCodificheSempliciSyncService}/{@link RentriTerritorialiSyncService}
 * contro la fake fedele al contratto RENTRI (R4 Task 5) — stesso motivo e
 * stessa impalcatura di `rentri-codifiche.client.oracolo.spec.ts` (Task 1),
 * ma qui a dimostrare che le voci REALI del catalogo (`unita-misura`,
 * `stati-fisici`, `caratteristiche-pericolo`, `attivita-rs`, `province`,
 * `nazioni`, `comuni` — inclusa la fusione comunale del 2014) attraversano
 * correttamente il livello applicativo, non solo il client HTTP.
 *
 * Repository in-memory al posto di Prisma: qui interessa la logica di
 * allineamento contro dati reali dell'ente, non la persistenza (già
 * verificata su Postgres reale in `rentri-codifica-semplice.repository.postgres.spec.ts`
 * e `rentri-territoriale.repository.postgres.spec.ts`).
 */
describe('Sync codifiche/territoriali RENTRI — verifica reale contro la fake (in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  function creaClient(): RentriCodificheClient {
    const cert = creaCertificatoDiTest('operatore-test')

    const config: RentriConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: `-----BEGIN CERTIFICATE-----\n${cert.certificatoBase64Der}\n-----END CERTIFICATE-----`,
      privateKeyPem: cert.chiavePrivataPem,
      algorithm: 'RS256',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }

    const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const metrics: any = { rentriApiErrors: { inc: jest.fn() } }

    const httpService: any = {
      get: (url: string, opts: { headers?: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsed = new URL(url)
          const path = parsed.pathname + parsed.search
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RentriCodificheClient(httpService, logger, metrics, config, auth)
  }

  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any
  ): void {
    const risposaAdattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
    if (risposaAdattata.status >= 400) {
      const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
      errore.response = risposaAdattata
      subscriber.error(errore)
      return
    }
    subscriber.next(risposaAdattata)
    subscriber.complete()
  }

  function creaLogger(): any {
    return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }

  /** Repository in-memory minimale, stessa forma di quello usato negli unit test. */
  function creaRepositoryCodifiche() {
    const righe = new Map<string, { externalId: string; name: string; presenteInRentri: boolean }>()
    const chiave = (t: string, c: string) => `${t}::${c}`
    return {
      righe,
      async findByTabellaECode(tabella: string, code: string) {
        const r = righe.get(chiave(tabella, code))
        return r ? { presenteInRentri: r.presenteInRentri } : null
      },
      async upsertFromRentri(data: {
        tabella: string
        code: string
        externalId: string
        name: string
      }) {
        righe.set(chiave(data.tabella, data.code), {
          externalId: data.externalId,
          name: data.name,
          presenteInRentri: true,
        })
      },
      async marcaRimossoSeAttivo(tabella: string, code: string): Promise<boolean> {
        const r = righe.get(chiave(tabella, code))
        if (!r || !r.presenteInRentri) return false
        r.presenteInRentri = false
        return true
      },
      async listTuttiICodici(tabella: string): Promise<string[]> {
        return Array.from(righe.keys())
          .filter(k => k.startsWith(`${tabella}::`))
          .map(k => k.slice(tabella.length + 2))
      },
    }
  }

  function creaRepositoryTerritoriale() {
    const province = new Map<string, any>()
    const comuni = new Map<string, any>()
    const nazioni = new Map<string, any>()
    return {
      province,
      comuni,
      nazioni,
      async findProvincia(id: string) {
        const r = province.get(id)
        return r ? { presenteInRentri: r.presenteInRentri } : null
      },
      async upsertProvincia(data: any) {
        province.set(data.id, { ...data, presenteInRentri: true })
      },
      async marcaProvinciaRimossaSeAttiva(id: string): Promise<boolean> {
        const r = province.get(id)
        if (!r || !r.presenteInRentri) return false
        r.presenteInRentri = false
        return true
      },
      async listTuttiGliIdProvincia(): Promise<string[]> {
        return Array.from(province.keys())
      },
      async findComune(id: string) {
        const r = comuni.get(id)
        return r ? { presenteInRentri: r.presenteInRentri } : null
      },
      async upsertComune(data: any) {
        comuni.set(data.id, { ...data, presenteInRentri: true })
      },
      async marcaComuneRimossoSeAttivo(id: string): Promise<boolean> {
        const r = comuni.get(id)
        if (!r || !r.presenteInRentri) return false
        r.presenteInRentri = false
        return true
      },
      async listTuttiGliIdComune(): Promise<string[]> {
        return Array.from(comuni.keys())
      },
      async findNazione(id: string) {
        const r = nazioni.get(id)
        return r ? { presenteInRentri: r.presenteInRentri } : null
      },
      async upsertNazione(data: any) {
        nazioni.set(data.id, { ...data, presenteInRentri: true })
      },
      async marcaNazioneRimossaSeAttiva(id: string): Promise<boolean> {
        const r = nazioni.get(id)
        if (!r || !r.presenteInRentri) return false
        r.presenteInRentri = false
        return true
      },
      async listTuttiGliIdNazione(): Promise<string[]> {
        return Array.from(nazioni.keys())
      },
    }
  }

  it('RentriCodificheSempliciSyncService: allinea le 4 tabelle reali della fake con i valori ufficiali (unità di misura, stati fisici, HP, R/D)', async () => {
    const client = creaClient()
    const repository = creaRepositoryCodifiche()
    const service = new RentriCodificheSempliciSyncService(client, repository as any, creaLogger())

    const esiti = await service.allinea('')

    expect(esiti.find(e => e.tabella === 'unita-misura')?.nuovi).toBeGreaterThan(0)
    expect(repository.righe.get('unita-misura::Kg')?.name).toBe('Chilogrammi')

    expect(repository.righe.get('stati-fisici::1')?.name).toBe('Solido pulverulento')
    expect(repository.righe.get('caratteristiche-pericolo::HP7')?.name).toBe('Cancerogeno')
    expect(repository.righe.get('attivita-rs::R13')?.name).toContain('Messa in riserva')
  }, 15000)

  it('RentriTerritorialiSyncService: il comune soppresso/accorpato reale della fake (San Piero a Sieve) viene registrato con attivo=false, nuovo-id e provincia derivata correttamente', async () => {
    const client = creaClient()
    const repository = creaRepositoryTerritoriale()
    const service = new RentriTerritorialiSyncService(client, repository as any, creaLogger())

    await service.allinea('')

    const soppresso = repository.comuni.get('048033')
    expect(soppresso).toBeDefined()
    expect(soppresso.attivo).toBe(false)
    expect(soppresso.nuovoId).toBe('048038')
    expect(soppresso.provinciaId).toBe('048') // derivato dal codice ISTAT del comune stesso

    const province = repository.province.get('048')
    expect(province).toBeDefined()
    expect(province.name).toBe('Firenze')

    const italia = repository.nazioni.get('IT')
    expect(italia).toBeDefined()
    expect(italia.name).toBe('Italia')
  }, 15000)
})
