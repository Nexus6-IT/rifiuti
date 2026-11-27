import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriAnagraficheClient } from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { RentriRegistriClient } from '../../../infrastructure/rentri/rentri-registri.client'
import { RentriAuthService } from '../../../infrastructure/rentri/rentri-auth.service'
import { RentriCredentialResolver } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { RentriSignatureService } from '../../../infrastructure/rentri/rentri-signature.service'
import { RentriConfig } from '../../../infrastructure/rentri/rentri-config'
import {
  firmaXmlRegistro,
  verificaFirmaXmlRegistro,
} from '../../../infrastructure/rentri/firma-xml-registro'
import { leggiEregi } from '../../../infrastructure/rentri/eregi/leggi-eregi'
import { materialeFirmaDiProva } from '../../../test-support/esportazioni-registro-di-prova'
import {
  costruisciEsportazioneRegistro,
  type EsportazioneCostruita,
} from './costruisci-esportazione-registro'
import { nomeFileEsportazione, statoDaEsito } from './valida-esportazione-registro-rentri.use-case'
import { traduciAnnotazione, type AnnotazionePerRentri } from './mappa-registrazione-rentri'
import { serializzaRegistro, type VoceRegistro } from './serializza-registro-xml'
import { verificaCatenaEsportazioni } from './verifica-catena-esportazioni'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../../tools/rentri-fake/src/app')
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  creaCertificatoDiTest,
} = require('../../../../../../tools/rentri-fake/test/aiuti/certificati')
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * Oracolo delle esportazioni del registro (eREGI E6): l'eREGI VERO della fake, la catena di 3
 * esportazioni costruita con le funzioni di produzione e la validazione tramite `RentriRegistriClient`
 * contro `POST .../valida` della fake (che verifica davvero firma XMLDSig e catena dei digest).
 * Nessun database: la parte su Postgres e' in `genera-esportazione-registro-rentri.postgres.spec.ts`.
 *
 * LIMITE: la fake valida per coerenza interna (FEDELTA.md §10). Che RENTRI accetti la catena e la
 * C14N e' un'ipotesi (R1/R2 del piano) da provare sul demo.
 */
