import {
  formattaTonnellate,
  puoGenerareComunicazioni,
  righeDaAnteprima,
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
})
