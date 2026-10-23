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

  it('numero ufficiale mancante (RENTRI_MISSING_NUMERO_FIR): chiede di controllare sul portale prima di ritrasmettere', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_MISSING_NUMERO_FIR',
      errorMessage: 'Esito RENTRI privo del numero ufficiale (numero_fir)',
    })

    expect(risultato).toEqual({
      messaggio:
        'RENTRI ha accettato la trasmissione ma non ha restituito il numero del formulario: controlla sul portale RENTRI prima di ritrasmettere, il formulario potrebbe già esistere.',
      azione: 'VERIFICA_SU_RENTRI',
    })
  })

  it('trasmissione incerta (RENTRI_TRASMISSIONE_INCERTA): controllare sul portale, poi ritrasmettere o collegare', () => {
    const risultato = traduciErroreRentri({ errorCode: 'RENTRI_TRASMISSIONE_INCERTA' })

    expect(risultato).toEqual({
      messaggio:
        "Non sappiamo se RENTRI ha ricevuto il formulario: controlla sul portale RENTRI. Se il formulario non c'è, ritrasmetti il FIR; se c'è, non ritrasmettere e collegalo con «Cerca su RENTRI».",
      azione: 'VERIFICA_SU_RENTRI',
    })
  })

  it('esito non acquisito (RENTRI_ESITO_NON_ACQUISITO): rileggere l’esito, nessun nuovo formulario', () => {
    const risultato = traduciErroreRentri({ errorCode: 'RENTRI_ESITO_NON_ACQUISITO' })

    expect(risultato).toEqual({
      messaggio:
        "RENTRI ha ricevuto il formulario ma non siamo riusciti a leggerne l'esito. Premi «Rileggi esito»: non verrà creato un nuovo formulario.",
      azione: 'RILEGGI_ESITO',
    })
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

  it('formulario già agganciato (FORMULARIO_GIA_AGGANCIATO): rimanda al FIR che lo ha già collegato, nessuna azione', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'FORMULARIO_GIA_AGGANCIATO',
    })

    expect(risultato.messaggio).toBe(
      'Questo formulario è già collegato a un altro FIR nel gestionale: rilascialo da lì prima di riprovare qui.'
    )
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('unità locale non configurata (UNITA_LOCALE_MANCANTE): rimanda alla pagina del certificato', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'UNITA_LOCALE_MANCANTE',
    })

    expect(risultato.messaggio).toBe(
      'Configura il numero di iscrizione della tua unità locale nella pagina del certificato prima di cercare i formulari.'
    )
    expect(risultato.azione).toBe('VEDI_CERTIFICATO')
  })

  it('403 su acquisizione-visibilità (RENTRI_FORBIDDEN_ACQUISIZIONE): nessun titolo sul formulario, distinto da RENTRI_FORBIDDEN', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'RENTRI_FORBIDDEN_ACQUISIZIONE',
    })

    expect(risultato.messaggio).toBe(
      'Non risulti tra i soggetti coinvolti in questo formulario: RENTRI non consente di agganciarlo.'
    )
    expect(risultato.azione).toBe('NESSUNA')
  })

  // --- R3 Task 9: operazione non più ammessa nello stato corrente ---
  //
  // Tre errorCode diversi (ACCETTAZIONE_NON_DISPONIBILE, ANNULLAMENTO_NON_DISPONIBILE,
  // ALLEGATO_NON_DISPONIBILE) condividono lo stesso `case` nell'implementazione: qui
  // verifichiamo esplicitamente due dei tre per provare che il fallthrough funziona
  // davvero, non solo per assunzione (il terzo, ANNULLAMENTO_NON_DISPONIBILE, cade
  // sullo stesso ramo e non aggiunge copertura).

  it('operazione non più ammessa (ACCETTAZIONE_NON_DISPONIBILE): la pagina si aggiornerà con lo stato corrente, nessun «Riprova»', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'ACCETTAZIONE_NON_DISPONIBILE',
    })

    expect(risultato.messaggio).toBe(
      'Il formulario non è più nella fase in cui questa operazione è possibile: la pagina si aggiornerà con lo stato corrente.'
    )
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('operazione non più ammessa (ALLEGATO_NON_DISPONIBILE): stesso messaggio condiviso del fallthrough', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'ALLEGATO_NON_DISPONIBILE',
    })

    expect(risultato.messaggio).toBe(
      'Il formulario non è più nella fase in cui questa operazione è possibile: la pagina si aggiornerà con lo stato corrente.'
    )
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('operazione non più ammessa (ANNULLAMENTO_NON_DISPONIBILE): stesso messaggio condiviso del fallthrough', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'ANNULLAMENTO_NON_DISPONIBILE',
    })

    expect(risultato.messaggio).toBe(
      'Il formulario non è più nella fase in cui questa operazione è possibile: la pagina si aggiornerà con lo stato corrente.'
    )
    expect(risultato.azione).toBe('NESSUNA')
  })

  // --- R3 Task 9: firma rifiutata a metà operazione ---

  it("firma rifiutata (FIRMA_RENTRI_RIFIUTATA, ACCETTAZIONE): nomina l'operazione specifica con l'accordo femminile, propone «Riprova»", () => {
    const risultato = traduciErroreRentri({
      errorCode: 'FIRMA_RENTRI_RIFIUTATA',
      errorMessage:
        "L'ente ha rifiutato la firma del formulario 123: l'operazione ACCETTAZIONE NON è stata completata. Dettaglio della validazione RENTRI: []",
    })

    expect(risultato.messaggio).toBe(
      "L'accettazione non si è completata sull'ente: puoi riprovare."
    )
    expect(risultato.azione).toBe('RIPROVA')
  })

  it("firma rifiutata (FIRMA_RENTRI_RIFIUTATA, ANNULLAMENTO): nomina l'operazione specifica con l'accordo maschile, propone «Riprova»", () => {
    const risultato = traduciErroreRentri({
      errorCode: 'FIRMA_RENTRI_RIFIUTATA',
      errorMessage:
        "L'ente ha rifiutato la firma del formulario 123: l'operazione ANNULLAMENTO NON è stata completata. Dettaglio della validazione RENTRI: []",
    })

    expect(risultato.messaggio).toBe(
      "L'annullamento non si è completato sull'ente: puoi riprovare."
    )
    expect(risultato.azione).toBe('RIPROVA')
  })

  it('firma rifiutata (FIRMA_RENTRI_RIFIUTATA) senza operazione riconoscibile: fallback generico, mai un crash', () => {
    const risultato = traduciErroreRentri({
      errorCode: 'FIRMA_RENTRI_RIFIUTATA',
      errorMessage: '',
    })

    expect(risultato.messaggio).toBe("L'operazione non si è completata sull'ente: puoi riprovare.")
    expect(risultato.azione).toBe('RIPROVA')
  })

  // --- R3 Task 9: validazione locale dell'allegato, non un errore RENTRI ---

  it("formato allegato non ammesso (FORMATO_ALLEGATO_NON_AMMESSO): non è un rifiuto dell'ente, nessuna azione", () => {
    const risultato = traduciErroreRentri({
      errorCode: 'FORMATO_ALLEGATO_NON_AMMESSO',
    })

    expect(risultato.messaggio).toBe(
      'Il formato del file non è ammesso: sono accettati solo allegati in PDF. Scegli un altro file.'
    )
    expect(risultato.messaggio).not.toContain('RENTRI')
    expect(risultato.messaggio.toLowerCase()).not.toContain('ente')
    expect(risultato.azione).toBe('NESSUNA')
  })

  it("allegato troppo grande (ALLEGATO_TROPPO_GRANDE): non è un rifiuto dell'ente, nessuna azione, indica il limite", () => {
    const risultato = traduciErroreRentri({
      errorCode: 'ALLEGATO_TROPPO_GRANDE',
    })

    expect(risultato.messaggio).toBe(
      'Il file supera la dimensione massima ammessa (1 MB): scegli un file più piccolo.'
    )
    expect(risultato.messaggio).not.toContain('RENTRI')
    expect(risultato.messaggio.toLowerCase()).not.toContain('ente')
    expect(risultato.azione).toBe('NESSUNA')
  })

  it('traduciErroreRentri RENTRI_CERTIFICATO_MANCANTE → VEDI_CERTIFICATO', () => {
    const risultato = traduciErroreRentri({ errorCode: 'RENTRI_CERTIFICATO_MANCANTE' })

    expect(risultato.messaggio).toBe(
      "L'azienda non ha un certificato RENTRI configurato: caricalo nella pagina del certificato RENTRI."
    )
    expect(risultato.azione).toBe('VEDI_CERTIFICATO')
  })
})
