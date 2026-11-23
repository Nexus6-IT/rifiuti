import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { CompletaOperazioneConFirmaUseCase } from '../../application/rentri/completa-operazione-con-firma.use-case'
import { TrasbordoTotaleRentriUseCase } from '../../application/rentri/trasbordo-totale-rentri.use-case'
import { DatiViaggioFirInMemoria } from '../../application/rentri/dati-viaggio-fir.in-memoria'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from '../../application/rentri/sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P6 contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - trasbordo totale: `/azioni` lo propone, il corpo e' quello del contratto (validato dalla fake), il
 *   formulario passa a `FirmaTrasbordoTotale` e SOLO ALLORA nasce la tratta locale del nuovo trasportatore;
 * - la firma e' del NUOVO trasportatore: chi ha dichiarato il trasbordo non firma, il nuovo trasportatore firma
 *   con UNA sola `authorize` e il formulario torna allo stato di prima (riletto dall'ente);
 * - ente che rifiuta, POST perso e risposta persa: nessuna tratta locale finche' l'ente non la mostra;
 * - invii concorrenti = un POST; ammesso solo in viaggio, non da `Accettato`.
 *
 * La macchina degli stati della fake per `trasbordo-totale` e' un'ipotesi dedotta dai nomi degli stati
 * (FEDELTA.md §8.5): da verificare sulla demo.
 */
describe('P6 — trasbordo totale contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p6')

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

  /** Vecchio trasportatore (CF) che ha in carico il rifiuto; il nuovo e' un'altra azienda (CF_NUOVO). */
  const CF = 'RSSMRA80A01H501U'
  const CF_NUOVO = '01234567890'
  const NUOVO_ID = 'trasportatore-nuovo-p6'
  const DIGEST = Buffer.from('digest-oracolo-p6').toString('base64')
  const TOKEN = 'token-oracolo-p6'

  function creaFIRLegato(tenantId: string, numeroFir: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-oracolo-p6',
      trasportatoreId: 'trasportatore-oracolo-p6',
      destinatarioId: 'destinatario-oracolo-p6',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatore: {
        ragioneSociale: 'Trasporti di prova SRL',
        partitaIva: '',
        codiceFiscale: CF,
      },
    })
    fir.emetti('FIR-ORACOLO-P6-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  function datiViaggioPer(firId: string): DatiViaggioFirInMemoria {
    const d = new DatiViaggioFirInMemoria()
    d.righe.set(firId, {
      firId,
      dichiarato: null,
      quantita: 100,
      unitaMisura: 'kg',
      numeroColli: null,
      verificatoInPartenza: null,
      rinfusa: null,
      dataTrasporto: new Date('2026-11-18T08:00:00Z'),
      targaAutomezzo: '',
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
    })
    return d
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
    sessioni: SessioniFirmaRentriInMemoria,
    datiViaggio: DatiViaggioFirInMemoria
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
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('P6CRED001') } as any,
      client,
      creaRateLimiter().servizio,
      sessioni,
      creaLogger()
    )
    const eventi = new EventiFirRentriInMemoria()
    const moduli = { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
    const anagrafica = {
      id: NUOVO_ID,
      ragioneSociale: 'Trasporti Verdi Srl',
      partitaIVA: { getValue: () => CF_NUOVO },
      codiceFiscale: undefined,
      numeroIscrizione: 'MI/7490',
    }
    const trasbordo = new TrasbordoTotaleRentriUseCase(
      firRepository as any,
      getAzioni,
      client,
      completa,
      eventi,
      creaLogger(),
      sessioni,
      moduli,
      prisma,
      { findById: jest.fn().mockResolvedValue(anagrafica) } as any,
      datiViaggio
    )
    return { completa, trasbordo, eventi }
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

  /** Un'azienda con il suo FIR legato e i suoi servizi, sul formulario `numeroFir` gia' seminato nella fake. */
  async function azienda(numeroFir: string, tenantId: string, cf: string) {
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const datiViaggio = datiViaggioPer(fir.id)
    return {
      fir,
      firRepository,
      client,
      sessioni,
      datiViaggio,
      ...creaServizi(firRepository, client, cf, sessioni, datiViaggio),
    }
  }

  async function preparaMittente(numeroFir: string, tenantId: string, stato: string) {
    await seminaFormulario({ numero_fir: numeroFir, stato, identificativo_soggetto: CF })
    return azienda(numeroFir, tenantId, CF)
  }

  const TEMPI = { intervalloPollingMs: 5, attesaMassimaMs: 2000 }
  const INIZIO = '2026-11-18T12:00:00.000Z'
  const CORPO = {
    trasportatore: {
      denominazione: 'Trasporti Verdi Srl',
      codice_fiscale: CF_NUOVO,
      tipo_trasporto: 'Terrestre',
      numero_iscrizione_albo: 'MI/007490',
    },
    presa_in_carico: {
      data_ora_inizio_trasporto: INIZIO,
      conducente: { nome: 'Luca', cognome: 'Bianchi' },
      targa_automezzo: 'FG456HI',
    },
  }
  const COMANDO = {
    trasportatoreId: NUOVO_ID,
    conducenteNome: ' Luca ',
    conducenteCognome: 'Bianchi',
    targaAutomezzo: 'fg456hi',
    // Con offset: all'ente arriva in UTC.
    dataOraInizioTrasporto: '2026-11-18T13:00:00+01:00',
  }

  const storico = async (eventi: EventiFirRentriInMemoria, tenantId: string, firId: string) =>
    (await eventi.elenca(tenantId, firId)).reverse().map(e => [e.operazione, e.esito])

  it.each(['InserimentoAccettazione', 'InserimentoTrasportoSuccessivo'])(
    'da %s: trasbordo -> FirmaTrasbordoTotale, corpo del contratto, tratta locale SOLO dopo l ente, storico',
    async partenza => {
      const tenantId = `tenant-oracolo-p6-${partenza}`
      const numeroFir = partenza === 'InserimentoAccettazione' ? 'BCDFGH00080ZH' : 'BCDFGH00080ZB'
      const { fir, client, trasbordo, eventi, datiViaggio } = await preparaMittente(
        numeroFir,
        tenantId,
        partenza
      )
      const invia = jest.spyOn(client, 'inviaTrasbordoTotale')
      const completatore = avviaCompletatore()

      try {
        const esito = await trasbordo.invia({
          firId: fir.id,
          tenantId,
          ...COMANDO,
          utenteId: 'u-1',
        })

        expect(esito).toMatchObject({
          operazione: 'TrasbordoTotale',
          statoFormulario: 'FirmaTrasbordoTotale',
          trattaLocaleCreata: true,
          firma: { esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE' },
        })
        // Il corpo e' quello del contratto (la fake lo ha validato e accettato): inizio in UTC, targa in maiuscolo.
        expect(invia).toHaveBeenCalledWith(tenantId, numeroFir, CORPO)
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
          'FirmaTrasbordoTotale'
        )
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toEqual([
          expect.objectContaining({
            ordine: 2,
            tipoTratta: 'TERRESTRE',
            denominazione: 'Trasporti Verdi Srl',
            partitaIva: CF_NUOVO,
            conducenteNome: 'Luca',
            mezzo: 'FG456HI',
            dataOraInizioTrasporto: new Date(INIZIO),
          }),
        ])
        expect(await storico(eventi, tenantId, fir.id)).toEqual([
          ['TrasbordoTotale', 'INVIATA'],
          ['TrasbordoTotale', 'ACCETTATA'],
        ])
      } finally {
        completatore.ferma()
      }
    },
    60000
  )

  it('Accettato: il trasbordo totale non e proposto (solo in viaggio), 409 OPERAZIONE_NON_DISPONIBILE, nessuna tratta', async () => {
    const tenantId = 'tenant-oracolo-p6-acc'
    const { fir, client, trasbordo, eventi, datiViaggio } = await preparaMittente(
      'BCDFGH00081ZH',
      tenantId,
      'Accettato'
    )
    const invia = jest.spyOn(client, 'inviaTrasbordoTotale')

    await expect(trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })).rejects.toMatchObject({
      metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' },
    })

    expect(invia).not.toHaveBeenCalled()
    expect(datiViaggio.scritture).toEqual([])
    expect(await eventi.elenca(tenantId, fir.id)).toHaveLength(0)
  })

  it('l ente rifiuta il trasbordo (esito in errore): 400 RIFIUTATO, RIFIUTATA nello storico, stato invariato, NESSUNA tratta locale', async () => {
    const tenantId = 'tenant-oracolo-p6-rif'
    const numeroFir = 'BCDFGH00082ZH'
    const { fir, client, trasbordo, eventi, datiViaggio, sessioni } = await preparaMittente(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const completatore = avviaCompletatore(['TrasbordoTotale'])

    try {
      await expect(trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })).rejects.toMatchObject({
        metadata: { rule: 'TRASBORDO_TOTALE_RENTRI_RIFIUTATO' },
      })

      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'InserimentoAccettazione'
      )
      expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toEqual([])
      expect(datiViaggio.scritture).toEqual([])
      expect(await storico(eventi, tenantId, fir.id)).toEqual([
        ['TrasbordoTotale', 'INVIATA'],
        ['TrasbordoTotale', 'RIFIUTATA'],
      ])
      expect(await sessioni.trovaAperta(tenantId, fir.id)).toBeNull()
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('dati non validi (nessuna targa): 400 locale, nessuna scrittura all ente', async () => {
    const tenantId = 'tenant-oracolo-p6-val'
    const { fir, client, trasbordo, eventi } = await preparaMittente(
      'BCDFGH00083ZH',
      tenantId,
      'InserimentoAccettazione'
    )
    const invia = jest.spyOn(client, 'inviaTrasbordoTotale')

    await expect(
      trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO, targaAutomezzo: undefined })
    ).rejects.toMatchObject({ metadata: { rule: 'TRASBORDO_TOTALE_NON_VALIDO' } })

    expect(invia).not.toHaveBeenCalled()
    expect(await eventi.elenca(tenantId, fir.id)).toHaveLength(0)
  })

  it('due invii concorrenti contro la fake = UN solo POST /trasbordo-totale, l altro 409', async () => {
    const tenantId = 'tenant-oracolo-p6-conc'
    const { fir, client, trasbordo, datiViaggio } = await preparaMittente(
      'BCDFGH00084ZH',
      tenantId,
      'InserimentoAccettazione'
    )
    const invia = jest.spyOn(client, 'inviaTrasbordoTotale')
    const completatore = avviaCompletatore()

    try {
      const esiti = await Promise.allSettled([
        trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO }),
        trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO }),
      ])

      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason).toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_IN_CORSO' } })
      expect(invia).toHaveBeenCalledTimes(1)
      expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toHaveLength(1)
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('la firma e del NUOVO trasportatore: chi ha dichiarato il trasbordo non firma (nessuna authorize), il nuovo firma con UNA authorize e lo stato torna a quello di prima', async () => {
    const numeroFir = 'BCDFGH00085ZH'
    const mittente = await preparaMittente(
      numeroFir,
      'tenant-oracolo-p6-mitt',
      'InserimentoAccettazione'
    )
    const completatore = avviaCompletatore()

    try {
      await mittente.trasbordo.invia({
        firId: mittente.fir.id,
        tenantId: 'tenant-oracolo-p6-mitt',
        ...COMANDO,
      })
      const authorizeMittente = jest.spyOn(mittente.client, 'autorizzaFirmaRemota')

      // Chi ha dichiarato il trasbordo: /azioni gli propone la firma, ma il nuovo trasportatore e' un altro.
      await expect(
        mittente.trasbordo.firma({
          firId: mittente.fir.id,
          tenantId: 'tenant-oracolo-p6-mitt',
          ...TEMPI,
        })
      ).rejects.toMatchObject({ metadata: { rule: 'TRASBORDO_TOTALE_FIRMA_NON_TUA' } })
      expect(authorizeMittente).not.toHaveBeenCalled()

      // Il nuovo trasportatore (altra azienda, stesso formulario presso l'ente).
      const nuovo = await azienda(numeroFir, 'tenant-oracolo-p6-nuovo', CF_NUOVO)
      agganciaConfermaAutomatica(nuovo.client)
      const authorize = jest.spyOn(nuovo.client, 'autorizzaFirmaRemota')

      const esito = await nuovo.trasbordo.firma({
        firId: nuovo.fir.id,
        tenantId: 'tenant-oracolo-p6-nuovo',
        utenteId: 'u-2',
        ...TEMPI,
      })

      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      expect(authorize).toHaveBeenCalledTimes(1)
      expect(
        (await nuovo.client.leggiStato('tenant-oracolo-p6-nuovo', numeroFir)).stato_formulario
      ).toBe('InserimentoAccettazione')
      expect(soloFirmaTipi(nuovo.sessioni)).toEqual([['TRASBORDO_TOTALE', 'COMPLETATA']])
      expect(await storico(nuovo.eventi, 'tenant-oracolo-p6-nuovo', nuovo.fir.id)).toEqual([
        ['AcquisizioneFirmaTrasbordoTotale', 'ACCETTATA'],
      ])
      // Chi firma non aggiunge tratte: il trasbordo l'ha dichiarato qualcun altro.
      expect(nuovo.datiViaggio.scritture).toEqual([])

      // Il trasbordo e' UNO solo: dopo la firma il mittente non puo proporne un secondo.
      await expect(
        mittente.trasbordo.invia({
          firId: mittente.fir.id,
          tenantId: 'tenant-oracolo-p6-mitt',
          ...COMANDO,
        })
      ).rejects.toMatchObject({ metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' } })
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('firma rifiutata dall ente: il trasbordo resta registrato, esito RIFIUTATA, sessione RIFIUTATA', async () => {
    const numeroFir = 'BCDFGH00086ZH'
    const mittente = await preparaMittente(
      numeroFir,
      'tenant-oracolo-p6-m2',
      'InserimentoAccettazione'
    )
    const completatore = avviaCompletatore(['AcquisizioneFirma'])

    try {
      await mittente.trasbordo.invia({
        firId: mittente.fir.id,
        tenantId: 'tenant-oracolo-p6-m2',
        ...COMANDO,
      })
      const nuovo = await azienda(numeroFir, 'tenant-oracolo-p6-n2', CF_NUOVO)
      agganciaConfermaAutomatica(nuovo.client)

      await expect(
        nuovo.trasbordo.firma({ firId: nuovo.fir.id, tenantId: 'tenant-oracolo-p6-n2', ...TEMPI })
      ).rejects.toBeDefined()

      expect(
        (await nuovo.client.leggiStato('tenant-oracolo-p6-n2', numeroFir)).stato_formulario
      ).toBe('FirmaTrasbordoTotale')
      expect(soloFirmaTipi(nuovo.sessioni)).toEqual([['TRASBORDO_TOTALE', 'RIFIUTATA']])
      expect(await storico(nuovo.eventi, 'tenant-oracolo-p6-n2', nuovo.fir.id)).toEqual([
        ['AcquisizioneFirmaTrasbordoTotale', 'RIFIUTATA'],
      ])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  describe('invio senza esito riconciliato con il dettaglio del formulario', () => {
    const { TrasmissioneRentriIncertaError } = jest.requireActual('./rentri-api.client')

    /** Il POST arriva all'ente (e viene elaborato) ma la risposta si perde: esito INCERTA da noi. */
    function rispostaPersaDopoIlPost(client: RENTRIApiClient) {
      const originale = client.inviaTrasbordoTotale.bind(client)
      return jest
        .spyOn(client, 'inviaTrasbordoTotale')
        .mockImplementationOnce(async (...argomenti: Parameters<typeof originale>) => {
          await originale(...argomenti)
          throw new TrasmissioneRentriIncertaError('HTTP_5XX', 503, 'trasbordo totale')
        })
    }

    it('INCERTA -> presente: nessuna tratta subito, errore dedicato (non un 500); al tentativo dopo l ente lo mostra e SOLO allora nasce la tratta (una volta), senza un secondo POST', async () => {
      const tenantId = 'tenant-oracolo-p6-r1'
      const numeroFir = 'BCDFGH00087ZH'
      const { fir, client, trasbordo, eventi, datiViaggio } = await preparaMittente(
        numeroFir,
        tenantId,
        'InserimentoAccettazione'
      )
      const invia = rispostaPersaDopoIlPost(client)
      const completatore = avviaCompletatore()

      try {
        await expect(
          trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })
        ).rejects.toMatchObject({
          code: 'BUSINESS_RULE_VIOLATION',
          metadata: { rule: 'TRASBORDO_TOTALE_ESITO_INCERTO' },
        })
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toEqual([])
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
          'FirmaTrasbordoTotale'
        )

        // Un nuovo tentativo riconcilia (il trasbordo e' presso l'ente, non firmato) e poi /azioni propone la firma.
        await expect(
          trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })
        ).rejects.toMatchObject({
          metadata: { rule: 'TRASBORDO_TOTALE_DA_FIRMARE' },
        })

        expect(invia).toHaveBeenCalledTimes(1)
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toHaveLength(1)
        const righe = await storico(eventi, tenantId, fir.id)
        expect(righe).toEqual([
          ['TrasbordoTotale', 'INVIATA'],
          ['TrasbordoTotale', 'INCERTA'],
          ['TrasbordoTotale', 'ACCETTATA'],
        ])
        const acc = (await eventi.elenca(tenantId, fir.id)).find(e => e.esito === 'ACCETTATA')!
        expect(acc.dettaglioEnte).toContain('riconciliata')
      } finally {
        completatore.ferma()
      }
    }, 60000)

    it('INCERTA -> il nuovo trasportatore firma -> «Verifica con l ente» del mittente: PRESENTE, tratta una volta sola, nessun POST ne authorize', async () => {
      const tenantId = 'tenant-oracolo-p6-r3'
      const numeroFir = 'BCDFGH00089ZH'
      const { fir, client, trasbordo, eventi, datiViaggio } = await preparaMittente(
        numeroFir,
        tenantId,
        'InserimentoAccettazione'
      )
      const invia = rispostaPersaDopoIlPost(client)
      const completatore = avviaCompletatore()

      try {
        await expect(
          trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })
        ).rejects.toMatchObject({ metadata: { rule: 'TRASBORDO_TOTALE_ESITO_INCERTO' } })
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toEqual([])

        // Il nuovo trasportatore firma prima che il mittente abbia riconciliato.
        const nuovo = await azienda(numeroFir, 'tenant-oracolo-p6-r3-nuovo', CF_NUOVO)
        agganciaConfermaAutomatica(nuovo.client)
        await nuovo.trasbordo.firma({
          firId: nuovo.fir.id,
          tenantId: 'tenant-oracolo-p6-r3-nuovo',
          utenteId: 'u-2',
          ...TEMPI,
        })

        const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
        const esito = await trasbordo.verifica({ firId: fir.id, tenantId, utenteId: 'u-1' })
        expect(esito).toEqual({ operazione: 'TrasbordoTotale', esito: 'PRESENTE' })
        await trasbordo.verifica({ firId: fir.id, tenantId, utenteId: 'u-1' })

        expect(invia).toHaveBeenCalledTimes(1)
        expect(authorize).not.toHaveBeenCalled()
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toHaveLength(1)
        expect(await storico(eventi, tenantId, fir.id)).toEqual([
          ['TrasbordoTotale', 'INVIATA'],
          ['TrasbordoTotale', 'INCERTA'],
          ['TrasbordoTotale', 'ACCETTATA'],
        ])
      } finally {
        completatore.ferma()
      }
    }, 60000)

    it('INCERTA -> assente: l ente non lo mostra, passata la finestra si chiude RIFIUTATA e si reinvia UNA volta; la tratta nasce solo dal reinvio', async () => {
      const tenantId = 'tenant-oracolo-p6-r2'
      const numeroFir = 'BCDFGH00088ZH'
      const { fir, client, trasbordo, eventi, datiViaggio } = await preparaMittente(
        numeroFir,
        tenantId,
        'InserimentoAccettazione'
      )
      // Il POST non arriva all'ente.
      const invia = jest
        .spyOn(client, 'inviaTrasbordoTotale')
        .mockRejectedValueOnce(
          new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA', undefined, 'trasbordo totale')
        )
      const completatore = avviaCompletatore()

      try {
        await expect(
          trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })
        ).rejects.toMatchObject({
          metadata: { rule: 'TRASBORDO_TOTALE_ESITO_INCERTO' },
        })
        expect(datiViaggio.scritture).toEqual([])

        // Dentro la finestra: l'ente non lo mostra ma potrebbe essere in elaborazione.
        await expect(
          trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })
        ).rejects.toMatchObject({
          metadata: { rule: 'TRASBORDO_TOTALE_IN_VERIFICA' },
        })
        expect(invia).toHaveBeenCalledTimes(1)
        expect(datiViaggio.scritture).toEqual([])

        // Passata la finestra: si chiude come RIFIUTATA e si reinvia.
        const incerta = (await eventi.elenca(tenantId, fir.id)).find(e => e.esito === 'INCERTA')!
        incerta.createdAt = new Date(Date.now() - 3600_000)
        invia.mockRestore()
        const reinvio = jest.spyOn(client, 'inviaTrasbordoTotale')

        const esito = await trasbordo.invia({ firId: fir.id, tenantId, ...COMANDO })

        expect(esito.trattaLocaleCreata).toBe(true)
        expect(reinvio).toHaveBeenCalledTimes(1)
        expect(await storico(eventi, tenantId, fir.id)).toEqual([
          ['TrasbordoTotale', 'INVIATA'],
          ['TrasbordoTotale', 'INCERTA'],
          ['TrasbordoTotale', 'RIFIUTATA'],
          ['TrasbordoTotale', 'INVIATA'],
          ['TrasbordoTotale', 'ACCETTATA'],
        ])
        expect(datiViaggio.righe.get(fir.id)!.tratteAggiuntive).toHaveLength(1)
      } finally {
        completatore.ferma()
      }
    }, 60000)
  })

  /** Sessioni di FIRMA (tipo, stato): la prenotazione che serializza l'invio e' un'altra cosa. */
  function soloFirmaTipi(sessioni: SessioniFirmaRentriInMemoria) {
    return sessioni.righe
      .filter(r => r.tipoOperazione !== 'TRASBORDO_TOTALE_INVIO')
      .map(r => [r.tipoOperazione, r.stato])
  }
})