describe('Esportazioni del registro — contro la fake RENTRI (in-process)', () => {
  let app: any
  const SITO = 'MI00001234-002'
  const TENANT = 'tenant-oracolo'
  let identificativo = ''
  let eregXml = ''
  const materiale = materialeFirmaDiProva()

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  function adattaRisposta(risposta: any): AxiosResponse {
    return {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
  }

  function inietta(
    metodo: string,
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
    sempreRisolve = false
  ): Observable<AxiosResponse> {
    return new Observable<AxiosResponse>(subscriber => {
      const analizzato = new URL(url)
      app
        .inject({
          method: metodo,
          url: `${analizzato.pathname}${analizzato.search}`,
          headers,
          payload: payload as any,
        })
        .then((risposta: any) => {
          const adattata = adattaRisposta(risposta)
          if (adattata.status >= 400 && !sempreRisolve) {
            const errore: any = new Error(`Richiesta fallita con status ${adattata.status}`)
            errore.response = adattata
            subscriber.error(errore)
            return
          }
          subscriber.next(adattata)
          subscriber.complete()
        })
        .catch((errore: unknown) => subscriber.error(errore))
    })
  }

  function config(): RentriConfig {
    const cert = creaCertificatoDiTest('operatore-test')
    return {
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
  }

  function dipendenze() {
    const cfg = config()
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: 'operatore-test',
        certificatePem: cfg.certificatePem,
        privateKeyPem: cfg.privateKeyPem,
        algorithm: 'RS256',
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const resolver = new RentriCredentialResolver(credentialService as any, cfg)
    const auth = new RentriAuthService(resolver, cfg, logger)
    const signature = new RentriSignatureService(cfg, resolver)
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }
    // Il polling di `attendiEsito` non deve mai lanciare su 200/303/400: `get` risolve sempre.
    const httpService: any = {
      get: (url: string, o: { headers: Record<string, string> }) =>
        inietta('GET', url, o.headers, undefined, true),
      post: (url: string, body: unknown, o: { headers: Record<string, string> }) =>
        inietta('POST', url, o.headers, body),
      put: (url: string, body: unknown, o: { headers: Record<string, string> }) =>
        inietta('PUT', url, o.headers, body),
      delete: (url: string, o: { headers: Record<string, string> }) =>
        inietta('DELETE', url, o.headers),
    }
    return { cfg, logger, auth, signature, metrics, httpService }
  }

  beforeAll(async () => {
    const d = dipendenze()
    // L'apertura e la lettura dell'eREGI usano `get` che lancia sugli errori: client dedicato.
    const httpAnagrafiche: any = {
      ...d.httpService,
      get: (url: string, o: { headers: Record<string, string> }) => inietta('GET', url, o.headers),
    }
    const anagrafiche = new RentriAnagraficheClient(
      httpAnagrafiche,
      d.logger,
      d.metrics,
      d.cfg,
      d.auth,
      d.signature
    )
    ;({ identificativo } = await anagrafiche.apriRegistro(
      { numIscrSito: SITO, attivita: ['Trasporto'], descrizione: 'Registro di prova' },
      TENANT
    ))
    const scaricato = await anagrafiche.scaricaVidimazioneXml(identificativo, TENANT)
    // DIVERGENZA DELLA FAKE (FEDELTA.md §10): le unita' locali di fixture (`MI00001234-002`) non
    // rispettano il pattern `NumIscrSito` dell'XSD, quindi il suo eREGI non sarebbe valido nel
    // registro. Si sostituisce il solo valore con uno conforme; la fake non ricalcola il digest
    // dell'eREGI, quindi la catena resta coerente.
    eregXml = scaricato.xml.replace(
      `<reg:NumIscrSito>${SITO}</reg:NumIscrSito>`,
      '<reg:NumIscrSito>OP1234ABC123456-MI0001</reg:NumIscrSito>'
    )
    expect(eregXml).not.toBe(scaricato.xml)
    // Il registro deve esistere anche per il servizio dati-registri della fake.
    await app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/registro',
      payload: { identificativo_registro: identificativo },
    })
  })

  function clientRegistri(): RentriRegistriClient {
    const d = dipendenze()
    return new RentriRegistriClient(
      d.httpService,
      d.logger,
      d.metrics,
      d.cfg,
      d.auth,
      d.signature as any
    )
  }

  function voci(anno: number, da: number, a: number): VoceRegistro[] {
    const risultato: VoceRegistro[] = []
    for (let p = da; p <= a; p++) {
      const annotazione: AnnotazionePerRentri = {
        movimentoId: `m-${anno}-${p}`,
        tipoAnnotazione: 'ORDINARIA',
        numero: { anno, progressivo: p },
        dataRegistrazione: '2026-03-01T10:00:00.000Z',
        verso: 'CARICO',
        codiceRentri: 'DT',
        cerCode: '15 01 01',
        descrizione: null,
        quantita: 100 + p,
        unit: 'KG',
        statoFisico: 'Solido',
        classiPericolo: null,
        operazione: null,
        predecessore: null,
        motivo: null,
        fir: null,
        riferimentiCarico: [],
      }
      const t = traduciAnnotazione(annotazione)
      if (!t.ok) throw new Error(t.motivi.join(','))
      risultato.push({
        corpo: t.corpo,
        autore: 'Mario Rossi',
        identificativoTemporale: '2026-03-01T10:00:00.000Z',
      })
    }
    return risultato
  }

  /** Invia il file a `/valida`, completa la transazione (la fake giudica firma e catena) e legge l'esito. */
  async function validaConLaFake(
    xml: string,
    nome: string
  ): Promise<Awaited<ReturnType<RentriRegistriClient['attendiEsitoMovimenti']>>> {
    const client = clientRegistri()
    const { transazioneId } = await client.validaRegistro(
      identificativo,
      {
        fileContentBase64: Buffer.from(xml, 'utf8').toString('base64'),
        nomeFile: nome,
        mime: 'application/xml',
      },
      undefined,
      TENANT
    )
    await app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/completa-transazione',
      payload: { transazione_id: transazioneId, errore: false, validazione: [] },
    })
    return client.attendiEsitoMovimenti(transazioneId, TENANT, {
      intervalloMs: 20,
      maxTentativi: 20,
    })
  }

  async function catenaDiTre(): Promise<EsportazioneCostruita[]> {
    const piano = [
      { anno: 2026, da: 1, a: 3, data: '2026-04-01T00:00:00.000Z' },
      { anno: 2026, da: 4, a: 5, data: '2026-05-01T00:00:00.000Z' },
      { anno: 2027, da: 1, a: 2, data: '2027-01-15T00:00:00.000Z' },
    ]
    const costruite: EsportazioneCostruita[] = []
    const precedenti: Array<{ digestValue: string; dataCreazione: Date }> = []
    for (const p of piano) {
      const c = await costruisciEsportazioneRegistro({
        eregXml,
        precedenti: [...precedenti],
        anno: p.anno,
        progressivoDa: p.da,
        voci: voci(p.anno, p.da, p.a),
        dataCreazione: new Date(p.data),
        materiale,
      })
      costruite.push(c)
      precedenti.push({ digestValue: c.digestValue, dataCreazione: new Date(p.data) })
    }
    return costruite
  }

  it('l eREGI della fake e leggibile e ha il formato che la catena si aspetta', () => {
    expect(leggiEregi(eregXml)).toMatchObject({ identificativo })
  })

  it('la catena di 3 esportazioni, con l eREGI vero della fake, passa /valida senza messaggi', async () => {
    const costruite = await catenaDiTre()
    for (const [i, c] of costruite.entries()) {
      const esito = await validaConLaFake(
        c.xml,
        nomeFileEsportazione(identificativo, 1, c.progressivoA, new Date('2026-04-01T00:00:00Z'))
      )
      expect({ esportazione: i + 1, errore: esito.errore, validazione: esito.validazione }).toEqual(
        {
          esportazione: i + 1,
          errore: false,
          validazione: [],
        }
      )
      expect(statoDaEsito(esito)).toBe('VALIDATA')
    }

    const righe = costruite.map((c, i) => ({
      anno: i < 2 ? 2026 : 2027,
      progressivoDa: [1, 4, 1][i],
      progressivoA: c.progressivoA,
      numeroRegistrazioni: c.numeroRegistrazioni,
      dataCreazione: new Date(
        ['2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2027-01-15T00:00:00.000Z'][i]
      ),
      digestValue: c.digestValue,
      sha256File: c.sha256File,
      xml: c.xml,
    }))
    expect(await verificaCatenaEsportazioni(eregXml, righe)).toEqual({ valida: true, errori: [] })
  }, 30000)

  it('un file alterato dopo la firma e rifiutato dalla fake (firmaNonValida) e dalla nostra verifica', async () => {
    const [prima] = await catenaDiTre()
    const alterato = prima.xml.replace('Mario Rossi', 'Mario Verdi')
    expect(verificaFirmaXmlRegistro(alterato).valida).toBe(false)
    const esito = await validaConLaFake(alterato, 'alterato.xml')
    expect(esito.validazione.map(m => m.codice)).toContain('firmaNonValida')
    expect(statoDaEsito(esito)).toBe('RIFIUTATA')
  })

  it('un primo Ref che non e il digest dell eREGI e rifiutato dalla fake (catenaDigestNonValida)', async () => {
    const ereg = leggiEregi(eregXml)
    const sbagliato = serializzaRegistro({
      eregXml,
      riferimenti: [
        { digestValue: Buffer.alloc(32, 9).toString('base64'), dataCreazione: ereg.dataRichiesta },
      ],
      registrazioni: [
        {
          anno: 2026,
          progressivoDa: 1,
          progressivoA: 1,
          dataCreazione: '2026-04-01T00:00:00.000Z',
          voci: voci(2026, 1, 1),
        },
      ],
    })
    const firmato = firmaXmlRegistro(sbagliato, materiale)
    const esito = await validaConLaFake(firmato.xml, 'catena.xml')
    expect(esito.validazione.map(m => m.codice)).toContain('catenaDigestNonValida')
    expect(statoDaEsito(esito)).toBe('RIFIUTATA')
  })

  it('un file non firmato passa con l avvertimento firmaNonPresente (VALIDATA_CON_AVVISI)', async () => {
    const ereg = leggiEregi(eregXml)
    const nonFirmato = serializzaRegistro({
      eregXml,
      riferimenti: [{ digestValue: ereg.digest, dataCreazione: ereg.dataRichiesta }],
      registrazioni: [
        {
          anno: 2026,
          progressivoDa: 1,
          progressivoA: 1,
          dataCreazione: '2026-04-01T00:00:00.000Z',
          voci: voci(2026, 1, 1),
        },
      ],
    })
    const esito = await validaConLaFake(nonFirmato, 'nonfirmato.xml')
    expect(esito.validazione.map(m => m.codice)).toEqual(['firmaNonPresente'])
    expect(statoDaEsito(esito)).toBe('VALIDATA_CON_AVVISI')
  })
})
