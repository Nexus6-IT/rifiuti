import { avvisiInvio, avvisiScarto } from './avvisi'

describe('avvisiInvio: INVIO_OLTRE_TERMINE', () => {
  it('TD01 entro 12 giorni: nessun avviso; oltre: avviso', () => {
    expect(
      avvisiInvio({ tipoDocumento: 'TD01', dataDocumento: '2026-03-01', dataInvio: '2026-03-13' })
    ).toEqual([])
    expect(
      avvisiInvio({ tipoDocumento: 'TD01', dataDocumento: '2026-03-01', dataInvio: '2026-03-14' })
    ).toEqual(['INVIO_OLTRE_TERMINE'])
  })

  it('TD04 come TD01', () => {
    expect(
      avvisiInvio({ tipoDocumento: 'TD04', dataDocumento: '2026-12-25', dataInvio: '2027-01-06' })
    ).toEqual([])
    expect(
      avvisiInvio({ tipoDocumento: 'TD04', dataDocumento: '2026-12-25', dataInvio: '2027-01-07' })
    ).toEqual(['INVIO_OLTRE_TERMINE'])
  })

  it('TD24: entro il 15 del mese successivo', () => {
    expect(
      avvisiInvio({ tipoDocumento: 'TD24', dataDocumento: '2026-03-31', dataInvio: '2026-04-15' })
    ).toEqual([])
    expect(
      avvisiInvio({ tipoDocumento: 'TD24', dataDocumento: '2026-03-31', dataInvio: '2026-04-16' })
    ).toEqual(['INVIO_OLTRE_TERMINE'])
    expect(
      avvisiInvio({ tipoDocumento: 'TD24', dataDocumento: '2026-12-10', dataInvio: '2027-01-15' })
    ).toEqual([])
  })

  it('un invio prima della data documento non e oltre il termine', () => {
    expect(
      avvisiInvio({ tipoDocumento: 'TD01', dataDocumento: '2026-03-10', dataInvio: '2026-03-01' })
    ).toEqual([])
  })
})

describe('avvisiScarto: PROBABILMENTE_GIA_INVIATA', () => {
  it('00404 (fattura duplicata) e 00002 (nome file duplicato) segnalano un possibile invio gia avvenuto', () => {
    expect(avvisiScarto(['00404'])).toEqual(['PROBABILMENTE_GIA_INVIATA'])
    expect(avvisiScarto(['00311', '00002'])).toEqual(['PROBABILMENTE_GIA_INVIATA'])
  })
  it('altri codici o nessuno: nessun avviso', () => {
    expect(avvisiScarto(['00305'])).toEqual([])
    expect(avvisiScarto([])).toEqual([])
  })
})
