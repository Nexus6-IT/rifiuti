import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriApiError } from './rentri-http-resilienza'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { GetAzioniDisponibiliUseCase } from '../../application/rentri/get-azioni-disponibili.use-case'
import { InviaDatiViaggioFirRentriUseCase } from '../../application/rentri/invia-dati-viaggio-fir-rentri.use-case'
import { DatiViaggioFirInMemoria } from '../../application/rentri/dati-viaggio-fir.in-memoria'
import { EventiFirRentriInMemoria } from '../../application/rentri/eventi-fir-rentri.in-memoria'
import { mappaNuovoFormulario } from '../../application/rentri/mappatura/mappa-nuovo-formulario'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * FIR in viaggio P2 contro la fake RENTRI, in-process come le altre `*.oracolo.spec.ts`:
 * - il corpo di creazione con quantita', colli, HP e trasporto di partenza e' giudicato dal contratto
 *   (validatore generato) e il formulario nasce nello stato di firma iniziale;
 * - `inviaQuantita`/`inviaTrasporto` dal use case: stato riletto, copia locale, storico;
 * - il rifiuto dell'ente non tocca nulla in locale; il contratto rifiuta davvero un corpo sbagliato.
 *
 * Le transizioni della fase iniziale della fake sono un'ipotesi (docs/contracts/rentri/FEDELTA.md §8.1).
 */
