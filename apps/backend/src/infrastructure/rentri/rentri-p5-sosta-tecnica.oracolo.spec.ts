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
import { SostaTecnicaRentriUseCase } from '../../application/rentri/sosta-tecnica-rentri.use-case'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from '../../application/rentri/sessioni-firma-rentri.in-memoria'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P5 contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - sosta tecnica: `/azioni` la propone, il corpo e' quello del contratto (luogo e date in UTC), il formulario
 *   passa a `FirmaSostaTecnica`, la firma del trasportatore lo riporta allo stato di prima (RILETTO dall'ente)
 *   e tutto finisce nello storico;
 * - ripresa: due richieste di firma = UNA sola `authorize`;
 * - nessuna doppia sosta, due invii concorrenti = un POST, esito ignoto riconciliato, firma rifiutata;
 * - la sosta e' ammessa solo in viaggio, non da `Accettato`.
 *
 * La macchina degli stati della fake per `sosta-tecnica` e' un'ipotesi dedotta dai nomi degli stati
 * (FEDELTA.md §8.4): da verificare sulla demo.
 */
describe('P5 — sosta tecnica contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p5')

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
    dati_soste_tecniche?: unknown[]
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
      produttoreId: 'produttore-oracolo-p5',
      trasportatoreId: 'trasportatore-oracolo-p5',
      destinatarioId: 'destinatario-oracolo-p5',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
      // Il CF del tenant e' quello del trasportatore: solo lui dichiara una sosta tecnica.
      trasportatore: {
        ragioneSociale: 'Trasporti di prova SRL',
        partitaIva: '',
        codiceFiscale: CF,
      },
    })
    fir.emetti('FIR-ORACOLO-P5-000001', {
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
      { getCredentialsIdFirmaRemota: jest.fn().mockResolvedValue('P5CRED001') } as any,
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
    const sostaTecnica = new SostaTecnicaRentriUseCase(
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
      {} as any, // AnnotazioneRentriUseCase: non usato dalle soste tecniche
      sostaTecnica
    )
    return { completa, sostaTecnica, eventi, gestisci }
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
  const DIGEST = Buffer.from('digest-oracolo-p5').toString('base64')
  const TOKEN = 'token-oracolo-p5'

  async function preparaFirDaFirmare(
    numeroFir: string,
    tenantId: string,
    stato: string,
    datiSoste?: unknown[]
  ) {
    await seminaFormulario({
      numero_fir: numeroFir,
      stato,
      identificativo_soggetto: CF,
      ...(datiSoste && { dati_soste_tecniche: datiSoste }),
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

  /** Le sessioni di FIRMA: la prenotazione che serializza l'invio (SOSTA_TECNICA_INVIO) e' un'altra cosa. */
  const soloFirma = (sessioni: SessioniFirmaRentriInMemoria) =>
    sessioni.righe.filter(r => r.tipoOperazione !== 'SOSTA_TECNICA_INVIO')

  const TEMPI = { intervalloPollingMs: 5, attesaMassimaMs: 2000 }
  const LUOGO = 'Area di servizio A1 km 120'
  const SOSPENSIONE = '2026-11-18T10:00:00.000Z'
  const RIPRESA = '2026-11-18T12:30:00.000Z'
  const CORPO = {
    luogo_stazionamento: LUOGO,
    data_ora_sospensione: SOSPENSIONE,
    data_ora_ripresa: RIPRESA,
  }
  const COMANDO = {
    luogoStazionamento: LUOGO,
    dataOraSospensione: SOSPENSIONE,
    dataOraRipresa: RIPRESA,
  }

  it.each(['InserimentoAccettazione', 'InserimentoTrasportoSuccessivo'])(
    'da %s: sosta + firma del trasportatore, lo stato torna a quello di prima (riletto dall ente) e finisce nello storico',
    async partenza => {
      const tenantId = `tenant-oracolo-p5-${partenza}`
      const numeroFir = partenza === 'InserimentoAccettazione' ? 'BCDFGH00070ZH' : 'BCDFGH00070ZB'
      const { fir, firRepository, client, sessioni, sostaTecnica, eventi } =
        await preparaFirDaFirmare(numeroFir, tenantId, partenza)
      agganciaConfermaAutomatica(client)
      const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')
      const completatore = avviaCompletatore()

      try {
        // Date con offset: all'ente arrivano in UTC.
        const esito = await sostaTecnica.invia({
          firId: fir.id,
          tenantId,
          luogoStazionamento: `  ${LUOGO} `,
          dataOraSospensione: '2026-11-18T11:00:00+01:00',
          dataOraRipresa: '2026-11-18T13:30:00+01:00',
          utenteId: 'u-1',
          ...TEMPI,
        })

        expect(esito).toEqual({
          operazione: 'SostaTecnica',
          statoFormulario: 'FirmaSostaTecnica',
          firma: { esito: 'COMPLETATA', statoFormulario: partenza },
        })
        expect(inviaSosta).toHaveBeenCalledWith(tenantId, numeroFir, CORPO)
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(partenza)
        expect((await firRepository.findById(fir.id))!.rentriStatoFormulario).toBe(partenza)
        expect(soloFirma(sessioni).map(s => [s.tipoOperazione, s.stato])).toEqual([
          ['SOSTA_TECNICA', 'COMPLETATA'],
        ])
        const storico = (await eventi.elenca(tenantId, fir.id)).reverse()
        expect(storico.map(e => [e.operazione, e.esito])).toEqual([
          ['SostaTecnica', 'INVIATA'],
          ['SostaTecnica', 'ACCETTATA'],
          ['AcquisizioneFirmaSostaTecnica', 'ACCETTATA'],
        ])
        expect(storico[1].payload).toEqual(CORPO)
        // L'ente mostra la sosta firmata.
        const dettaglio = await client.leggiFormulario(tenantId, numeroFir)
        expect(dettaglio.dati_soste_tecniche).toEqual([
          { ...CORPO, dati_firma: expect.objectContaining({ data_firma: expect.any(String) }) },
        ])
      } finally {
        completatore.ferma()
      }
    },
    60000
  )

  it('Accettato: la sosta tecnica non e proposta (solo in viaggio), 409 OPERAZIONE_NON_DISPONIBILE senza scritture', async () => {
    const tenantId = 'tenant-oracolo-p5-acc'
    const numeroFir = 'BCDFGH00070ZC'
    const { fir, client, sostaTecnica } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'Accettato'
    )
    const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')

    await expect(
      sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
    ).rejects.toMatchObject({ metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' } })
    expect(inviaSosta).not.toHaveBeenCalled()
  })

  it('nessuna doppia sosta ne doppia firma: con la firma in attesa una seconda sosta e un 409 e la ripresa usa UNA authorize', async () => {
    const tenantId = 'tenant-oracolo-p5-2'
    const numeroFir = 'BCDFGH00070ZD'
    const { fir, client, sessioni, sostaTecnica, gestisci, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')
    const completatore = avviaCompletatore()

    try {
      const prima = await sostaTecnica.invia({
        firId: fir.id,
        tenantId,
        ...COMANDO,
        intervalloPollingMs: 5,
        attesaMassimaMs: 100,
      })
      // L'utente non ha ancora confermato sul telefono.
      expect(prima.firma.esito).toBe('IN_ATTESA')
      const handle = (prima.firma as { handle: string }).handle

      await expect(
        sostaTecnica.invia({
          firId: fir.id,
          tenantId,
          ...COMANDO,
          luogoStazionamento: 'Altro posto',
          ...TEMPI,
        })
      ).rejects.toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_IN_CORSO' } })
      expect(inviaSosta).toHaveBeenCalledTimes(1)

      await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })
      const esito = await gestisci.riprendi({
        firId: fir.id,
        tenantId,
        sessioneId: soloFirma(sessioni)[0].id,
        utenteId: 'u-1',
      })

      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      expect(authorize).toHaveBeenCalledTimes(1)
      const storico = (await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])
      expect(storico).toEqual(
        expect.arrayContaining([
          ['SostaTecnica', 'INVIATA'],
          ['SostaTecnica', 'ACCETTATA'],
          ['AcquisizioneFirmaSostaTecnica', 'INVIATA'],
          ['AcquisizioneFirmaSostaTecnica', 'ACCETTATA'],
        ])
      )
      expect(storico).toHaveLength(4)
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('sosta gia scritta e firma non conclusa: una seconda sosta e 409 SOSTA_TECNICA_DA_FIRMARE e «firma» la completa', async () => {
    const tenantId = 'tenant-oracolo-p5-3'
    const numeroFir = 'BCDFGH00070ZP'
    const { fir, client, sostaTecnica, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaSostaTecnica',
      [{ ...CORPO, dati_firma: null }]
    )
    await eventi.registra({
      tenantId,
      firId: fir.id,
      operazione: 'SostaTecnica',
      payload: CORPO,
      transazioneId: 'tr-pregressa',
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: 'FirmaSostaTecnica',
      utenteId: 'u-1',
    })
    agganciaConfermaAutomatica(client)
    const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')
    const completatore = avviaCompletatore()

    try {
      await expect(
        sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
      ).rejects.toMatchObject({ metadata: { rule: 'SOSTA_TECNICA_DA_FIRMARE' } })
      expect(inviaSosta).not.toHaveBeenCalled()

      const esito = await sostaTecnica.firma({ firId: fir.id, tenantId, ...TEMPI })
      expect(esito.esito).toBe('COMPLETATA')
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('sosta in attesa di firma dichiarata da ALTRI (nessuna traccia locale): 409 DI_ALTRO_SOGGETTO, nessuna authorize', async () => {
    const tenantId = 'tenant-oracolo-p5-4'
    const numeroFir = 'BCDFGH00070ZF'
    const { fir, client, sostaTecnica } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'FirmaSostaTecnica',
      [{ ...CORPO, dati_firma: null }]
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')

    await expect(sostaTecnica.firma({ firId: fir.id, tenantId, ...TEMPI })).rejects.toMatchObject({
      metadata: { rule: 'SOSTA_TECNICA_DI_ALTRO_SOGGETTO' },
    })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('due invii concorrenti contro la fake = UN solo POST /sosta-tecnica, l altro 409', async () => {
    const tenantId = 'tenant-oracolo-p5-5'
    const numeroFir = 'BCDFGH00070ZG'
    const { fir, client, sostaTecnica } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    agganciaConfermaAutomatica(client)
    const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')
    const completatore = avviaCompletatore()

    try {
      const esiti = await Promise.allSettled([
        sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, utenteId: 'u-1', ...TEMPI }),
        sostaTecnica.invia({
          firId: fir.id,
          tenantId,
          ...COMANDO,
          luogoStazionamento: 'Altro',
          utenteId: 'u-2',
          ...TEMPI,
        }),
      ])

      expect(inviaSosta).toHaveBeenCalledTimes(1)
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      expect(
        (esiti.find(e => e.status === 'rejected') as PromiseRejectedResult).reason
      ).toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_IN_CORSO' } })
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('dati non validi (ripresa prima della sospensione): 400 locale, nessuna scrittura all ente', async () => {
    const tenantId = 'tenant-oracolo-p5-6'
    const numeroFir = 'BCDFGH00070ZK'
    const { fir, client, sostaTecnica, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const inviaSosta = jest.spyOn(client, 'inviaSostaTecnica')

    await expect(
      sostaTecnica.invia({
        firId: fir.id,
        tenantId,
        ...COMANDO,
        dataOraSospensione: RIPRESA,
        dataOraRipresa: SOSPENSIONE,
        ...TEMPI,
      })
    ).rejects.toMatchObject({ metadata: { rule: 'SOSTA_TECNICA_NON_VALIDA' } })
    expect(inviaSosta).not.toHaveBeenCalled()
    expect(await eventi.elenca(tenantId, fir.id)).toHaveLength(0)
  })

  it('l ente rifiuta la sosta (esito in errore): 400 SOSTA_TECNICA_RENTRI_RIFIUTATA, evento RIFIUTATA, stato invariato, nessuna firma', async () => {
    const tenantId = 'tenant-oracolo-p5-7'
    const numeroFir = 'BCDFGH00070ZM'
    const { fir, client, sessioni, sostaTecnica, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
    const completatore = avviaCompletatore(['SostaTecnica'])

    try {
      await expect(
        sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
      ).rejects.toMatchObject({ metadata: { rule: 'SOSTA_TECNICA_RENTRI_RIFIUTATA' } })

      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'InserimentoAccettazione'
      )
      expect(authorize).not.toHaveBeenCalled()
      expect(soloFirma(sessioni)).toHaveLength(0)
      expect(await sessioni.trovaAperta(tenantId, fir.id)).toBeNull()
      expect((await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])).toEqual([
        ['SostaTecnica', 'RIFIUTATA'],
        ['SostaTecnica', 'INVIATA'],
      ])
    } finally {
      completatore.ferma()
    }
  }, 60000)

  it('firma rifiutata dall ente: la sosta resta registrata, esito RIFIUTATA, sessione RIFIUTATA e si puo richiedere di nuovo', async () => {
    const tenantId = 'tenant-oracolo-p5-8'
    const numeroFir = 'BCDFGH00070ZN'
    const { fir, client, sessioni, sostaTecnica, eventi } = await preparaFirDaFirmare(
      numeroFir,
      tenantId,
      'InserimentoAccettazione'
    )
    agganciaConfermaAutomatica(client)
    const completatore = avviaCompletatore(['AcquisizioneFirma'])

    try {
      const esito = await sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })

      expect(esito.statoFormulario).toBe('FirmaSostaTecnica')
      expect(esito.firma).toMatchObject({
        esito: 'DA_COMPLETARE',
        codice: 'FIRMA_RENTRI_RIFIUTATA',
      })
      expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
        'FirmaSostaTecnica'
      )
      expect(soloFirma(sessioni).map(s => s.stato)).toEqual(['RIFIUTATA'])
      const storico = (await eventi.elenca(tenantId, fir.id)).map(e => [e.operazione, e.esito])
      expect(storico).toEqual(
        expect.arrayContaining([
          ['SostaTecnica', 'ACCETTATA'],
          ['AcquisizioneFirmaSostaTecnica', 'RIFIUTATA'],
        ])
      )
    } finally {
      completatore.ferma()
    }
  }, 60000)

  describe('invio senza esito riconciliato con il dettaglio del formulario', () => {
    const { TrasmissioneRentriIncertaError } = jest.requireActual('./rentri-api.client')

    /** Il POST arriva all'ente (e viene elaborato) ma la risposta si perde: esito INCERTA da noi. */
    function rispostaPersaDopoIlPost(client: RENTRIApiClient) {
      const originale = client.inviaSostaTecnica.bind(client)
      return jest
        .spyOn(client, 'inviaSostaTecnica')
        .mockImplementationOnce(async (...argomenti: Parameters<typeof originale>) => {
          await originale(...argomenti)
          throw new TrasmissioneRentriIncertaError('HTTP_5XX', 503, 'sosta tecnica')
        })
    }

    it('INCERTA -> propria: la sosta e presso l ente, firma() la riconcilia e la firma con UNA authorize, nessun secondo POST', async () => {
      const tenantId = 'tenant-oracolo-p5-r1'
      const numeroFir = 'BCDFGH00070ZS'
      const { fir, client, sostaTecnica, eventi } = await preparaFirDaFirmare(
        numeroFir,
        tenantId,
        'InserimentoAccettazione'
      )
      const inviaSosta = rispostaPersaDopoIlPost(client)
      const authorize = jest.spyOn(client, 'autorizzaFirmaRemota')
      agganciaConfermaAutomatica(client)
      const completatore = avviaCompletatore()

      try {
        await expect(
          sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
        ).rejects.toBeInstanceOf(TrasmissioneRentriIncertaError)
        expect((await client.leggiStato(tenantId, numeroFir)).stato_formulario).toBe(
          'FirmaSostaTecnica'
        )

        // Una nuova sosta NON parte: la nostra e' gia' presso l'ente, va firmata.
        await expect(
          sostaTecnica.invia({
            firId: fir.id,
            tenantId,
            ...COMANDO,
            luogoStazionamento: 'Altro',
            ...TEMPI,
          })
        ).rejects.toMatchObject({ metadata: { rule: 'SOSTA_TECNICA_DA_FIRMARE' } })

        const esito = await sostaTecnica.firma({ firId: fir.id, tenantId, ...TEMPI })

        expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
        expect(inviaSosta).toHaveBeenCalledTimes(1)
        expect(authorize).toHaveBeenCalledTimes(1)
        const storico = (await eventi.elenca(tenantId, fir.id)).reverse()
        expect(storico.map(e => [e.operazione, e.esito])).toEqual([
          ['SostaTecnica', 'INVIATA'],
          ['SostaTecnica', 'INCERTA'],
          ['SostaTecnica', 'ACCETTATA'],
          ['AcquisizioneFirmaSostaTecnica', 'ACCETTATA'],
        ])
        expect(storico[2].dettaglioEnte).toContain('riconciliata')
      } finally {
        completatore.ferma()
      }
    }, 60000)

    it('INCERTA -> assente: la sosta non e presso l ente, passata la finestra si chiude e si reinvia una sola volta', async () => {
      const tenantId = 'tenant-oracolo-p5-r2'
      const numeroFir = 'BCDFGH00070ZT'
      const { fir, client, sostaTecnica, eventi } = await preparaFirDaFirmare(
        numeroFir,
        tenantId,
        'InserimentoAccettazione'
      )
      // Il POST non arriva all'ente.
      const inviaSosta = jest
        .spyOn(client, 'inviaSostaTecnica')
        .mockRejectedValueOnce(
          new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA', undefined, 'sosta tecnica')
        )
      agganciaConfermaAutomatica(client)
      const completatore = avviaCompletatore()

      try {
        await expect(
          sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
        ).rejects.toBeInstanceOf(TrasmissioneRentriIncertaError)

        // Dentro la finestra: l'ente non la mostra ma potrebbe essere in elaborazione.
        await expect(
          sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })
        ).rejects.toMatchObject({ metadata: { rule: 'SOSTA_TECNICA_IN_VERIFICA' } })
        expect(inviaSosta).toHaveBeenCalledTimes(1)

        // Passata la finestra: si chiude come RIFIUTATA e si reinvia.
        const incerta = (await eventi.elenca(tenantId, fir.id)).find(e => e.esito === 'INCERTA')!
        incerta.createdAt = new Date(Date.now() - 3600_000)
        inviaSosta.mockRestore()
        const reinvio = jest.spyOn(client, 'inviaSostaTecnica')

        const esito = await sostaTecnica.invia({ firId: fir.id, tenantId, ...COMANDO, ...TEMPI })

        expect(esito.firma.esito).toBe('COMPLETATA')
        expect(reinvio).toHaveBeenCalledTimes(1)
        const righe = (await eventi.elenca(tenantId, fir.id))
          .reverse()
          .map(e => [e.operazione, e.esito])
        expect(righe).toEqual([
          ['SostaTecnica', 'INVIATA'],
          ['SostaTecnica', 'INCERTA'],
          ['SostaTecnica', 'RIFIUTATA'],
          ['SostaTecnica', 'INVIATA'],
          ['SostaTecnica', 'ACCETTATA'],
          ['AcquisizioneFirmaSostaTecnica', 'ACCETTATA'],
        ])
      } finally {
        completatore.ferma()
      }
    }, 60000)
  })
})
