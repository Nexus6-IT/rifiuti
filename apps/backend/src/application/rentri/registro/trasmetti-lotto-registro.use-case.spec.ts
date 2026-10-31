import { TenantSenzaCertificatoRentriError } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import {
  TransazioneRentriNonTrovataError,
  TrasmissioneRentriIncertaError,
} from '../../../infrastructure/rentri/rentri-api.client'
import {
  ETA_MASSIMA_ATTESA_ESITO_MS,
  TrasmettiLottoRegistroUseCase,
} from './trasmetti-lotto-registro.use-case'
import { LOTTO_MASSIMO_RENTRI, type CandidataLotto } from './selezione-lotto-rentri'

const T = 'tenant-1'
const R = 'registro-1'
const TRANS = '11111111-1111-4111-8111-111111111111'

const cand = (n: number): CandidataLotto => ({
  movimentoId: `m${n}`,
  numero: { anno: 2026, progressivo: n },
  predecessoreId: null,
  statoPredecessore: null,
})

const annotazione = (n: number) => ({
  movimentoId: `m${n}`,
  tipoAnnotazione: 'ORDINARIA',
  numero: { anno: 2026, progressivo: n },
})

function prepara(candidate: CandidataLotto[], traducibile = (_n: number) => true) {
  const log: any[] = []
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn((...a) => log.push(a)),
    warn: jest.fn((...a) => log.push(a)),
    error: jest.fn((...a) => log.push(a)),
    debug: jest.fn((...a) => log.push(a)),
  }
  const ordine: string[] = []
  const repo: any = {
    prenota: jest.fn(async (_t: string, _r: string, fn: any) => {
      const tx = {
        registroRifiuti: {
          findFirst: jest.fn().mockResolvedValue({ identificativoRentri: 'RABCDE12345' }),
        },
      }
      const scelta = await fn(tx, candidate)
      repo.scelta = scelta
      return scelta.lotto.length
        ? { esito: 'PRENOTATO', lottoId: 'lotto-1', movimentoIds: scelta.lotto }
        : { esito: 'NIENTE' }
    }),
    salvaTransazione: jest.fn(async () => {
      ordine.push('salva')
      return 'SALVATA'
    }),
    segnaIncerte: jest.fn(async () => 1),
    segnaRifiutate: jest.fn(async () => 1),
    applicaEsiti: jest.fn(async () => undefined),
    annotaErrorePolling: jest.fn(async () => undefined),
    ripristinaPrenotazione: jest.fn(async () => undefined),
    transazioniInAttesa: jest.fn(async () => []),
    righeDellaTransazione: jest.fn(async () => []),
  }
  const lettore: any = {
    leggi: jest.fn(async (_tx: unknown, _t: string, _r: string, ids: string[]) =>
      ids.map(id => annotazione(Number(id.slice(1))))
    ),
  }
  const traduci = jest.fn((a: any) =>
    traducibile(a.numero.progressivo)
      ? { ok: true as const, corpo: { codice_eer: '150101', n: a.numero.progressivo } }
      : { ok: false as const, motivi: ['Manca la sede'] }
  )
  const client: any = {
    inviaMovimenti: jest.fn(async () => {
      ordine.push('post')
      return { transazioneId: TRANS }
    }),
    attendiEsitoMovimenti: jest.fn(async () => {
      ordine.push('polling')
      return {
        errore: false,
        validazione: [],
        numeroRegistrazioni: candidate.map(c => ({
          anno: 2026,
          progressivo: c.numero.progressivo,
          identificativo: `M${String(c.numero.progressivo).padStart(19, '0')}`,
        })),
      }
    }),
  }
  const uc = new TrasmettiLottoRegistroUseCase(repo, lettore, client, logger, traduci)
  return { uc, repo, lettore, client, logger, log, ordine, traduci }
}

