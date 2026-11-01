import {
  ESIGIBILITA_IVA,
  normalizzaDatiFiscali,
  tipoDestinatario,
  validaCodiceDestinatario,
  validaDatiFiscali,
  validaRitenuta,
  type DatiFiscaliCliente,
} from './dati-fiscali-cliente'

const base = (extra: Partial<DatiFiscaliCliente> = {}): DatiFiscaliCliente => ({
  ...normalizzaDatiFiscali({}),
  ...extra,
})
const impresa = { privato: false }
const privato = { privato: true }

describe('normalizzaDatiFiscali', () => {
  it('trim, vuoto -> null, maiuscole e IBAN senza spazi', () => {
    const d = normalizzaDatiFiscali({
      codice: '  C1 ',
      codiceDestinatario: ' abc1234 ',
      pecFatturazione: '   ',
      iban: 'it60 x054 2811 1010 0000 0123 456',
      note: '  nota ',
    })
    expect(d.codice).toBe('C1')
    expect(d.codiceDestinatario).toBe('ABC1234')
    expect(d.pecFatturazione).toBeNull()
    expect(d.iban).toBe('IT60X0542811101000000123456')
    expect(d.note).toBe('nota')
    expect(d.agenteId).toBeNull()
  })

  it('esigibilitaIva assente -> IMMEDIATA', () => {
    expect(normalizzaDatiFiscali({}).esigibilitaIva).toBe('IMMEDIATA')
    expect(normalizzaDatiFiscali({ esigibilitaIva: 'SCISSIONE' }).esigibilitaIva).toBe('SCISSIONE')
    expect(ESIGIBILITA_IVA).toEqual(['IMMEDIATA', 'DIFFERITA', 'SCISSIONE'])
  })

  it('ritenuta: "4" -> "4.00", "4,5" -> "4.50"', () => {
    expect(normalizzaDatiFiscali({ ritenutaPercentuale: '4' }).ritenutaPercentuale).toBe('4.00')
    expect(normalizzaDatiFiscali({ ritenutaPercentuale: '4,5' }).ritenutaPercentuale).toBe('4.50')
  })
})

describe('codice destinatario', () => {
  it('7 caratteri valido', () => expect(validaCodiceDestinatario('ABC1234')).toBeNull())
  it('6 caratteri valido (PA)', () => expect(validaCodiceDestinatario('UFE1AB')).toBeNull())
  it('5 caratteri: messaggio D3', () => {
    expect(validaCodiceDestinatario('ABC12')).toBe(
      'Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione).'
    )
  })
  it('con un trattino: messaggio D3', () => {
    expect(validaCodiceDestinatario('ABC-123')).toBe(
      'Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione).'
    )
  })
  it('XXXXXXX: vale solo per i clienti esteri', () => {
    expect(validaCodiceDestinatario('XXXXXXX')).toBe(
      'Il codice destinatario XXXXXXX vale solo per i clienti esteri.'
    )
  })
  it('null valido', () => expect(validaCodiceDestinatario(null)).toBeNull())
})

describe('tipoDestinatario', () => {
  it('PA, impresa, nessuno', () => {
    expect(tipoDestinatario('UFE1AB')).toBe('PA')
    expect(tipoDestinatario('ABC1234')).toBe('IMPRESA')
    expect(tipoDestinatario('0000000')).toBe('NESSUNO')
    expect(tipoDestinatario(null)).toBe('NESSUNO')
  })
})

describe('validaRitenuta', () => {
  const msg = 'La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.'
  it('0: messaggio D3', () => expect(validaRitenuta('0.00')).toBe(msg))
  it('0 senza decimali: messaggio D3', () => expect(validaRitenuta('0')).toBe(msg))
  it('30: valida', () => expect(validaRitenuta('30')).toBeNull())
  it('30.01: messaggio', () => expect(validaRitenuta('30.01')).toBe(msg))
  it('"abc": messaggio', () => expect(validaRitenuta('abc')).toBe(msg))
  it('null: valida', () => expect(validaRitenuta(null)).toBeNull())
})

