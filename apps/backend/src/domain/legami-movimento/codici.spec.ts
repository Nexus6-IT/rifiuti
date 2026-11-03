import {
  AVVISI_LEGAME,
  MESSAGGI_AVVISO,
  MESSAGGI_MOTIVO,
  MOTIVI_LEGAME,
  STATI_FATTURATI,
  STATI_LEGAME,
  eStatoFatturato,
  sonoAvvisiValidi,
  sonoMotiviValidi,
  validaMotivoEsclusione,
} from './codici'

describe('codici del legame movimento', () => {
  it('gli insiemi sono chiusi: 11 motivi, 4 avvisi (compreso PREZZO_MANUALE), 7 stati', () => {
    expect(MOTIVI_LEGAME).toHaveLength(11)
    expect(AVVISI_LEGAME).toHaveLength(4)
    expect(AVVISI_LEGAME).toContain('PREZZO_MANUALE')
    expect(STATI_LEGAME).toHaveLength(7)
  })

  it('ogni motivo e ogni avviso ha un messaggio non vuoto, senza id', () => {
    for (const m of MOTIVI_LEGAME) {
      expect(MESSAGGI_MOTIVO[m].trim().length).toBeGreaterThan(0)
      expect(MESSAGGI_MOTIVO[m]).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
    for (const a of AVVISI_LEGAME) {
      expect(MESSAGGI_AVVISO[a].trim().length).toBeGreaterThan(0)
      expect(MESSAGGI_AVVISO[a]).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
    expect(MESSAGGI_AVVISO.PREZZO_MANUALE).toBe(
      'Una o più righe hanno il prezzo modificato a mano: «Aggiorna prezzi» non le cambia.'
    )
  })

  it('validaMotivoEsclusione: trim e limiti 1-200', () => {
    expect(validaMotivoEsclusione('  x ')).toEqual({ ok: true, valore: 'x' })
    expect(validaMotivoEsclusione('   ').ok).toBe(false)
    expect(validaMotivoEsclusione('').ok).toBe(false)
    expect(validaMotivoEsclusione(undefined).ok).toBe(false)
    expect(validaMotivoEsclusione(12).ok).toBe(false)
    expect(validaMotivoEsclusione('a'.repeat(200)).ok).toBe(true)
    expect(validaMotivoEsclusione('a'.repeat(201)).ok).toBe(false)
    expect(validaMotivoEsclusione(` ${'a'.repeat(200)} `).ok).toBe(true)
  })

  it('eStatoFatturato è vero solo per i due stati fatturati', () => {
    expect(STATI_FATTURATI).toEqual(['FATTURATO', 'IMPORTATO_FATTURATO'])
    for (const s of STATI_LEGAME) {
      expect(eStatoFatturato(s)).toBe(s === 'FATTURATO' || s === 'IMPORTATO_FATTURATO')
    }
  })

  it('sonoMotiviValidi / sonoAvvisiValidi rifiutano codici ignoti', () => {
    expect(sonoMotiviValidi(['SENZA_CLIENTE', 'SENZA_PREZZO'])).toBe(true)
    expect(sonoMotiviValidi(['FOO'])).toBe(false)
    expect(sonoMotiviValidi([1])).toBe(false)
    expect(sonoAvvisiValidi(['PREZZO_MANUALE'])).toBe(true)
    expect(sonoAvvisiValidi(['SENZA_CLIENTE'])).toBe(false)
  })
})
