import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { GestisciSessioneFirmaRentriUseCase } from '../../application/rentri/gestisci-sessione-firma-rentri.use-case'
import { FirmaPartenzaRentriUseCase } from '../../application/rentri/firma-partenza-rentri.use-case'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from '../../application/rentri/sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P3 contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - firma di partenza: l'operazione la sceglie `/azioni`, la firma passa dal ciclo comune e lo stato di viaggio
 *   e' RILETTO dall'ente;
 * - ripresa: due richieste = UNA sola `authorize`;
 * - i due esiti dopo un'azione locale: firma riuscita e firma rifiutata (l'azione locale non si annulla).
 *
 * La macchina degli stati della fake per `acquisizione-firma` nella fase iniziale e' un'ipotesi dedotta dai nomi
 * degli stati (FEDELTA.md §8.2): da verificare sulla demo.
 */
describe('P3 — firme di partenza contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p3')

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
      produttoreId: 'produttore-oracolo-p3',
      trasportatoreId: 'trasportatore-oracolo-p3',
      destinatarioId: 'destinatario-oracolo-p3',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-P3-000001', {
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

  function creaServizi(
    firRepository: FIRRepositoryFake,
    client: RENTRIApiClient,
    cf: string,
    sessioni: SessioniFirmaRentriInMemoria
  ) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: cf }) },
    }
    const getAzioni = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )
    const completa = new CompletaOperazioneConFirmaUseCase(
      firRepository as any,
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('P3CRED001') } as any,
      client,
      creaRateLimiter().servizio,
      sessioni,
      creaLogger()
    )
    const eventi = new EventiFirRentriInMemoria()
    const firmaPartenza = new FirmaPartenzaRentriUseCase(
      firRepository as any,
      getAzioni,
      completa,
      eventi,
      creaLogger(),
      { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
    )
    const gestisci = new GestisciSessioneFirmaRentriUseCase(
      firRepository as any,
      sessioni,
      completa,
      creaLogger(),
      firmaPartenza,
      {} as any, // AnnotazioneRentriUseCase: non usato dalle firme di partenza
      {} as any // SostaTecnicaRentriUseCase: non usato dalle firme di partenza
    )
    return { completa, firmaPartenza, eventi, gestisci }
  }

  /**
   * Completa ogni transazione NONBLOCK_PULL aperta: `/hash` (nessun contesto di dominio) con digest e
   * token; tutte le altre con esito vuoto, in errore se l'operazione e' in `inErrore`.
   */
  function avviaCompletatore(inErrore: string[] = []): { ferma: () => void } {
    let attivo = true
    const gestite = new Set<string>()
    const giro = async (): Promise<void> => {
      while (attivo) {
        const mappa: Map<string, any> = (app.archivio as any).transazioni
        for (const t of [...mappa.values()]) {
          if (t.stato !== 'in_elaborazione' || gestite.has(t.id)) continue
          gestite.add(t.id)
          const operazione = t.contestoOperazione?.operazione as string | undefined
          const errore = operazione !== undefined && inErrore.includes(operazione)
          await app.inject({
            method: 'POST',
            url: '/__controllo/completa-transazione',
            payload: {
              transazione_id: t.id,
              errore,
              validazione: errore ? [{ tipo: 'Errore', codice_messaggio: 'FIR-996' }] : [],
              esito:
                operazione === undefined
                  ? {
                      hash_algorithm: '2.16.840.1.101.3.4.2.1',
                      digest_to_sign: DIGEST,
                      token: TOKEN,
                      versione: 1,
                    }
                  : {},
            },
          })
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    void giro()
    return { ferma: () => (attivo = false) }
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

  const DIGEST = Buffer.from('digest-oracolo-p3').toString('base64')
  const TOKEN = 'token-oracolo-p3'
  const CF = 'RSSMRA80A01H501U'

  async function preparaFirDaFirmare(numeroFir: string, tenantId: string, stato: string) {
    await seminaFormulario({
      numero_fir: numeroFir,
      stato,
      identificativo_soggetto: CF,
    })
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    const sessioni = new SessioniFirmaRentriInMemoria()
    return {
      fir,
      firRepository,
      client,
      sessioni,
      ...creaServizi(firRepository, client, CF, sessioni),
    }
  }

  const TEMPI = { intervalloPollingMs: 5, attesaMassimaMs: 2000 }

  it('firma di partenza: /azioni sceglie l operazione, lo stato di viaggio e riletto dall ente e finisce nello storico', async () => {
    const tenantId = 'tenant-oracolo-p3-1'
    const numeroFir = 'BCDFGH00050ZH'
    const { fir, firRepository, client, sessioni, firmaPartenza, eventi } =
      await preparaFirDaFirmare(numeroFir, tenantId, 'FirmaProduttoreTrasportatoreIniziale')
    agganciaConfermaAutomatica(client)
    const completatore = avviaCompletatore()

    try {
      const esito = await firmaPartenza.execute({
        firId: fir.id,
        tenantId,
        utenteId: 'u-1',
        ...TEMPI,
      })

      expect(esito).toEqual({
        operazione: 'AcquisizioneFirmaProduttoreTrasportatore',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      })
      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'InserimentoAccettazione'
      )
      expect((await firRepository.findById(fir.id))!.rentriStatoFormulario).toBe(
        'InserimentoAccettazione'
      )
      expect(sessioni.righe.map(s => s.stato)).toEqual(['COMPLETATA'])
      const storico = await eventi.elenca(tenantId, fir.id)
      expect(storico).toHaveLength(1)
      expect(storico[0]).toMatchObject({
        operazione: 'AcquisizioneFirmaProduttoreTrasportatore',
        esito: 'ACCETTATA',
        statoFormularioDopo: 'InserimentoAccettazione',
      })
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('nessuna doppia firma: due richieste = UNA authorize, la seconda riprende lo stesso handle', async () => {
    const tenantId = 'tenant-oracolo-p3-2'
    const numeroFir = 'BCDFGH00050ZB'
    const { fir, client, sessioni, firmaPartenza } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaProduttoreTrasportatoreIniziale'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const hash = jest.spyOn(client, 'richiediHashPerFirma')
    const completatore = avviaCompletatore()

    try {
      const comando = { firId: fir.id, tenantId, intervalloPollingMs: 5, attesaMassimaMs: 100 }
      // L'utente non ha ancora confermato sul telefono.
      const prima = await firmaPartenza.execute(comando)
      expect(prima.firma.esito).toBe('IN_ATTESA')
      const handle = (prima.firma as { handle: string }).handle

      await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })
      const seconda = await firmaPartenza.execute(comando)

      expect(seconda.firma).toEqual({
        esito: 'COMPLETATA',
        statoFormulario: 'InserimentoAccettazione',
      })
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(hash).toHaveBeenCalledTimes(1)
      expect(sessioni.righe.map(s => s.stato)).toEqual(['COMPLETATA'])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('ente non pronto (mancano i dati del viaggio): 409 FIRMA_PARTENZA_NON_DISPONIBILE senza authorize', async () => {
    const tenantId = 'tenant-oracolo-p3-3'
    const numeroFir = 'BCDFGH00050ZC'
    const { fir, client, firmaPartenza } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoTrasportoIniziale'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')

    await expect(
      firmaPartenza.execute({ firId: fir.id, tenantId, ...TEMPI })
    ).rejects.toMatchObject({ metadata: { rule: 'FIRMA_PARTENZA_NON_DISPONIBILE' } })
    expect(authorize).not.toHaveBeenCalled()
  })

  describe('dopo un azione locale riuscita (Emetti, Presa in carico)', () => {
    it('esito 1 — firma riuscita: COMPLETATA, il formulario e in viaggio', async () => {
      const tenantId = 'tenant-oracolo-p3-4'
      const numeroFir = 'BCDFGH00050ZD'
      const { fir, client, firmaPartenza } = await preparaFirDaFirmare(
        numeroFir,
        tenantId,
        'FirmaProduttoreTrasportatoreIniziale'
      )
      agganciaConfermaAutomatica(client)
      const completatore = avviaCompletatore()

      try {
        const esito = await firmaPartenza.dopoAzioneLocale({ firId: fir.id, tenantId, ...TEMPI })

        expect(esito).toEqual({ stato: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      } finally {
        completatore.ferma()
      }
    }, 60000)

    it('esito 2 — firma rifiutata dall ente: nessuna eccezione, avviso «firma RENTRI da completare», stato invariato', async () => {
      const tenantId = 'tenant-oracolo-p3-5'
      const numeroFir = 'BCDFGH00050ZK'
      const { fir, client, firRepository, sessioni, firmaPartenza, eventi } =
        await preparaFirDaFirmare(numeroFir, tenantId, 'FirmaProduttoreTrasportatoreIniziale')
      agganciaConfermaAutomatica(client)
      const completatore = avviaCompletatore(['AcquisizioneFirma'])

      try {
        const esito = await firmaPartenza.dopoAzioneLocale({ firId: fir.id, tenantId, ...TEMPI })

        expect(esito).toMatchObject({ stato: 'DA_COMPLETARE', codice: 'FIRMA_RENTRI_RIFIUTATA' })
        expect((esito as { avviso: string }).avviso).toMatch(/firma RENTRI da completare/i)
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
          'FirmaProduttoreTrasportatoreIniziale'
        )
        expect((await firRepository.findById(fir.id))!.stato).toBe(fir.stato)
        expect(sessioni.righe.map(s => s.stato)).toEqual(['RIFIUTATA'])
        expect((await eventi.elenca(tenantId, fir.id))[0]).toMatchObject({ esito: 'RIFIUTATA' })
      } finally {
        completatore.ferma()
      }
    }, 60000)

    it('FIR non legato (flusso cartaceo): NON_APPLICABILE, nessuna chiamata all ente', async () => {
      const tenantId = 'tenant-oracolo-p3-6'
      const { client, sessioni, firRepository, firmaPartenza } = await preparaFirDaFirmare(
        'BCDFGH00050ZM',
        tenantId,
        'FirmaProduttoreTrasportatoreIniziale'
      )
      const cartaceo = FIR.create({
        produttoreId: 'p',
        trasportatoreId: 't',
        destinatarioId: 'd',
        tenantId,
        rifiuto: { cerCode: '150101', quantita: 100 },
      })
      await firRepository.save(cartaceo)
      const richieste = jest.spyOn(client, 'leggiAzioniDisponibili')

      const esito = await firmaPartenza.dopoAzioneLocale({ firId: cartaceo.id, tenantId })

      expect(esito).toMatchObject({ stato: 'NON_ANCORA_LEGATO' })
      expect(richieste).not.toHaveBeenCalled()
      expect(sessioni.righe).toHaveLength(0)
    })
  })

  it('I1: IN_ATTESA, conferma sul telefono, «Ho confermato» (riprendi) = storico [INVIATA, ACCETTATA] e una sola authorize', async () => {
    const tenantId = 'tenant-oracolo-p3-7'
    const numeroFir = 'BCDFGH00050ZN'
    const { fir, client, sessioni, firmaPartenza, gestisci, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaProduttoreTrasportatoreIniziale'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const completatore = avviaCompletatore()

    try {
      const prima = await firmaPartenza.execute({
        firId: fir.id,
        tenantId,
        intervalloPollingMs: 5,
        attesaMassimaMs: 100,
      })
      expect(prima.firma.esito).toBe('IN_ATTESA')
      const handle = (prima.firma as { handle: string }).handle
      await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })

      const esito = await gestisci.riprendi({
        firId: fir.id,
        tenantId,
        sessioneId: sessioni.righe[0].id,
        utenteId: 'u-1',
      })

      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      expect(authorize).toHaveBeenCalledTimes(1)
      const storico = (await eventi.elenca(tenantId, fir.id)).map(e => e.esito).sort()
      expect(storico).toEqual(['ACCETTATA', 'INVIATA'])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('I1: «Richiedi di nuovo» dopo SCADUTA quando /azioni non propone piu la firma: 409 senza authorize', async () => {
    const tenantId = 'tenant-oracolo-p3-8'
    const numeroFir = 'BCDFGH00050ZP'
    const { fir, client, sessioni, firmaPartenza, gestisci } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaProduttoreTrasportatoreIniziale'
    )
    const completatore = avviaCompletatore()

    try {
      await firmaPartenza.execute({
        firId: fir.id,
        tenantId,
        intervalloPollingMs: 5,
        attesaMassimaMs: 100,
      })
      sessioni.righe[0].stato = 'SCADUTA'
      // Nel frattempo la partenza e' stata firmata altrove: l'ente non la propone piu.
      await app.inject({
        method: 'POST',
        url: '/__controllo/formulario',
        payload: {
          numero_fir: numeroFir,
          stato: 'InserimentoAccettazione',
          identificativo_soggetto: CF,
        },
      })
      const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')

      await expect(
        gestisci.riprendi({
          firId: fir.id,
          tenantId,
          sessioneId: sessioni.righe[0].id,
          nuovaSessione: true,
        })
      ).rejects.toMatchObject({ metadata: { rule: 'FIRMA_PARTENZA_NON_DISPONIBILE' } })
      expect(authorize).not.toHaveBeenCalled()
    } finally {
      completatore.ferma()
    }
  }, 60000)
})
