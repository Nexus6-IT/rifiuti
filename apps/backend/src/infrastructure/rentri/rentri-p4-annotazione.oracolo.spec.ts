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
import { AnnotazioneRentriUseCase } from '../../application/rentri/annotazione-rentri.use-case'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from '../../application/rentri/sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P4 contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - annotazione: `/azioni` la propone, il CF del tenant viaggia come `identificativo_soggetto`, il formulario passa a
 *   `FirmaAnnotazione`, la firma lo riporta allo stato di prima (RILETTO dall'ente) e tutto finisce nello storico;
 * - ripresa: due richieste di firma = UNA sola `authorize`;
 * - nessuna doppia annotazione, CF fuori dal FIR, firma rifiutata.
 *
 * La macchina degli stati della fake per `annotazione` e' un'ipotesi dedotta dai nomi degli stati
 * (FEDELTA.md §8.3): da verificare sulla demo.
 */
describe('P4 — annotazione contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p4')

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
      produttoreId: 'produttore-oracolo-p4',
      trasportatoreId: 'trasportatore-oracolo-p4',
      destinatarioId: 'destinatario-oracolo-p4',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
      // Il CF del tenant compare fra i soggetti del FIR (condizione dell'annotazione).
      produttore: { ragioneSociale: 'Produttore di prova SRL', partitaIva: '', codiceFiscale: CF },
    })
    fir.emetti('FIR-ORACOLO-P4-000001', {
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
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('P4CRED001') } as any,
      client,
      creaRateLimiter().servizio,
      sessioni,
      creaLogger()
    )
    const eventi = new EventiFirRentriInMemoria()
    const moduli = { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
    const firmaPartenza = new FirmaPartenzaRentriUseCase(
      firRepository as any,
      getAzioni,
      completa,
      eventi,
      creaLogger(),
      moduli
    )
    const annotazione = new AnnotazioneRentriUseCase(
      firRepository as any,
      getAzioni,
      client,
      completa,
      eventi,
      creaLogger(),
      sessioni,
      moduli,
      prisma
    )
    const gestisci = new GestisciSessioneFirmaRentriUseCase(
      firRepository as any,
      sessioni,
      completa,
      creaLogger(),
      firmaPartenza,
      annotazione
    )
    return { completa, annotazione, eventi, gestisci }
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

  const CF = 'RSSMRA80A01H501U'
  const DIGEST = Buffer.from('digest-oracolo-p4').toString('base64')
  const TOKEN = 'token-oracolo-p4'

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
  const TESTO = 'Il carico è stato pesato due volte alla partenza.'

  it.each(['InserimentoAccettazione', 'Accettato'])(
    'da %s: annotazione + firma, lo stato torna a quello di prima (riletto dall ente) e finisce nello storico',
    async partenza => {
      const tenantId = `tenant-oracolo-p4-${partenza}`
      const numeroFir = partenza === 'Accettato' ? 'BCDFGH00060ZH' : 'BCDFGH00060ZB'
      const { fir, firRepository, client, sessioni, annotazione, eventi } =
        await preparaFirDaFirmare(numeroFir, tenantId, partenza)
      agganciaConfermaAutomatica(client)
      const inviaAnnotazione = jest.spyOn(client, 'inviaAnnotazione')
      const completatore = avviaCompletatore()

      try {
        const esito = await annotazione.invia({
          firId: fir.id,
          tenantId,
          testo: TESTO,
          utenteId: 'u-1',
          ...TEMPI,
        })

        expect(esito).toEqual({
          operazione: 'Annotazione',
          statoFormulario: 'FirmaAnnotazione',
          firma: { esito: 'COMPLETATA', statoFormulario: partenza },
        })
        // Il CF dell'azienda e' l'identificativo del soggetto e il corpo e' quello del contratto.
        expect(inviaAnnotazione).toHaveBeenCalledWith(tenantId, numeroFir, {
          annotazione: TESTO,
          identificativo_soggetto: CF,
        })
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(partenza)
        expect((await firRepository.findById(fir.id))!.rentriStatoFormulario).toBe(partenza)
        expect(sessioni.righe.map(s => [s.tipoOperazione, s.stato])).toEqual([
          ['ANNOTAZIONE', 'COMPLETATA'],
        ])
        const storico = (await eventi.elenca(tenantId, fir.id)).reverse()
        expect(storico.map(e => [e.operazione, e.esito])).toEqual([
          ['Annotazione', 'ACCETTATA'],
          ['AcquisizioneFirmaAnnotazione', 'ACCETTATA'],
        ])
        expect(storico[0].payload).toEqual({ annotazione: TESTO, identificativo_soggetto: CF })
      } finally {
        completatore.ferma()
      }
    },
    60000
  )

  it('nessuna doppia annotazione ne doppia firma: con la firma in attesa una seconda annotazione e un 409 e la ripresa usa UNA authorize', async () => {
    const tenantId = 'tenant-oracolo-p4-3'
    const numeroFir = 'BCDFGH00060ZC'
    const { fir, client, sessioni, annotazione, gestisci, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const inviaAnnotazione = jest.spyOn(client, 'inviaAnnotazione')
    const completatore = avviaCompletatore()

    try {
      const prima = await annotazione.invia({
        firId: fir.id,
        tenantId,
        testo: TESTO,
        intervalloPollingMs: 5,
        attesaMassimaMs: 100,
      })
      // L'utente non ha ancora confermato sul telefono.
      expect(prima.firma.esito).toBe('IN_ATTESA')
      const handle = (prima.firma as { handle: string }).handle

      await expect(
        annotazione.invia({ firId: fir.id, tenantId, testo: 'Altra annotazione', ...TEMPI })
      ).rejects.toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_IN_CORSO' } })
      expect(inviaAnnotazione).toHaveBeenCalledTimes(1)

      await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })
      const esito = await gestisci.riprendi({
        firId: fir.id,
        tenantId,
        sessioneId: sessioni.righe[0].id,
        utenteId: 'u-1',
      })

      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      expect(authorize).toHaveBeenCalledTimes(1)
      const storico = (await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])
      expect(storico).toEqual(
        expect.arrayContaining([
          ['Annotazione', 'ACCETTATA'],
          ['AcquisizioneFirmaAnnotazione', 'INVIATA'],
          ['AcquisizioneFirmaAnnotazione', 'ACCETTATA'],
        ])
      )
      expect(storico).toHaveLength(3)
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('annotazione gia scritta e firma non conclusa: una seconda annotazione e 409 ANNOTAZIONE_DA_FIRMARE e «firma» la completa', async () => {
    const tenantId = 'tenant-oracolo-p4-4'
    const numeroFir = 'BCDFGH00060ZD'
    // Stato dell'ente: annotazione registrata, firma ancora da dare, nessuna sessione locale aperta.
    const { fir, client, annotazione } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaAnnotazione'
    )
    agganciaConfermaAutomatica(client)
    const inviaAnnotazione = jest.spyOn(client, 'inviaAnnotazione')
    const completatore = avviaCompletatore()

    try {
      await expect(
        annotazione.invia({ firId: fir.id, tenantId, testo: TESTO, ...TEMPI })
      ).rejects.toMatchObject({ metadata: { rule: 'ANNOTAZIONE_DA_FIRMARE' } })
      expect(inviaAnnotazione).not.toHaveBeenCalled()

      const esito = await annotazione.firma({ firId: fir.id, tenantId, ...TEMPI })
      expect(esito.esito).toBe('COMPLETATA')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('CF del tenant fuori dal FIR: 409 chiaro senza alcuna chiamata di scrittura all ente', async () => {
    const tenantId = 'tenant-oracolo-p4-5'
    const numeroFir = 'BCDFGH00060ZK'
    const { fir, firRepository, client, annotazione } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    // FIR di un altro produttore: il CF dell'azienda non compare fra i soggetti.
    const altro = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 1 },
      produttore: { ragioneSociale: 'Altra SRL', partitaIva: '01234567897' },
    })
    altro.emetti('FIR-ALTRO-1', { firmatario: 'x', timestamp: new Date(), certificato: 'c' })
    altro.markRENTRISynced(numeroFir)
    await firRepository.save(altro)
    const inviaAnnotazione = jest.spyOn(client, 'inviaAnnotazione')
    const azioni = jest.spyOn(client, 'leggiAzioniDisponibili')

    await expect(
      annotazione.invia({ firId: altro.id, tenantId, testo: TESTO, ...TEMPI })
    ).rejects.toMatchObject({ metadata: { rule: 'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR' } })
    expect(inviaAnnotazione).not.toHaveBeenCalled()
    expect(azioni).not.toHaveBeenCalled()
    expect(fir.id).not.toBe(altro.id)
  })

  it('l ente rifiuta l annotazione (esito in errore): 400 ANNOTAZIONE_RENTRI_RIFIUTATA, evento RIFIUTATA, stato invariato, nessuna firma', async () => {
    const tenantId = 'tenant-oracolo-p4-6'
    const numeroFir = 'BCDFGH00060ZM'
    const { fir, client, sessioni, annotazione, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const completatore = avviaCompletatore(['Annotazione'])

    try {
      await expect(
        annotazione.invia({ firId: fir.id, tenantId, testo: TESTO, ...TEMPI })
      ).rejects.toMatchObject({ metadata: { rule: 'ANNOTAZIONE_RENTRI_RIFIUTATA' } })

      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'InserimentoAccettazione'
      )
      expect(authorize).not.toHaveBeenCalled()
      expect(sessioni.righe).toHaveLength(0)
      expect((await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])).toEqual([
        ['Annotazione', 'RIFIUTATA'],
      ])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('firma rifiutata dall ente: l annotazione resta registrata, esito RIFIUTATA, sessione RIFIUTATA e si puo richiedere di nuovo', async () => {
    const tenantId = 'tenant-oracolo-p4-7'
    const numeroFir = 'BCDFGH00060ZN'
    const { fir, client, sessioni, annotazione, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    agganciaConfermaAutomatica(client)
    const completatore = avviaCompletatore(['AcquisizioneFirma'])

    try {
      const esito = await annotazione.invia({ firId: fir.id, tenantId, testo: TESTO, ...TEMPI })

      expect(esito.statoFormulario).toBe('FirmaAnnotazione')
      expect(esito.firma).toMatchObject({
        esito: 'DA_COMPLETARE',
        codice: 'FIRMA_RENTRI_RIFIUTATA',
      })
      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'FirmaAnnotazione'
      )
      expect(sessioni.righe.map(s => s.stato)).toEqual(['RIFIUTATA'])
      const storico = (await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])
      expect(storico).toEqual(
        expect.arrayContaining([
          ['Annotazione', 'ACCETTATA'],
          ['AcquisizioneFirmaAnnotazione', 'RIFIUTATA'],
        ])
      )
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('Annotazione non e proposta in una fase di firma iniziale: 409 OPERAZIONE_NON_DISPONIBILE senza scritture', async () => {
    const tenantId = 'tenant-oracolo-p4-8'
    const numeroFir = 'BCDFGH00060ZP'
    const { fir, client, annotazione } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaProduttoreTrasportatoreIniziale'
    )
    const inviaAnnotazione = jest.spyOn(client, 'inviaAnnotazione')

    await expect(
      annotazione.invia({ firId: fir.id, tenantId, testo: TESTO, ...TEMPI })
    ).rejects.toMatchObject({ metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' } })
    expect(inviaAnnotazione).not.toHaveBeenCalled()
  })
})
