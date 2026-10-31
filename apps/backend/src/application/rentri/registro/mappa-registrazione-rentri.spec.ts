import {
  traduciAnnotazione,
  traduciClassiPericolo,
  traduciQuantita,
  type AnnotazionePerRentri,
  type DatiFirPerRegistro,
} from './mappa-registrazione-rentri'

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  validaElencoMovimenti,
} = require('../../../../../../tools/rentri-fake/src/dominio/movimento')
/* eslint-enable @typescript-eslint/no-var-requires */

const INDIRIZZO = {
  citta: { comune_id: '058091' },
  indirizzo: 'Via Roma',
  civico: '1',
  cap: '00100',
}

function fir(extra: Partial<DatiFirPerRegistro> = {}): DatiFirPerRegistro {
  return {
    numeroFir: 'FIR/2026/0001',
    dataInizioTrasporto: '2026-03-02T08:00:00.000Z',
    dataFineTrasporto: '2026-03-02T12:00:00.000Z',
    pesoVerificatoDestinoKg: 95,
    provenienza: 'U',
    produttore: {
      denominazione: 'Produttore Srl',
      codiceFiscale: '01234567890',
      indirizzo: INDIRIZZO,
    },
    trasportatore: {
      denominazione: 'Trasporti Srl',
      codiceFiscale: '09876543210',
      numeroIscrizioneAlbo: 'MI/123456',
    },
    destinatario: {
      denominazione: 'Impianto Srl',
      codiceFiscale: '11223344556',
      numeroAutorizzazione: 'AUT-77',
    },
    ...extra,
  }
}

function annotazione(extra: Partial<AnnotazionePerRentri> = {}): AnnotazionePerRentri {
  return {
    movimentoId: 'mov-1',
    tipoAnnotazione: 'ORDINARIA',
    numero: { anno: 2026, progressivo: 7 },
    dataRegistrazione: '2026-03-01T10:00:00.000Z',
    verso: 'CARICO',
    codiceRentri: 'DT',
    cerCode: '15 01 01',
    descrizione: null,
    quantita: 100,
    unit: 'KG',
    statoFisico: 'Solido',
    classiPericolo: null,
    operazione: null,
    predecessore: null,
    motivo: null,
    fir: null,
    riferimentiCarico: [],
    ...extra,
  }
}

function ok(a: AnnotazionePerRentri): any {
  const r = traduciAnnotazione(a)
  if (!r.ok) throw new Error(`attesa traduzione ok, motivi: ${r.motivi.join(' | ')}`)
  expect(validaElencoMovimenti([r.corpo])).toBeNull()
  return r.corpo
}

function ko(a: AnnotazionePerRentri): string[] {
  const r = traduciAnnotazione(a)
  if (r.ok) throw new Error('attesa non trasmissibile')
  return r.motivi
}

