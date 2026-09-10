import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { corpoFormularioValido } from './mappatura/aiuti-test'
import { RentriAuthService } from '../../infrastructure/rentri/rentri-auth.service'
import { RentriConfig } from '../../infrastructure/rentri/rentri-config'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import {
  IFIRRepository,
  FIRSearchFilters,
} from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { RilasciaFormularioRENTRIUseCase } from './rilascia-formulario-rentri.use-case'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

const NUM_ISCR_SITO_VALIDO = 'OP1234ABC123456-RM1234'
const TENANT_ID = 'tenant-r2-t9'

/**
 * R2 Task 9 (ultimo task del piano): verifica end-to-end del ciclo di
 * aggancio contro l'oracolo (`tools/rentri-fake`) — non un mock scritto
 * dallo stesso autore del codice sotto test.
 *
 * Due livelli, come richiesto dal brief:
 * 1. Scenario obbligatorio a livello di CLIENT HTTP (`RENTRIApiClient` reale
 *    via `app.inject()`, stesso bootstrap di
 *    `rentri-api.client.ricerca-aggancio.oracolo.spec.ts`): cerca → acquisisci
 *    → riverifica lo stato → rilascia.
 * 2. Un livello più in alto: gli USE CASE applicativi reali
 *    (`AcquisisciFormularioRENTRIUseCase`/`RilasciaFormularioRENTRIUseCase`)
 *    con un repository FIR in-memory che tiene un vero aggregate `FIR`
 *    (`FIR.create()`, non un doppio con metodi stubbati) — così il vincolo di
 *    non-doppio-aggancio e le transizioni `agganciaManualmente`/
 *    `rilasciaLegameRENTRI` sono ESERCITATE per davvero, non solo assunte.
 *    Scelta esplicita di scope: solo il ramo COLLEGA_ESISTENTE è coperto a
 *    questo livello (non il ramo NUOVO, che dipende da
 *    `CreaFIRDaFormularioRENTRIPort` — la creazione di un FIR completo da un
 *    dettaglio RENTRI — già coperta dai suoi `.spec.ts` unitari dedicati in
 *    questa stessa cartella; cablarla di nuovo qui contro l'oracolo avrebbe
 *    aggiunto un aggregate FIR completo di produttore/trasportatore/
 *    destinatario senza verificare nulla di nuovo sul confine con RENTRI).
 */
