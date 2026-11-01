import {
  CAMPI_EREDITATI_DAL_CLIENTE,
  CAMPI_FACOLTATIVI,
  CAMPI_MODIFICABILI,
  contoCorrenteEffettivo,
  dataPiuUnAnno,
  destinatarioEffettivo,
  ETICHETTE_CAMPI,
  ETICHETTE_STATO,
  ETICHETTE_UNITA_VALIDITA,
  motivoNonEliminabile,
  motivoNonModificabile,
  normalizzaContratto,
  pianificaModifica,
  rinnovabile,
  scaduto,
  TRANSIZIONI,
  validaContrattoCliente,
  verificaTransizione,
  type CampoContrattoCliente,
  type DatiContrattoCliente,
  type StatoContrattoCliente,
} from './regole-contratto-cliente'

/** R36: la modifica conosce sempre l'id del contratto (serve alla regola del principale). */
const pianifica = (
  stato: StatoContrattoCliente,
  attuale: DatiContrattoCliente,
  modifica: Parameters<typeof pianificaModifica>[2],
  contesto: { id: string } = { id: 'cc-0' }
) => pianificaModifica(stato, attuale, modifica, contesto)

const TUTTI_I_CAMPI: CampoContrattoCliente[] = [
  'numero',
  'descrizione',
  'clienteId',
  'clienteFatturazioneId',
  'sedeId',
  'categoriaId',
  'tipoId',
  'dataInizio',
  'dataFine',
  'dataStipula',
  'validitaQuantita',
  'validitaUnita',
  'contrattoPrincipaleId',
  'condizionePagamentoId',
  'contoCorrenteId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'agenteId',
  'testoFatturazioneId',
  'codiceDestinatario',
  'riferimentoAmministrazione',
  'codiceCig',
  'codiceCup',
  'idDocumentoPa',
  'escludiDichiarazioneIntento',
  'sogliaDal',
  'sogliaImporto',
  'sogliaIvaEsclusa',
  'rinnovoAutomatico',
  'codiceRinnovo',
  'incrementoIstat',
  'commessa',
  'annotazioni',
  'periodi',
]

const valido = (
  extra: Partial<Record<CampoContrattoCliente, unknown>> = {}
): DatiContrattoCliente =>
  normalizzaContratto({
    numero: 'CC-2026-001',
    descrizione: 'Raccolta rifiuti',
    clienteId: 'cli-1',
    dataInizio: '2026-01-01',
    ...extra,
  })

const p = (gi: number, mi: number, gf: number, mf: number) => ({
  giornoInizio: gi,
  meseInizio: mi,
  giornoFine: gf,
  meseFine: mf,
})

