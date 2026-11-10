import {
  adattaMovimentiOrso,
  aggregatoInImpiantoMesi,
  movimentiConteggiati,
  movimentiSenzaDescrizione,
  type MovimentoLetto,
} from './adatta-orso'
import type { AggregatoOrso } from './aggregato'

function letto(extra: Partial<MovimentoLetto> = {}): MovimentoLetto {
  return {
    id: 'm1',
    tipo: 'CARICO',
    movementDate: new Date('2025-03-10T10:00:00Z'),
    cer: '200301',
    descrizione: 'Rifiuti urbani',
    quantita: 500,
    unita: 'kg',
    kg: 500,
    ruolo: 'RICEVUTO_DA_TERZI',
    operationCode: 'R13',
    conFir: true,
    provinciaConferitore: 'MI',
    ...extra,
  }
}

describe('adattaMovimentiOrso', () => {
  it('traduce il movimento del lettore in quello dell’aggregatore', () => {
    const [m] = adattaMovimentiOrso([letto()])
    expect(m).toEqual({
      id: 'm1',
      mese: 3,
      verso: 'CARICO',
      ruoloMud: 'RICEVUTO_DA_TERZI',
      cer: '200301',
      descrizione: 'Rifiuti urbani',
      quantita: 500,
      unita: 'kg',
      kgPerUnita: null,
      operazione: 'R13',
      conFir: true,
      provinciaConferitore: 'MI',
    })
  })

  it('usa i kg già convertiti dal lettore (peso specifico compreso)', () => {
    const [m] = adattaMovimentiOrso([letto({ quantita: 10, unita: 'L', kg: 8.5 })])
    expect(m.quantita).toBe(8.5)
    expect(m.unita).toBe('kg')
  })

  it('lascia l’unità originale se il lettore non ha potuto convertire, così resta non convertibile', () => {
    const [m] = adattaMovimentiOrso([letto({ quantita: 10, unita: 'L', kg: null })])
    expect(m.quantita).toBe(10)
    expect(m.unita).toBe('L')
  })

  it('calcola il mese nel fuso italiano (28/02 23:30 UTC è già marzo)', () => {
    const [m] = adattaMovimentiOrso([letto({ movementDate: new Date('2025-02-28T23:30:00Z') })])
    expect(m.mese).toBe(3)
  })

  it('operazione vuota diventa null', () => {
    const [m] = adattaMovimentiOrso([letto({ operationCode: '  ' })])
    expect(m.operazione).toBeNull()
  })
})

describe('aggregatoInImpiantoMesi', () => {
  const aggregato: AggregatoOrso = {
    anno: 2025,
    bloccato: false,
    avvisi: [],
    mesi: [
      {
        mese: 3,
        ricevuti: [
          {
            cer: '200301',
            descrizione: 'Urbani',
            operazioni: ['R13'],
            totale: '1.5',
            extra: '0.5',
            f: 1,
          },
          {
            cer: '150101',
            descrizione: 'Carta',
            operazioni: ['R3'],
            totale: '2',
            extra: '0',
            f: 0,
          },
        ],
        prodotti: [
          { cer: '191212', descrizione: 'Scarti', totale: '0.8', trattatoInternamente: '0' },
          { cer: '191201', descrizione: 'Zero', totale: '0', trattatoInternamente: '0' },
        ],
      },
    ],
  }

  it('produce Tot e, solo se diverso da zero, Extra per i ricevuti', () => {
    const d = aggregatoInImpiantoMesi(aggregato, 'WasteFlow')
    expect(d.autore).toBe('WasteFlow')
    expect(d.anni).toHaveLength(1)
    const [r1, r2] = d.anni[0].mesi[0].ricevuti
    expect(r1.ingressi).toEqual([
      { q: '1.5', f: 1, ts: 'Tot', s: '0' },
      { q: '0.5', f: 1, ts: 'Extra', s: '0' },
    ])
    expect(r1.operazioni).toEqual(['R13'])
    expect(r2.ingressi).toEqual([{ q: '2', f: 0, ts: 'Tot', s: '0' }])
  })

  it('produce l’uscita Tot solo se > 0 e riporta il trattato internamente', () => {
    const d = aggregatoInImpiantoMesi(aggregato)
    const [p1, p2] = d.anni[0].mesi[0].prodotti
    expect(p1.uscite).toEqual([{ q: '0.8', ts: 'Tot', s: '0' }])
    expect(p1.quantitaTrattataInternamente).toBe('0')
    expect(p2.uscite).toEqual([])
  })
})

describe('movimentiConteggiati e movimentiSenzaDescrizione', () => {
  it('conta i carichi ricevuti da terzi e gli scarichi non esclusi, solo se convertibili', () => {
    const lista = [
      letto({ id: 'a' }),
      letto({ id: 'b', ruolo: 'AVVIATO' }),
      letto({ id: 'c', tipo: 'SCARICO', ruolo: 'PRODOTTO' }),
      letto({ id: 'd', tipo: 'SCARICO', ruolo: 'ESCLUSO' }),
      letto({ id: 'e', kg: null }),
    ]
    expect(movimentiConteggiati(lista).map(m => m.id)).toEqual(['a', 'c'])
  })

  it('segnala i movimenti conteggiati con descrizione vuota o di soli spazi', () => {
    const lista = [
      letto({ id: 'a', descrizione: null }),
      letto({ id: 'b', descrizione: '   ' }),
      letto({ id: 'c' }),
      letto({ id: 'd', ruolo: 'ESCLUSO', tipo: 'SCARICO', descrizione: null }),
    ]
    expect(movimentiSenzaDescrizione(lista).map(m => m.id)).toEqual(['a', 'b'])
  })
})
