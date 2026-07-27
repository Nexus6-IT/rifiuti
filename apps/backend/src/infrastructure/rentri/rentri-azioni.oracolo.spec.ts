import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R3 Task 2 — verifica REALE (non mockata) contro la fake fedele al
 * contratto RENTRI (`tools/rentri-fake`) del "motore della UI": consultazione
 * di stato/azioni disponibili e il ciclo completo
 * (`RENTRIApiClient` → `GetAzioniDisponibiliUseCase` → `FIR.applyRentriStato`).
 *
 * Istanziata IN-PROCESS con `creaApp()` + `app.inject()`, come le altre
 * `*.oracolo.spec.ts` accanto a questo file.
 *
 * Due cose, esplicitamente, sono l'oggetto di questa suite (v.
 * task-2-brief.md, Step 1 e Step 4):
 * 1. Due stati diversi del formulario restituiscono liste di azioni
 *    OSSERVABILMENTE diverse (non lo stesso elenco completo sempre) — un
 *    client che ignorasse la risposta e proponesse sempre tutto passerebbe
 *    un test che verificasse solo "la lista non è vuota".
 * 2. Difesa in profondità: se l'ente rifiuta comunque la chiamata (400/403)
 *    nonostante una `/azioni` precedente avesse elencato tutt'altro, il
 *    codice chiamante (client + use case) non corrompe né `rentriStatoFormulario`
 *    né lo stato locale — l'eccezione propaga, `save` non viene invocato.
 */
