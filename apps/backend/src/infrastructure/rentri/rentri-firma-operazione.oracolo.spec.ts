import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { verificaFirmaLocale } from './rentri-firma-verifica.util'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { intestazioniAutenticate } = require('../../../../../tools/rentri-fake/test/aiuti/token')

/**
 * R3 Task 3 — verifica REALE (non mockata) del ciclo completo di FIRMA
 * REMOTA RENTRI contro la fake (`tools/rentri-fake`), in-process con
 * `creaApp()` + `app.inject()` come le altre `*.oracolo.spec.ts`.
 *
 * Il ciclo esercitato per intero:
 * `GET /ca-rentri/.../credentials/info` → `POST /{numero_fir}/hash` (202 +
 * NONBLOCK_PULL) → `POST /credentials/authorize` → polling
 * `authorize-check` (202 → 200, con la conferma dell'utente simulata dal
 * canale di controllo a metà polling) → `POST /signatures/sign-hash` →
 * `POST /{numero_fir}/acquisizione-firma` (202 + NONBLOCK_PULL) →
 * rilettura di `/stato` → `FIR.applyRentriStato`.
 *
 * **Limite dichiarato di questa suite** (stessa onestà di
 * `docs/contracts/rentri/FEDELTA.md`): il servizio `ca-rentri` non ha alcun
 * contratto OpenAPI pubblico, quindi la fake ne è una RICOSTRUZIONE da fonti
 * secondarie (v. il commento di testata di `tools/rentri-fake/src/routes/ca-rentri.ts`).
 * Questi test dimostrano che il nostro client percorre correttamente il ciclo
 * come lo abbiamo ricostruito; NON che quel ciclo coincida con quello
 * dell'ente reale.
 */
