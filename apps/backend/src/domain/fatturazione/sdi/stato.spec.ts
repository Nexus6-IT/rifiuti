import { esitoFiscale, statoDaNotifiche, type NotificaPerStato } from './stato'
import { STATI_TRASMISSIONE_SDI, TIPI_NOTIFICA_SDI } from './codici'

const n = (tipo: NotificaPerStato['tipo'], esitoCommittente?: 'EC01' | 'EC02'): NotificaPerStato => ({
  tipo,
  esitoCommittente: esitoCommittente ?? null,
})

/** Tutte le permutazioni di un insieme piccolo (prova di proprieta' senza dipendenze). */
function permutazioni<T>(v: T[]): T[][] {
  if (v.length <= 1) return [v]
  return v.flatMap((x, i) => permutazioni([...v.slice(0, i), ...v.slice(i + 1)]).map(p => [x, ...p]))
}

describe('statoDaNotifiche', () => {
  it('senza notifiche una trasmissione INVIATA resta INVIATA', () => {
    expect(statoDaNotifiche('INVIATA', [])).toEqual({ stato: 'INVIATA', avvisi: [] })
  })

  it.each([
    [[n('RC')], 'CONSEGNATA'],
    [[n('MC')], 'NON_CONSEGNATA'],
    [[n('NS')], 'SCARTATA'],
    [[n('NE', 'EC01')], 'ACCETTATA'],
    [[n('NE', 'EC02')], 'RIFIUTATA'],
    [[n('DT')], 'DECORSI_TERMINI'],
    [[n('AT')], 'NON_RECAPITABILE'],
    [[n('SE')], 'INVIATA'],
    [[n('ERRORE_PROVIDER')], 'INVIATA'],
  ] as const)('%j -> %s', (notifiche, atteso) => {
    expect(statoDaNotifiche('INVIATA', [...notifiche]).stato).toBe(atteso)
  })

  it('NE prima di RC: stato finale ACCETTATA (una RC in ritardo non fa tornare indietro)', () => {
    expect(statoDaNotifiche('INVIATA', [n('NE', 'EC01'), n('RC')]).stato).toBe('ACCETTATA')
    expect(statoDaNotifiche('INVIATA', [n('RC'), n('NE', 'EC01')]).stato).toBe('ACCETTATA')
  })

  it('RC dopo MC: la fattura e arrivata, CONSEGNATA', () => {
    expect(statoDaNotifiche('INVIATA', [n('MC'), n('RC')]).stato).toBe('CONSEGNATA')
  })

  it('NS vince su tutto, con avviso se dopo una consegna', () => {
    const r = statoDaNotifiche('INVIATA', [n('RC'), n('NS')])
    expect(r.stato).toBe('SCARTATA')
    expect(r.avvisi).toEqual(['NOTIFICHE_INCOERENTI'])
    expect(statoDaNotifiche('INVIATA', [n('NS')]).avvisi).toEqual([])
  })

  it('EC01 e EC02 insieme: avviso, vince il rifiuto', () => {
    const r = statoDaNotifiche('INVIATA', [n('NE', 'EC01'), n('NE', 'EC02')])
    expect(r).toEqual({ stato: 'RIFIUTATA', avvisi: ['NOTIFICHE_INCOERENTI'] })
  })

  it('i duplicati non cambiano nulla', () => {
    expect(statoDaNotifiche('INVIATA', [n('RC'), n('RC'), n('RC')])).toEqual(
      statoDaNotifiche('INVIATA', [n('RC')])
    )
  })

  it('un NE senza esito non cambia lo stato', () => {
    expect(statoDaNotifiche('INVIATA', [n('NE')]).stato).toBe('INVIATA')
  })

  it.each(['DA_INVIARE', 'IN_INVIO', 'INCERTA', 'ERRORE_INVIO'] as const)(
    'in %s le notifiche non si applicano: lo stato resta quello',
    stato => {
      expect(statoDaNotifiche(stato, [n('RC'), n('NS')])).toEqual({ stato, avvisi: [] })
    }
  )

  it('proprieta: ogni permutazione dello stesso insieme da lo stesso risultato', () => {
    const insiemi = [
      [n('RC'), n('NE', 'EC01'), n('DT')],
      [n('NS'), n('RC'), n('MC'), n('AT')],
      [n('NE', 'EC02'), n('NE', 'EC01'), n('RC'), n('SE')],
      [n('MC'), n('AT'), n('DT')],
    ]
    for (const insieme of insiemi) {
      const attesa = statoDaNotifiche('INVIATA', insieme)
      for (const p of permutazioni(insieme)) {
        expect(statoDaNotifiche('INVIATA', p)).toEqual(attesa)
      }
    }
  })

  it('proprieta: NS presente => SCARTATA, qualunque sia il resto', () => {
    for (const altro of TIPI_NOTIFICA_SDI) {
      expect(statoDaNotifiche('INVIATA', [n(altro), n('NS')]).stato).toBe('SCARTATA')
    }
  })

  it('il risultato e sempre uno stato del catalogo', () => {
    for (const t of TIPI_NOTIFICA_SDI) {
      expect(STATI_TRASMISSIONE_SDI).toContain(statoDaNotifiche('INVIATA', [n(t)]).stato)
    }
  })
})

describe('esitoFiscale', () => {
  it.each([
    ['CONSEGNATA', 'EMESSA'],
    ['NON_CONSEGNATA', 'EMESSA'],
    ['ACCETTATA', 'EMESSA'],
    ['DECORSI_TERMINI', 'EMESSA'],
    ['NON_RECAPITABILE', 'EMESSA'],
    ['RIFIUTATA', 'RIFIUTATA_DAL_COMMITTENTE'],
    ['SCARTATA', 'NON_EMESSA'],
    ['ERRORE_INVIO', 'NON_EMESSA'],
    ['DA_INVIARE', 'IN_CORSO'],
    ['IN_INVIO', 'IN_CORSO'],
    ['INVIATA', 'IN_CORSO'],
    ['INCERTA', 'IN_CORSO'],
  ] as const)('%s -> %s', (stato, atteso) => {
    expect(esitoFiscale(stato)).toBe(atteso)
  })
})
