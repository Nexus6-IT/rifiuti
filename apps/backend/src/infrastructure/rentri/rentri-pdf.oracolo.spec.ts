import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { ScaricaPdfFirUseCase } from '../../application/rentri/scarica-pdf-fir.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R3 Task 7 — verifica REALE (non mockata) di `GET /{numero_fir}/pdf`
 * contro la fake RENTRI (`tools/rentri-fake`), in-process con `creaApp()` +
 * `app.inject()` (stesso schema di `rentri-allegati.oracolo.spec.ts`).
 *
 * A differenza degli altri cicli di scrittura di questo piano, QUESTO
 * endpoint è **SINCRONO** (nessun NONBLOCK_PULL, nessuna firma remota): un
 * solo scambio HTTP, risposta 200 o 204 diretta.
 *
 * **Limite dichiarato**: la fake NON modella l'autorizzazione per-soggetto
 * descritta dal contratto (riga 1748, "un'utenza che abbia incarichi per, o
 * coincida con, almeno uno dei soggetti coinvolti") — nessuna rotta della
 * fake lo fa, per nessun endpoint (v. `docs/contracts/rentri/FEDELTA.md`).
 * Questa suite verifica quindi il CICLO (200/204/404) contro l'ente
 * simulato; l'autorizzazione realmente applicabile con i dati che abbiamo
 * (il confronto di tenant) è verificata invece in
 * `scarica-pdf-fir.use-case.spec.ts` (unitario, senza rete).
 */
describe('ScaricaPdfFirUseCase / RENTRIApiClient.scaricaPdf — contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-pdf')

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
    identificativo_soggetto?: string
    pdfDisponibile?: boolean
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
      produttoreId: 'produttore-oracolo-pdf',
      trasportatoreId: 'trasportatore-oracolo-pdf',
      destinatarioId: 'destinatario-oracolo-pdf',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-PDF-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  it('scarica il PDF (200 + DownloadableBaseResponse) end-to-end attraverso lo use case', async () => {
    const tenantId = 'tenant-oracolo-pdf-1'
    const numeroFir = 'BCDFGH00041ZH'
    await seminaFormulario({ numero_fir: numeroFir, stato: 'Accettato' })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const useCase = new ScaricaPdfFirUseCase(firRepository as any, client, creaLogger())

    const risultato = await useCase.execute(fir.id, tenantId)

    expect(risultato.disponibile).toBe(true)
    expect(risultato.mime).toBe('application/pdf')
    expect(risultato.nomeFile).toBe(`FIR-${numeroFir}.pdf`)
    expect(Buffer.from(risultato.contenutoBase64 ?? '', 'base64').toString('utf-8')).toContain(
      numeroFir
    )
  })

  it('propaga il 204 dichiarato dal contratto (righe 1758-1765) come disponibile:false, mai un errore', async () => {
    const tenantId = 'tenant-oracolo-pdf-2'
    const numeroFir = 'BCDFGH00042ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      pdfDisponibile: false,
    })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const useCase = new ScaricaPdfFirUseCase(firRepository as any, client, creaLogger())

    const risultato = await useCase.execute(fir.id, tenantId)

    expect(risultato).toEqual({ disponibile: false })
  })

  it("propaga 404 quando l'ente non trova il formulario (numero noto localmente ma sparito sull'ente)", async () => {
    const tenantId = 'tenant-oracolo-pdf-3'
    const numeroFirMaiSeminato = 'BCDFGH00043ZH'

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFirMaiSeminato)
    await firRepository.save(fir)

    const client = creaClient()
    const useCase = new ScaricaPdfFirUseCase(firRepository as any, client, creaLogger())

    await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow(/HTTP 404/)
  })

  it('423 su GET /pdf: il client non ritenta oltre il limite previsto', async () => {
    const tenantId = 'tenant-oracolo-pdf-4'
    const numeroFir = 'BCDFGH00044ZH'
    await seminaFormulario({ numero_fir: numeroFir, stato: 'Accettato' })

    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)

    const client = creaClient()
    const useCase = new ScaricaPdfFirUseCase(firRepository as any, client, creaLogger())

    // 423 persistente, oltre il numero massimo di tentativi del client
    // (5, v. RENTRIApiClient.MAX_TENTATIVI_RESILIENZA): la richiesta deve
    // fermarsi con un errore esplicito, mai tentare all'infinito.
    await impostaGuasto(423, 10)

    await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow()
  })
})
