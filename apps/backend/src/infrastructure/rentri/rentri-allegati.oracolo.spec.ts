import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { GestisciAllegatiFIRUseCase } from '../../application/rentri/gestisci-allegati-fir.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R3 Task 6 — verifica REALE (non mockata) del ciclo di gestione allegati
 * contro la fake RENTRI (`tools/rentri-fake`), in-process con `creaApp()` +
 * `app.inject()` (stesso schema di `rentri-accettazione.oracolo.spec.ts` /
 * `rentri-annullamento.oracolo.spec.ts`).
 *
 * A differenza di quei due cicli, QUESTO non ha alcuna firma remota: il
 * contratto dichiara esplicitamente (formulari.yaml riga 788) che l'allegato
 * "non necessita di essere firmato" — un solo scambio NONBLOCK_PULL
 * (202 → /status → /result) per `POST /allegato` e per
 * `DELETE /allegato/{id}`, mai un secondo passaggio di `hash`/`acquisizione-firma`.
 *
 * **Questa suite NON valida la correttezza dei campi del modello dati di
 * scrittura**: la fake valida solo la struttura minima di `DatiAllegatoModel`
 * (v. `formulari.ts`, `registraOperazioneAsincrona('allegato', ...)`). La
 * traduzione camelCase→snake_case è verificata a parte, in
 * `rentri-api.client.spec.ts` ("caricaAllegato — corpo conforme al
 * contratto"). Questa suite verifica il CICLO: precondizione da `/azioni`,
 * scrittura, allineamento locale, e un caso di 423 (resilienza).
 */
describe('GestisciAllegatiFIRUseCase — ciclo allegati contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-allegati')

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

    // Ogni azienda del test ha un certificato proprio (uguale a quello di prova): la
    // credenziale env e' legata a una sola azienda (RENTRI_ENV_TENANT_ID).
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: config.clientId,
        certificatePem: config.certificatePem,
        privateKeyPem: config.privateKeyPem,
        algorithm: config.algorithm,
        environment: 'demo',
      }),
    }
    const logger = creaLogger()
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
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
      delete: (url: string, opts: { headers: Record<string, string>; validateStatus?: any }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'DELETE',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => emetti(subscriber, risposta, opts))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /** Stessa fedeltà axios delle altre oracolo: v. `rentri-firma-operazione.oracolo.spec.ts`. */
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

  /**
   * Fake MINIMA di `PrismaService` — `tenant.findUnique` (per risolvere
   * `identificativo_soggetto` dal CF del tenant, v.
   * `GestisciAllegatiFIRUseCase`) e `fIRAllegatoRentri`, tenuto in memoria
   * (Map). Stesso principio delle altre oracolo: il confine verificato QUI è
   * la conversazione HTTP con RENTRI, non la persistenza reale (verificata a
   * parte dalla migrazione + `prisma migrate status`). Un'unica istanza,
   * passata sia a `GetAzioniDisponibiliUseCase` sia a
   * `GestisciAllegatiFIRUseCase`: nella realtà è lo stesso `PrismaService`.
   */
  class FIRAllegatoRentriPrismaFake {
    private righe = new Map<string, any>()
    private contatore = 0

    constructor(private readonly codiceFiscaleTenant: string | null) {}

    tenant = {
      findUnique: async () => ({ codiceFiscale: this.codiceFiscaleTenant }),
    }

    fIRAllegatoRentri = {
      create: async ({ data }: { data: any }) => {
        this.contatore += 1
        const riga = {
          id: `allegato-locale-${this.contatore}`,
          caricatoAlle: new Date(),
          ...data,
        }
        this.righe.set(riga.id, riga)
        return riga
      },
      findMany: async ({ where }: { where: { firId: string } }) =>
        [...this.righe.values()].filter(r => r.firId === where.firId),
      findFirst: async ({ where }: { where: { id: string; firId: string } }) => {
        const riga = this.righe.get(where.id)
        return riga && riga.firId === where.firId ? riga : null
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const riga = this.righe.get(where.id)
        this.righe.delete(where.id)
        return riga
      },
    }
  }

  function creaFIRLegato(tenantId: string, numeroFir: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-oracolo-allegati',
      trasportatoreId: 'trasportatore-oracolo-allegati',
      destinatarioId: 'destinatario-oracolo-allegati',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-ALLEGATI-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  function creaUseCase(
    firRepository: FIRRepositoryFake,
    prisma: FIRAllegatoRentriPrismaFake,
    client: RENTRIApiClient
  ): GestisciAllegatiFIRUseCase {
    const getAzioniDisponibiliUseCase = new GetAzioniDisponibiliUseCase(
      prisma as any,
      firRepository as any,
      client,
      creaLogger()
    )
    return new GestisciAllegatiFIRUseCase(
      firRepository as any,
      prisma as any,
      getAzioniDisponibiliUseCase,
      client,
      creaLogger()
    )
  }

  async function elencaTransazioniAperte(): Promise<string[]> {
    const archivio: any = app.archivio
    const mappa: Map<string, any> = archivio.transazioni
    return [...mappa.values()].filter(t => t.stato === 'in_elaborazione').map(t => t.id)
  }

  /**
   * Completa la PRIMA (e unica, per questo ciclo senza firma) transazione
   * NONBLOCK_PULL osservata, con l'esito indicato. A differenza di
   * `avviaCompletatoreOperazioni` di `rentri-annullamento.oracolo.spec.ts`,
   * un solo passaggio: `POST /allegato` e `DELETE /allegato/{id}` non aprono
   * mai un secondo scambio di firma.
   */
  function avviaCompletatorePassoUnico(esito: {
    errore: boolean
    validazione?: unknown[]
    esito?: unknown
  }): { ferma: () => void } {
    let attivo = true
    let gestita = false

    const giro = async (): Promise<void> => {
      while (attivo && !gestita) {
        const aperte = await elencaTransazioniAperte()
        if (aperte.length > 0) {
          gestita = true
          await app.inject({
            method: 'POST',
            url: '/__controllo/completa-transazione',
            payload: {
              transazione_id: aperte[0],
              errore: esito.errore,
              validazione: esito.validazione ?? [],
              esito: esito.esito ?? {},
            },
          })
          return
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    void giro()
    return {
      ferma: () => {
        attivo = false
      },
    }
  }

  const CONTENUTO_BASE64 = Buffer.from('%PDF-1.4 contenuto di prova').toString('base64')

  it("carica un allegato con successo: /azioni → POST /allegato → riga locale registrata con l'allegato_id dell'ente", async () => {
    const tenantId = 'tenant-oracolo-allegati-1'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00031ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const prisma = new FIRAllegatoRentriPrismaFake(cf)
    const client = creaClient()
    const useCase = creaUseCase(firRepository, prisma, client)

    // Precondizione iniziale: 'Allegato' compare nella fase di lavorazione iniziale.
    const azioniIniziali = await client.leggiAzioniDisponibili(tenantId, numeroFir, cf)
    expect(azioniIniziali.azioni).toContain('Allegato')

    const completatore = avviaCompletatorePassoUnico({ errore: false, esito: { allegato_id: 7 } })

    try {
      const risultato = await useCase.caricaAllegato({
        firId: fir.id,
        tenantId,
        userId: 'utente-oracolo-1',
        nomeFile: 'analisi-chimica.pdf',
        contentType: 'application/pdf',
        contenutoBase64: CONTENUTO_BASE64,
      })

      expect(risultato.rentriAllegatoId).toBe(7)
      expect(risultato.filename).toBe('analisi-chimica.pdf')

      const elenco = await useCase.elencaAllegati(fir.id, tenantId)
      expect(elenco).toHaveLength(1)
      expect(elenco[0].rentriAllegatoId).toBe(7)
    } finally {
      completatore.ferma()
    }
  })

  it("elimina un allegato con successo: DELETE sull'ente riflesso ANCHE in locale", async () => {
    const tenantId = 'tenant-oracolo-allegati-2'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00032ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const prisma = new FIRAllegatoRentriPrismaFake(cf)
    const client = creaClient()
    const useCase = creaUseCase(firRepository, prisma, client)

    const caricamento = avviaCompletatorePassoUnico({ errore: false, esito: { allegato_id: 9 } })
    let allegatoCaricato
    try {
      allegatoCaricato = await useCase.caricaAllegato({
        firId: fir.id,
        tenantId,
        userId: 'utente-oracolo-2',
        nomeFile: 'analisi.pdf',
        contentType: 'application/pdf',
        contenutoBase64: CONTENUTO_BASE64,
      })
    } finally {
      caricamento.ferma()
    }

    const eliminazione = avviaCompletatorePassoUnico({ errore: false })
    try {
      await useCase.eliminaAllegato({
        firId: fir.id,
        tenantId,
        allegatoLocaleId: allegatoCaricato.id,
      })

      const elenco = await useCase.elencaAllegati(fir.id, tenantId)
      expect(elenco).toHaveLength(0)

      // Riflesso anche sull'ente: l'allegato non è più scaricabile (404, non
      // più uno stub cieco — usa lo stesso client autenticato, non una
      // chiamata HTTP nuda che fallirebbe prima ancora sull'autenticazione).
      // 404 non è ritentabile (v. `gestisciRispostaErroreRentri`): propaga
      // come errore esplicito "Risposta inattesa ... HTTP 404".
      await expect(client.scaricaAllegato(tenantId, numeroFir, 9)).rejects.toThrow(/HTTP 404/)
    } finally {
      eliminazione.ferma()
    }
  })

  it("rifiuta il caricamento se 'Allegato' non compare in /azioni (formulario in stato terminale)", async () => {
    const tenantId = 'tenant-oracolo-allegati-3'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00033ZH'
    // 'Accettato' e' uno stato terminale senza seguito (operazione.ts):
    // nessuna operazione di scrittura, 'Allegato' compreso.
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'Accettato',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const prisma = new FIRAllegatoRentriPrismaFake(cf)
    const client = creaClient()
    const useCase = creaUseCase(firRepository, prisma, client)

    await expect(
      useCase.caricaAllegato({
        firId: fir.id,
        tenantId,
        userId: 'utente-oracolo-3',
        nomeFile: 'analisi.pdf',
        contentType: 'application/pdf',
        contenutoBase64: CONTENUTO_BASE64,
      })
    ).rejects.toThrow(/ALLEGATO_NON_DISPONIBILE/)

    const elenco = await useCase.elencaAllegati(fir.id, tenantId)
    expect(elenco).toHaveLength(0)
  })

  it('423 su POST /allegato: il client non ritenta oltre il limite, la riga locale non viene creata', async () => {
    const tenantId = 'tenant-oracolo-allegati-4'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00034ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      identificativo_soggetto: cf,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const prisma = new FIRAllegatoRentriPrismaFake(cf)
    const client = creaClient()
    const useCase = creaUseCase(firRepository, prisma, client)

    // 423 persistente, oltre il numero massimo di tentativi del client
    // (5, v. RENTRIApiClient.MAX_TENTATIVI_RESILIENZA): la richiesta non
    // valida (qui simulata) deve fermarsi con un errore, non tentare
    // all'infinito.
    await impostaGuasto(423, 10)

    await expect(
      useCase.caricaAllegato({
        firId: fir.id,
        tenantId,
        userId: 'utente-oracolo-4',
        nomeFile: 'analisi.pdf',
        contentType: 'application/pdf',
        contenutoBase64: CONTENUTO_BASE64,
      })
    ).rejects.toThrow()

    const elenco = await useCase.elencaAllegati(fir.id, tenantId)
    expect(elenco).toHaveLength(0)
  })
})
