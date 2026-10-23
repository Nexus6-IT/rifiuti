import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { AnnullaFIRRentriUseCase } from '../../application/rentri/annulla-fir-rentri.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R3 Task 5 — verifica REALE (non mockata) del ciclo completo di
 * annullamento, con nota, contro la fake RENTRI (`tools/rentri-fake`),
 * in-process con `creaApp()` + `app.inject()` come le altre `*.oracolo.spec.ts`
 * (modello più vicino: `rentri-accettazione.oracolo.spec.ts`, R3 Task 4).
 *
 * Il ciclo esercitato per intero (scenario 1): `GET /{numero_fir}/azioni`
 * (precondizione 'Annulla') → `POST /{numero_fir}/annulla-fir` (202 +
 * NONBLOCK_PULL) → l'intero ciclo di firma remota già validato da
 * `rentri-firma-operazione.oracolo.spec.ts` (`hash` → `authorize` →
 * `authorize-check` → `sign-hash` → `acquisizione-firma`) → rilettura di
 * `/stato` (`Annullato`) → `GET /azioni` (precondizione 'NoteAnnullamento',
 * DI NUOVO) → `POST /{numero_fir}/note-annullamento` (202 + NONBLOCK_PULL,
 * SENZA alcuna firma successiva) → persistenza locale del motivo.
 *
 * **Questa suite NON valida la correttezza dei campi del modello dati di
 * scrittura**: `annulla-fir` non ha alcun corpo (verificato riga per riga sul
 * contratto, v. `AnnullaFIRRentriUseCase`), e la fake valida solo la
 * struttura minima di `NoteAnnullamentoModel.note`. Questa suite verifica il
 * CICLO: doppia precondizione da `/azioni`, doppia scrittura, firma solo
 * sulla prima, esito.
 */
