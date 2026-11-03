import {
  AVVISI_LEGAME,
  MOTIVI_LEGAME,
  STATI_LEGAME,
  STATI_LISTA,
  etichettaAvviso,
  etichettaMotivo,
  etichettaStato,
  severitaStato,
} from './vocabolario-legami'

describe('vocabolario legami', () => {
  it('ogni stato, motivo e avviso ha un’etichetta italiana non vuota', () => {
    for (const s of STATI_LISTA) expect(etichettaStato(s).length).toBeGreaterThan(0)
    for (const m of MOTIVI_LEGAME) expect(etichettaMotivo(m)).not.toBe(m)
    for (const a of AVVISI_LEGAME) expect(etichettaAvviso(a)).not.toBe(a)
  })

  it('i vocabolari combaciano con il backend (5 avvisi, 11 motivi, 7 stati + 2 virtuali)', () => {
    expect(AVVISI_LEGAME).toEqual([
      'CLIENTE_NON_DA_FIR',
      'QUANTITA_MANUALE_NON_DERIVATA',
      'CAMBIO_CER_DA_CONFERMARE',
      'PREZZO_MANUALE',
      'CONTRATTO_ALTRA_SEDE',
    ])
    expect(MOTIVI_LEGAME.length).toBe(11)
    expect(STATI_LEGAME.length).toBe(7)
    expect(STATI_LISTA).toContain('MANCANTE')
    expect(STATI_LISTA).toContain('DA_RIALLINEARE')
  })

  it('un codice sconosciuto torna com’è, senza errori', () => {
    expect(etichettaMotivo('NUOVO' as never)).toBe('NUOVO')
  })

  it('severità per stato', () => {
    expect(severitaStato('CONFERMATO')).toBe('success')
    expect(severitaStato('FATTURATO')).toBe('success')
    expect(severitaStato('IMPORTATO_FATTURATO')).toBe('secondary')
    expect(severitaStato('PROPOSTO')).toBe('info')
    expect(severitaStato('DA_COLLEGARE')).toBe('warn')
    expect(severitaStato('MANCANTE')).toBe('danger')
    expect(severitaStato('DA_RIALLINEARE')).toBe('danger')
    expect(severitaStato('ESCLUSO')).toBe('secondary')
    expect(severitaStato('ANNULLATO')).toBe('secondary')
  })
})