describe('tabelle di stato', () => {
  it('etichette di stato e unita', () => {
    expect(ETICHETTE_STATO).toEqual({
      BOZZA: 'Bozza',
      ATTIVO: 'Attivo',
      SOSPESO: 'Sospeso',
      SOSPESO_MOVIMENTI: 'Sospeso (solo movimenti)',
      ANNULLATO: 'Annullato',
    })
    expect(ETICHETTE_UNITA_VALIDITA).toEqual({
      A: 'Anni',
      S: 'Semestri',
      M: 'Mesi',
      G: 'Giorni',
    })
  })

  it('TRANSIZIONI come la tabella di D8', () => {
    expect(TRANSIZIONI).toEqual({
      BOZZA: ['ATTIVO'],
      ATTIVO: ['SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
      SOSPESO: ['ATTIVO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
      SOSPESO_MOVIMENTI: ['ATTIVO', 'SOSPESO', 'ANNULLATO'],
      ANNULLATO: [],
    })
  })

  it('37 etichette dei campi, nell ordine del tipo', () => {
    expect(Object.keys(ETICHETTE_CAMPI)).toEqual(TUTTI_I_CAMPI)
    expect(ETICHETTE_CAMPI.clienteFatturazioneId).toBe('Cliente di fatturazione')
    expect(ETICHETTE_CAMPI.ritenutaPercentuale).toBe("Ritenuta d'acconto (%)")
    expect(ETICHETTE_CAMPI.idDocumentoPa).toBe('Documento della PA')
    expect(ETICHETTE_CAMPI.periodi).toBe('Periodi di fatturazione')
  })
})

describe('verificaTransizione', () => {
  const completi = { condizionePagamentoId: 'c1', registroIvaId: 'r1' }

  it('BOZZA -> ATTIVO senza condizione: messaggio', () => {
    expect(
      verificaTransizione('BOZZA', 'ATTIVO', { condizionePagamentoId: null, registroIvaId: 'r1' })
    ).toBe('Per attivare il contratto indica la condizione di pagamento.')
  })
  it('BOZZA -> ATTIVO senza registro: messaggio', () => {
    expect(
      verificaTransizione('BOZZA', 'ATTIVO', { condizionePagamentoId: 'c1', registroIvaId: null })
    ).toBe('Per attivare il contratto indica il registro IVA.')
  })
  it('BOZZA -> ATTIVO con entrambi: ammessa', () => {
    expect(verificaTransizione('BOZZA', 'ATTIVO', completi)).toBeNull()
  })
  it('ATTIVO -> ANNULLATO senza motivo ne codice: messaggio', () => {
    expect(verificaTransizione('ATTIVO', 'ANNULLATO', completi)).toBe(
      "Indica il motivo dell'annullo."
    )
  })
  it('motivo di soli spazi: stesso messaggio', () => {
    expect(verificaTransizione('ATTIVO', 'ANNULLATO', { ...completi, motivo: '  ' })).toBe(
      "Indica il motivo dell'annullo."
    )
  })
  it('con il solo codice del motivo: ammessa', () => {
    expect(
      verificaTransizione('ATTIVO', 'ANNULLATO', { ...completi, motivoAnnulloId: 'm1' })
    ).toBeNull()
  })
  it('con il solo testo del motivo: ammessa', () => {
    expect(
      verificaTransizione('SOSPESO', 'ANNULLATO', { ...completi, motivo: 'Cliente cessato' })
    ).toBeNull()
  })
  it('ANNULLATO -> ATTIVO: non ammessa', () => {
    expect(verificaTransizione('ANNULLATO', 'ATTIVO', completi)).toBe(
      'Dallo stato Annullato non si passa a Attivo.'
    )
  })
  it('BOZZA -> SOSPESO: non ammessa', () => {
    expect(verificaTransizione('BOZZA', 'SOSPESO', completi)).toBe(
      'Dallo stato Bozza non si passa a Sospeso.'
    )
  })
  it('la riattivazione da sospeso non richiede condizione ne registro', () => {
    const vuoti = { condizionePagamentoId: null, registroIvaId: null }
    expect(verificaTransizione('SOSPESO', 'ATTIVO', vuoti)).toBeNull()
    expect(verificaTransizione('SOSPESO_MOVIMENTI', 'SOSPESO', vuoti)).toBeNull()
  })
  it('ogni coppia fuori tabella e non ammessa', () => {
    const stati = Object.keys(TRANSIZIONI) as StatoContrattoCliente[]
    for (const da of stati)
      for (const a of stati)
        if (!TRANSIZIONI[da].includes(a))
          expect(verificaTransizione(da, a, { ...completi, motivo: 'x' })).toBe(
            `Dallo stato ${ETICHETTE_STATO[da]} non si passa a ${ETICHETTE_STATO[a]}.`
          )
  })
})

describe('campi modificabili e stati', () => {
  it('BOZZA: tutti i 37 campi', () => {
    expect(CAMPI_MODIFICABILI.BOZZA).toEqual(TUTTI_I_CAMPI)
  })
  it('stati attivi: tutti tranne numero, cliente, data di inizio', () => {
    const attesi = TUTTI_I_CAMPI.filter(c => !['numero', 'clienteId', 'dataInizio'].includes(c))
    expect(attesi).toHaveLength(34)
    for (const s of ['ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI'] as const)
      expect(CAMPI_MODIFICABILI[s]).toEqual(attesi)
  })
  it('ANNULLATO: nessuno', () => {
    expect(CAMPI_MODIFICABILI.ANNULLATO).toEqual([])
  })
  it('motivoNonModificabile', () => {
    expect(motivoNonModificabile('ANNULLATO')).toBe('Un contratto annullato non si modifica.')
    for (const s of ['BOZZA', 'ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI'] as const)
      expect(motivoNonModificabile(s)).toBeNull()
  })
  it('motivoNonEliminabile: null solo per BOZZA', () => {
    expect(motivoNonEliminabile('BOZZA')).toBeNull()
    for (const s of ['ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'] as const)
      expect(motivoNonEliminabile(s)).toBe(
        'Si eliminano solo i contratti in bozza: per chiudere questo contratto annullalo.'
      )
  })
  it('CAMPI_EREDITATI_DAL_CLIENTE come D4', () => {
    expect(CAMPI_EREDITATI_DAL_CLIENTE).toEqual([
      'condizionePagamentoId',
      'agenteId',
      'registroIvaId',
      'speseIncassoId',
      'bolloId',
      'esigibilitaIva',
      'ritenutaPercentuale',
      'codiceDestinatario',
      'riferimentoAmministrazione',
    ])
  })
  it('i facoltativi sono tutti tranne i 9 obbligatori', () => {
    const obbligatori = [
      'numero',
      'descrizione',
      'clienteId',
      'dataInizio',
      'esigibilitaIva',
      'escludiDichiarazioneIntento',
      'sogliaIvaEsclusa',
      'rinnovoAutomatico',
      'incrementoIstat',
    ]
    expect(CAMPI_FACOLTATIVI).toEqual(TUTTI_I_CAMPI.filter(c => !obbligatori.includes(c)))
  })
})

describe('validaContrattoCliente', () => {
  it('contratto valido', () => {
    expect(validaContrattoCliente(valido())).toEqual([])
  })
  it('descrizione vuota', () => {
    expect(validaContrattoCliente(valido({ descrizione: '   ' }))).toEqual([
      'Inserisci una descrizione per questo contratto.',
    ])
  })
  it('numero vuoto e oltre 50', () => {
    expect(validaContrattoCliente(valido({ numero: '' }))).toEqual(['Numero è obbligatorio.'])
    expect(validaContrattoCliente(valido({ numero: 'N'.repeat(51) }))).toEqual([
      'Il numero non può superare 50 caratteri.',
    ])
  })
  it('data di inizio mancante o non reale', () => {
    expect(validaContrattoCliente(valido({ dataInizio: null }))).toEqual([
      'Data di inizio è obbligatoria.',
    ])
    expect(validaContrattoCliente(valido({ dataStipula: '2026-02-30' }))).toEqual([
      'Data di stipula: data non valida.',
    ])
  })
  it('fine prima dell inizio: errore; fine uguale: valida', () => {
    expect(validaContrattoCliente(valido({ dataFine: '2025-12-31' }))).toEqual([
      'La data di fine non può precedere la data di inizio.',
    ])
    expect(validaContrattoCliente(valido({ dataFine: '2026-01-01' }))).toEqual([])
  })
  it('rinnovo senza fine', () => {
    expect(validaContrattoCliente(valido({ rinnovoAutomatico: true }))).toEqual([
      'Il rinnovo automatico richiede una data di fine.',
    ])
    expect(
      validaContrattoCliente(valido({ rinnovoAutomatico: true, dataFine: '2026-12-31' }))
    ).toEqual([])
  })
  it('CIG e CUP', () => {
    expect(validaContrattoCliente(valido({ codiceCig: 'ABC123456', idDocumentoPa: 'X1' }))).toEqual(
      ['Il CIG deve avere 10 caratteri alfanumerici.']
    )
    expect(
      validaContrattoCliente(valido({ codiceCup: 'A'.repeat(14), idDocumentoPa: 'X1' }))
    ).toEqual(['Il CUP deve avere 15 caratteri alfanumerici.'])
    expect(validaContrattoCliente(valido({ codiceCig: 'ABC1234567' }))).toEqual([
      'Con CIG o CUP indica anche il riferimento del documento della PA (contratto, convenzione o ordine).',
    ])
    expect(
      validaContrattoCliente(valido({ codiceCup: 'A'.repeat(15), idDocumentoPa: 'ORD-1' }))
    ).toEqual([])
  })
  it('codice destinatario di 5 caratteri (regola riusata)', () => {
    expect(validaContrattoCliente(valido({ codiceDestinatario: 'ABCDE' }))).toEqual([
      'Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione).',
    ])
  })
  it('riferimento amministrazione: serve un codice vero (0000000 rifiutato)', () => {
    const msg = 'Il riferimento amministrazione si indica solo insieme al codice destinatario.'
    expect(validaContrattoCliente(valido({ riferimentoAmministrazione: 'RIF1' }))).toEqual([msg])
    expect(
      validaContrattoCliente(
        valido({ riferimentoAmministrazione: 'RIF1', codiceDestinatario: '0000000' })
      )
    ).toEqual([msg])
    expect(
      validaContrattoCliente(
        valido({ riferimentoAmministrazione: 'RIF1', codiceDestinatario: 'UFE1AB' })
      )
    ).toEqual([])
  })
  it('ritenuta 31', () => {
    expect(validaContrattoCliente(valido({ ritenutaPercentuale: '31' }))).toEqual([
      'La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.',
    ])
    expect(validaContrattoCliente(valido({ ritenutaPercentuale: '4' }))).toEqual([])
  })
  it('soglia', () => {
    const msg = 'La soglia massima deve essere un importo positivo con al massimo due decimali.'
    expect(validaContrattoCliente(valido({ sogliaImporto: '0' }))).toEqual([msg])
    expect(validaContrattoCliente(valido({ sogliaImporto: '10.555' }))).toEqual([msg])
    expect(validaContrattoCliente(valido({ sogliaImporto: '1000.50' }))).toEqual([])
    expect(validaContrattoCliente(valido({ sogliaDal: '2026-01-01' }))).toEqual([
      'La data di inizio controllo soglia richiede la soglia massima.',
    ])
  })
  it('validita', () => {
    expect(validaContrattoCliente(valido({ validitaQuantita: 3 }))).toEqual([
      "Indica sia la durata sia l'unità della validità.",
    ])
    expect(validaContrattoCliente(valido({ validitaUnita: 'A' }))).toEqual([
      "Indica sia la durata sia l'unità della validità.",
    ])
    expect(validaContrattoCliente(valido({ validitaQuantita: 1000, validitaUnita: 'A' }))).toEqual([
      'La durata della validità va da 1 a 999.',
    ])
    expect(validaContrattoCliente(valido({ validitaQuantita: 3, validitaUnita: 'X' }))).toEqual([
      "L'unità della validità non è ammessa.",
    ])
    expect(validaContrattoCliente(valido({ validitaQuantita: 3, validitaUnita: 'M' }))).toEqual([])
  })
  it('codice di rinnovo non ammesso', () => {
    expect(validaContrattoCliente(valido({ codiceRinnovo: 'O' }))).toEqual([
      'Il codice di rinnovo non è ammesso.',
    ])
  })
  it('commessa con uno spazio', () => {
    expect(validaContrattoCliente(valido({ commessa: 'AB 12' }))).toEqual([
      'La commessa può contenere al massimo 12 caratteri fra lettere, cifre, punto, barra, trattino e trattino basso.',
    ])
    expect(validaContrattoCliente(valido({ commessa: 'AB/12-3' }))).toEqual([])
  })
  it('annotazioni', () => {
    const msg = 'Al massimo 3 annotazioni di 45 caratteri ciascuna.'
    expect(validaContrattoCliente(valido({ annotazioni: ['a', 'b', 'c', 'd'] }))).toEqual([msg])
    expect(validaContrattoCliente(valido({ annotazioni: ['x'.repeat(46)] }))).toEqual([msg])
    expect(validaContrattoCliente(valido({ annotazioni: ['x'.repeat(45), 'b', 'c'] }))).toEqual([])
  })
  it('contratto principale uguale a se stesso (contesto)', () => {
    const d = valido({ contrattoPrincipaleId: 'cc-1' })
    expect(validaContrattoCliente(d, { id: 'cc-1' })).toEqual([
      'Un contratto non può essere allegato a sé stesso.',
    ])
    expect(validaContrattoCliente(d, { id: 'cc-2' })).toEqual([])
    expect(validaContrattoCliente(d)).toEqual([])
  })
  it('periodi sovrapposti', () => {
    expect(validaContrattoCliente(valido({ periodi: [p(1, 1, 31, 3), p(1, 3, 30, 6)] }))).toEqual([
      'I periodi 1 e 2 si sovrappongono.',
    ])
  })
  it('periodi: 28/02 vale 29/02 (R26 a)', () => {
    expect(validaContrattoCliente(valido({ periodi: [p(1, 1, 28, 2), p(29, 2, 31, 3)] }))).toEqual([
      'I periodi 1 e 2 si sovrappongono.',
    ])
  })
  it('esigibilita non ammessa', () => {
    expect(validaContrattoCliente(valido({ esigibilitaIva: 'BOH' }))).toEqual([
      "L'esigibilità IVA scelta non è ammessa.",
    ])
  })
  it('piu errori nell ordine dei campi', () => {
    const d = valido({
      descrizione: '',
      dataFine: '2025-01-01',
      ritenutaPercentuale: '31',
      commessa: 'a b',
      annotazioni: ['1', '2', '3', '4'],
    })
    expect(validaContrattoCliente(d)).toEqual([
      'Inserisci una descrizione per questo contratto.',
      'La data di fine non può precedere la data di inizio.',
      'La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.',
      'La commessa può contenere al massimo 12 caratteri fra lettere, cifre, punto, barra, trattino e trattino basso.',
      'Al massimo 3 annotazioni di 45 caratteri ciascuna.',
    ])
  })
})

describe('normalizzaContratto', () => {
  it('cliente di fatturazione uguale al cliente -> null (E5)', () => {
    expect(valido({ clienteFatturazioneId: 'cli-1' }).clienteFatturazioneId).toBeNull()
    expect(valido({ clienteFatturazioneId: 'cli-2' }).clienteFatturazioneId).toBe('cli-2')
  })
  it('date da Date e da stringa ISO', () => {
    const d = valido({
      dataInizio: new Date('2026-03-05T00:00:00.000Z'),
      dataFine: '2026-12-31T00:00:00.000Z',
      dataStipula: ' 2026-02-01 ',
    })
    expect(d.dataInizio).toBe('2026-03-05')
    expect(d.dataFine).toBe('2026-12-31')
    expect(d.dataStipula).toBe('2026-02-01')
  })
  it('periodi ordinati e ripuliti dai campi in piu', () => {
    const d = valido({ periodi: [{ ...p(1, 4, 30, 6), id: 'x', ordine: 2 }, p(1, 1, 31, 3)] })
    expect(d.periodi).toEqual([p(1, 1, 31, 3), p(1, 4, 30, 6)])
  })
  it('codice rinnovo S/N decide il rinnovo automatico', () => {
    expect(valido({ codiceRinnovo: 'S' }).rinnovoAutomatico).toBe(true)
    expect(valido({ codiceRinnovo: 'N', rinnovoAutomatico: true }).rinnovoAutomatico).toBe(false)
    expect(valido({ rinnovoAutomatico: true }).rinnovoAutomatico).toBe(true)
  })
  it('soglia IVA esclusa senza soglia -> false', () => {
    expect(valido({ sogliaIvaEsclusa: true }).sogliaIvaEsclusa).toBe(false)
    expect(valido({ sogliaIvaEsclusa: true, sogliaImporto: '100' }).sogliaIvaEsclusa).toBe(true)
  })
  it('annotazioni vuote tolte, decimali normalizzati', () => {
    const d = valido({
      annotazioni: [' uno ', '', '   ', 'due'],
      ritenutaPercentuale: '4',
      sogliaImporto: '1000,5',
    })
    expect(d.annotazioni).toEqual(['uno', 'due'])
    expect(d.ritenutaPercentuale).toBe('4.00')
    expect(d.sogliaImporto).toBe('1000.50')
  })
  it('decimali Prisma (oggetti con toString)', () => {
    const decimal = (s: string) => ({ toString: () => s })
    expect(valido({ ritenutaPercentuale: decimal('4') }).ritenutaPercentuale).toBe('4.00')
  })
  it('predefiniti: esigibilita IMMEDIATA, booleani false, stringhe vuote -> null', () => {
    const d = valido({ commessa: '  ', codiceDestinatario: ' ufe1ab ' })
    expect(d.esigibilitaIva).toBe('IMMEDIATA')
    expect(d.incrementoIstat).toBe(false)
    expect(d.escludiDichiarazioneIntento).toBe(false)
    expect(d.commessa).toBeNull()
    expect(d.codiceDestinatario).toBe('UFE1AB')
  })
})

describe('pianificaModifica', () => {
  const attuale = valido({
    condizionePagamentoId: 'c1',
    registroIvaId: 'r1',
    ritenutaPercentuale: '4',
    periodi: [p(1, 1, 31, 3), p(1, 4, 30, 6)],
    dataInizio: '2026-01-01',
  })

  it('modifica vuota -> NESSUNA_MODIFICA', () => {
    expect(pianifica('ATTIVO', attuale, {})).toEqual({ esito: 'NESSUNA_MODIFICA' })
  })
  it('stessi valori in altra forma -> NESSUNA_MODIFICA', () => {
    expect(
      pianifica('ATTIVO', attuale, {
        dataInizio: new Date('2026-01-01T00:00:00Z') as unknown as string,
        periodi: [p(1, 4, 30, 6), p(1, 1, 31, 3)],
        ritenutaPercentuale: '4.00',
      })
    ).toEqual({ esito: 'NESSUNA_MODIFICA' })
    expect(pianifica('ATTIVO', attuale, { ritenutaPercentuale: '4' })).toEqual({
      esito: 'NESSUNA_MODIFICA',
    })
  })
  it('ATTIVO cambia data di inizio e cliente -> CAMPI_NON_AMMESSI', () => {
    const r = pianifica('ATTIVO', attuale, { dataInizio: '2026-02-01', clienteId: 'cli-9' })
    expect(r).toEqual({
      esito: 'CAMPI_NON_AMMESSI',
      campi: ['clienteId', 'dataInizio'],
      messaggio:
        'In un contratto attivo o sospeso non si possono cambiare: Cliente, Data di inizio.',
    })
  })
  it('ATTIVO cambia periodi, condizione e conto -> OK', () => {
    const r = pianifica('ATTIVO', attuale, {
      periodi: [p(1, 1, 30, 6)],
      condizionePagamentoId: 'c2',
      contoCorrenteId: 'cc1',
    })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') {
      expect(r.cambiati).toEqual(['condizionePagamentoId', 'contoCorrenteId', 'periodi'])
      expect(r.dopo.periodi).toEqual([p(1, 1, 30, 6)])
      expect(r.dopo.condizionePagamentoId).toBe('c2')
      expect(attuale.condizionePagamentoId).toBe('c1')
    }
  })
  it('BOZZA cambia anche numero e cliente', () => {
    const r = pianifica('BOZZA', attuale, { numero: 'CC-2026-002', clienteId: 'cli-9' })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') expect(r.cambiati).toEqual(['numero', 'clienteId'])
  })
  it('null su dataFine svuota', () => {
    const conFine = valido({ dataFine: '2026-12-31' })
    const r = pianifica('ATTIVO', conFine, { dataFine: null })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') {
      expect(r.dopo.dataFine).toBeNull()
      expect(r.cambiati).toEqual(['dataFine'])
    }
  })
  it('null sui periodi li svuota', () => {
    const r = pianifica('ATTIVO', attuale, { periodi: null })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') expect(r.dopo.periodi).toEqual([])
  })
  it('null su descrizione -> NON_VALIDA', () => {
    expect(pianifica('ATTIVO', attuale, { descrizione: null })).toEqual({
      esito: 'NON_VALIDA',
      messaggi: ['Descrizione è obbligatoria.'],
    })
  })
  it('valore non valido -> NON_VALIDA con i messaggi della validazione', () => {
    expect(pianifica('ATTIVO', attuale, { ritenutaPercentuale: '31' })).toEqual({
      esito: 'NON_VALIDA',
      messaggi: ['La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.'],
    })
  })
  it('il codice di rinnovo decide il rinnovo automatico', () => {
    const conFine = valido({ dataFine: '2026-12-31' })
    const r = pianifica('ATTIVO', conFine, { codiceRinnovo: 'S' })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') {
      expect(r.dopo.rinnovoAutomatico).toBe(true)
      expect(r.cambiati).toEqual(['rinnovoAutomatico', 'codiceRinnovo'])
    }
  })
  it('rinnovo automatico cambiato da solo resta coerente col codice', () => {
    const conCodice = valido({ dataFine: '2026-12-31', codiceRinnovo: 'N' })
    const r = pianifica('ATTIVO', conCodice, { rinnovoAutomatico: true })
    expect(r.esito).toBe('OK')
    if (r.esito === 'OK') {
      expect(r.dopo.rinnovoAutomatico).toBe(true)
      expect(r.dopo.codiceRinnovo).toBe('S')
    }
  })
  it('contratto annullato: il messaggio e quello dello stato', () => {
    expect(pianifica('ANNULLATO', attuale, { descrizione: 'Altro' })).toEqual({
      esito: 'CAMPI_NON_AMMESSI',
      campi: ['descrizione'],
      messaggio: 'Un contratto annullato non si modifica.',
    })
  })
  it('il contesto passa alla validazione (principale = se stesso)', () => {
    const r = pianifica('ATTIVO', attuale, { contrattoPrincipaleId: 'cc-1' }, { id: 'cc-1' })
    expect(r).toEqual({
      esito: 'NON_VALIDA',
      messaggi: ['Un contratto non può essere allegato a sé stesso.'],
    })
  })
})