describe('P2 — quantita e trasporto contro la fake RENTRI (in-process)', () => {
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
    const cert = creaCertificatoDiTest('operatore-test-p2')

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
      produttoreId: 'produttore-oracolo-p2',
      trasportatoreId: 'trasportatore-oracolo-p2',
      destinatarioId: 'destinatario-oracolo-p2',
      tenantId,
      rifiuto: { cerCode: '150101', quantita: 100 },
    })
    fir.emetti('FIR-ORACOLO-P2-000001', {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    })
    fir.markRENTRISynced(numeroFir)
    return fir
  }

  const CF = 'RSSMRA80A01H501U'

  /** Completa ogni transazione aperta (esito vuoto), in errore se l'operazione e' in `inErrore`. */
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
              esito: {},
            },
          })
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    void giro()
    return { ferma: () => (attivo = false) }
  }

  async function semina(numeroFir: string, stato: string): Promise<void> {
    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        produttore: 'Produttore di prova SRL',
        numero_fir: numeroFir,
        stato,
        identificativo_soggetto: CF,
      },
    })
  }

  async function statoSullEnte(client: RENTRIApiClient, tenantId: string, numeroFir: string) {
    return (await client.leggiStato(tenantId, numeroFir)).stato_formulario
  }

  async function ambiente(tenantId: string, numeroFir: string, statoIniziale: string) {
    await semina(numeroFir, statoIniziale)
    const firRepository = new FIRRepositoryFake()
    const fir = creaFIRLegato(tenantId, numeroFir)
    await firRepository.save(fir)
    const client = creaClient()
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ codiceFiscale: CF }) },
    }
    const getAzioni = new GetAzioniDisponibiliUseCase(
      prisma,
      firRepository as any,
      client,
      creaLogger()
    )
    const dati = new DatiViaggioFirInMemoria()
    dati.righe.set(fir.id, {
      firId: fir.id,
      quantita: 100,
      unitaMisura: 'kg',
      numeroColli: null,
      verificatoInPartenza: null,
      rinfusa: null,
      dataTrasporto: new Date('2026-11-21T07:00:00Z'),
      targaAutomezzo: '',
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
    })
    const eventi = new EventiFirRentriInMemoria()
    const useCase = new InviaDatiViaggioFirRentriUseCase(
      firRepository as any,
      getAzioni,
      client,
      dati,
      eventi,
      creaLogger()
    )
    return { fir, client, useCase, dati, eventi }
  }

  it("il corpo di creazione completo e' valido per il contratto e il formulario nasce in attesa di firma", async () => {
    const tenantId = 'tenant-oracolo-p2-1'
    const client = creaClient()
    const corpo = await mappaNuovoFormulario(
      {
        numIscrSito: 'OP1234ABC000001-AB0001',
        provenienza: 'S',
        tipoTrasporto: 'Terrestre',
        produttore: {
          ragioneSociale: 'Produttore Uno SRL',
          partitaIVA: '12345678901',
          indirizzo: {
            via: 'Via Roma',
            civico: '1',
            cap: '80100',
            comune: 'Napoli',
            provincia: 'NA',
          },
        },
        destinatario: {
          ragioneSociale: 'Destinatario Due SPA',
          partitaIVA: '98765432109',
          indirizzo: {
            via: 'Via Milano',
            civico: '2',
            cap: '80100',
            comune: 'Napoli',
            provincia: 'NA',
          },
        },
        trasportatori: [
          {
            ragioneSociale: 'Trasporti Tre SNC',
            partitaIVA: '11223344556',
            numeroIscrizione: 'NA/123456',
          },
          {
            ragioneSociale: 'Ferrovie Merci SPA',
            partitaIVA: '99887766554',
            tipoTrasporto: 'Ferroviario',
          },
        ],
        rifiuto: {
          cerCode: '150106',
          wastePhysicalState: 'Solido',
          wasteDescription: 'Imballaggi',
        },
        quantita: { valore: 1.5, unitaMisura: 't', numeroColli: 12, verificatoInPartenza: true },
        caratteristichePericolo: 'HP4,HP14',
        datiTrasportoPartenza: {
          conducenteNome: 'Mario',
          conducenteCognome: 'De Rossi',
          targaAutomezzo: 'ab123cd',
          targaRimorchio: 'xy987zw',
          percorso: 'A1 poi SS7',
          dataOraInizioTrasporto: new Date('2026-11-21T07:00:00Z'),
        },
      },
      { risolvi: async () => '063049' }
    )

    const { transazioneId } = await client.creaFormulario(tenantId, corpo as any)
    const numeroFir = 'BCDFGH00050ZD'
    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: transazioneId, errore: false, esito: { numero_fir: numeroFir } },
    })

    expect(await statoSullEnte(client, tenantId, numeroFir)).toBe(
      'FirmaProduttoreTrasportatoreIniziale'
    )
  })

  it("un corpo di creazione sbagliato e' rifiutato dal contratto (400): l'oracolo giudica davvero", async () => {
    const client = creaClient()
    const corpo = await mappaNuovoFormulario(
      {
        numIscrSito: 'OP1234ABC000001-AB0001',
        provenienza: 'S',
        tipoTrasporto: 'Terrestre',
        produttore: {
          ragioneSociale: 'P',
          partitaIVA: '12345678901',
          indirizzo: { via: 'V', civico: '1', cap: '80100', comune: 'Napoli', provincia: 'NA' },
        },
        destinatario: {
          ragioneSociale: 'D',
          partitaIVA: '98765432109',
          indirizzo: { via: 'V', civico: '2', cap: '80100', comune: 'Napoli', provincia: 'NA' },
        },
        trasportatori: [{ ragioneSociale: 'T', partitaIVA: '11223344556' }],
        rifiuto: { cerCode: '150106', wastePhysicalState: 'Solido' },
        quantita: { valore: 10, unitaMisura: 'kg', rinfusa: true },
      },
      { risolvi: async () => '063049' }
    )
    // Un'unita' fuori contratto: se qualcuno rompe il mappatore, l'ente lo rifiuta qui.
    ;(corpo as any).dati_partenza.rifiuto.quantita.unita_misura = 'tonnellate'
    await expect(client.creaFormulario('tenant-oracolo-p2-2', corpo as any)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('quantita poi trasporto dal use case: stato riletto a ogni passo, copia locale, storico', async () => {
    const tenantId = 'tenant-oracolo-p2-3'
    const numeroFir = 'BCDFGH00051ZD'
    const { fir, client, useCase, dati, eventi } = await ambiente(
      tenantId,
      numeroFir,
      'InserimentoQuantitaTrasportoIniziale'
    )
    const completatore = avviaCompletatore()
    try {
      const q = await useCase.inviaQuantita({
        firId: fir.id,
        tenantId,
        quantita: 2.5,
        unitaMisura: 't',
        numeroColli: 6,
        utenteId: 'u1',
      })
      expect(q).toEqual({
        operazione: 'DatiQuantita',
        statoFormulario: 'InserimentoTrasportoIniziale',
      })
      expect(await statoSullEnte(client, tenantId, numeroFir)).toBe('InserimentoTrasportoIniziale')
      expect(dati.righe.get(fir.id)).toMatchObject({
        quantita: 2.5,
        unitaMisura: 't',
        numeroColli: 6,
      })

      const t = await useCase.inviaTrasporto({
        firId: fir.id,
        tenantId,
        conducenteNome: 'Mario',
        conducenteCognome: 'Rossi',
        targaAutomezzo: 'ab123cd',
        utenteId: 'u1',
      })
      expect(t).toEqual({
        operazione: 'Trasporto',
        statoFormulario: 'FirmaProduttoreTrasportatoreIniziale',
      })
      expect(dati.righe.get(fir.id)).toMatchObject({
        targaAutomezzo: 'AB123CD',
        principale: { conducenteNome: 'Mario', conducenteCognome: 'Rossi' },
      })
    } finally {
      completatore.ferma()
    }
    expect(eventi.righe.map(e => [e.operazione, e.esito])).toEqual([
      ['DatiQuantita', 'ACCETTATA'],
      ['Trasporto', 'ACCETTATA'],
    ])
    expect(eventi.righe[0].transazioneId).toEqual(expect.any(String))
    expect(eventi.righe[0].payload).toMatchObject({
      quantita: { valore: 2500, unita_misura: 'kg' },
    })
  })

  it('correzione in attesa di firma: stesso endpoint, operazione DatiQuantitaUpdate, stato invariato', async () => {
    const tenantId = 'tenant-oracolo-p2-4'
    const numeroFir = 'BCDFGH00052ZD'
    const { fir, client, useCase, eventi } = await ambiente(
      tenantId,
      numeroFir,
      'FirmaProduttoreTrasportatoreIniziale'
    )
    const completatore = avviaCompletatore()
    try {
      const q = await useCase.inviaQuantita({
        firId: fir.id,
        tenantId,
        quantita: 90,
        unitaMisura: 'kg',
        rinfusa: true,
      })
      expect(q.operazione).toBe('DatiQuantitaUpdate')
      expect(await statoSullEnte(client, tenantId, numeroFir)).toBe(
        'FirmaProduttoreTrasportatoreIniziale'
      )
    } finally {
      completatore.ferma()
    }
    expect(eventi.righe[0]).toMatchObject({ operazione: 'DatiQuantitaUpdate', esito: 'ACCETTATA' })
  })

  it("l'ente rifiuta l'operazione: evento RIFIUTATA, nessuna copia locale, stato dell'ente invariato", async () => {
    const tenantId = 'tenant-oracolo-p2-5'
    const numeroFir = 'BCDFGH00053ZD'
    const { fir, client, useCase, dati, eventi } = await ambiente(
      tenantId,
      numeroFir,
      'InserimentoQuantitaTrasportoIniziale'
    )
    const completatore = avviaCompletatore(['Quantita'])
    try {
      await expect(
        useCase.inviaQuantita({
          firId: fir.id,
          tenantId,
          quantita: 5,
          unitaMisura: 'kg',
          numeroColli: 1,
        })
      ).rejects.toMatchObject({ metadata: { rule: 'QUANTITA_RENTRI_RIFIUTATA' } })
    } finally {
      completatore.ferma()
    }
    expect(eventi.righe).toHaveLength(1)
    expect(eventi.righe[0]).toMatchObject({ esito: 'RIFIUTATA' })
    expect(dati.scritture).toEqual([])
    expect(await statoSullEnte(client, tenantId, numeroFir)).toBe(
      'InserimentoQuantitaTrasportoIniziale'
    )
  })

  it("/azioni non propone l'operazione (Accettato): 409 e l'ente non riceve nulla", async () => {
    const tenantId = 'tenant-oracolo-p2-6'
    const numeroFir = 'BCDFGH00054ZD'
    const { fir, client, useCase, eventi } = await ambiente(tenantId, numeroFir, 'Accettato')
    const inviaQuantita = jest.spyOn(client, 'inviaQuantita')
    await expect(
      useCase.inviaQuantita({
        firId: fir.id,
        tenantId,
        quantita: 5,
        unitaMisura: 'kg',
        rinfusa: true,
      })
    ).rejects.toMatchObject({ metadata: { rule: 'OPERAZIONE_NON_DISPONIBILE' } })
    expect(inviaQuantita).not.toHaveBeenCalled()
    expect(eventi.righe).toHaveLength(0)
  })

  it('il contratto rifiuta una targa oltre i 10 caratteri anche se il client la lasciasse passare', async () => {
    const tenantId = 'tenant-oracolo-p2-7'
    const numeroFir = 'BCDFGH00055ZD'
    await semina(numeroFir, 'InserimentoTrasportoIniziale')
    const client = creaClient()
    const errore = await client
      .inviaTrasporto(tenantId, numeroFir, {
        data_ora_inizio_trasporto: '2026-11-21T07:00:00Z',
        conducente: { nome: 'Mario', cognome: 'Rossi' },
        targa_automezzo: 'ABCDEFGHIJK',
      })
      .catch(e => e)
    expect(errore).toBeInstanceOf(RentriApiError)
    expect(errore.status).toBe(400)
  })
})