describe('AnnullaFIRRentriUseCase — ciclo di annullamento con nota contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-annullamento')

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
      produttoreId: 'produttore-oracolo-annullamento',
      trasportatoreId: 'trasportatore-oracolo-annullamento',
      destinatarioId: 'destinatario-oracolo-annullamento',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-ANNULLAMENTO-000001', {
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
  ): AnnullaFIRRentriUseCase {
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
    return new AnnullaFIRRentriUseCase(
      firRepository as any,
      getAzioniDisponibiliUseCase,
      client,
      completaOperazioneConFirmaUseCase,
      creaLogger()
    )
  }

  /**
   * Completa in ordine le transazioni NONBLOCK_PULL create da un singolo
   * ciclo `AnnullaFIRRentriUseCase.execute()`: la 1a è `/annulla-fir`
   * (nessun dato da restituire, solo `errore` secondo `opzioni`), la 2a è
   * `/hash` (deve restituire `digest_to_sign`/`token`, presente solo se la
   * prima non è in errore), la 3a è `/acquisizione-firma`, la 4a — se si
   * arriva fin lì — è `/note-annullamento` (nessuna firma successiva, v.
   * commento di classe della suite). Stessa tecnica di
   * `rentri-accettazione.oracolo.spec.ts`.
   */
  function avviaCompletatoreOperazioni(opzioni: {
    digestToSign: string
    token: string
    annullaFirInErrore?: boolean
    acquisizioneInErrore?: boolean
    noteInErrore?: boolean
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
            // /annulla-fir
            payload = {
              transazione_id: id,
              errore: opzioni.annullaFirInErrore ?? false,
              validazione: opzioni.annullaFirInErrore
                ? [{ tipo: 'Errore', codice_messaggio: 'FIR-998' }]
                : [],
              esito: {},
            }
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
          } else if (indice === 3) {
            // /acquisizione-firma
            payload = {
              transazione_id: id,
              errore: opzioni.acquisizioneInErrore ?? false,
              validazione: opzioni.acquisizioneInErrore
                ? [{ tipo: 'Errore', codice_messaggio: 'FIR-999' }]
                : [],
              esito: {},
            }
          } else {
            // /note-annullamento
            payload = {
              transazione_id: id,
              errore: opzioni.noteInErrore ?? false,
              validazione: opzioni.noteInErrore
                ? [{ tipo: 'Errore', codice_messaggio: 'FIR-997' }]
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

  const DIGEST = Buffer.from('digest-oracolo-annullamento').toString('base64')
  const TOKEN = 'token-oracolo-annullamento'

  it('ciclo completo, esito positivo: InserimentoQuantita → FirmaAnnullamento → Annullato → nota registrata', async () => {
    const tenantId = 'tenant-oracolo-annullamento-1'
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = 'BCDFGH00030ZH'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
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
      'ANN000001',
      rateLimiter
    )

    // Precondizione iniziale: 'Annulla' compare nella fase di lavorazione iniziale.
    const azioniIniziali = await client.leggiAzioniDisponibili(tenantId, numeroFir, cf)
    expect(azioniIniziali.azioni).toContain('Annulla')

    const completatore = avviaCompletatoreOperazioni({ digestToSign: DIGEST, token: TOKEN })

    const motivo = 'errore di pesatura alla partenza'

    try {
      const risultato = await useCase.execute({
        firId: fir.id,
        tenantId,
        motivo,
        correlationId: 'correlazione-annullamento-1',
      })

      expect(risultato.esitoFirma.esito).toBe('COMPLETATA')
      expect(risultato.noteInviate).toBe(true)

      const stato = await client.leggiStato(tenantId, numeroFir)
      expect(stato.stato_formulario).toBe('Annullato')

      // Dopo l'annullamento e la trasmissione della nota, 'NoteAnnullamento'
      // non compare più (la nota è già registrata presso l'ente).
      const azioniFinali = await client.leggiAzioniDisponibili(tenantId, numeroFir, cf)
      expect(azioniFinali.azioni).not.toContain('NoteAnnullamento')

      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.motivoAnnullamento).toBe(motivo)
      expect(firRiletto!.stato).toBe('ANNULLATO')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('precondizione iniziale violata: Annulla non disponibile su un formulario già Accettato, nessuna chiamata a /annulla-fir', async () => {
    const tenantId = 'tenant-oracolo-annullamento-2'
    const cf = 'VRDGPP75B02H501X'
    const numeroFir = 'BCDFGH00030ZB'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'Accettato',
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
      'ANN000002',
      rateLimiter
    )
    const spy = jest.spyOn(client, 'annullaFormulario')

    await expect(
      useCase.execute({
        firId: fir.id,
        tenantId,
        motivo: 'tentativo di annullamento tardivo',
      })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('motivo mancante o troppo lungo: lancia PRIMA di consultare /azioni o l’ente', async () => {
    const tenantId = 'tenant-oracolo-annullamento-3'
    const cf = 'BNCLGU70C03H501Y'
    const numeroFir = 'BCDFGH00030ZC'
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
      'ANN000003',
      rateLimiter
    )
    const spyAzioni = jest.spyOn(client, 'leggiAzioniDisponibili')
    const spyAnnulla = jest.spyOn(client, 'annullaFormulario')

    await expect(useCase.execute({ firId: fir.id, tenantId, motivo: '   ' })).rejects.toMatchObject(
      { code: 'BUSINESS_RULE_VIOLATION' }
    )

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'x'.repeat(1025) })
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

    expect(spyAzioni).not.toHaveBeenCalled()
    expect(spyAnnulla).not.toHaveBeenCalled()
  })

  it('l’ente rifiuta annulla-fir: l’use case lancia, CompletaOperazioneConFirmaUseCase mai chiamato', async () => {
    const tenantId = 'tenant-oracolo-annullamento-4'
    const cf = 'MRNLGU80D04H501Z'
    const numeroFir = 'BCDFGH00030ZD'
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
      'ANN000004',
      rateLimiter
    )

    const completatore = avviaCompletatoreOperazioni({
      digestToSign: DIGEST,
      token: TOKEN,
      annullaFirInErrore: true,
    })

    try {
      await expect(
        useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo qualunque' })
      ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' })

      // Il FIR non ha mai raggiunto FirmaAnnullamento presso l'ente: nessuna
      // riconciliazione a un esito di firma.
      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.motivoAnnullamento).toBeNull()
    } finally {
      completatore.ferma()
    }
  }, 30000)

  it('la nota viene rifiutata dopo un annullamento riuscito: lancia, ma NON scrive il motivo (annullamento comunque avvenuto)', async () => {
    const tenantId = 'tenant-oracolo-annullamento-5'
    const cf = 'FRRLGU85E05H501A'
    const numeroFir = 'BCDFGH00030ZG'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
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
      'ANN000005',
      rateLimiter
    )

    const completatore = avviaCompletatoreOperazioni({
      digestToSign: DIGEST,
      token: TOKEN,
      noteInErrore: true,
    })

    try {
      await expect(
        useCase.execute({
          firId: fir.id,
          tenantId,
          motivo: 'motivo che verrà rifiutato',
        })
      ).rejects.toThrow(/annullat[oa].*ente/i)

      // L'annullamento presso l'ente è comunque avvenuto...
      const stato = await client.leggiStato(tenantId, numeroFir)
      expect(stato.stato_formulario).toBe('Annullato')

      // ...ma il motivo NON è stato scritto localmente: nessun save con la nota.
      const firRiletto = await firRepository.findById(fir.id)
      expect(firRiletto!.motivoAnnullamento).toBeNull()
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('guasto 423 su /annulla-fir: il client ritenta entro i limiti di resilienza, poi propaga (nessuna correttezza del modello dati verificata qui)', async () => {
    const tenantId = 'tenant-oracolo-annullamento-6'
    const cf = 'GRVMHL90F06H501B'
    const numeroFir = 'BCDFGH00030ZF'
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
      'ANN000006',
      rateLimiter
    )

    // Precondizione da /azioni mockata (nessuna rete reale): questo scenario
    // isola il guasto sulla chiamata /annulla-fir, non sulla lettura delle
    // azioni disponibili (già coperta da una suite dedicata).
    jest.spyOn(client, 'leggiAzioniDisponibili').mockResolvedValue({
      versione: 1,
      stato: 'InserimentoQuantita',
      azioni: ['Annulla'],
    })

    await impostaGuasto(423, 100)

    await expect(
      useCase.execute({ firId: fir.id, tenantId, motivo: 'motivo qualunque' })
    ).rejects.toThrow()

    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto!.motivoAnnullamento).toBeNull()
  }, 30000)
})