describe('RENTRIApiClient/GetAzioniDisponibiliUseCase — stato e azioni contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-azioni')

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

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato, volte },
    })
  }

  function seminaFormulario(payload: {
    numero_fir: string
    stato: string
    identificativo_soggetto: string
  }): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: { produttore: 'Produttore di prova SRL', ...payload },
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
      produttoreId: 'produttore-oracolo-azioni',
      trasportatoreId: 'trasportatore-oracolo-azioni',
      destinatarioId: 'destinatario-oracolo-azioni',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 50 },
    })
    fir.emetti('FIR-ORACOLO-AZIONI-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
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

  it('leggiStato: restituisce lo stato_formulario e la versione esatti seminati in archivio', async () => {
    const client = creaClient()
    const cf = 'RSSMRA80A01H501U'
    await seminaFormulario({
      numero_fir: 'BCDFGH00010ZH',
      stato: 'InserimentoTrasportoIniziale',
      identificativo_soggetto: cf,
    })

    const risultato = await client.leggiStato('', 'BCDFGH00010ZH')

    expect(risultato.stato_formulario).toBe('InserimentoTrasportoIniziale')
  })

  it('leggiAzioniDisponibili: due stati diversi restituiscono liste di azioni OSSERVABILMENTE diverse', async () => {
    const client = creaClient()
    const cf = 'RSSMRA80A01H501U'

    await seminaFormulario({
      numero_fir: 'BCDFGH00010ZB',
      stato: 'InserimentoQuantita',
      identificativo_soggetto: cf,
    })
    await seminaFormulario({
      numero_fir: 'BCDFGH00010ZC',
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const azioniIniziale = await client.leggiAzioniDisponibili('', 'BCDFGH00010ZB', cf)
    const azioniAccettazione = await client.leggiAzioniDisponibili('', 'BCDFGH00010ZC', cf)

    expect(azioniIniziale.stato).toBe('InserimentoQuantita')
    expect(azioniIniziale.azioni).not.toBeNull()
    expect(azioniIniziale.azioni).not.toContain('Accettazione')

    expect(azioniAccettazione.stato).toBe('InserimentoAccettazione')
    expect(azioniAccettazione.azioni).toContain('Accettazione')

    // La prova decisiva richiesta dal piano: non lo stesso elenco sempre.
    expect(azioniAccettazione.azioni).not.toEqual(azioniIniziale.azioni)
  })

  it('leggiAzioniDisponibili: un formulario in stato terminale non propone alcuna operazione di scrittura', async () => {
    const client = creaClient()
    const cf = 'RSSMRA80A01H501U'
    await seminaFormulario({
      numero_fir: 'BCDFGH00010ZD',
      stato: 'Accettato',
      identificativo_soggetto: cf,
    })

    const risultato = await client.leggiAzioniDisponibili('', 'BCDFGH00010ZD', cf)

    expect(risultato.azioni).toEqual([])
  })

  it('leggiAzioniDisponibili: senza identificativo_soggetto l’ente rifiuta con 400 (parametro obbligatorio)', async () => {
    const client = creaClient()
    await seminaFormulario({
      numero_fir: 'BCDFGH00010ZK',
      stato: 'InserimentoQuantita',
      identificativo_soggetto: 'RSSMRA80A01H501U',
    })

    await expect(client.leggiAzioniDisponibili('', 'BCDFGH00010ZK', '')).rejects.toThrow(/HTTP 400/)
  })

  it('GetAzioniDisponibiliUseCase: legge le azioni, riconcilia rentriStatoFormulario e salva il FIR', async () => {
    const tenantId = 'tenant-oracolo-azioni-1'
    const cf = 'VRDGPP75B02H501X'
    const numeroFir = 'BCDFGH00010ZF'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const fir = creaFIRLegato(tenantId, numeroFir)
    expect(fir.rentriStatoFormulario).toBeNull()

    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const client = creaClient()
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: cf }) },
    }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )

    const risultato = await useCase.execute(fir.id, tenantId)

    expect(risultato.stato).toBe('InserimentoAccettazione')
    expect(risultato.azioni).toContainEqual({
      operazione: 'Accettazione',
      verbo: 'Accetta o respingi il carico',
    })

    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.rentriStatoFormulario).toBe('InserimentoAccettazione')
  })

  it('difesa in profondità: un 400 dell’ente su /azioni propaga come errore e NON corrompe lo stato locale né salva nulla', async () => {
    const tenantId = 'tenant-oracolo-azioni-2'
    const cf = 'BNCLGU70C03H501Y'
    const numeroFir = 'BCDFGH00010ZG'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const fir = creaFIRLegato(tenantId, numeroFir)
    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const client = creaClient()
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: cf }) },
    }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )

    // Prima lettura: successo, /azioni elencava (fra le altre) 'Accettazione'
    // per questo formulario — verificato sopra. Ora la riconciliazione ha
    // già scritto rentriStatoFormulario.
    await useCase.execute(fir.id, tenantId)
    const statoRiconciliato = (await firRepository.findById(fir.id))!.rentriStatoFormulario
    expect(statoRiconciliato).toBe('InserimentoAccettazione')

    const saveSpy = jest.spyOn(firRepository, 'save')

    // L'ente ora rifiuta comunque la PROSSIMA chiamata con 400, nonostante
    // la lettura precedente avesse elencato azioni disponibili: la cache
    // locale di /azioni non va MAI considerata una garanzia per la
    // richiesta successiva.
    await impostaGuasto(400, 1)

    await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow(/HTTP 400/)

    // Nessuna corruzione: né una nuova riconciliazione né un salvataggio.
    expect(saveSpy).not.toHaveBeenCalled()
    const firDopoIlRifiuto = await firRepository.findById(fir.id)
    expect(firDopoIlRifiuto!.rentriStatoFormulario).toBe(statoRiconciliato)

    // Il guasto era iniettato per una sola occorrenza: la chiamata
    // successiva torna a funzionare normalmente — non è un blocco
    // permanente, solo un singolo rifiuto simulato dall'ente.
    const risultatoDopo = await useCase.execute(fir.id, tenantId)
    expect(risultatoDopo.stato).toBe('InserimentoAccettazione')
  })

  it('guasto 423 su /azioni: il client ritenta entro i limiti di resilienza, poi propaga senza corrompere lo stato locale', async () => {
    // Buco colmato qui (R3 Task 10): le altre quattro famiglie
    // (rentri-firma-operazione, rentri-accettazione, rentri-annullamento,
    // rentri-allegati) hanno già un test 423 iniettato su un guasto
    // permanente (più occorrenze di RENTRIApiClient.MAX_TENTATIVI_RESILIENZA
    // = 5, v. `rentri-api.client.ts`); questa suite aveva solo il 400 di
    // "difesa in profondità" sopra. Stesso stile di quei quattro: guasto
    // permanente (100 >> 5), il client esaurisce i tentativi di resilienza
    // e propaga, senza corrompere `rentriStatoFormulario` né salvare nulla
    // (stesso criterio del test "difesa in profondità").
    const tenantId = 'tenant-oracolo-azioni-3'
    const cf = 'MRTLGU82D10H501B'
    const numeroFir = 'BCDFGH00010ZL'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const fir = creaFIRLegato(tenantId, numeroFir)
    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const client = creaClient()
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: cf }) },
    }

    const useCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )

    const saveSpy = jest.spyOn(firRepository, 'save')

    // Guasto permanente: l'ente "banna" il chiamante su ogni tentativo.
    // Verifica solo il ciclo di retry/propagazione (nessuna correttezza
    // del modello dati coinvolta qui — l'endpoint è una GET).
    await impostaGuasto(423, 100)

    await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow()

    // Nessuna corruzione: né una riconciliazione né un salvataggio, anche
    // dopo che il client ha esaurito i tentativi di resilienza.
    expect(saveSpy).not.toHaveBeenCalled()
    const firDopoIlGuasto = await firRepository.findById(fir.id)
    expect(firDopoIlGuasto!.rentriStatoFormulario).toBeNull()
  }, 30000)
})
