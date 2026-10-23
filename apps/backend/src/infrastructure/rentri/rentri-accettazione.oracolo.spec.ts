import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { AccettaORespingiFIRUseCase } from '../../application/rentri/accetta-o-respingi-fir.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R3 Task 4 — verifica REALE (non mockata) del ciclo completo di
 * accettazione/respingimento contro la fake RENTRI (`tools/rentri-fake`),
 * in-process con `creaApp()` + `app.inject()` come le altre `*.oracolo.spec.ts`.
 *
 * Il ciclo esercitato per intero (scenari 1-2): `GET /{numero_fir}/azioni`
 * (precondizione) → `POST /{numero_fir}/accettazione` (202 + NONBLOCK_PULL)
 * → l'intero ciclo di firma remota già validato da
 * `rentri-firma-operazione.oracolo.spec.ts` (`hash` → `authorize` →
 * `authorize-check` → `sign-hash` → `acquisizione-firma`) → rilettura di
 * `/stato` → `FIR.applyRentriStato`.
 *
 * **Questa suite NON valida la correttezza del modello dati di scrittura**
 * (`DatiAccettazioneModel`): la fake accetta qualunque `tipo_accettazione`
 * fra 'A'/'P'/'R' con una `data_ora_arrivo` non vuota, senza replicare i
 * vincoli condizionali di business (quantità/causale/motivo), che sono
 * responsabilità esclusiva di `AccettaORespingiFIRUseCase` (verificati nel
 * suo unitario, `accetta-o-respingi-fir.use-case.spec.ts`). Questa suite
 * verifica il CICLO: precondizione da `/azioni`, scrittura, firma, esito.
 */
