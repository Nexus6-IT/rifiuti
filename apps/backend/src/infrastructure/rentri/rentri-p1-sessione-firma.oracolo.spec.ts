import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { RollbackEResetFirRentriUseCase } from '../../application/rentri/rollback-e-reset-fir-rentri.use-case'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from '../../application/rentri/sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P1 (T1-T3) contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - ripresa della firma: due `execute()` = UNA sola `authorize`, la seconda aggancia lo stesso handle;
 * - reset («Annulla la richiesta»): FirmaAnnullamento -> stato precedente, sessione ANNULLATA;
 * - rollback-firma: Accettato -> FirmaAccettazione; guardia `/azioni` quando non disponibile.
 *
 * La macchina degli stati della fake per `Reset`/`RollbackFirma` e' modellata sul contratto
 * (formulari.yaml righe 1888 e 2079): il rollback ricostruisce l'attesa di firma precedente.
 */
describe('P1 — firma riprendibile, reset e rollback contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p1')

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
      produttoreId: 'produttore-oracolo-p1',
      trasportatoreId: 'trasportatore-oracolo-p1',
      destinatarioId: 'destinatario-oracolo-p1',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-P1-000001', {
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
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('P1CRED001') } as any,
      client,
      creaRateLimiter().servizio,
      sessioni,
      creaLogger()
    )
    const rollbackReset = new RollbackEResetFirRentriUseCase(
      firRepository as any,
      getAzioni,
      client,
      sessioni,
      creaLogger(),
      new EventiFirRentriInMemoria()
    )
    return { completa, rollbackReset }
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

  const DIGEST = Buffer.from('digest-oracolo-p1').toString('base64')
  const TOKEN = 'token-oracolo-p1'
  const CF = 'RSSMRA80A01H501U'

  async function preparaAnnullaInAttesa(numeroFir: string, tenantId: string) {
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoQuantita',
      identificativo_soggetto: CF,
    })
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const servizi = creaServizi(firRepository, client, CF, sessioni)
    // Porta il formulario in FirmaAnnullamento (dato inserito, non ancora firmato).
    const completatore = avviaCompletatore()
    try {
      const esito = await client.annullaFormulario(tenantId, numeroFir)
      expect(esito.errore).toBe(false)
    } finally {
      completatore.ferma()
    }
    return { fir, firRepository, client, sessioni, ...servizi }
  }

  it('due execute() sullo stesso FIR: UNA sola authorize, la seconda riprende lo stesso handle e chiude', async () => {
    const tenantId = 'tenant-oracolo-p1-1'
    const numeroFir = 'BCDFGH00040ZH'
    const { fir, client, sessioni, completa } = await preparaAnnullaInAttesa(numeroFir, tenantId)
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const hash = jest.spyOn(client, 'richiediHashPerFirma')
    const completatore = avviaCompletatore()

    try {
      const comando = {
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ANNULLAMENTO',
        intervalloPollingMs: 5,
        attesaMassimaMs: 100,
      }
      // L'utente non ha ancora confermato sul telefono.
      const prima = await completa.execute(comando)
      expect(prima.esito).toBe('IN_ATTESA')
      const handle = (prima as { handle: string }).handle

      // Conferma sul telefono, poi la SECONDA invocazione (stesso FIR, stessa operazione).
      await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })
      const seconda = await completa.execute(comando)

      expect(seconda).toEqual({ esito: 'COMPLETATA', statoFormulario: 'Annullato' })
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(hash).toHaveBeenCalledTimes(1)
      expect(sessioni.righe.map(s => s.stato)).toEqual(['COMPLETATA'])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('reset («Annulla la richiesta»): torna allo stato precedente e annulla la sessione in attesa', async () => {
    const tenantId = 'tenant-oracolo-p1-2'
    const numeroFir = 'BCDFGH00040ZB'
    const { fir, client, sessioni, completa, rollbackReset } = await preparaAnnullaInAttesa(
      numeroFir,
      tenantId
    )
    expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
      'FirmaAnnullamento'
    )
    const completatore = avviaCompletatore()

    try {
      const inAttesa = await completa.execute({
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ANNULLAMENTO',
        intervalloPollingMs: 5,
        attesaMassimaMs: 60,
      })
      expect(inAttesa.esito).toBe('IN_ATTESA')

      const r = await rollbackReset.execute({ firId: fir.id, tenantId, operazione: 'Reset' })

      expect(r).toMatchObject({ operazione: 'Reset', statoFormulario: 'InserimentoQuantita' })
      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'InserimentoQuantita'
      )
      expect(sessioni.righe.map(s => s.stato)).toEqual(['ANNULLATA'])
      expect(r.sessioneAnnullataId).toBe(sessioni.righe[0].id)
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('Reset non disponibile (nessun dato in attesa di firma): 409 e nessuna chiamata a /reset', async () => {
    const tenantId = 'tenant-oracolo-p1-3'
    const numeroFir = 'BCDFGH00040ZC'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'Accettato',
      identificativo_soggetto: CF,
    })
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    const { rollbackReset } = creaServizi(
      firRepository,
      client,
      CF,
      new SessioniFirmaRentriInMemoria()
    )
    const reset = jest.spyOn(client, 'resetStato')

    await expect(
      rollbackReset.execute({ firId: fir.id, tenantId, operazione: 'Reset' })
    ).rejects.toMatchObject({ metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' } })
    expect(reset).not.toHaveBeenCalled()
  })

  it('l ente rifiuta il reset: errore leggibile e stato locale invariato', async () => {
    const tenantId = 'tenant-oracolo-p1-4'
    const numeroFir = 'BCDFGH00040ZD'
    const { fir, firRepository, rollbackReset } = await preparaAnnullaInAttesa(numeroFir, tenantId)
    const statoPrima = (await firRepository.findById(fir.id))!.rentriStatoFormulario
    const completatore = avviaCompletatore(['Reset'])

    try {
      await expect(
        rollbackReset.execute({ firId: fir.id, tenantId, operazione: 'Reset' })
      ).rejects.toMatchObject({ metadata: { rule: 'RESET_RENTRI_RIFIUTATO' } })
      // /azioni aveva gia riconciliato lo stato (FirmaAnnullamento): il rifiuto non lo cambia.
      expect((await firRepository.findById(fir.id))!.rentriStatoFormulario).toBe(
        'FirmaAnnullamento'
      )
      expect(statoPrima).not.toBe('InserimentoQuantita')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('rollback-firma: dopo l accettazione firmata riporta a FirmaAccettazione', async () => {
    const tenantId = 'tenant-oracolo-p1-5'
    const numeroFir = 'BCDFGH00040ZK'
    await seminaFormulario({
      numero_fir: numeroFir,
      stato: 'InserimentoAccettazione',
      identificativo_soggetto: CF,
    })
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    agganciaConfermaAutomatica(client)
    const sessioni = new SessioniFirmaRentriInMemoria()
    const { completa, rollbackReset } = creaServizi(firRepository, client, CF, sessioni)
    const completatore = avviaCompletatore()

    try {
      // Come fa lo use case di accettazione: prima /azioni (l'ente decide cosa e' ammesso).
      await client.leggiAzioniDisponibili(tenantId, numeroFir, CF)
      const accettazione = await client.inviaAccettazione(tenantId, numeroFir, {
        tipoAccettazione: 'A',
        dataOraArrivo: new Date().toISOString(),
        quantitaAccettataKg: 100,
      })
      expect(accettazione.errore).toBe(false)
      const firmata = await completa.execute({
        firId: fir.id,
        tenantId,
        tipoOperazione: 'ACCETTAZIONE',
        intervalloPollingMs: 5,
        attesaMassimaMs: 2000,
      })
      expect(firmata).toEqual({ esito: 'COMPLETATA', statoFormulario: 'Accettato' })

      const r = await rollbackReset.execute({
        firId: fir.id,
        tenantId,
        operazione: 'RollbackFirma',
      })

      expect(r).toMatchObject({ operazione: 'RollbackFirma', statoFormulario: 'FirmaAccettazione' })
      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'FirmaAccettazione'
      )
    } finally {
      completatore.ferma()
    }
  }, 60000)
})