describe('TrasmettiLottoRegistroUseCase', () => {
  it('salvaTransazione PRIMA del polling; esito applicato alle righe del lotto', async () => {
    const x = prepara([cand(2), cand(1)])
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(x.ordine).toEqual(['post', 'salva', 'polling'])
    expect(r).toMatchObject({ esito: 'INVIATO', trasmesse: 2, rifiutate: 0 })
    const corpi = x.client.inviaMovimenti.mock.calls[0][1]
    expect(corpi.map((c: any) => c.n)).toEqual([1, 2]) // ordine (anno, progressivo)
    const esiti = x.repo.applicaEsiti.mock.calls[0][2]
    expect(esiti.map((e: any) => [e.movimentoId, e.stato])).toEqual([
      ['m1', 'TRASMESSA'],
      ['m2', 'TRASMESSA'],
    ])
  })

  it('traduce solo le prime LOTTO_MASSIMO_RENTRI candidate', async () => {
    const molte = Array.from({ length: LOTTO_MASSIMO_RENTRI + 20 }, (_, i) => cand(i + 1))
    const x = prepara(molte)
    await x.uc.trasmettiRegistro(T, R)
    expect(x.lettore.leggi.mock.calls[0][3]).toHaveLength(LOTTO_MASSIMO_RENTRI)
    expect(x.traduci).toHaveBeenCalledTimes(LOTTO_MASSIMO_RENTRI)
  })

  it('le righe NON_TRASMISSIBILE ricevono i motivi e non vanno nella POST', async () => {
    const x = prepara([cand(1), cand(2)], n => n !== 1)
    x.client.attendiEsitoMovimenti.mockResolvedValue({
      errore: false,
      validazione: [],
      numeroRegistrazioni: [{ anno: 2026, progressivo: 2, identificativo: null }],
    })
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(x.client.inviaMovimenti.mock.calls[0][1]).toHaveLength(1)
    expect(r.nonTrasmissibili).toBe(1)
    expect(x.repo.scelta.nonTrasmissibili).toEqual([
      { movimentoId: 'm1', motivi: ['Manca la sede'] },
    ])
    expect(x.repo.scelta.lotto).toEqual(['m2'])
  })

  it('niente da inviare, gia in corso, senza identificativo: nessuna POST', async () => {
    for (const esito of ['NIENTE', 'GIA_IN_CORSO', 'SENZA_IDENTIFICATIVO']) {
      const x = prepara([])
      x.repo.prenota.mockResolvedValue({ esito })
      const r = await x.uc.trasmettiRegistro(T, R)
      expect(r.esito).toBe(esito)
      expect(x.client.inviaMovimenti).not.toHaveBeenCalled()
    }
  })

  it('TrasmissioneRentriIncertaError: INCERTA e nessuna seconda POST', async () => {
    const x = prepara([cand(1)])
    x.client.inviaMovimenti.mockRejectedValue(new TrasmissioneRentriIncertaError('HTTP_5XX', 502))
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r.esito).toBe('INCERTO')
    expect(x.repo.segnaIncerte).toHaveBeenCalledWith(
      T,
      'lotto-1',
      expect.stringMatching(/verificare/)
    )
    expect(x.repo.segnaRifiutate).not.toHaveBeenCalled()
    expect(x.repo.ripristinaPrenotazione).not.toHaveBeenCalled()
    expect(x.client.inviaMovimenti).toHaveBeenCalledTimes(1)
  })

  it('429/423 esauriti: INCERTA, mai RIFIUTATA ne ripristino', async () => {
    const x = prepara([cand(1)])
    x.client.inviaMovimenti.mockRejectedValue(new RentriApiError(429, 'Too many', undefined, true))
    expect((await x.uc.trasmettiRegistro(T, R)).esito).toBe('INCERTO')
    expect(x.repo.segnaIncerte).toHaveBeenCalled()
    expect(x.repo.segnaRifiutate).not.toHaveBeenCalled()
    expect(x.repo.ripristinaPrenotazione).not.toHaveBeenCalled()
  })

  it('400 della POST: RIFIUTATA con il titolo; 404 con messaggio sul registro', async () => {
    const x = prepara([cand(1)])
    x.client.inviaMovimenti.mockRejectedValue(
      new RentriApiError(400, 'Richiesta non valida', undefined, false)
    )
    expect((await x.uc.trasmettiRegistro(T, R)).esito).toBe('RIFIUTATO')
    expect(x.repo.segnaRifiutate).toHaveBeenCalledWith(T, 'lotto-1', 'Richiesta non valida')
    const y = prepara([cand(1)])
    y.client.inviaMovimenti.mockRejectedValue(
      new RentriApiError(404, 'Not found', undefined, false)
    )
    await y.uc.trasmettiRegistro(T, R)
    expect(y.repo.segnaRifiutate).toHaveBeenCalledWith(
      T,
      'lotto-1',
      expect.stringMatching(/Registro non trovato su RENTRI/)
    )
  })

  it('un 4xx non previsto (es. 401) e un errore sconosciuto vanno in INCERTA', async () => {
    for (const err of [new RentriApiError(401, 'x', undefined, false), new Error('boom')]) {
      const x = prepara([cand(1)])
      x.client.inviaMovimenti.mockRejectedValue(err)
      expect((await x.uc.trasmettiRegistro(T, R)).esito).toBe('INCERTO')
      expect(x.repo.segnaRifiutate).not.toHaveBeenCalled()
    }
  })

  it('senza certificato: prenotazione ripristinata', async () => {
    const x = prepara([cand(1)])
    x.client.inviaMovimenti.mockRejectedValue(new TenantSenzaCertificatoRentriError())
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r.esito).toBe('SENZA_CERTIFICATO')
    expect(x.repo.ripristinaPrenotazione).toHaveBeenCalledWith(T, 'lotto-1')
    expect(x.repo.segnaIncerte).not.toHaveBeenCalled()
  })

  it('un errore diverso dal certificato mancante non ripristina', async () => {
    for (const err of [
      new Error('qualunque'),
      new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA'),
      new RentriApiError(423, 'Locked', undefined, true),
    ]) {
      const x = prepara([cand(1)])
      x.client.inviaMovimenti.mockRejectedValue(err)
      await x.uc.trasmettiRegistro(T, R)
      expect(x.repo.ripristinaPrenotazione).not.toHaveBeenCalled()
    }
  })

  it('certificato mancante DURANTE il polling: non ripristina, resta ATTESA_ESITO', async () => {
    const x = prepara([cand(1)])
    x.client.attendiEsitoMovimenti.mockRejectedValue(new TenantSenzaCertificatoRentriError())
    await x.uc.trasmettiRegistro(T, R)
    expect(x.repo.ripristinaPrenotazione).not.toHaveBeenCalled()
    expect(x.repo.annotaErrorePolling).toHaveBeenCalled()
    expect(x.repo.segnaIncerte).not.toHaveBeenCalled()
  })

  it('un errore nel polling lascia ATTESA_ESITO (niente applicaEsiti ne RIFIUTATA)', async () => {
    const x = prepara([cand(1)])
    x.client.attendiEsitoMovimenti.mockRejectedValue(
      new Error('Superato il numero massimo di tentativi')
    )
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(x.repo.annotaErrorePolling).toHaveBeenCalledWith(T, TRANS, expect.any(String))
    expect(x.repo.applicaEsiti).not.toHaveBeenCalled()
    expect(x.repo.segnaIncerte).not.toHaveBeenCalled()
    expect(r.esito).toBe('INVIATO')
    expect(r.inAttesa).toBe(1)
  })

  it('404 della transazione: INCERTA', async () => {
    const x = prepara([cand(1)])
    x.client.attendiEsitoMovimenti.mockRejectedValue(new TransazioneRentriNonTrovataError(TRANS))
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r.esito).toBe('INCERTO')
    expect(x.repo.segnaIncerte).toHaveBeenCalledWith(
      T,
      { transazioneId: TRANS },
      expect.any(String)
    )
    expect(x.repo.applicaEsiti).not.toHaveBeenCalled()
  })

  it('salvaTransazione SU_INCERTA: nessun polling', async () => {
    const x = prepara([cand(1)])
    x.repo.salvaTransazione.mockResolvedValue('SU_INCERTA')
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r.esito).toBe('INCERTO')
    expect(x.client.attendiEsitoMovimenti).not.toHaveBeenCalled()
  })

  it('lotto con numero duplicato all esito: INCERTA, mai RIFIUTATA', async () => {
    const x = prepara([cand(1), cand(2)])
    x.repo.righeDellaTransazione.mockResolvedValue([])
    // forza il duplicato: due righe dello stesso lotto con lo stesso numero
    x.lettore.leggi.mockImplementation(async () => [
      annotazione(1),
      { ...annotazione(2), numero: { anno: 2026, progressivo: 1 } },
    ])
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r.esito).toBe('INCERTO')
    expect(x.repo.segnaIncerte).toHaveBeenCalled()
    expect(x.repo.segnaRifiutate).not.toHaveBeenCalled()
  })

  it('esito con errore: RIFIUTATE con i motivi', async () => {
    const x = prepara([cand(1)])
    x.client.attendiEsitoMovimenti.mockResolvedValue({
      errore: true,
      validazione: [],
      numeroRegistrazioni: [],
    })
    const r = await x.uc.trasmettiRegistro(T, R)
    expect(r).toMatchObject({ esito: 'RIFIUTATO', trasmesse: 0, rifiutate: 1 })
    expect(x.repo.applicaEsiti.mock.calls[0][2][0].stato).toBe('RIFIUTATA')
  })

  it('nessun log contiene il corpo', async () => {
    const x = prepara([cand(1)])
    await x.uc.trasmettiRegistro(T, R)
    x.client.inviaMovimenti.mockRejectedValue(new Error('boom'))
    const y = prepara([cand(1)])
    y.client.inviaMovimenti.mockRejectedValue(new Error('boom'))
    await y.uc.trasmettiRegistro(T, R)
    for (const l of [...x.log, ...y.log]) {
      expect(JSON.stringify(l)).not.toContain('codice_eer')
    }
  })

  describe('riprendiAttese', () => {
    it('ATTESA_ESITO oltre 7 giorni: INCERTA, senza rileggere', async () => {
      const x = prepara([])
      x.repo.transazioniInAttesa.mockResolvedValue([
        {
          transazioneId: TRANS,
          registroId: R,
          dal: new Date(Date.now() - ETA_MASSIMA_ATTESA_ESITO_MS - 1000),
        },
      ])
      const r = await x.uc.riprendiAttese(T)
      expect(r).toEqual({ riletti: 0, incerte: 1 })
      expect(x.repo.segnaIncerte).toHaveBeenCalledWith(
        T,
        { transazioneId: TRANS },
        expect.any(String)
      )
      expect(x.client.attendiEsitoMovimenti).not.toHaveBeenCalled()
    })

    it('rilegge senza POST e applica l esito', async () => {
      const x = prepara([cand(1)])
      x.repo.transazioniInAttesa.mockResolvedValue([
        { transazioneId: TRANS, registroId: R, dal: new Date() },
      ])
      x.repo.righeDellaTransazione.mockResolvedValue([
        { movimentoId: 'm1', numero: { anno: 2026, progressivo: 1 } },
      ])
      const r = await x.uc.riprendiAttese(T)
      expect(r).toEqual({ riletti: 1, incerte: 0 })
      expect(x.client.inviaMovimenti).not.toHaveBeenCalled()
      expect(x.repo.applicaEsiti).toHaveBeenCalledTimes(1)
    })

    it('errore tecnico nella rilettura: annota e resta in attesa; 404: INCERTA', async () => {
      const x = prepara([cand(1)])
      x.repo.transazioniInAttesa.mockResolvedValue([
        { transazioneId: TRANS, registroId: R, dal: new Date() },
      ])
      x.repo.righeDellaTransazione.mockResolvedValue([
        { movimentoId: 'm1', numero: { anno: 2026, progressivo: 1 } },
      ])
      x.client.attendiEsitoMovimenti.mockRejectedValue(new Error('rete'))
      expect(await x.uc.riprendiAttese(T)).toEqual({ riletti: 0, incerte: 0 })
      expect(x.repo.annotaErrorePolling).toHaveBeenCalled()
      x.client.attendiEsitoMovimenti.mockRejectedValue(new TransazioneRentriNonTrovataError(TRANS))
      expect(await x.uc.riprendiAttese(T)).toEqual({ riletti: 0, incerte: 1 })
      expect(x.repo.applicaEsiti).not.toHaveBeenCalled()
    })
  })
})
