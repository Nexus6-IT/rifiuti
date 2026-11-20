/**
 * Pezzo I5 T3: `migrazione:riacquisisci-fir` con un client RENTRI FINTO che registra ogni chiamata.
 * Prova che: nessuna scrittura verso l'ente (ne' POST di creazione ne' acquisizione di visibilita'),
 * un FIR riacquisito non e' importato (Q5: nasce senza provenienza e non bloccato), il limite di
 * frequenza (pausa fra le chiamate, massimo per esecuzione, stop al primo errore transitorio) e
 * che senza `esegui` non si contatta RENTRI.
 */
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TenantSenzaCertificatoRentriError } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { mappaValida, T_PROVA, U2 } from '../../../test-support/migrazione/mappa-di-prova'
import { AcquisisciFormularioRENTRIUseCase } from '../../rentri/acquisisci-formulario-rentri.use-case'
import { apriPacchetto, PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { RecordFirDigitale } from '../pacchetto/record-fir'
import { scriviPacchetto } from '../pacchetto/scrittore-pacchetto'
import {
  ArchivioRiacquisizione,
  RiacquisisciFirService,
  UtenteNonAbilitatoError,
} from './riacquisisci-fir.service'

const UL = '55555555-5555-4555-8555-555555555555'
const UTENTE = '66666666-6666-4666-8666-666666666666'

/** Client che registra QUALUNQUE metodo chiamato; solo `leggiFormulario` ha un comportamento. */
function clientFinto(opzioni: { leggi?: (numero: string) => Promise<unknown> } = {}) {
  const chiamate: string[] = []
  const comportamenti: Record<string, (...a: any[]) => Promise<unknown>> = {
    leggiFormulario: opzioni.leggi ?? (async () => ({ stato_formulario: 'EMESSO' })),
  }
  const proxy = new Proxy(
    {},
    {
      get:
        (_t, nome: string) =>
        async (...a: any[]) => {
          chiamate.push(nome)
          const f = comportamenti[nome]
          if (!f) throw new Error(`chiamata non prevista al client RENTRI: ${nome}`)
          return await f(...a)
        },
    }
  )
  return { proxy, chiamate }
}

const logger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

describe('RiacquisisciFirService (client RENTRI finto)', () => {
  let radice: string
  beforeAll(async () => {
    radice = await mkdtemp(join(tmpdir(), 'riacq-fir-'))
  })
  afterAll(() => rm(radice, { recursive: true, force: true }))

  async function pacchetto(righe: RecordFirDigitale[]): Promise<PacchettoAperto> {
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: T_PROVA,
      registri: [],
      unitaLocali: [{ legacy: 'X1.0001', sedeId: U2, unitaLocaleId: UL }],
      causali: [],
      agganci: [],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'a'.repeat(64),
      mappa,
      fasi: [{ ambito: 'FIR', fase: 'fir-digitali', record: righe }],
    })
    return await apriPacchetto(cartella)
  }
  const dig = (n: number, unita: string | null = UL): RecordFirDigitale => ({
    legacyKey: `0001|2026|FORMULARI|${n}`,
    numeroFir: `NUMERO${String(n).padStart(6, '0')}`,
    idRentri: `id-${n}`,
    unitaLocaleId: unita,
  })

  function costruisci(
    opzioni: { presenti?: string[]; leggi?: (n: string) => Promise<unknown> } = {}
  ) {
    const { proxy, chiamate } = clientFinto({ leggi: opzioni.leggi })
    const salvati: FIR[] = []
    const repo = {
      findByRentriNumeroFir: jest.fn(async () => null),
      findById: jest.fn(),
      save: jest.fn(async (f: FIR) => {
        salvati.push(f)
      }),
    }
    const port = {
      creaDaDettaglio: jest.fn(async () =>
        FIR.create({
          produttoreId: 'p',
          tenantId: T_PROVA,
          rifiuto: { cerCode: '15 01 01', quantita: 1, unitaMisura: UnitaMisura.KG },
          trasportatoreId: 't',
          destinatarioId: 'd',
        })
      ),
    }
    const useCase = new AcquisisciFormularioRENTRIUseCase(
      repo as any,
      proxy as any,
      { activityLog: { create: jest.fn() } } as any,
      port as any,
      logger() as any
    )
    const archivio: ArchivioRiacquisizione = {
      firGiaPresente: jest.fn(async (_t: string, numero: string) =>
        (opzioni.presenti ?? []).includes(numero)
      ),
      numIscrSito: jest.fn(async () => 'OP1234ABC123456-RM1234'),
      ruoloUtente: jest.fn(async () => 'OPERATOR'),
    }
    const attese: number[] = []
    const servizio = new RiacquisisciFirService(
      { acquisisci: i => useCase.execute(i) },
      archivio,
      logger() as any,
      async ms => {
        attese.push(ms)
      }
    )
    return { servizio, chiamate, salvati, archivio, attese }
  }
  const richiesta = (p: PacchettoAperto, extra: Record<string, unknown> = {}) => ({
    tenantId: T_PROVA,
    userId: UTENTE,
    pacchetto: p,
    esegui: true,
    pausaMs: 2500,
    massimo: 25,
    ...extra,
  })

  it('riacquisisce in sola lettura: l unica chiamata al client e leggiFormulario, nessuna POST di creazione ne acquisizione di visibilita', async () => {
    const p = await pacchetto([dig(1), dig(2), dig(3)])
    const { servizio, chiamate, salvati } = costruisci()
    const r = await servizio.esegui(richiesta(p))
    expect(r.conteggi).toEqual({ RIACQUISITO: 3 })
    expect(chiamate).toEqual(['leggiFormulario', 'leggiFormulario', 'leggiFormulario'])
    for (const vietato of [
      'creaFormulario',
      'acquisisciVisibilita',
      'rilasciaVisibilita',
      'inviaAccettazione',
      'annullaFormulario',
      'caricaAllegato',
      'inviaNoteAnnullamento',
    ])
      expect(chiamate).not.toContain(vietato)
    expect(salvati).toHaveLength(3)
  })

  it('Q5: un FIR riacquisito non e un import (nessuna provenienza) e non e bloccato; porta il numero RENTRI', async () => {
    const p = await pacchetto([dig(1)])
    const { servizio, salvati } = costruisci()
    await servizio.esegui(richiesta(p))
    const fir = salvati[0]
    expect(fir.rentriNumeroFir).toBe('NUMERO000001')
    expect(fir.bloccatoInvio).toBe(false)
    expect(fir.motivoBloccoInvio).toBeNull()
  })

  it('un FIR gia presente nel database non contatta RENTRI', async () => {
    const p = await pacchetto([dig(1), dig(2)])
    const { servizio, chiamate } = costruisci({ presenti: ['NUMERO000001'] })
    const r = await servizio.esegui(richiesta(p))
    expect(r.conteggi).toEqual({ GIA_PRESENTE: 1, RIACQUISITO: 1 })
    expect(chiamate).toEqual(['leggiFormulario'])
  })

  it('senza unita locale della mappa il FIR e segnalato e non si chiama RENTRI', async () => {
    const p = await pacchetto([dig(1, null)])
    const { servizio, chiamate } = costruisci()
    const r = await servizio.esegui(richiesta(p))
    expect(r.conteggi).toEqual({ SENZA_UNITA_LOCALE: 1 })
    expect(chiamate).toEqual([])
  })

  it('senza esegui e una simulazione: zero chiamate a RENTRI, zero scritture', async () => {
    const p = await pacchetto([dig(1), dig(2)])
    const { servizio, chiamate, salvati, attese } = costruisci()
    const r = await servizio.esegui(richiesta(p, { esegui: false }))
    expect(r.conteggi).toEqual({ SIMULATO: 2 })
    expect(chiamate).toEqual([])
    expect(salvati).toEqual([])
    expect(attese).toEqual([])
  })

  describe('limite di frequenza', () => {
    it('pausa fra una chiamata e la successiva (non prima della prima)', async () => {
      const p = await pacchetto([dig(1), dig(2), dig(3)])
      const { servizio, attese } = costruisci()
      await servizio.esegui(richiesta(p, { pausaMs: 4000 }))
      expect(attese).toEqual([4000, 4000])
    })

    it('massimo per esecuzione: il resto e RINVIATO e non si chiama RENTRI', async () => {
      const p = await pacchetto([dig(1), dig(2), dig(3), dig(4)])
      const { servizio, chiamate } = costruisci()
      const r = await servizio.esegui(richiesta(p, { massimo: 2 }))
      expect(r.conteggi).toEqual({ RIACQUISITO: 2, RINVIATO: 2 })
      expect(chiamate).toHaveLength(2)
    })

    it('un errore transitorio dell ente (429/423/5xx a tentativi esauriti) ferma l esecuzione', async () => {
      const p = await pacchetto([dig(1), dig(2), dig(3)])
      let n = 0
      const { servizio, chiamate } = costruisci({
        leggi: async () => {
          n++
          if (n === 2) throw new RentriApiError(429, 'Too Many Requests', undefined, true)
          return { stato_formulario: 'EMESSO' }
        },
      })
      const r = await servizio.esegui(richiesta(p))
      expect(r.interrotto).toBe(true)
      expect(r.conteggi).toEqual({ RIACQUISITO: 1, INTERROTTO_ENTE: 1, RINVIATO: 1 })
      expect(chiamate).toHaveLength(2)
    })

    it('I-2: 403 = visibilita non acquisita (si prosegue, senza acquisirla); 404 = non trovato su RENTRI; 400 = FALLITO con codice', async () => {
      const p = await pacchetto([dig(1), dig(2), dig(3), dig(4)])
      const stati = [403, 404, 400]
      let n = 0
      const { servizio, chiamate } = costruisci({
        leggi: async () => {
          const st = stati[n++]
          if (st) throw new RentriApiError(st, 'x', undefined, false)
          return { stato_formulario: 'EMESSO' }
        },
      })
      const r = await servizio.esegui(richiesta(p))
      expect(r.interrotto).toBe(false)
      expect(r.conteggi).toEqual({
        VISIBILITA_NON_ACQUISITA: 1,
        NON_TROVATO_SU_RENTRI: 1,
        FALLITO: 1,
        RIACQUISITO: 1,
      })
      expect(r.esiti.find(e => e.esito === 'FALLITO')?.codice).toBe('HTTP_400')
      expect(chiamate).not.toContain('acquisisciVisibilita')
    })

    it('I-2: 401 o certificato mancante e un problema SISTEMICO: stop al primo, il resto RINVIATO', async () => {
      for (const errore of [
        new RentriApiError(401, 'Unauthorized', undefined, false),
        new TenantSenzaCertificatoRentriError(),
      ]) {
        const p = await pacchetto([dig(1), dig(2), dig(3)])
        const { servizio, chiamate } = costruisci({
          leggi: async () => {
            throw errore
          },
        })
        const r = await servizio.esegui(richiesta(p))
        expect(r.interrotto).toBe(true)
        expect(r.conteggi).toEqual({ INTERROTTO_CREDENZIALE: 1, RINVIATO: 2 })
        expect(chiamate).toHaveLength(1)
      }
    })
  })

  it('M-6: il ruolo letto dall archivio arriva al caso d uso', async () => {
    const p = await pacchetto([dig(1)])
    const eseguite: any[] = []
    const { archivio, attese: _a } = costruisci()
    ;(archivio.ruoloUtente as jest.Mock).mockResolvedValue('ADMIN')
    const servizio = new RiacquisisciFirService(
      {
        acquisisci: async i => {
          eseguite.push(i)
          return { firId: 'f', numeroFir: i.numeroFir }
        },
      },
      archivio,
      logger() as any,
      async () => undefined
    )
    await servizio.esegui(richiesta(p))
    expect(eseguite[0].userRole).toBe('ADMIN')
  })

  it('un utente non abilitato alle scritture RENTRI ferma tutto prima di leggere il pacchetto', async () => {
    const p = await pacchetto([dig(1)])
    const { servizio, archivio, chiamate } = costruisci()
    ;(archivio.ruoloUtente as jest.Mock).mockResolvedValue('VIEWER')
    await expect(servizio.esegui(richiesta(p))).rejects.toBeInstanceOf(UtenteNonAbilitatoError)
    ;(archivio.ruoloUtente as jest.Mock).mockResolvedValue(null)
    await expect(servizio.esegui(richiesta(p))).rejects.toBeInstanceOf(UtenteNonAbilitatoError)
    expect(chiamate).toEqual([])
  })

  it('il rapporto non contiene altro che numeri di FIR, esiti e codici', async () => {
    const p = await pacchetto([dig(1)])
    const { servizio } = costruisci()
    const r = await servizio.esegui(richiesta(p))
    expect(Object.keys(r.esiti[0]).sort()).toEqual(['esito', 'numeroFir'])
    expect(JSON.stringify(r)).not.toMatch(/id-1|OP1234/)
  })
})