describe('traduciAnnotazione', () => {
  it('DT: solo riferimenti e rifiuto, codice_eer a 6 cifre', () => {
    const c = ok(annotazione())
    expect(Object.keys(c).sort()).toEqual(['riferimenti', 'rifiuto'])
    expect(c.rifiuto.codice_eer).toBe('150101')
    expect(c.rifiuto.stato_fisico).toBe('S')
    expect(c.rifiuto.quantita).toEqual({ valore: 100, unita_misura: 'kg' })
    expect(c.riferimenti.numero_registrazione).toEqual({ anno: 2026, progressivo: 7 })
    expect(c.riferimenti.causale_operazione).toBe('DT')
  })

  it('T*: produttore, trasportatore e integrazione_fir dal FIR', () => {
    const c = ok(annotazione({ codiceRentri: 'T*', fir: fir() }))
    expect(c.produttore.codice_fiscale).toBe('01234567890')
    expect(c.produttore.indirizzo.citta.comune_id).toBe('058091')
    expect(c.trasportatore.num_iscrizione_albo).toBe('MI/123456')
    expect(c.integrazione_fir).toEqual({
      numero_fir: 'FIR/2026/0001',
      data_inizio_trasporto: '2026-03-02T08:00:00.000Z',
    })
    expect(c.destinatario).toBeUndefined()
    expect(c.esito).toBeUndefined()
    expect(c.rifiuto.provenienza).toBe('U')
  })

  it('T* senza trasportatore: omesso', () => {
    const c = ok(annotazione({ codiceRentri: 'T*', fir: fir({ trasportatore: null }) }))
    expect(c.trasportatore).toBeUndefined()
  })

  it('aT: destinatario con num_autorizzazione, trasportatore, integrazione_fir, esito col peso', () => {
    const c = ok(annotazione({ codiceRentri: 'aT', verso: 'SCARICO', fir: fir() }))
    expect(c.destinatario.num_autorizzazione).toBe('AUT-77')
    expect(c.trasportatore.codice_fiscale).toBe('09876543210')
    expect(c.integrazione_fir.numero_fir).toBe('FIR/2026/0001')
    expect(c.esito).toEqual({
      data_fine_trasporto: '2026-03-02T12:00:00.000Z',
      peso_verificato_destino: 95,
    })
    expect(c.produttore).toBeUndefined()
  })

  it('aT senza esito del FIR: nessun blocco esito', () => {
    const c = ok(
      annotazione({
        codiceRentri: 'aT',
        verso: 'SCARICO',
        fir: fir({ pesoVerificatoDestinoKg: null, dataFineTrasporto: null }),
      })
    )
    expect(c.esito).toBeUndefined()
  })

  it('aT senza FIR: non trasmissibile, motivo che nomina il FIR', () => {
    const motivi = ko(annotazione({ codiceRentri: 'aT', verso: 'SCARICO', fir: null }))
    expect(motivi.join(' ')).toMatch(/FIR/)
  })

  it('aT con FIR senza autorizzazione del destinatario o senza codice fiscale: motivi', () => {
    const motivi = ko(
      annotazione({
        codiceRentri: 'aT',
        verso: 'SCARICO',
        fir: fir({
          destinatario: { denominazione: 'X', codiceFiscale: null, numeroAutorizzazione: null },
          trasportatore: null,
        }),
      })
    )
    expect(motivi.length).toBeGreaterThanOrEqual(3)
  })

  it('RETTIFICA porta numero_registrazione_rettifica del predecessore', () => {
    const c = ok(
      annotazione({
        tipoAnnotazione: 'RETTIFICA',
        predecessore: { anno: 2026, progressivo: 3 },
        motivo: 'quantità errata',
      })
    )
    expect(c.riferimenti.numero_registrazione_rettifica).toEqual({ anno: 2026, progressivo: 3 })
    expect(c.annotazioni).toBe('quantità errata')
  })

  it('RETTIFICA senza predecessore: motivo', () => {
    expect(ko(annotazione({ tipoAnnotazione: 'RETTIFICA' })).join(' ')).toMatch(
      /rettifica senza annotazione rettificata/i
    )
  })

  it('ANNULLAMENTO diventa AnnullamentoMovimentoModel con il motivo nelle annotazioni', () => {
    const c = ok(
      annotazione({
        tipoAnnotazione: 'ANNULLAMENTO',
        predecessore: { anno: 2026, progressivo: 3 },
        motivo: 'registrato per errore',
      })
    )
    expect(c).toEqual({
      numero_registrazione: { anno: 2026, progressivo: 7 },
      data_ora_registrazione: '2026-03-01T10:00:00.000Z',
      numero_registrazione_annullata: { anno: 2026, progressivo: 3 },
      annotazioni: 'registrato per errore',
    })
  })

  it('ANNULLAMENTO senza predecessore o senza motivo: motivi', () => {
    expect(ko(annotazione({ tipoAnnotazione: 'ANNULLAMENTO' })).length).toBe(2)
  })

  it('causale senza codice RENTRI: messaggio di Q6', () => {
    expect(ko(annotazione({ codiceRentri: null })).join(' ')).toContain(
      'Causale senza codice RENTRI: crea una causale aziendale con il codice giusto'
    )
  })

  it('M, TR, T*aT: non supportate', () => {
    for (const codice of ['M', 'TR', 'T*aT']) {
      expect(ko(annotazione({ codiceRentri: codice })).join(' ')).toMatch(
        /non supportata da questo programma/
      )
    }
  })

  it('aT su un CARICO: incoerente', () => {
    expect(ko(annotazione({ codiceRentri: 'aT', verso: 'CARICO', fir: fir() })).join(' ')).toMatch(
      /scarico/i
    )
  })

  it('HP4,HP14 → HP04 HP14', () => {
    expect(traduciClassiPericolo('HP4,HP14')).toEqual(['HP04', 'HP14'])
    const c = ok(annotazione({ cerCode: '16 05 06*', classiPericolo: 'HP4,HP14' }))
    expect(c.rifiuto.caratteristiche_pericolo).toEqual(['HP04', 'HP14'])
  })

  it('HP 7; hp15', () => {
    expect(traduciClassiPericolo('HP 7; hp15')).toEqual(['HP07', 'HP15'])
    expect(traduciClassiPericolo(null)).toEqual([])
    expect(traduciClassiPericolo('  ')).toEqual([])
  })

  it('HP16 e XY: non traducibili', () => {
    expect(() => traduciClassiPericolo('HP16')).toThrow(/HP16/)
    expect(() => traduciClassiPericolo('XY')).toThrow(/XY/)
    expect(() => traduciClassiPericolo('HP0')).toThrow()
    expect(ko(annotazione({ cerCode: '16 05 06*', classiPericolo: 'HP16' })).join(' ')).toMatch(
      /HP16/
    )
  })

  it('CER pericoloso senza HP: motivo', () => {
    expect(ko(annotazione({ cerCode: '16 05 06*', classiPericolo: null })).join(' ')).toMatch(
      /rifiuto pericoloso senza caratteristiche di pericolo/i
    )
  })

  it('quantità: 1,5 t → 1500 kg', () => {
    expect(traduciQuantita(1.5, 'T')).toEqual({ valore: 1500, unita_misura: 'kg' })
    expect(traduciQuantita(3, '')).toEqual({ valore: 3, unita_misura: 'kg' })
  })

  it('quantità: 200 L → 200 l', () => {
    expect(traduciQuantita(200, 'L')).toEqual({ valore: 200, unita_misura: 'l' })
  })

  it('quantità: 2 M3 → 2000 l', () => {
    expect(traduciQuantita(2, 'M3')).toEqual({ valore: 2000, unita_misura: 'l' })
  })

  it('quantità: PZ non traducibile', () => {
    expect(() => traduciQuantita(5, 'PZ')).toThrow(/PZ/)
    expect(ko(annotazione({ unit: 'PZ' })).join(' ')).toMatch(/unità di misura/i)
  })

  it('stato fisico Gassoso: non traducibile', () => {
    expect(ko(annotazione({ statoFisico: 'Gassoso' })).join(' ')).toMatch(/stato fisico/i)
    expect(ko(annotazione({ statoFisico: null })).join(' ')).toMatch(/stato fisico/i)
  })

  it('CER .99 senza descrizione: motivo; con descrizione: descrizione_eer', () => {
    expect(ko(annotazione({ cerCode: '15 01 99', descrizione: null })).join(' ')).toMatch(
      /descrizione/i
    )
    const c = ok(annotazione({ cerCode: '15 01 99', descrizione: 'Scarti vari' }))
    expect(c.rifiuto.descrizione_eer).toBe('Scarti vari')
    expect(ok(annotazione({ descrizione: 'ignorata' })).rifiuto.descrizione_eer).toBeUndefined()
  })

  it('operazione R13 su aT diventa destinato_attivita; R99 no', () => {
    const base = { codiceRentri: 'aT', verso: 'SCARICO' as const, fir: fir() }
    expect(ok(annotazione({ ...base, operazione: 'r13' })).rifiuto.destinato_attivita).toBe('R13')
    expect(ko(annotazione({ ...base, operazione: 'R99' })).join(' ')).toMatch(/operazione/i)
    expect(
      ok(annotazione({ codiceRentri: 'I', verso: 'SCARICO', operazione: 'D10' })).rifiuto
        .destinato_attivita
    ).toBe('D10')
    // Su DT l'operazione non si trasmette.
    expect(ok(annotazione({ operazione: 'R13' })).rifiuto.destinato_attivita).toBeUndefined()
  })

  it('num_iscrizione_albo fuori formato omesso, non rifiutato', () => {
    const f = fir({
      trasportatore: {
        denominazione: 'T',
        codiceFiscale: '09876543210',
        numeroIscrizioneAlbo: 'MI-12',
      },
    })
    const c = ok(annotazione({ codiceRentri: 'aT', verso: 'SCARICO', fir: f }))
    expect(c.trasportatore.num_iscrizione_albo).toBeUndefined()
  })

  it('più problemi: tutti i motivi insieme, nessun codice fiscale nei messaggi', () => {
    const motivi = ko(
      annotazione({
        codiceRentri: 'aT',
        verso: 'SCARICO',
        cerCode: '16 05 06*',
        classiPericolo: null,
        unit: 'PZ',
        statoFisico: 'Gassoso',
        fir: fir({
          destinatario: { denominazione: 'X', codiceFiscale: null, numeroAutorizzazione: null },
        }),
      })
    )
    expect(motivi.length).toBeGreaterThanOrEqual(5)
    const testo = motivi.join(' ')
    expect(testo).not.toMatch(/0123456789|0987654321|1122334455/)
    expect(testo).not.toMatch(/mov-1/)
  })

  it('scarico con riferimentiCarico: riferimento_operazione in ordine', () => {
    const rif = [
      { anno: 2026, progressivo: 1 },
      { anno: 2026, progressivo: 4 },
    ]
    const c = ok(
      annotazione({
        codiceRentri: 'aT',
        verso: 'SCARICO',
        fir: fir(),
        riferimentiCarico: rif,
      })
    )
    expect(c.riferimenti.riferimento_operazione).toEqual(rif)
    // Su un carico non si trasmettono.
    expect(
      ok(annotazione({ riferimentiCarico: rif })).riferimenti.riferimento_operazione
    ).toBeUndefined()
  })

  describe('ritocchi', () => {
    it('CER pericoloso con classiPericolo di soli separatori: senza HP', () => {
      for (const v of [',', ' ; ', ' , ; ']) {
        expect(ko(annotazione({ cerCode: '16 05 06*', classiPericolo: v })).join(' ')).toMatch(
          /rifiuto pericoloso senza caratteristiche di pericolo/i
        )
      }
      // HP non traducibile: solo il suo motivo, non anche "senza caratteristiche".
      const motivi = ko(annotazione({ cerCode: '16 05 06*', classiPericolo: 'XY' }))
      expect(motivi.join(' ')).not.toMatch(/senza caratteristiche/i)
    })

    it('verso fissato dalla causale: DT, NP, RE, T* sono carichi; I e aT scarichi', () => {
      for (const codice of ['DT', 'NP', 'RE']) {
        expect(ko(annotazione({ codiceRentri: codice, verso: 'SCARICO' })).join(' ')).toMatch(
          /carico/i
        )
      }
      expect(ko(annotazione({ codiceRentri: 'I', verso: 'CARICO' })).join(' ')).toMatch(/scarico/i)
      ok(annotazione({ codiceRentri: 'NP' }))
      ok(annotazione({ codiceRentri: 'I', verso: 'SCARICO' }))
    })

    it('aT/T* con FIR senza numero: motivo, anche con la data di inizio', () => {
      const f = fir({ numeroFir: null })
      expect(ko(annotazione({ codiceRentri: 'T*', fir: f })).join(' ')).toMatch(/numero del FIR/i)
      expect(ko(annotazione({ codiceRentri: 'aT', verso: 'SCARICO', fir: f })).join(' ')).toMatch(
        /numero del FIR/i
      )
      expect(ko(annotazione({ codiceRentri: 'T*', fir: fir({ numeroFir: '  ' }) })).length).toBe(1)
    })

    it('quantità oltre il massimo del contratto: motivo', () => {
      expect(() => traduciQuantita(10_000_000_000, 'KG')).toThrow()
      expect(ko(annotazione({ quantita: 10_000_000, unit: 'T' })).join(' ')).toMatch(/quantità/i)
      expect(traduciQuantita(9_999_999_999.9999, 'KG').valore).toBe(9_999_999_999.9999)
    })

    it('peso verificato a destino: finito, non negativo, a 4 decimali', () => {
      const base = { codiceRentri: 'aT', verso: 'SCARICO' as const }
      const c = ok(annotazione({ ...base, fir: fir({ pesoVerificatoDestinoKg: 95.123456 }) }))
      expect(c.esito.peso_verificato_destino).toBe(95.1235)
      for (const peso of [-1, Number.NaN, Number.POSITIVE_INFINITY, 10_000_000_000]) {
        expect(
          ko(annotazione({ ...base, fir: fir({ pesoVerificatoDestinoKg: peso }) })).join(' ')
        ).toMatch(/peso verificato/i)
      }
    })
  })
})
