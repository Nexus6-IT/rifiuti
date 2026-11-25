import {
  RispostaRentriInattesaError,
  calcolaAttesaRetryMs,
  gestisciRispostaErroreRentri,
} from './rentri-http-resilienza'

describe('calcolaAttesaRetryMs', () => {
  const backoff = { baseMs: 1000, maxMs: 30000 }

  it('rispetta un Retry-After ragionevole', () => {
    expect(calcolaAttesaRetryMs(1, '5', backoff)).toBe(5000)
    expect(calcolaAttesaRetryMs(1, '0', backoff)).toBe(0)
  })

  it('un Retry-After enorme e` limitato al tetto del backoff', () => {
    expect(calcolaAttesaRetryMs(1, '86400', backoff)).toBe(30000)
  })

  it('senza header o con header non valido: backoff esponenziale con tetto', () => {
    expect(calcolaAttesaRetryMs(3, undefined, backoff)).toBe(4000)
    expect(calcolaAttesaRetryMs(10, 'abc', backoff)).toBe(30000)
  })
})

describe('gestisciRispostaErroreRentri: rifiuto definitivo diverso dal 403', () => {
  const logger: any = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const metrics: any = {
    rentriApiErrors: { inc: jest.fn() },
    rentriTenantLocked: { set: jest.fn() },
  }
  const chiama = (status: number, data?: unknown) =>
    gestisciRispostaErroreRentri(
      { status, data },
      '/formulari/X/quantita',
      1,
      5,
      logger,
      metrics,
      async () => undefined,
      { baseMs: 1, maxMs: 1 }
    )

  it("un 400 solleva un errore con il messaggio storico e il ProblemDetails dell'ente", async () => {
    const errore = await chiama(400, { title: 'Non valido', detail: 'numero_colli errato' }).catch(
      e => e
    )
    expect(errore).toBeInstanceOf(RispostaRentriInattesaError)
    // Altri chiamanti dipendono da questo testo.
    expect(errore.message).toBe('Risposta inattesa da /formulari/X/quantita: HTTP 400')
    expect(errore).toMatchObject({
      status: 400,
      problemTitle: 'Non valido',
      problemDetail: 'numero_colli errato',
    })
    expect(errore).toBeInstanceOf(Error)
  })

  it("senza corpo il ProblemDetails e' assente ma lo status resta", async () => {
    const errore = await chiama(404).catch(e => e)
    expect(errore).toMatchObject({ status: 404, problemTitle: undefined, problemDetail: undefined })
  })
})
