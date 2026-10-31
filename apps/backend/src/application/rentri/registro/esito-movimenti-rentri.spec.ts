import { applicaEsito, applicaEsitoDettagliato } from './esito-movimenti-rentri'
import type { EsitoMovimentiRentri } from '../../../infrastructure/rentri/rentri-registri.client'

const ID = (n: number) => `M${String(n).padStart(19, 'A')}`
const lotto = [
  { movimentoId: 'a', numero: { anno: 2026, progressivo: 1 } },
  { movimentoId: 'b', numero: { anno: 2026, progressivo: 2 } },
  { movimentoId: 'c', numero: { anno: 2026, progressivo: 3 } },
]
function esito(extra: Partial<EsitoMovimentiRentri> = {}): EsitoMovimentiRentri {
  return { errore: false, validazione: [], numeroRegistrazioni: [], ...extra }
}

describe('applicaEsito', () => {
  it('errore false con tutti i numeri: tutte TRASMESSA con identificativo', () => {
    const r = applicaEsito(
      lotto,
      esito({
        numeroRegistrazioni: lotto.map((l, i) => ({ ...l.numero, identificativo: ID(i) })),
      })
    )
    expect(r.map(x => [x.movimentoId, x.stato, x.identificativo])).toEqual([
      ['a', 'TRASMESSA', ID(0)],
      ['b', 'TRASMESSA', ID(1)],
      ['c', 'TRASMESSA', ID(2)],
    ])
  })

  it('errore true con un numero confermato: quella TRASMESSA, le altre RIFIUTATA', () => {
    const r = applicaEsito(
      lotto,
      esito({
        errore: true,
        numeroRegistrazioni: [{ anno: 2026, progressivo: 2, identificativo: null }],
      })
    )
    expect(r.map(x => x.stato)).toEqual(['RIFIUTATA', 'TRASMESSA', 'RIFIUTATA'])
    expect(r[1].identificativo).toBeNull()
    expect(r[0].motivo).toBe(
      'Rifiutata da RENTRI insieme alle altre annotazioni dello stesso invio'
    )
    expect(r[1].motivo).toBeNull()
  })

  it('messaggi per indice alla riga giusta, messaggi senza indice a tutte', () => {
    const m1 = { indice: 1, campo: 'rifiuto.quantita', tipo: 'Errore' as const, codice: 'E1' }
    const mTutti = { indice: null, campo: null, tipo: 'Avvertimento' as const, codice: 'W9' }
    const r = applicaEsito(lotto, esito({ errore: true, validazione: [m1, mTutti] }))
    expect(r[0].messaggi).toEqual([mTutti])
    expect(r[1].messaggi).toEqual([m1, mTutti])
    expect(r[2].messaggi).toEqual([mTutti])
    // con messaggi propri o generali il motivo generico "insieme alle altre" non serve
    expect(r[1].motivo).not.toMatch(/insieme alle altre/)
  })

  it('errore false senza conferma di una riga: RIFIUTATA, mai TRASMESSA', () => {
    const r = applicaEsito(
      lotto,
      esito({ numeroRegistrazioni: [{ anno: 2026, progressivo: 1, identificativo: ID(1) }] })
    )
    expect(r.map(x => x.stato)).toEqual(['TRASMESSA', 'RIFIUTATA', 'RIFIUTATA'])
    expect(r[1].motivo).toBe("RENTRI non ha confermato l'annotazione")
    // nessuna conferma e nessun messaggio: nessuna riga TRASMESSA
    expect(applicaEsito(lotto, esito()).every(x => x.stato === 'RIFIUTATA')).toBe(true)
  })

  it('numero confermato che non è nel lotto: ignorato e segnalato', () => {
    const e = esito({
      numeroRegistrazioni: [
        { anno: 2026, progressivo: 1, identificativo: ID(1) },
        { anno: 2026, progressivo: 99, identificativo: ID(99) },
      ],
    })
    const { righe, fuoriLotto } = applicaEsitoDettagliato(lotto, e)
    expect(righe.map(x => x.stato)).toEqual(['TRASMESSA', 'RIFIUTATA', 'RIFIUTATA'])
    expect(fuoriLotto).toEqual([{ anno: 2026, progressivo: 99 }])
    expect(applicaEsito(lotto, e)).toEqual(righe)
  })

  it('numero duplicato nel lotto: mai TRASMESSA (ambiguo)', () => {
    const doppio = [lotto[0], { movimentoId: 'a2', numero: { ...lotto[0].numero } }]
    const r = applicaEsito(
      doppio,
      esito({ numeroRegistrazioni: [{ anno: 2026, progressivo: 1, identificativo: ID(1) }] })
    )
    expect(r.map(x => x.stato)).toEqual(['RIFIUTATA', 'RIFIUTATA'])
  })

  it('lotto vuoto: nessuna riga', () => {
    expect(applicaEsito([], esito())).toEqual([])
  })
})
