import { FIRStato } from './fir.model'
import { ETICHETTE_STATO_FIR, STATO_FIR_DA_DB, TONO_STATO_FIR, contaPerStatoFir } from './stati-fir'

describe('stati-fir', () => {
  describe('contaPerStatoFir', () => {
    it('raggruppa le 7 chiavi del database nei 5 stati del frontend', () => {
      const conteggi = contaPerStatoFir({
        DRAFT: 2,
        AWAITING_PRODUCER: 1,
        AWAITING_CARRIER: 4,
        AWAITING_RECEIVER: 9,
        COMPLETED: 20,
        SYNCED_TO_RENTRI: 1,
        CANCELLED: 1,
      })
      expect(conteggi).toEqual({
        [FIRStato.BOZZA]: 3,
        [FIRStato.EMESSO]: 4,
        [FIRStato.IN_TRANSITO]: 9,
        [FIRStato.CONSEGNATO]: 21,
        [FIRStato.ANNULLATO]: 1,
      })
    })

    it('con un oggetto vuoto, null o undefined stampa cinque zeri', () => {
      const zeri = {
        [FIRStato.BOZZA]: 0,
        [FIRStato.EMESSO]: 0,
        [FIRStato.IN_TRANSITO]: 0,
        [FIRStato.CONSEGNATO]: 0,
        [FIRStato.ANNULLATO]: 0,
      }
      expect(contaPerStatoFir({})).toEqual(zeri)
      expect(contaPerStatoFir(null)).toEqual(zeri)
      expect(contaPerStatoFir(undefined)).toEqual(zeri)
    })

    it('ignora una chiave sconosciuta: non entra in nessuna cella e non crea undefined', () => {
      const conteggi = contaPerStatoFir({ NUOVO_STATO: 5, DRAFT: 1 })
      expect(conteggi[FIRStato.BOZZA]).toBe(1)
      const somma = Object.values(conteggi).reduce((a, b) => a + b, 0)
      expect(somma).toBe(1)
      expect(Object.values(conteggi).every(v => typeof v === 'number')).toBeTrue()
    })

    it('ignora i valori che non sono numeri finiti', () => {
      const conteggi = contaPerStatoFir({ DRAFT: Number.NaN, COMPLETED: 3 })
      expect(conteggi[FIRStato.BOZZA]).toBe(0)
      expect(conteggi[FIRStato.CONSEGNATO]).toBe(3)
    })
  })

  it("ogni stato ha un'etichetta italiana e un tono", () => {
    for (const stato of Object.values(FIRStato)) {
      expect(ETICHETTE_STATO_FIR[stato]).toBeTruthy()
      expect(TONO_STATO_FIR[stato]).toBeTruthy()
    }
    expect(ETICHETTE_STATO_FIR[FIRStato.IN_TRANSITO]).toBe('In transito')
    expect(TONO_STATO_FIR[FIRStato.CONSEGNATO]).toBe('ok')
    expect(TONO_STATO_FIR[FIRStato.IN_TRANSITO]).toBe('warn')
    expect(TONO_STATO_FIR[FIRStato.EMESSO]).toBe('todo')
  })

  it("la mappa dal database coincide con le 7 coppie decise (cambiarla e' una decisione)", () => {
    expect(STATO_FIR_DA_DB).toEqual({
      DRAFT: FIRStato.BOZZA,
      AWAITING_PRODUCER: FIRStato.BOZZA,
      AWAITING_CARRIER: FIRStato.EMESSO,
      AWAITING_RECEIVER: FIRStato.IN_TRANSITO,
      COMPLETED: FIRStato.CONSEGNATO,
      SYNCED_TO_RENTRI: FIRStato.CONSEGNATO,
      CANCELLED: FIRStato.ANNULLATO,
    })
  })
})
