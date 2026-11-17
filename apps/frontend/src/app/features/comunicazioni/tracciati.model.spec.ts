import {
  AvvisoTracciato,
  annoSolare,
  daConfermare,
  linkCorrezione,
  mesePrecedente,
} from './tracciati.model'

const avviso = (o: Partial<AvvisoTracciato> = {}): AvvisoTracciato => ({
  codice: 'X',
  messaggio: 'm',
  movimentoIds: [],
  bloccante: true,
  ...o,
})

describe('tracciati.model', () => {
  it('daConfermare dipende dall affidabilita, non dal consorzio', () => {
    expect(daConfermare({ affidabilita: 'RICAVATO_WINWASTE' })).toBeTrue()
    expect(daConfermare({ affidabilita: 'UFFICIALE' })).toBeFalse()
    expect(daConfermare(null)).toBeFalse()
    expect(daConfermare({})).toBeFalse()
  })

  it('mesePrecedente: mese intero, anche a cavallo d anno e in bisestile', () => {
    expect(mesePrecedente(new Date(2026, 5, 15))).toEqual({ da: '2026-05-01', a: '2026-05-31' })
    expect(mesePrecedente(new Date(2026, 0, 10))).toEqual({ da: '2025-12-01', a: '2025-12-31' })
    expect(mesePrecedente(new Date(2024, 2, 5))).toEqual({ da: '2024-02-01', a: '2024-02-29' })
  })

  it('annoSolare', () => {
    expect(annoSolare(2026)).toEqual({ da: '2026-01-01', a: '2026-12-31' })
  })

  it('linkCorrezione: movimento, anagrafiche, configurazione, nessuno', () => {
    expect(linkCorrezione(avviso({ correzione: { tipo: 'MOVIMENTO' } }))).toEqual([
      { etichetta: 'Apri il registro', rotta: '/registro' },
    ])
    expect(
      linkCorrezione(avviso({ correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's' } })).map(
        l => l.rotta
      )
    ).toEqual(['/produttori', '/trasportatori', '/destinatari'])
    expect(linkCorrezione(avviso({ correzione: { tipo: 'CONFIGURAZIONE_SEDE' } }))[0].rotta).toBe(
      '/comunicazioni'
    )
    expect(linkCorrezione(avviso())).toEqual([])
  })
})