describe('date e rinnovo', () => {
  it('dataPiuUnAnno', () => {
    expect(dataPiuUnAnno('2024-02-29')).toBe('2025-02-28')
    expect(dataPiuUnAnno('2026-12-31')).toBe('2027-12-31')
    expect(dataPiuUnAnno('2027-02-28')).toBe('2028-02-28')
  })
  it('rinnovabile', () => {
    expect(rinnovabile('ATTIVO', '2026-12-31')).toBe(true)
    expect(rinnovabile('SOSPESO', '2026-12-31')).toBe(true)
    expect(rinnovabile('SOSPESO_MOVIMENTI', '2026-12-31')).toBe(true)
    expect(rinnovabile('ATTIVO', null)).toBe(false)
    expect(rinnovabile('BOZZA', '2026-12-31')).toBe(false)
    expect(rinnovabile('ANNULLATO', '2026-12-31')).toBe(false)
  })
  it('scaduto', () => {
    expect(scaduto('2026-11-01', '2026-11-02')).toBe(true)
    expect(scaduto('2026-11-02', '2026-11-02')).toBe(false)
    expect(scaduto(null, '2026-11-02')).toBe(false)
  })
})

describe('valori effettivi (D4)', () => {
  it('destinatarioEffettivo', () => {
    const vuoto = { codiceDestinatario: null, riferimentoAmministrazione: null }
    expect(
      destinatarioEffettivo(
        { codiceDestinatario: 'UFE1AB', riferimentoAmministrazione: 'R1' },
        { codiceDestinatario: 'ZZZZZZZ', riferimentoAmministrazione: 'R2' }
      )
    ).toEqual({ codiceDestinatario: 'UFE1AB', riferimentoAmministrazione: 'R1' })
    expect(
      destinatarioEffettivo(vuoto, {
        codiceDestinatario: 'ZZZZZZZ',
        riferimentoAmministrazione: 'R2',
      })
    ).toEqual({ codiceDestinatario: 'ZZZZZZZ', riferimentoAmministrazione: 'R2' })
    expect(destinatarioEffettivo(vuoto, vuoto)).toEqual({
      codiceDestinatario: '0000000',
      riferimentoAmministrazione: null,
    })
    expect(
      destinatarioEffettivo(vuoto, { codiceDestinatario: null, riferimentoAmministrazione: 'R2' })
    ).toEqual({ codiceDestinatario: '0000000', riferimentoAmministrazione: 'R2' })
  })
  it('destinatarioEffettivo: 0000000 sul contratto vale "nessun codice" e ripiega sul cliente di fatturazione (R35)', () => {
    expect(
      destinatarioEffettivo(
        { codiceDestinatario: '0000000', riferimentoAmministrazione: null },
        { codiceDestinatario: 'ZZZZZZZ', riferimentoAmministrazione: 'R2' }
      )
    ).toEqual({ codiceDestinatario: 'ZZZZZZZ', riferimentoAmministrazione: 'R2' })
    expect(
      destinatarioEffettivo(
        { codiceDestinatario: '0000000', riferimentoAmministrazione: null },
        { codiceDestinatario: '0000000', riferimentoAmministrazione: null }
      )
    ).toEqual({ codiceDestinatario: '0000000', riferimentoAmministrazione: null })
  })
  it('contoCorrenteEffettivo', () => {
    expect(contoCorrenteEffettivo({ contoCorrenteId: 'a' }, { contoCorrenteId: 'b' })).toBe('a')
    expect(contoCorrenteEffettivo({ contoCorrenteId: null }, { contoCorrenteId: 'b' })).toBe('b')
    expect(contoCorrenteEffettivo({ contoCorrenteId: null }, { contoCorrenteId: null })).toBeNull()
  })
})

describe('normalizzaContratto: id dei clienti (M8)', () => {
  it('cliente e cliente di fatturazione uguali a meno delle maiuscole: fatturazione nulla', () => {
    const d = normalizzaContratto({
      clienteId: 'AAAAAAAA-0000-4000-8000-000000000001',
      clienteFatturazioneId: 'aaaaaaaa-0000-4000-8000-000000000001',
    })
    expect(d.clienteFatturazioneId).toBeNull()
    expect(d.clienteId).toBe('aaaaaaaa-0000-4000-8000-000000000001')
  })
})