describe('CompletaOperazioneConFirmaUseCase — ciclo di firma remota contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-firma')

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
    const logger = creaLogger()
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    const httpService: any = {
      post: (
        url: string,
        body: unknown,
        opts: { headers: Record<string, string>; validateStatus?: (status: number) => boolean }
      ) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'POST',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
              payload: body as any,
            })
            .then((risposta: any) => emetti(subscriber, risposta, opts))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string>; validateStatus?: any }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'GET',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => emetti(subscriber, risposta, opts))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /**
   * Replica la semantica di axios, `validateStatus` incluso: quando il
   * chiamante lo passa permissivo (come fa `verificaAutorizzazioneFirma` per
   * poter LEGGERE il 202 invece di riceverlo come eccezione), nessuno status
   * fa fallire l'observable. Senza questa fedeltà il test non
   * eserciterebbe il ramo reale del polling.
   */
  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any,
    opts?: { validateStatus?: (status: number) => boolean }
  ): void {
    const risposaAdattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }

    const accettabile = opts?.validateStatus
      ? opts.validateStatus(risposaAdattata.status)
      : risposaAdattata.status < 400

    if (!accettabile) {
      const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
      errore.response = risposaAdattata
      subscriber.error(errore)
      return
    }
    subscriber.next(risposaAdattata)
    subscriber.complete()
  }

  function creaLogger(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  function seminaFormulario(numeroFir: string, stato: string): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: numeroFir,
        stato,
        produttore: 'Produttore di prova SRL',
        identificativo_soggetto: 'RSSMRA80A01H501U',
      },
    })
  }

  class FIRRepositoryFake {
    private readonly memoria = new Map<string, FIR>()
    async findById(id: string): Promise<FIR | null> {
      return this.memoria.get(id) ?? null
    }
    async save(fir: FIR): Promise<void> {
      this.memoria.set(fir.id, fir)
    }
  }

  function creaFIRLegato(tenantId: string, numeroFir: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-oracolo-firma',
      trasportatoreId: 'trasportatore-oracolo-firma',
      destinatarioId: 'destinatario-oracolo-firma',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 30 },
    })
    fir.emetti('FIR-ORACOLO-FIRMA-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  /**
   * Rate limiter finto: questa suite esercita il ciclo HTTP contro la fake,
   * non Redis (il limitatore reale ha una suite dedicata, `test:redis`).
   * Conta però acquisizioni e rilasci, perché la loro parità è una proprietà
   * dello use case e va verificata anche qui.
   */
  function creaRateLimiter() {
    const rilascia = jest.fn().mockResolvedValue(undefined)
    const acquisisci = jest.fn().mockResolvedValue({ rilascia })
    return { acquisisci, rilascia, servizio: { acquisisci } as any }
  }

  function creaUseCase(
    firRepository: FIRRepositoryFake,
    client: RENTRIApiClient,
    credentialsId: string | null,
    rateLimiter: { servizio: any }
  ): CompletaOperazioneConFirmaUseCase {
    const credentialService = {
      getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue(credentialsId),
    }
    return new CompletaOperazioneConFirmaUseCase(
      firRepository as any,
      credentialService as any,
      client,
      rateLimiter.servizio,
      creaLogger()
    )
  }

  /**
   * La fake NON completa da sola le transazioni NONBLOCK_PULL (scelta
   * deliberata: è il test a decidere l'esito di una scrittura). Questo
   * osservatore le completa appena compaiono, così il ciclo può proseguire
   * senza che il test conosca in anticipo gli id generati.
   *
   * `esitoPerTipo` permette di far rispondere `/hash` con i dati per la
   * firma e `/acquisizione-firma` con un esito (positivo o negativo).
   */
  function avviaCompletatoreTransazioni(opzioni: {
    digestToSign: string
    token: string
    acquisizioneInErrore?: boolean
  }): { ferma: () => void } {
    let attivo = true
    const gestite = new Set<string>()

    const giro = async (): Promise<void> => {
      while (attivo) {
        // L'ordine di creazione distingue le due transazioni: la prima è
        // quella di /hash, la seconda quella di /acquisizione-firma. La fake
        // non espone il tipo di operazione di una transazione, quindi si
        // usa la posizione — sufficiente perché questo ciclo ne crea
        // esattamente due, in quest'ordine.
        for (const id of await elencaTransazioniAperte()) {
          if (gestite.has(id)) continue
          gestite.add(id)
          const primo = gestite.size === 1
          await app.inject({
            method: 'POST',
            url: '/__controllo/completa-transazione',
            payload: primo
              ? {
                  transazione_id: id,
                  errore: false,
                  esito: {
                    hash_algorithm: '2.16.840.1.101.3.4.2.1',
                    digest_to_sign: opzioni.digestToSign,
                    token: opzioni.token,
                    versione: 1,
                  },
                }
              : {
                  transazione_id: id,
                  errore: opzioni.acquisizioneInErrore ?? false,
                  validazione: opzioni.acquisizioneInErrore
                    ? [{ tipo: 'Errore', codice_messaggio: 'FIR-999' }]
                    : [],
                  esito: {},
                },
          })
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }

    void giro()
    return {
      ferma: () => {
        attivo = false
      },
    }
  }

  /**
   * La fake non offre un elenco delle transazioni: si intercettano gli id
   * osservando le risposte 202. Più semplice e robusto: si tiene traccia
   * degli id man mano che il client li crea, spiando le POST via l'archivio
   * decorato sull'app.
   */
  async function elencaTransazioniAperte(): Promise<string[]> {
    const archivio: any = app.archivio
    // `transazioni` è privato: vi si accede deliberatamente SOLO dal test,
    // per evitare di aggiungere alla fake un endpoint di elenco che l'ente
    // non ha (aggiungerlo la renderebbe meno fedele per comodità nostra).
    const mappa: Map<string, any> = archivio.transazioni
    return [...mappa.values()].filter(t => t.stato === 'in_elaborazione').map(t => t.id)
  }

  const DIGEST = Buffer.from('digest-oracolo-firma').toString('base64')
  const TOKEN = 'token-oracolo-firma'

  it('ciclo completo: 202→200 con conferma a metà polling → esito positivo e stato riletto dall’ente', async () => {
    const tenantId = 'tenant-oracolo-firma-1'
    const numeroFir = 'BCDFGH00010ZM'
    await seminaFormulario(numeroFir, 'FirmaAccettazione')

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(firRepository, client, 'cred-oracolo-1', rateLimiter)

    const completatore = avviaCompletatoreTransazioni({ digestToSign: DIGEST, token: TOKEN })

    // Simula l'utente che conferma sul proprio dispositivo A METÀ polling.
    // La conferma è agganciata al PRIMO 202 realmente osservato, non a un
    // timer: così il test garantisce che il ramo «non ancora confermato»
    // venga davvero attraversato invece di dipendere da una corsa fra
    // orologi (che renderebbe verde anche un ciclo che salta il 202).
    let confermaEffettuata = false
    const verificaOriginale = client.verificaAutorizzazioneFirma.bind(client)
    jest
      .spyOn(client, 'verificaAutorizzazioneFirma')
      .mockImplementation(async (tenant: string, handle: string) => {
        const esito = await verificaOriginale(tenant, handle)
        if (esito === 'IN_ATTESA' && !confermaEffettuata) {
          confermaEffettuata = true
          await app.inject({
            method: 'POST',
            url: `/__controllo/ca-rentri/autorizza/${handle}`,
          })
        }
        return esito
      })

    try {
      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ACCETTAZIONE',
        intervalloPollingMs: 100,
        attesaMassimaMs: 15000,
      })

      expect(risultato.esito).toBe('COMPLETATA')
      if (risultato.esito === 'COMPLETATA') {
        // Lo stato è quello che la fake ha in archivio, RILETTO da /stato:
        // non un valore dedotto dal tipo di operazione.
        expect(risultato.statoFormulario).toBe('FirmaAccettazione')
      }

      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.rentriStatoFormulario).toBe('FirmaAccettazione')

      // Il ramo 202 è stato realmente attraversato prima del 200.
      expect(confermaEffettuata).toBe(true)
      // Almeno due giri di polling: uno prima della conferma (202), uno dopo (200).
      expect(rateLimiter.acquisisci.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(rateLimiter.rilascia).toHaveBeenCalledTimes(rateLimiter.acquisisci.mock.calls.length)
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('la firma prodotta dalla CA simulata verifica DAVVERO contro il certificato servito da /credentials/info', async () => {
    // Non un dettaglio della fake: dimostra che `verificaFirmaLocale` è
    // cablata su dati reali del ciclo (certificato ottenuto da
    // `/credentials/info`, firma ottenuta da `sign-hash`) e non su materiale
    // costruito ad arte dentro il proprio test.
    const client = creaClient()
    const certificato = await client.leggiCertificatoFirmaRemota('', 'cred-verifica')

    const autorizzazione = await client.autorizzaFirmaRemota('', {
      credentialsId: 'cred-verifica',
      digestToSign: DIGEST,
      description: 'Verifica locale della firma',
    })
    await app.inject({
      method: 'POST',
      url: `/__controllo/ca-rentri/autorizza/${autorizzazione.handle}`,
    })

    const firma = await client.firmaHashRemoto('', {
      credentialsId: 'cred-verifica',
      sad: autorizzazione.sad,
      digestToSign: DIGEST,
    })

    expect(verificaFirmaLocale(certificato, DIGEST, firma)).toBe(true)
    // E la stessa firma NON verifica su un digest diverso.
    expect(
      verificaFirmaLocale(certificato, Buffer.from('altro-digest').toString('base64'), firma)
    ).toBe(false)
  }, 60000)

  it('authorize-check su sessione scaduta: la fake risponde 410 e il client lo mappa a SCADUTA, non a un errore generico', async () => {
    // Livello CLIENT, deterministico: usa `__expires_in_test` della fake per
    // ottenere una scadenza di 50ms invece di attendere il default di 120s.
    // Verifica il finding corretto in questo round: prima, il 410 finiva
    // nella gestione generica degli errori e diventava un `Error` anonimo
    // («Risposta inattesa da ...: HTTP 410»), indistinguibile da un guasto.
    const client = creaClient()

    const risposta = await app.inject({
      method: 'POST',
      url: '/ca-rentri/v1.0/credentials/authorize',
      // `__expires_in_test` è un'affordance della sola fake: il client di
      // produzione non la invia (e non deve), quindi questa singola richiesta
      // si costruisce a mano con l'helper di autenticazione già in dotazione
      // alla fake.
      headers: await intestazioniAutenticate(),
      payload: {
        credentials_id: 'cred-scadenza',
        num_signatures: 1,
        hashes: [DIGEST],
        hash_algo: '2.16.840.1.101.3.4.2.1',
        description: 'Prova di scadenza',
        __expires_in_test: 0.05,
      },
    })
    expect(risposta.statusCode).toBe(200)
    const { handle, expires_in: expiresIn } = risposta.json()
    expect(expiresIn).toBe(0.05)

    // Oltre la scadenza dichiarata dalla fake.
    await new Promise(resolve => setTimeout(resolve, 120))

    expect(await client.verificaAutorizzazioneFirma('', handle)).toBe('SCADUTA')
  }, 60000)

  it('authorize-check su sessione rifiutata dall’utente: 400 mappato a RIFIUTATA, distinto da SCADUTA', async () => {
    const client = creaClient()
    const autorizzazione = await client.autorizzaFirmaRemota('', {
      credentialsId: 'cred-rifiuto',
      digestToSign: DIGEST,
      description: 'Prova di rifiuto',
    })

    await app.inject({
      method: 'POST',
      url: `/__controllo/ca-rentri/rifiuta/${autorizzazione.handle}`,
    })

    expect(await client.verificaAutorizzazioneFirma('', autorizzazione.handle)).toBe('RIFIUTATA')
  }, 60000)

  it('scadenza lato ente durante il ciclo: UN SOLO esito, SCADUTA rilevata dall’ente, nessuna corruzione di stato', async () => {
    const tenantId = 'tenant-oracolo-firma-2'
    const numeroFir = 'BCDFGH00010ZN'
    await seminaFormulario(numeroFir, 'FirmaAccettazione')

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    expect(fir.rentriStatoFormulario).toBeNull()

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(firRepository, client, 'cred-oracolo-2', rateLimiter)
    const saveSpy = jest.spyOn(firRepository, 'save')

    const completatore = avviaCompletatoreTransazioni({ digestToSign: DIGEST, token: TOKEN })

    // Deterministico: la sessione viene fatta scadere SUBITO DOPO che
    // `authorize` l'ha creata e PRIMA che parta il primo `authorize-check`.
    // Il primo controllo trova quindi certamente un 410, e l'esito atteso è
    // uno solo. (La versione precedente di questo test usava un timer e
    // ammetteva tre esiti alternativi: con tre su tre ammessi non verificava
    // nulla, ed è ciò che ha nascosto il difetto del 410.)
    const autorizzaOriginale = client.autorizzaFirmaRemota.bind(client)
    jest.spyOn(client, 'autorizzaFirmaRemota').mockImplementation(async (tenant, richiesta) => {
      const autorizzazione = await autorizzaOriginale(tenant, richiesta)
      await app.inject({
        method: 'POST',
        url: `/__controllo/ca-rentri/scadi/${autorizzazione.handle}`,
      })
      return autorizzazione
    })

    try {
      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ANNULLAMENTO',
        intervalloPollingMs: 100,
        // Tetto di invocazione ampio: se l'esito dipendesse dal nostro
        // orologio invece che dal 410 dell'ente, questo test attenderebbe
        // 15s e riporterebbe `orologio-locale`, fallendo l'asserzione.
        attesaMassimaMs: 15000,
      })

      expect(risultato.esito).toBe('SCADUTA')
      if (risultato.esito === 'SCADUTA') {
        expect(risultato.rilevataDa).toBe('ente')
      }
    } finally {
      completatore.ferma()
    }

    expect(saveSpy).not.toHaveBeenCalled()
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.rentriStatoFormulario).toBeNull()
  }, 60000)

  it('guasto 423 durante il polling: il client ritenta entro i limiti, l’errore propaga, nessuna corruzione di stato', async () => {
    const tenantId = 'tenant-oracolo-firma-3'
    const numeroFir = 'BCDFGH00010ZP'
    await seminaFormulario(numeroFir, 'FirmaAccettazione')

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(firRepository, client, 'cred-oracolo-3', rateLimiter)
    const saveSpy = jest.spyOn(firRepository, 'save')

    const completatore = avviaCompletatoreTransazioni({ digestToSign: DIGEST, token: TOKEN })

    // Guasto 423 permanente (più occorrenze dei tentativi di resilienza del
    // client): l'ente "banna" il chiamante e non smette. Il client deve
    // arrendersi entro MAX_TENTATIVI_RESILIENZA, non ritentare all'infinito.
    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 423, volte: 100 },
    })

    try {
      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoOperazione: 'ACCETTAZIONE',
          intervalloPollingMs: 50,
          attesaMassimaMs: 10000,
        })
      ).rejects.toThrow()
    } finally {
      completatore.ferma()
    }

    // Il punto: un rifiuto dell'ente non produce MAI uno stato locale.
    expect(saveSpy).not.toHaveBeenCalled()
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.rentriStatoFormulario).toBeNull()
  }, 120000)

  it('l’ente rifiuta /acquisizione-firma (esito.errore true) → errore leggibile, nessuno stato applicato', async () => {
    const tenantId = 'tenant-oracolo-firma-4'
    const numeroFir = 'BCDFGH00010ZQ'
    await seminaFormulario(numeroFir, 'FirmaAccettazione')

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(firRepository, client, 'cred-oracolo-4', rateLimiter)
    const saveSpy = jest.spyOn(firRepository, 'save')

    const completatore = avviaCompletatoreTransazioni({
      digestToSign: DIGEST,
      token: TOKEN,
      acquisizioneInErrore: true,
    })

    const confermaUtente = setInterval(() => {
      const sessioni = app.archivio.elencaSessioniFirma()
      if (sessioni.length > 0) {
        void app.inject({
          method: 'POST',
          url: `/__controllo/ca-rentri/autorizza/${sessioni[0].handle}`,
        })
      }
    }, 100)

    try {
      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          tipoOperazione: 'ACCETTAZIONE',
          intervalloPollingMs: 100,
          attesaMassimaMs: 15000,
        })
      ).rejects.toThrow(/rifiutato la firma/i)
    } finally {
      clearInterval(confermaUtente)
      completatore.ferma()
    }

    expect(saveSpy).not.toHaveBeenCalled()
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.rentriStatoFormulario).toBeNull()
  }, 60000)
})
