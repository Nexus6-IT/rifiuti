/**
 * Traduzione errori RENTRI (R1 Task 5) — TDD, un test per famiglia.
 *
 * Il metro del task: il testo che l'utente vedrebbe deve dirgli cosa è
 * successo e cosa fare, e l'azione «Riprova» deve comparire SOLO quando
 * ritentare ha senso. Offrirla su un 429/423 è attivamente dannoso
 * (peggiora il bando dell'ente); offrirla su un 403 è inutile (la
 * credenziale non cambia da sola).
 */
import { traduciErroreRentri } from './rentri-error-presentation'

describe('traduciErroreRentri', () => {
  it('403 (RENTRI_FORBIDDEN): certificato non valido, nessun «Riprova», rimanda al certificato', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_FORBIDDEN',
      errorMessage: 'Certificato non riconosciuto',
    })

    expect(risultato.messaggio).toContain('certificato')
    expect(risultato.messaggio).not.toMatch(/403|RENTRI_FORBIDDEN/)
    expect(risultato.azione).toBe('VEDI_CERTIFICATO')
  })

  it('429/423 (RENTRI_RATE_LIMITED): nessun «Riprova», spiega che riprenderà da sola', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_RATE_LIMITED',
      errorMessage: 'Too Many Requests',
    })

    expect(risultato.messaggio).toContain('riprenderà')
    expect(risultato.messaggio).not.toMatch(/429|423|RENTRI_RATE_LIMITED/)
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('errore di validazione: riporta il messaggio dell’ente e il campo del formulario quando ricavabile', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_VALIDATION_ERROR',
      errorMessage: 'cerCode: Invalid CER code',
      responsePayload: JSON.stringify({
        errore: true,
        validazione: [{ campo: 'cerCode', codice_messaggio: 'Invalid CER code' }],
      }),
    })

    expect(risultato.messaggio).toContain('Invalid CER code')
    expect(risultato.messaggio).toContain('cerCode')
    expect(risultato.campo).toBe('cerCode')
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('errore di validazione senza campo ricavabile: messaggio comunque presente, campo assente (mai inventato)', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_VALIDATION_ERROR',
      errorMessage: 'Errore generico di validazione',
      responsePayload: null,
    })

    expect(risultato.messaggio).toContain('Errore generico di validazione')
    expect(risultato.campo).toBeUndefined()
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('numero ufficiale mancante (RENTRI_MISSING_NUMERO_FIR): spiega che il FIR non è legato, propone «Riprova»', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_MISSING_NUMERO_FIR',
      errorMessage: 'Esito RENTRI privo del numero ufficiale (numero_fir)',
    })

    expect(risultato.messaggio).toContain('numero ufficiale')
    expect(risultato.messaggio.toLowerCase()).toContain('non risulta')
    expect(risultato.azione).toBe('RIPROVA')
  })

  it('5xx / problemi di rete (RENTRI_API_ERROR): transitorio, nessun «Riprova» manuale (riprende da sola)', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_API_ERROR',
      errorMessage: 'RENTRI service unavailable',
    })

    expect(risultato.messaggio).toContain('riprenderà')
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('errorCode assente/sconosciuto: tratta come transitorio, mai un testo tecnico non tradotto', () => {
    const risultato = traduciErroreRentri({
      errorCode: undefined,
      errorMessage: 'qualcosa di non catalogato',
    })

    expect(risultato.messaggio).not.toContain('qualcosa di non catalogato')
    expect(risultato.azione).toBe('NESSUNA')
  })
})
