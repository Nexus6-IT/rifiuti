import { BASE_INDICE_RENTRI, applicaEsito, applicaEsitoDettagliato } from './esito-movimenti-rentri'
import { NumeroDuplicatoNelLottoError } from './selezione-lotto-rentri'
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

  it('errore false senza conferma di una riga: INCERTA, mai RIFIUTATA', () => {
    const r = applicaEsito(
      lotto,
      esito({ numeroRegistrazioni: [{ anno: 2026, progressivo: 1, identificativo: ID(1) }] })
    )
    expect(r.map(x => x.stato)).toEqual(['TRASMESSA', 'INCERTA', 'INCERTA'])
    expect(r[1].motivo).toMatch(/non ha confermato/)
    // nessuna conferma e nessun messaggio: tutte incerte, nessuna TRASMESSA ne' RIFIUTATA
    expect(applicaEsito(lotto, esito()).every(x => x.stato === 'INCERTA')).toBe(true)
  })

  it('errore true con registrazioni senza numero: le righe non confermate sono INCERTA', () => {
    const r = applicaEsito(
      lotto,
      esito({
        errore: true,
        numeroRegistrazioni: [{ anno: 2026, progressivo: 1, identificativo: ID(1) }],
        registrazioniSenzaNumero: 1,
      })
    )
    expect(r.map(x => x.stato)).toEqual(['TRASMESSA', 'INCERTA', 'INCERTA'])
  })

  it('RIFIUTATA solo con errore true e nessuna registrazione ignota', () => {
    const r = applicaEsito(lotto, esito({ errore: true, registrazioniSenzaNumero: 0 }))
    expect(r.every(x => x.stato === 'RIFIUTATA')).toBe(true)
  })

  it('numero confermato che non è nel lotto: ignorato e segnalato', () => {
    const e = esito({
      numeroRegistrazioni: [
        { anno: 2026, progressivo: 1, identificativo: ID(1) },
        { anno: 2026, progressivo: 99, identificativo: ID(99) },
      ],
    })
    const { righe, fuoriLotto } = applicaEsitoDettagliato(lotto, e)
    expect(righe.map(x => x.stato)).toEqual(['TRASMESSA', 'INCERTA', 'INCERTA'])
    expect(fuoriLotto).toEqual([{ anno: 2026, progressivo: 99 }])
    expect(applicaEsito(lotto, e)).toEqual(righe)
  })

  it('numero duplicato nel lotto: errore, mai un RIFIUTATA reinviabile', () => {
    const doppio = [lotto[0], { movimentoId: 'a2', numero: { ...lotto[0].numero } }]
    expect(() => applicaEsito(doppio, esito())).toThrow(NumeroDuplicatoNelLottoError)
    expect(() => applicaEsitoDettagliato(doppio, esito())).toThrow(NumeroDuplicatoNelLottoError)
  })

  it("base dell'indice: costante nominata, 0", () => {
    expect(BASE_INDICE_RENTRI).toBe(0)
  })

  it('indice fuori intervallo: a tutte le righe e fra le anomalie', () => {
    const fuori = { indice: 7, campo: 'x', tipo: 'Errore' as const, codice: 'E7' }
    const negativo = { indice: -1, campo: null, tipo: 'Errore' as const, codice: null }
    const { righe, anomalie } = applicaEsitoDettagliato(
      lotto,
      esito({ errore: true, validazione: [fuori, negativo] })
    )
    for (const r of righe) expect(r.messaggi).toEqual([fuori, negativo])
    expect(anomalie).toEqual([
      { tipo: 'INDICE_FUORI_INTERVALLO', indice: 7 },
      { tipo: 'INDICE_FUORI_INTERVALLO', indice: -1 },
    ])
  })

  it('stesso numero confermato due volte con identificativi diversi: identificativo null e anomalia', () => {
    const { righe, anomalie } = applicaEsitoDettagliato(
      lotto,
      esito({
        numeroRegistrazioni: [
          { anno: 2026, progressivo: 1, identificativo: ID(1) },
          { anno: 2026, progressivo: 1, identificativo: ID(2) },
        ],
      })
    )
    expect(righe[0].stato).toBe('TRASMESSA')
    expect(righe[0].identificativo).toBeNull()
    expect(anomalie).toEqual([
      { tipo: 'IDENTIFICATIVI_DISCORDANTI', numero: { anno: 2026, progressivo: 1 } },
    ])
  })

  it('stesso numero confermato due volte con lo stesso identificativo (o uno solo noto): nessuna anomalia', () => {
    const { righe, anomalie } = applicaEsitoDettagliato(
      lotto,
      esito({
        numeroRegistrazioni: [
          { anno: 2026, progressivo: 1, identificativo: ID(1) },
          { anno: 2026, progressivo: 1, identificativo: null },
          { anno: 2026, progressivo: 2, identificativo: ID(2) },
          { anno: 2026, progressivo: 2, identificativo: ID(2) },
        ],
      })
    )
    expect(righe[0].identificativo).toBe(ID(1))
    expect(righe[1].identificativo).toBe(ID(2))
    expect(anomalie).toEqual([])
  })

  it('lotto vuoto: nessuna riga', () => {
    expect(applicaEsito([], esito())).toEqual([])
  })

  it('identificativi discordanti: una sola anomalia per numero, anche con tre conferme', () => {
    const { anomalie } = applicaEsitoDettagliato(
      lotto,
      esito({
        numeroRegistrazioni: [
          { anno: 2026, progressivo: 1, identificativo: ID(1) },
          { anno: 2026, progressivo: 1, identificativo: ID(2) },
          { anno: 2026, progressivo: 1, identificativo: ID(3) },
        ],
      })
    )
    expect(anomalie).toEqual([
      { tipo: 'IDENTIFICATIVI_DISCORDANTI', numero: { anno: 2026, progressivo: 1 } },
    ])
  })
})
