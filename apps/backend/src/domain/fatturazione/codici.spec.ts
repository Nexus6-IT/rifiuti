import {
  AVVISI_DOCUMENTO,
  ERRORI_DOCUMENTO,
  ERRORI_GENERALI,
  MESSAGGI_AVVISO,
  MESSAGGI_ERRORE,
  RAGGRUPPAMENTI,
  STATI_DOCUMENTO,
  STATI_ELABORAZIONE,
  TETTO_DOCUMENTI_DEFINITIVA,
  TIPI_DOCUMENTO,
  TIPI_MARCATORE,
  TIPI_RIGA_DOCUMENTO,
  validaTestoBreve,
} from './codici'

describe('insiemi chiusi della fatturazione', () => {
  it("hanno i valori della spec, nell'ordine", () => {
    expect(STATI_ELABORAZIONE).toEqual([
      'IN_CODA',
      'IN_CORSO',
      'ANTEPRIMA_PRONTA',
      'IN_DEFINITIVA',
      'DEFINITIVA',
      'FALLITA',
      'SCARTATA',
    ])
    expect(STATI_DOCUMENTO).toEqual(['BOZZA', 'DEFINITIVO', 'ANNULLATO'])
    expect(TIPI_DOCUMENTO).toEqual(['TD01', 'TD04', 'TD24'])
    expect(RAGGRUPPAMENTI).toEqual(['PER_CONTRATTO', 'PER_ELENCO'])
    expect(TIPI_RIGA_DOCUMENTO).toEqual([
      'MOVIMENTO',
      'FASCIA_SPECIALE',
      'FISSO',
      'MINIMO',
      'SPESA_INCASSO',
      'BOLLO',
      'STORNO',
      'QUANTITA_MOVIMENTI',
    ])
    expect(TIPI_MARCATORE).toEqual([
      'SCADENZA_FISSO',
      'PERIODO_CANONE',
      'CONGUAGLIO',
      'ACCONTO_FATTURATO',
      'ACCONTO_DETRATTO',
    ])
    expect(ERRORI_GENERALI).toEqual([
      'CEDENTE_INCOMPLETO',
      'DATA_ANTERIORE_ULTIMA_FATTURA',
      'DATA_FUTURA',
      'LEGAMI_SENZA_CONTRATTO',
    ])
    expect(AVVISI_DOCUMENTO).toEqual([
      'MOVIMENTI_DA_COLLEGARE_ESCLUSI',
      'MOVIMENTI_SOSPESI',
      'ARRETRATI_PRESENTI',
      'BOLLO_NON_ADDEBITATO',
      'DESTINATARIO_ASSENTE',
      'FPA_DA_FIRMARE',
      'DATA_OLTRE_TERMINE_DIFFERITA',
    ])
  })

  it('hanno le cardinalita attese', () => {
    expect(STATI_ELABORAZIONE).toHaveLength(7)
    expect(STATI_DOCUMENTO).toHaveLength(3)
    expect(TIPI_DOCUMENTO).toHaveLength(3)
    expect(TIPI_RIGA_DOCUMENTO).toHaveLength(8)
    expect(TIPI_MARCATORE).toHaveLength(5)
    expect(ERRORI_GENERALI).toHaveLength(4)
    expect(ERRORI_DOCUMENTO).toHaveLength(18)
    expect(AVVISI_DOCUMENTO).toHaveLength(7)
  })

  it('gli errori del documento contengono i codici della spec', () => {
    for (const c of [
      'CONTRATTO_SOSPESO',
      'SENZA_REGISTRO_IVA',
      'CLIENTE_SENZA_DATI_FISCALI',
      'SEDE_CLIENTE_INCOMPLETA',
      'DATI_PA_INCOMPLETI',
      'SENZA_CONDIZIONE_PAGAMENTO',
      'PAGAMENTO_SENZA_BANCA',
      'PAGAMENTO_NON_AMMESSO',
      'SPESA_SENZA_CODICE_IVA',
      'RIGA_LEGAME_INCOMPLETA',
      'FAMIGLIA_NON_CALCOLATA',
      'PREZZO_SPECIALE_NON_VALIDO',
      'UM_NON_UNIVOCA',
      'CANONE_PERIODO_SOVRAPPOSTO',
      'NATURA_NON_AMMESSA',
      'IMPORTI_NON_COERENTI',
      'TOTALE_NON_POSITIVO',
      'RITENUTA_NON_GESTITA',
    ]) {
      expect(ERRORI_DOCUMENTO).toContain(c)
    }
  })

  it('nessun codice e ripetuto fra errori generali e del documento', () => {
    const tutti = [...ERRORI_GENERALI, ...ERRORI_DOCUMENTO]
    expect(new Set(tutti).size).toBe(tutti.length)
  })

  it('il tetto della definitiva e 500', () => {
    expect(TETTO_DOCUMENTI_DEFINITIVA).toBe(500)
  })
})

describe('messaggi', () => {
  it('ogni codice ha un messaggio non vuoto, senza id', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-/i
    for (const c of [...ERRORI_GENERALI, ...ERRORI_DOCUMENTO]) {
      expect(MESSAGGI_ERRORE[c].trim().length).toBeGreaterThan(0)
      expect(MESSAGGI_ERRORE[c]).not.toMatch(uuid)
    }
    for (const c of AVVISI_DOCUMENTO) {
      expect(MESSAGGI_AVVISO[c].trim().length).toBeGreaterThan(0)
      expect(MESSAGGI_AVVISO[c]).not.toMatch(uuid)
    }
  })

  it('i messaggi non hanno chiavi in piu', () => {
    expect(Object.keys(MESSAGGI_ERRORE).sort()).toEqual(
      [...ERRORI_GENERALI, ...ERRORI_DOCUMENTO].sort()
    )
    expect(Object.keys(MESSAGGI_AVVISO).sort()).toEqual([...AVVISI_DOCUMENTO].sort())
  })

  it('FAMIGLIA_NON_CALCOLATA ha il testo della spec', () => {
    expect(MESSAGGI_ERRORE.FAMIGLIA_NON_CALCOLATA).toBe(
      'Il contratto ha un addebito che WasteFlow non calcola ancora: il documento non si emette.'
    )
  })
})

describe('validaTestoBreve', () => {
  it('toglie gli spazi ai bordi', () => {
    expect(validaTestoBreve('  x ')).toEqual({ ok: true, valore: 'x' })
  })
  it('rifiuta vuoto, spazi e non stringhe', () => {
    expect(validaTestoBreve('').ok).toBe(false)
    expect(validaTestoBreve('   ').ok).toBe(false)
    expect(validaTestoBreve(undefined).ok).toBe(false)
    expect(validaTestoBreve(12).ok).toBe(false)
    expect(validaTestoBreve(null).ok).toBe(false)
  })
  it('accetta 200 caratteri, rifiuta 201 (dopo trim)', () => {
    expect(validaTestoBreve('a'.repeat(200)).ok).toBe(true)
    expect(validaTestoBreve(` ${'a'.repeat(200)} `).ok).toBe(true)
    const r = validaTestoBreve('a'.repeat(201))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errore.length).toBeGreaterThan(0)
  })
})