describe('AccettaORespingiFIRUseCase — ciclo di accettazione/respingimento contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-accettazione')

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

  /** Stessa fedeltà axios di `rentri-firma-operazione.oracolo.spec.ts`: v. lì per il perché. */
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

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato, volte },
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
      produttoreId: 'produttore-oracolo-accettazione',
      trasportatoreId: 'trasportatore-oracolo-accettazione',
      destinatarioId: 'destinatario-oracolo-accettazione',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-ACCETTAZIONE-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  function creaRateLimiter() {
    const rilascia = jest.fn().mockResolvedValue(undefined)
    const acquisisci = jest.fn().mockResolvedValue({ rilascia })
    return { acquisisci, rilascia, servizio: { acquisisci } as any }
  }

  function creaUseCase(
    firRepository: FIRRepositoryFake,
    client: RENTRIApiClient,
    cf: string,
    credentialsId: string | null,
    rateLimiter: { servizio: any }
  ): AccettaORespingiFIRUseCase {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: cf }) },
    }
    const getAzioniDisponibiliUseCase = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )
    const credentialService = {
      getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue(credentialsId),
    }
    const completaOperazioneConFirmaUseCase = new CompletaOperazioneConFirmaUseCase(
      firRepository as any,
      credentialService as any,
      client,
      rateLimiter.servizio,
      creaLogger()
    )
    return new AccettaORespingiFIRUseCase(
      firRepository as any,
      getAzioniDisponibiliUseCase,
      client,
      completaOperazioneConFirmaUseCase,
      creaLogger()
    )
  }

  /**
   * Completa in ordine le transazioni NONBLOCK_PULL create da un singolo
   * ciclo `AccettaORespingiFIRUseCase.execute()`: la 1a è `/accettazione`
   * (nessun dato da restituire, solo `errore: false`), la 2a è `/hash`
   * (deve restituire `digest_to_sign`/`token`), la 3a è
   * `/acquisizione-firma`. Stessa tecnica di
   * `rentri-firma-operazione.oracolo.spec.ts` (la fake non completa da sola
   * le transazioni: è il test a decidere l'esito di ogni scrittura).
   */
  function avviaCompletatoreOperazioni(opzioni: {
    digestToSign: string
    token: string
    acquisizioneInErrore?: boolean
  }): { ferma: () => void } {
    let attivo = true
    const gestite = new Set<string>()

    const giro = async (): Promise<void> => {
      while (attivo) {
        for (const id of await elencaTransazioniAperte()) {
          if (gestite.has(id)) continue
          gestite.add(id)
          const indice = gestite.size

          let payload: Record<string, unknown>
          if (indice === 1) {
            // /accettazione
            payload = { transazione_id: id, errore: false, validazione: [], esito: {} }
          } else if (indice === 2) {
            // /hash
            payload = {
              transazione_id: id,
              errore: false,
              validazione: [],
              esito: {
                hash_algorithm: '2.16.840.1.101.3.4.2.1',
                digest_to_sign: opzioni.digestToSign,
                token: opzioni.token,
                versione: 1,
              },
            }
          } else {
            // /acquisizione-firma
            payload = {
              transazione_id: id,
              errore: opzioni.acquisizioneInErrore ?? false,
              validazione: opzioni.acquisizioneInErrore
                ? [{ tipo: 'Errore', codice_messaggio: 'FIR-999' }]
                : [],
              esito: {},
            }
          }

          await app.inject({
            method: 'POST',
            url: '/__controllo/completa-transazione',
            payload,
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

  async function elencaTransazioniAperte(): Promise<string[]> {
    const archivio: any = app.archivio
    const mappa: Map<string, any> = archivio.transazioni
    return [...mappa.values()].filter(t => t.stato === 'in_elaborazione').map(t => t.id)
  }

  /** Simula la conferma dell'utente sul proprio dispositivo al primo 202 osservato (v. firma-operazione). */
  function agganciaConfermaAutomatica(client: RENTRIApiClient): void {
    let confermata = false
    const originale = client.verificaAutorizzazioneFirma.bind(client)
    jest
      .spyOn(client, 'verificaAutorizzazioneFirma')
      .mockImplementation(async (tenant: string, handle: string) => {
        const esito = await originale(tenant, handle)
        if (esito.stato === 'IN_ATTESA' && !confermata) {
          confermata = true
          await app.inject({
            method: 'POST',
            url: `/__controllo/ca-rentri/autorizza/${handle}`,
          })
        }
        return esito
      })
  }

  const DIGEST = Buffer.from('digest-oracolo-accettazione').toString('base64')
  const TOKEN = 'token-oracolo-accettazione'

  it('ciclo completo, accettazione intera (A): InserimentoAccettazione → FirmaAccettazione → Accettato', async () => {
    const tenantId = 'tenant-oracolo-accettazione-1'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00020ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    agganciaConfermaAutomatica(client)
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(
      firRepository,
      client,
      cf,
      'ACC000001',
      rateLimiter
    )

    const completatore = avviaCompletatoreOperazioni({ digestToSign: DIGEST, token: TOKEN })

    try {
      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'A',
        quantitaAccettataKg: 100,
        correlationId: 'correlazione-accettazione-1',
      })

      expect(risultato.tipoAccettazione).toBe('A')
      expect(risultato.esitoFirma.esito).toBe('COMPLETATA')

      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.rentriStatoFormulario).toBe('Accettato')

      const stato = await client.leggiStato(tenantId, numeroFir)
      expect(stato.stato_formulario).toBe('Accettato')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('ciclo completo, respingimento (R) con causale e motivazione: → RespintoAccettatoParzialmente', async () => {
    const tenantId = 'tenant-oracolo-accettazione-2'
    const cf = 'VRDGPP75B02H501X'
    const numeroFir = 'BCDFGH00020ZB'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    agganciaConfermaAutomatica(client)
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(
      firRepository,
      client,
      cf,
      'ACC000002',
      rateLimiter
    )

    const completatore = avviaCompletatoreOperazioni({ digestToSign: DIGEST, token: TOKEN })

    try {
      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'R',
        causaleRespingimento: 'NC',
        motivoRespingimento: 'Il carico non corrisponde alla descrizione dichiarata.',
        correlationId: 'correlazione-accettazione-2',
      })

      expect(risultato.tipoAccettazione).toBe('R')
      expect(risultato.esitoFirma.esito).toBe('COMPLETATA')

      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.rentriStatoFormulario).toBe('RespintoAccettatoParzialmente')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('precondizione violata: Accettazione non disponibile in InserimentoQuantita, nessuna chiamata a /accettazione', async () => {
    const tenantId = 'tenant-oracolo-accettazione-3'
    const cf = 'BNCLGU70C03H501Y'
    const numeroFir = 'BCDFGH00020ZC'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(
      firRepository,
      client,
      cf,
      'ACC000003',
      rateLimiter
    )
    const spy = jest.spyOn(client, 'inviaAccettazione')

    await expect(
      useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'A',
        quantitaAccettataKg: 100,
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('motivazione mancante per un respingimento: lancia PRIMA di consultare /azioni o l’ente', async () => {
    const tenantId = 'tenant-oracolo-accettazione-4'
    const cf = 'MRNLGU80D04H501Z'
    const numeroFir = 'BCDFGH00020ZD'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(
      firRepository,
      client,
      cf,
      'ACC000004',
      rateLimiter
    )
    const spyAzioni = jest.spyOn(client, 'leggiAzioniDisponibili')
    const spyAccettazione = jest.spyOn(client, 'inviaAccettazione')

    await expect(
      useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'R',
        causaleRespingimento: 'NC',
        // motivoRespingimento assente
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(spyAzioni).not.toHaveBeenCalled()
    expect(spyAccettazione).not.toHaveBeenCalled()
  })

  it('guasto 423 su /accettazione: il client ritenta entro i limiti di resilienza, poi propaga (nessuna correttezza del modello dati verificata qui)', async () => {
    const tenantId = 'tenant-oracolo-accettazione-5'
    const cf = 'FRRLGU85E05H501A'
    const numeroFir = 'BCDFGH00020ZK'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const rateLimiter = creaRateLimiter()
    const useCase = creaUseCase(
      firRepository,
      client,
      cf,
      'ACC000005',
      rateLimiter
    )

    // La precondizione da /azioni è mockata (nessuna rete reale): questo
    // scenario isola il guasto sulla chiamata /accettazione, non sulla
    // lettura delle azioni disponibili (che condivide lo stesso meccanismo
    // di resilienza e ha già una suite dedicata, `rentri-azioni.oracolo.spec.ts`).
    jest.spyOn(client, 'leggiAzioniDisponibili').mockResolvedValue({
      versione: 1,
      stato: 'InserimentoAccettazione',
      azioni: ['Accettazione'],
    })

    // Guasto permanente (più occorrenze dei tentativi di resilienza): l'ente
    // "banna" il chiamante. Questo scenario verifica solo il CICLO di
    // retry/propagazione, non la correttezza dei campi del modello dati
    // (v. commento di testata della suite).
    await impostaGuasto(423, 100)

    await expect(
      useCase.execute({
        firId: fir.id,
        tenantId,
        tipoAccettazione: 'A',
        quantitaAccettataKg: 100,
      })
    ).rejects.toThrow()

    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.rentriStatoFormulario).toBe('InserimentoAccettazione')
  }, 30000)
})