describe('validaDatiFiscali', () => {
  it('dati minimi validi', () => expect(validaDatiFiscali(base(), impresa)).toEqual([]))

  it('PEC senza chiocciola: messaggio', () => {
    expect(validaDatiFiscali(base({ pecFatturazione: 'pec.esempio.it' }), impresa)).toEqual([
      'La PEC per la fattura elettronica non è valida.',
    ])
  })
  it('PEC con codice 0000000: valida', () => {
    expect(
      validaDatiFiscali(
        base({ pecFatturazione: 'a@pec.it', codiceDestinatario: '0000000' }),
        impresa
      )
    ).toEqual([])
  })
  it('PEC con codice ABC1234: messaggio', () => {
    expect(
      validaDatiFiscali(
        base({ pecFatturazione: 'a@pec.it', codiceDestinatario: 'ABC1234' }),
        impresa
      )
    ).toEqual([
      'La PEC per la fattura elettronica si indica solo con il codice destinatario 0000000 o senza codice.',
    ])
  })
  it('PEC senza codice: valida', () => {
    expect(validaDatiFiscali(base({ pecFatturazione: 'a@pec.it' }), impresa)).toEqual([])
  })

  it('riferimento amministrazione senza codice destinatario: messaggio', () => {
    expect(validaDatiFiscali(base({ riferimentoAmministrazione: 'RIF1' }), impresa)).toEqual([
      'Il riferimento amministrazione si indica solo insieme al codice destinatario.',
    ])
  })
  it('riferimento amministrazione con codice destinatario 0000000: rifiutato', () => {
    expect(
      validaDatiFiscali(
        base({ riferimentoAmministrazione: 'RIF1', codiceDestinatario: '0000000' }),
        impresa
      )
    ).toEqual(['Il riferimento amministrazione si indica solo insieme al codice destinatario.'])
  })
  it('riferimento di 21 caratteri: messaggio', () => {
    expect(
      validaDatiFiscali(
        base({ riferimentoAmministrazione: 'R'.repeat(21), codiceDestinatario: 'UFE1AB' }),
        impresa
      )
    ).toEqual(['Il riferimento amministrazione non può superare 20 caratteri.'])
  })
  it('riferimento con codice destinatario: valido', () => {
    expect(
      validaDatiFiscali(
        base({ riferimentoAmministrazione: 'RIF1', codiceDestinatario: 'UFE1AB' }),
        impresa
      )
    ).toEqual([])
  })

  it('IBAN non valido', () => {
    expect(validaDatiFiscali(base({ iban: 'IT60X0542811101000000123457' }), impresa)).toEqual([
      "L'IBAN non è valido.",
    ])
  })

  it('ritenuta 0 / 30 / 30.01 / abc', () => {
    expect(validaDatiFiscali(base({ ritenutaPercentuale: '0.00' }), impresa)).toHaveLength(1)
    expect(validaDatiFiscali(base({ ritenutaPercentuale: '30.00' }), impresa)).toEqual([])
    expect(validaDatiFiscali(base({ ritenutaPercentuale: '30.01' }), impresa)).toHaveLength(1)
    expect(validaDatiFiscali(base({ ritenutaPercentuale: 'abc' }), impresa)).toHaveLength(1)
  })

  it('privato senza nome', () => {
    expect(validaDatiFiscali(base({ cognome: 'Rossi' }), privato)).toEqual([
      'Per un cliente persona fisica indica nome e cognome.',
    ])
    expect(validaDatiFiscali(base({ nome: 'Mario', cognome: 'Rossi' }), privato)).toEqual([])
  })
  it('non privato con cognome: messaggio', () => {
    expect(validaDatiFiscali(base({ cognome: 'Rossi' }), impresa)).toEqual([
      'Nome e cognome si indicano solo per un cliente persona fisica.',
    ])
  })

  it('codice cliente con spazio o di 21 caratteri: messaggio', () => {
    const m =
      'Il codice cliente può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 20 caratteri).'
    expect(validaDatiFiscali(base({ codice: 'A B' }), impresa)).toEqual([m])
    expect(validaDatiFiscali(base({ codice: 'A'.repeat(21) }), impresa)).toEqual([m])
    expect(validaDatiFiscali(base({ codice: 'A'.repeat(20) }), impresa)).toEqual([])
  })

  it("più errori: tutti i messaggi nell'ordine dei campi", () => {
    const r = validaDatiFiscali(
      base({
        codice: 'A B',
        codiceDestinatario: 'ABC12',
        iban: 'IT00',
        ritenutaPercentuale: '99',
        cognome: 'Rossi',
      }),
      impresa
    )
    expect(r).toEqual([
      'Il codice cliente può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 20 caratteri).',
      'Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione).',
      "L'IBAN non è valido.",
      'La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30.',
      'Nome e cognome si indicano solo per un cliente persona fisica.',
    ])
  })

  it('nessun messaggio contiene il valore ricevuto', () => {
    const casi: Partial<DatiFiscaliCliente>[] = [
      { codice: 'COD VALORE-X' },
      { codiceDestinatario: 'QQ9-ZZ' },
      { pecFatturazione: 'segreto-pec.it' },
      { riferimentoAmministrazione: 'RIFSEGRETO', codiceDestinatario: null },
      { iban: 'IT99SEGRETO' },
      { ritenutaPercentuale: 'zzsegreto' },
      { nome: 'Nomesegreto', cognome: 'Cognomesegreto' },
    ]
    for (const c of casi) {
      const messaggi = validaDatiFiscali(base(c), impresa)
      expect(messaggi.length).toBeGreaterThan(0)
      const valori = Object.values(c).filter((v): v is string => typeof v === 'string')
      for (const m of messaggi) for (const v of valori) expect(m).not.toContain(v)
    }
  })
})
