import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriCodificheClient } from '../../infrastructure/rentri/codifiche/rentri-codifiche.client'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { RentriAuthService } from '../../infrastructure/rentri/rentri-auth.service'
import { RentriCredentialResolver } from '../../infrastructure/rentri/rentri-credential.resolver'
import { RentriConfig } from '../../infrastructure/rentri/rentri-config'
import { RentriCerSyncService } from './rentri-cer-sync.service'
import { RentriCodificheSempliciSyncService } from './rentri-codifiche-semplici-sync.service'
import { RentriTerritorialiSyncService } from './rentri-territoriali-sync.service'
import { RentriCodificheSyncService } from './rentri-codifiche-sync.service'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'
import {
  ICERRepository,
  CERSearchFilters,
} from '../../domain/cer/repositories/cer-repository.interface'
/* eslint-disable @typescript-eslint/no-var-requires */
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica end-to-end (R4 Task 8, Step 2) del ciclo COMPLETO di allineamento
 * codifiche/CER contro l'oracolo (`tools/rentri-fake`), a differenza di
 * `rentri-codifiche-sync.oracolo.spec.ts` (Task 5, che copre solo
 * codifiche-semplici/territoriali) e di `rentri-codifiche.client.oracolo.spec.ts`
 * (Task 1, solo il client HTTP): qui l'obiettivo è dimostrare tre proprietà
 * che nessuno degli spec esistenti copre insieme:
 *
 * 1. `RentriCodificheSyncService.allineaTutto()` (i tre passi in sequenza,
 *    con la pausa tra un passo e l'altro) contro l'app reale della fake, non
 *    solo repository doppi isolati.
 * 2. La marcatura "non cancella mai" del CER (`RentriCerSyncService`) quando
 *    un codice sparisce dal catalogo restituito dall'ente TRA DUE chiamate
 *    reali — non solo con repository in-memory fittizi che simulano la
 *    sparizione lato test, ma con la fake stessa che smette di restituire il
 *    codice (canale di controllo `/__controllo/rimuovi-codice-eer`, aggiunto
 *    in questo task: v. `tools/rentri-fake/src/stato/archivio.ts`).
 * 3. Un 423 PERSISTENTE (oltre il budget di resilienza del client) blocca il
 *    passo CER in modo DEFINITIVO, senza che l'orchestratore aggiunga
 *    ritentativi propri — v. commento del terzo `it` per la distinzione
 *    rispetto al 423 isolato (già verificato altrove: ritenta e riesce).
 */
describe('Ciclo di allineamento codifiche+CER — verifica reale contro la fake (in-process, R4 Task 8)', () => {
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
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
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

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({ method: 'POST', url: '/__controllo/guasto', payload: { stato, volte } })
  }

  function rimuoviCodiceEer(code: string): Promise<any> {
    return app.inject({ method: 'POST', url: '/__controllo/rimuovi-codice-eer', payload: { code } })
  }

  /**
   * Repository CER in-memory minimale (stessa forma dei repository doppi già
   * usati altrove per i test contro l'oracolo): implementa `ICERRepository`
   * per intero, ma solo i metodi usati da `RentriCerSyncService` +
   * `exists`/`isUtilizzabilePerNuovoFormulario` (verificati dal test) hanno
   * comportamento non banale.
   */
  function creaRepositoryCer(): ICERRepository & { righe: Map<string, CERCode> } {
    const righe = new Map<string, CERCode>()
    return {
      righe,
      async findByCode(code: string) {
        return righe.get(code) ?? null
      },
      async findById() {
        return null
      },
      async search(_keyword: string, _filters?: CERSearchFilters) {
        return []
      },
      async findByCategory() {
        return []
      },
      async findAllPericolosi() {
        return []
      },
      async findPaginated() {
        return { items: [], total: 0 }
      },
      async save() {},
      async saveMany() {},
      async count() {
        return righe.size
      },
      async exists(code: string) {
        return righe.has(code)
      },
      async isUtilizzabilePerNuovoFormulario(code: string) {
        const riga = righe.get(code)
        return !!riga && riga.presenteInRentri
      },
      async upsertFromRentri(data: { code: string; description: string; isPericoloso: boolean }) {
        const esistente = righe.get(data.code)
        righe.set(
          data.code,
          CERCode.reconstitute({
            id: esistente?.id ?? data.code,
            code: data.code,
            description: data.description,
            isPericoloso: data.isPericoloso,
            category: esistente?.category ?? data.code.slice(0, 2),
            subcategory: esistente?.subcategory ?? undefined,
            createdAt: esistente?.createdAt ?? new Date(),
            updatedAt: new Date(),
            presenteInRentri: true,
            rimossoDaRentriAl: null,
            fonte: 'rentri',
          })
        )
      },
      async marcaRimossoDaRentriSeAttivo(code: string, rimossoAl: Date) {
        const riga = righe.get(code)
        if (!riga || !riga.presenteInRentri) return false
        righe.set(
          code,
          CERCode.reconstitute({
            id: riga.id,
            code: riga.code,
            description: riga.description,
            isPericoloso: riga.isPericoloso,
            category: riga.category,
            subcategory: riga.subcategory ?? undefined,
            createdAt: riga.createdAt,
            updatedAt: new Date(),
            presenteInRentri: false,
            rimossoDaRentriAl: rimossoAl,
            fonte: riga.fonte,
          })
        )
        return true
      },
      async listTuttiICodici() {
        return Array.from(righe.keys())
      },
    }
  }

  /** Repository doppi minimi per codifiche-semplici/territoriali — stessa forma di `rentri-codifiche-sync.oracolo.spec.ts`. */
  function creaRepositoryCodificheSemplici() {
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

  it('allineaTutto: ciclo completo (CER + codifiche semplici + territoriali) in sequenza contro la fake, esito registrato per tutti e tre i passi', async () => {
    const client = creaClient()
    const cerRepository = creaRepositoryCer()
    const cerSync = new RentriCerSyncService(client, cerRepository, creaLogger())
    const codificheSempliciSync = new RentriCodificheSempliciSyncService(
      client,
      creaRepositoryCodificheSemplici() as any,
      creaLogger()
    )
    const territorialiSync = new RentriTerritorialiSyncService(
      client,
      creaRepositoryTerritoriale() as any,
      creaLogger()
    )
    const orchestratore = new RentriCodificheSyncService(
      cerSync,
      codificheSempliciSync,
      territorialiSync,
      creaLogger()
    )

    await orchestratore.allineaTutto('')

    const esito = orchestratore.ottieniUltimoEsito()
    expect(esito).not.toBeNull()
    expect(esito?.cer?.nuovi).toBeGreaterThan(0)
    expect(esito?.codificheSemplici?.length).toBeGreaterThan(0)
    expect(esito?.territoriali?.length).toBeGreaterThan(0)

    // I 5 codici CER reali della fixture sono stati tutti recepiti.
    expect(cerRepository.righe.size).toBe(5)
    expect(cerRepository.righe.get('13 02 08*')?.isPericoloso).toBe(true)
    expect(cerRepository.righe.get('15 01 01')?.isPericoloso).toBe(false)
  }, 20000)

  it("RentriCerSyncService.allinea: un codice che l'ente smette di restituire tra due cicli viene MARCATO, mai cancellato — resta valido per lo storico, non più proponibile per un FIR nuovo", async () => {
    const client = creaClient()
    const cerRepository = creaRepositoryCer()
    const service = new RentriCerSyncService(client, cerRepository, creaLogger())

    // Primo giro: il codice non pericoloso "15 01 01" (150101 nella fixture) è confermato.
    const primoEsito = await service.allinea('')
    expect(primoEsito.nuovi).toBe(5)
    expect(await cerRepository.exists('15 01 01')).toBe(true)
    expect(await cerRepository.isUtilizzabilePerNuovoFormulario('15 01 01')).toBe(true)

    // L'ente smette di restituire il codice (fake pilotata dal canale di controllo).
    const rispostaRimozione = await rimuoviCodiceEer('150101')
    expect(rispostaRimozione.json().rimosso).toBe(true)

    // Secondo giro contro la STESSA istanza della fake.
    const secondoEsito = await service.allinea('')
    expect(secondoEsito.rimossi).toBe(1)

    // (a) Il FIR storico resta valido: il codice esiste ancora nel catalogo.
    expect(await cerRepository.exists('15 01 01')).toBe(true)
    // (b) Marcato non più confermato dall'ente.
    const riga = await cerRepository.findByCode('15 01 01')
    expect(riga?.presenteInRentri).toBe(false)
    expect(riga?.rimossoDaRentriAl).not.toBeNull()
    // (c) Non più proponibile per un FIR NUOVO.
    expect(await cerRepository.isUtilizzabilePerNuovoFormulario('15 01 01')).toBe(false)

    // Nessuna cancellazione: il conteggio totale dei codici in catalogo resta 5.
    expect(cerRepository.righe.size).toBe(5)
  }, 20000)

  it("423 PERSISTENTE (oltre il budget di resilienza): il passo CER fallisce in modo DEFINITIVO dopo esattamente MAX_TENTATIVI_RESILIENZA (5) chiamate reali, e l'orchestratore non aggiunge ritentativi propri", async () => {
    // Nota di distinzione (v. commento di testata della classe e la
    // decisione di questo task): un 423 ISOLATO (volte:1) è già verificato
    // altrove (`rentri-codifiche.client.oracolo.spec.ts`) — il client
    // ritenta con backoff e alla fine RIESCE: quel comportamento (423 =
    // errore transitorio, non "mai ritentare" come il 403) è politica
    // voluta, invariata, e non è oggetto di questo test.
    //
    // Qui iniettiamo un 423 che dura QUANTO il budget di ritentativi del
    // client (`RentriCodificheClient.MAX_TENTATIVI_RESILIENZA = 5`): tutte
    // e 5 le chiamate reali del client falliscono con 423, il client si
    // arrende (non ha più tentativi) e il guasto — condiviso da TUTTA la
    // fake, non scoped per tabella — risulta naturalmente esaurito subito
    // dopo (v. seconda parte del test). Dimostra che, esaurito quel budget
    // GIÀ NOTO, il fallimento propaga come DEFINITIVO — nessun livello
    // sopra il client (né `RentriCerSyncService`, né l'orchestratore
    // `RentriCodificheSyncService`) aggiunge un solo ritentativo in più.
    // "Insistere peggiora la situazione": un chiamante che continuasse a
    // ritentare dopo un 423 persistente sarebbe esattamente l'automazione
    // mal tarata che RENTRI banderebbe.
    await impostaGuasto(423, 5)

    const client = creaClient()
    const cerRepository = creaRepositoryCer()
    const cerSync = new RentriCerSyncService(client, cerRepository, creaLogger())

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    let erroreCatturato: unknown
    let sollevato = false
    try {
      await cerSync.allinea('')
    } catch (errore) {
      sollevato = true
      erroreCatturato = errore
    }

    expect(sollevato).toBe(true)
    expect(erroreCatturato).toBeInstanceOf(RentriApiError)
    expect(erroreCatturato).toMatchObject({ status: 423, retryable: true })

    // Esattamente 5 chiamate HTTP reali (il budget del client), non una di più:
    // il passo CER non ha ritentato oltre quanto già fatto dal client.
    expect(spia).toHaveBeenCalledTimes(5)

    // Nessuna riga scritta: il ciclo è fallito prima di qualunque upsert.
    expect(cerRepository.righe.size).toBe(0)

    spia.mockRestore()

    // Verifica anche a livello di orchestratore: il passo CER fallito
    // risulta null in ultimoEsito (eseguiPasso lo cattura e logga, non lo
    // ritenta), e il ciclo prosegue con gli altri passi invece di ripetere
    // il primo. Guasto reimpostato a 5 (esattamente il budget del client):
    // il passo CER lo esaurisce per intero nelle sue 5 chiamate reali,
    // lasciando i passi successivi (codifiche semplici, territoriali)
    // liberi di completarsi senza contaminazione — il guasto è globale
    // alla fake, non scoped per tabella.
    await impostaGuasto(423, 5)
    const codificheSempliciSync = new RentriCodificheSempliciSyncService(
      client,
      creaRepositoryCodificheSemplici() as any,
      creaLogger()
    )
    const territorialiSync = new RentriTerritorialiSyncService(
      client,
      creaRepositoryTerritoriale() as any,
      creaLogger()
    )
    const orchestratore = new RentriCodificheSyncService(
      cerSync,
      codificheSempliciSync,
      territorialiSync,
      creaLogger()
    )

    await orchestratore.allineaTutto('')
    const esito = orchestratore.ottieniUltimoEsito()
    expect(esito?.cer).toBeNull()
    expect(esito?.codificheSemplici?.length).toBeGreaterThan(0)
    expect(esito?.territoriali?.length).toBeGreaterThan(0)
    // Timeout alzato (F4, revisione): due sequenze di backoff reali da ~15s
    // l'una (1+2+4+8s, passo CER isolato + passo CER dentro allineaTutto) più
    // l'overhead delle chiamate reali di codifiche-semplici/territoriali —
    // 60s lasciava un margine troppo stretto su un runner lento.
  }, 120000)
})