describe('Ciclo completo aggancio formulari RENTRI contro la fake (in-process)', () => {
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

  function creaClient(): RENTRIApiClient {
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
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'GET',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /** Replica la semantica reale di axios: status >= 400 fa fallire l'observable con `error.response`. */
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

  /** Stesso pattern di `creaFormularioReale` in `rentri-api.client.ricerca-aggancio.oracolo.spec.ts`. */
  async function creaFormularioReale(
    client: RENTRIApiClient,
    identificativoSoggetto: string,
    numeroFir: string
  ): Promise<string> {
    // Il soggetto per cui il formulario sara' cercabile non e' piu' un campo
    // inventato alla radice: la fake lo ricava da `dati_partenza`, come fa
    // l'ente vero. Qui si mette quindi nel codice fiscale del produttore.
    const corpo = corpoFormularioValido()
    const partenza = corpo.dati_partenza as Record<string, unknown>
    // Il produttore in variante COMPLETA (denominazione + codice fiscale +
    // indirizzo): e' da li' che la fake ricava il soggetto per cui il
    // formulario sara' cercabile.
    partenza.produttore = {
      denominazione: 'Produttore di prova SRL',
      codice_fiscale: identificativoSoggetto,
      indirizzo: {
        citta: { comune_id: '063049' },
        indirizzo: 'Via Roma',
        civico: '1',
        cap: '80100',
      },
    }

    const { transazioneId } = await client.creaFormulario('', corpo)

    const completamento = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
        esito: { numero_fir: numeroFir },
      },
    })
    expect(completamento.statusCode).toBe(200)

    return numeroFir
  }

  // --- Livello 1 (obbligatorio) — solo client HTTP contro la fake ---

  describe('livello client — cerca, acquisisci, riverifica, rilascia', () => {
    it('il ciclo intero regge: la seconda ricerca riflette davvero il cambio di stato dopo acquisisciVisibilita', async () => {
      const client = creaClient()
      const cf = 'MNZGZN78A01F839X'
      const numeroFir = await creaFormularioReale(client, cf, 'BCDFGH00030ZZ')

      // 1. Cercare per CF (tenant "destinatario") — il formulario è visibile
      // ma la visibilità non è ancora acquisita da nessuna sede.
      const primaRicerca = await client.cercaFormulari('', { identificativoSoggetto: cf })
      expect(primaRicerca.risultati).toEqual([
        expect.objectContaining({ numero_fir: numeroFir, visibilita_sito_acquisita: false }),
      ])

      // 2. Acquisire la visibilità.
      await expect(
        client.acquisisciVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
      ).resolves.toBeUndefined()

      // 3. Riverificare con una SECONDA ricerca: asserzione PIENA, non
      // addolcita — se questo giro d'esecuzione mostrasse
      // `visibilita_sito_acquisita: false`, il test deve fallire, non
      // aggirare il problema (v. nota del brief Task 9, Passo 2 punto 4).
      const secondaRicerca = await client.cercaFormulari('', { identificativoSoggetto: cf })
      expect(secondaRicerca.risultati).toEqual([
        expect.objectContaining({ numero_fir: numeroFir, visibilita_sito_acquisita: true }),
      ])

      // 4. Rilasciare: il ciclo si chiude senza errore.
      await expect(
        client.rilasciaVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
      ).resolves.toBeUndefined()
    })
  })

  // --- Livello 2 — use case applicativi reali + aggregate FIR reale ---

  /**
   * Repository in-memory REALE (non uno stub con metodi jest.fn()): tiene
   * gli aggregate `FIR` costruiti da `FIR.create()` in una Map e applica
   * `findByRentriNumeroFir` scansionando lo stato vero dell'aggregate
   * (`fir.rentriNumeroFir`), esattamente come farebbe una query SQL sulla
   * colonna. Se il vincolo di non-doppio-aggancio nell'use case non
   * chiamasse davvero questo metodo, o l'aggregate non aggiornasse davvero
   * il campo in `agganciaManualmente`, questo repository lo scoprirebbe.
   */
  class InMemoryFIRRepository implements IFIRRepository {
    private readonly store = new Map<string, FIR>()

    seed(fir: FIR): void {
      this.store.set(fir.id, fir)
    }

    async findById(id: string): Promise<FIR | null> {
      return this.store.get(id) ?? null
    }

    async findByIdPublic(id: string): Promise<FIR | null> {
      return this.findById(id)
    }

    async findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null> {
      for (const fir of this.store.values()) {
        if (fir.numeroProgressivo === numeroProgressivo) return fir
      }
      return null
    }

    async findByTenant(tenantId: string, _filters?: FIRSearchFilters): Promise<FIR[]> {
      return [...this.store.values()].filter(f => f.tenantId === tenantId)
    }

    async findByIds(ids: string[], tenantId: string): Promise<FIR[]> {
      return [...this.store.values()].filter(f => ids.includes(f.id) && f.tenantId === tenantId)
    }

    /** Il metodo su cui poggia davvero il vincolo di non-doppio-aggancio dell'use case. */
    async findByRentriNumeroFir(tenantId: string, numeroFir: string): Promise<FIR | null> {
      for (const fir of this.store.values()) {
        if (fir.tenantId === tenantId && fir.rentriNumeroFir === numeroFir) return fir
      }
      return null
    }

    async findByStato(): Promise<FIR[]> {
      return []
    }

    async save(fir: FIR): Promise<void> {
      this.store.set(fir.id, fir)
    }

    async delete(id: string): Promise<void> {
      this.store.delete(id)
    }

    async existsNumeroProgressivo(): Promise<boolean> {
      return false
    }

    async generateNumeroProgressivo(): Promise<string> {
      return 'N/D'
    }

    async count(): Promise<number> {
      return this.store.size
    }
  }

  function fakeLogger() {
    return {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
  }

  function fakePrisma() {
    return { activityLog: { create: jest.fn().mockResolvedValue(undefined) } }
  }

  function creaFirLocaleDiTest(): FIR {
    return FIR.create({
      produttoreId: 'produttore-1',
      rifiuto: { cerCode: '150101', quantita: 10 },
      trasportatoreId: 'trasportatore-1',
      destinatarioId: 'destinatario-1',
      tenantId: TENANT_ID,
      creatoDaUserId: 'user-1',
    })
  }

  describe('livello use case — AcquisisciFormularioRENTRIUseCase/RilasciaFormularioRENTRIUseCase reali contro la fake', () => {
    it(
      'COLLEGA_ESISTENTE aggancia un FIR locale reale, il vincolo di non-doppio-aggancio rifiuta un secondo tentativo, ' +
        "il rilascio scioglie davvero il legame sull'aggregate",
      async () => {
        const client = creaClient()
        const cf = 'RSSMRA80A01H501U'
        const numeroFir = await creaFormularioReale(client, cf, 'BCDFGH00040ZZ')

        const repository = new InMemoryFIRRepository()
        const firLocale = creaFirLocaleDiTest()
        repository.seed(firLocale)

        const prisma = fakePrisma()
        const logger = fakeLogger()
        const creaFirPortNonUsata = { creaDaDettaglio: jest.fn() }

        const acquisisci = new AcquisisciFormularioRENTRIUseCase(
          repository,
          client,
          prisma as any,
          creaFirPortNonUsata,
          logger as any
        )
        const rilascia = new RilasciaFormularioRENTRIUseCase(
          repository,
          client,
          prisma as any,
          logger as any
        )

        // Cerca (client reale) per ottenere visibilitaGiaAcquisita=false, come
        // farebbe CercaFormulariRENTRIUseCase.
        const ricerca = await client.cercaFormulari('', { identificativoSoggetto: cf })
        expect(ricerca.risultati[0]).toMatchObject({
          numero_fir: numeroFir,
          visibilita_sito_acquisita: false,
        })

        // Aggancia: l'use case chiama acquisisciVisibilita sulla fake, poi
        // agganciaManualmente sull'aggregate REALE, poi salva.
        const esito = await acquisisci.execute({
          tenantId: TENANT_ID,
          userId: 'user-1',
          userRole: 'OPERATOR',
          numeroFir,
          numIscrSito: NUM_ISCR_SITO_VALIDO,
          visibilitaGiaAcquisita: false,
          scelta: { tipo: 'COLLEGA_ESISTENTE', firId: firLocale.id },
          correlationId: 'corr-t9',
        })
        expect(esito).toEqual({ firId: firLocale.id, numeroFir })

        // L'aggregate REALE ora porta il legame (non un mock che lo
        // "afferma": è lo stesso oggetto restituito da FIR.create/getter).
        const firRiletto = await repository.findById(firLocale.id)
        expect(firRiletto!.rentriNumeroFir).toBe(numeroFir)

        // Vincolo di non-doppio-aggancio: un secondo FIR locale che prova ad
        // agganciare LO STESSO numero_fir viene rifiutato PRIMA di contattare
        // di nuovo RENTRI (altrimenti la fake risponderebbe comunque, ma la
        // spia sotto dimostra che l'use case non ci arriva nemmeno).
        const secondoFirLocale = creaFirLocaleDiTest()
        repository.seed(secondoFirLocale)
        const spiaAcquisisci = jest.spyOn(client, 'acquisisciVisibilita')
        try {
          await expect(
            acquisisci.execute({
              tenantId: TENANT_ID,
              userId: 'user-1',
              userRole: 'OPERATOR',
              numeroFir,
              numIscrSito: NUM_ISCR_SITO_VALIDO,
              visibilitaGiaAcquisita: false,
              scelta: { tipo: 'COLLEGA_ESISTENTE', firId: secondoFirLocale.id },
              correlationId: 'corr-t9-doppio',
            })
          ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })
          expect(spiaAcquisisci).not.toHaveBeenCalled()
        } finally {
          spiaAcquisisci.mockRestore()
        }

        // Rilascia: la fake riceve rilasciaVisibilita, poi l'aggregate REALE
        // perde il legame (rilasciaLegameRENTRI), non solo l'use case che lo
        // "dice".
        const esitoRilascio = await rilascia.execute({
          tenantId: TENANT_ID,
          userId: 'user-1',
          userRole: 'OPERATOR',
          firId: firLocale.id,
          numIscrSito: NUM_ISCR_SITO_VALIDO,
          correlationId: 'corr-t9-rilascio',
        })
        expect(esitoRilascio).toEqual({ numeroFirRilasciato: numeroFir })

        const firDopoRilascio = await repository.findById(firLocale.id)
        expect(firDopoRilascio!.rentriNumeroFir).toBeNull()

        // Un secondo rilascio sullo stesso FIR (ormai senza legame) fallisce
        // con un errore di dominio leggibile — l'invariante dell'aggregate
        // (`assertNonGiaLegatoRENTRI`/controllo simmetrico in
        // `rilasciaLegameRENTRI`) è quella REALE, non riaffermata da un mock.
        await expect(
          rilascia.execute({
            tenantId: TENANT_ID,
            userId: 'user-1',
            userRole: 'OPERATOR',
            firId: firLocale.id,
            numIscrSito: NUM_ISCR_SITO_VALIDO,
            correlationId: 'corr-t9-rilascio-doppio',
          })
        ).rejects.toThrow(DomainException)
      },
      30000
    )
  })
})
