import {
  formattaTonnellate,
  puoGenerareComunicazioni,
  righeDaAnteprima,
  testoSoggetto,
} from './comunicazioni.model'

describe('comunicazioni.model', () => {
  it('formatta le tonnellate in it-IT con 3 decimali', () => {
    expect(formattaTonnellate('12345.5')).toBe('12.345,500 t')
    expect(formattaTonnellate('0')).toBe('0,000 t')
  })

  it('appiattisce i mesi in righe ordinate, ricevuti prima dei prodotti', () => {
    const righe = righeDaAnteprima([
      {
        mese: 3,
        ricevuti: [],
        prodotti: [
          {
            cer: '19 12 01',
            descrizione: 'Carta',
            operazioni: ['R3'],
            totT: '2',
            giacenzaFineMeseT: '0',
          },
        ],
      },
      {
        mese: 1,
        ricevuti: [
          {
            cer: '15 01 01',
            descrizione: 'Imballaggi',
            operazioni: ['R13', 'R3'],
            totT: '10.5',
            extraT: '1',
            conFir: true,
          },
        ],
        prodotti: [],
      },
    ])
    expect(righe.map(r => `${r.mese}-${r.direzione}-${r.cer}`)).toEqual([
      '1-Ricevuto-15 01 01',
      '3-Prodotto-19 12 01',
    ])
    expect(righe[0].operazioni).toBe('R13, R3')
    expect(righe[0].quantita).toBe('10,500 t')
  })

  it('genera solo ADMIN, OPERATOR e SUPER_ADMIN', () => {
    expect(puoGenerareComunicazioni('OPERATOR')).toBeTrue()
    expect(puoGenerareComunicazioni('ADMIN')).toBeTrue()
    expect(puoGenerareComunicazioni('VIEWER')).toBeFalse()
    expect(puoGenerareComunicazioni(undefined)).toBeFalse()
  })

  it('in modalità dettagliata appiattisce una riga per soggetto, con tipo e nome', () => {
    const righe = righeDaAnteprima([
      {
        mese: 3,
        ricevuti: [
          {
            cer: '17 04 05',
            descrizione: 'Ferro',
            operazioni: ['R13'],
            totT: '2.5',
            extraT: '0',
            conFir: true,
            soggetti: [
              { ts: 'I', s: '123', etichetta: 'Impianto ARPA 123', qT: '2', conFir: true },
              { ts: 'Inew', s: '1', etichetta: 'Rossi Srl', qT: '0.5', conFir: false },
            ],
          },
        ],
        prodotti: [
          {
            cer: '17 04 05',
            descrizione: 'Ferro',
            operazioni: [],
            totT: '1',
            giacenzaFineMeseT: '0.2',
            soggetti: [{ ts: 'Inew', s: '2', etichetta: 'Verdi', qT: '1' }],
          },
        ],
      },
    ])
    expect(righe.map(r => [r.direzione, r.soggetto, r.quantita, r.dettaglio])).toEqual([
      ['Ricevuto', 'Impianto ARPA 123 · Impianto ARPA 123', '2,000 t', 'con FIR'],
      ['Ricevuto', 'Nuovo impianto n. 1 · Rossi Srl', '0,500 t', 'senza FIR'],
      ['Prodotto', 'Nuovo impianto n. 2 · Verdi', '1,000 t', 'giacenza a fine mese 0,200 t'],
    ])
    expect(testoSoggetto({ ts: 'C', s: '015146', etichetta: 'Comune di Milano', qT: '1' })).toBe(
      'Comune 015146 · Comune di Milano'
    )
  })
})
