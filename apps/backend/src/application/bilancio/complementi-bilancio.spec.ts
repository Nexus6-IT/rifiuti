import { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { righeCausaliSistema } from '../registro/causali/catalogo-causali.fixture'
import {
  mesiConMovimenti,
  operazionePreliminare,
  prodottoNelPeriodo,
  preliminariNelPeriodo,
  type FirBilancio,
  type MovimentoBilancio,
} from './complementi-bilancio'

const catalogo = new CatalogoCausali(righeCausaliSistema(), [])

function mov(o: Partial<MovimentoBilancio> = {}): MovimentoBilancio {
  return {
    type: 'CARICO',
    causale: 'PRODUZIONE_INTERNA',
    causaleAziendaId: null,
    movementDate: new Date('2025-03-10T10:00:00Z'),
    quantity: 100,
    unit: 'KG',
    operationCode: null,
    fir: null,
    ...o,
  }
}

function fir(o: Partial<FirBilancio> = {}): FirBilancio {
  return {
    id: 'fir-1',
    status: 'COMPLETED',
    firNumber: 'FIR-1',
    wasteOperationCode: null,
    ...o,
  }
}

describe('prodottoNelPeriodo', () => {
  it('solo carichi con ruolo PRODOTTO, in kg', () => {
    const movimenti = [
      mov({ causale: 'PRODUZIONE_INTERNA', quantity: 100, unit: 'KG' }),
      mov({ causale: 'RECUPERO_PARZIALE', quantity: 1, unit: 'T' }),
      mov({ causale: 'INGRESSO_ESTERNO', quantity: 500 }),
      mov({ causale: 'RICLASSIFICAZIONE', quantity: 50 }),
      mov({ type: 'SCARICO', causale: 'AVVIO_RECUPERO', quantity: 70 }),
    ]
    expect(prodottoNelPeriodo(catalogo, movimenti, '2025-12-31')).toBe(1100)
  })

  it('litri e m³ fuori', () => {
    const movimenti = [mov({ quantity: 100 }), mov({ quantity: 30, unit: 'L' })]
    expect(prodottoNelPeriodo(catalogo, movimenti, '2025-12-31')).toBe(100)
  })

  it('giorno italiano entro al', () => {
    const m = mov({ movementDate: new Date('2025-06-30T22:30:00Z') }) // 1° luglio in Italia
    expect(prodottoNelPeriodo(catalogo, [m], '2025-06-30')).toBe(0)
    expect(prodottoNelPeriodo(catalogo, [m], '2025-07-01')).toBe(100)
  })
})

describe('operazionePreliminare', () => {
  const scarico = (o: Partial<MovimentoBilancio> = {}) =>
    mov({ type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE', ...o })

  it('codice del movimento', () => {
    expect(operazionePreliminare(catalogo, scarico({ operationCode: 'R 13' }))).toBe('R13')
    expect(operazionePreliminare(catalogo, scarico({ operationCode: 'd15' }))).toBe('D15')
  })

  it('senza codice nel movimento vale il FIR, se la lettera coincide con la causale', () => {
    const f = fir({ wasteOperationCode: 'R13' })
    expect(operazionePreliminare(catalogo, scarico({ causale: 'AVVIO_RECUPERO', fir: f }))).toBe(
      'R13'
    )
    expect(
      operazionePreliminare(catalogo, scarico({ causale: 'AVVIO_SMALTIMENTO', fir: f }))
    ).toBeNull()
  })

  it('il codice del movimento vince sulla causale', () => {
    expect(
      operazionePreliminare(
        catalogo,
        scarico({ causale: 'AVVIO_SMALTIMENTO', operationCode: 'R13' })
      )
    ).toBe('R13')
  })

  it('R1 o D10 non sono preliminari', () => {
    expect(operazionePreliminare(catalogo, scarico({ operationCode: 'R1' }))).toBeNull()
    expect(operazionePreliminare(catalogo, scarico({ operationCode: 'D10' }))).toBeNull()
  })

  it('carico, causale esclusa o FIR annullato -> null', () => {
    expect(
      operazionePreliminare(catalogo, mov({ type: 'CARICO', operationCode: 'R13' }))
    ).toBeNull()
    expect(
      operazionePreliminare(catalogo, scarico({ causale: 'ALTRO_SCARICO', operationCode: 'R13' }))
    ).toBeNull()
    expect(
      operazionePreliminare(
        catalogo,
        scarico({
          operationCode: 'R13',
          fir: fir({ status: 'CANCELLED', wasteOperationCode: 'R13' }),
        })
      )
    ).toBeNull()
  })
})

describe('preliminariNelPeriodo', () => {
  it('somma in kg per R13 e D15', () => {
    const s = (o: Partial<MovimentoBilancio>) =>
      mov({ type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE', ...o })
    const movimenti = [
      s({ operationCode: 'R13', quantity: 200 }),
      s({ operationCode: 'R13', quantity: 1, unit: 'T' }),
      s({ operationCode: 'D15', quantity: 40 }),
      s({ operationCode: 'R1', quantity: 999 }),
      s({ operationCode: 'D15', quantity: 5, movementDate: new Date('2026-01-10T10:00:00Z') }),
    ]
    expect(preliminariNelPeriodo(catalogo, movimenti, '2025-12-31')).toEqual({
      r13Kg: 1200,
      d15Kg: 40,
    })
  })
})

describe('mesiConMovimenti', () => {
  it('qualunque tipo vigente, distinti e ordinati, entro al', () => {
    const date = (iso: string) => ({ movementDate: new Date(iso) })
    expect(
      mesiConMovimenti(
        [
          date('2025-01-15T10:00:00Z'),
          date('2025-03-05T10:00:00Z'),
          date('2025-03-20T10:00:00Z'),
          date('2025-11-02T10:00:00Z'),
        ],
        '2025-10-31'
      )
    ).toEqual([1, 3])
  })
})
