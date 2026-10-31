import { nettoNellUnitaFir, PESO_FIR_MINIMO } from './netto-unita-fir'

// Gli stessi casi di apps/backend/src/domain/pese/confronto-documento.spec.ts: il frontend mostra
// prima dell'invio il valore che il backend scrivera' nel FIR.
describe('nettoNellUnitaFir (gemella del dominio backend)', () => {
  it('kg: netto invariato, anche sotto i 5 kg', () => {
    expect(nettoNellUnitaFir(16000, 'KG')).toEqual({ ok: true, valore: 16000 })
    expect(nettoNellUnitaFir(0.4, 'kg')).toEqual({ ok: true, valore: 0.4 })
    expect(nettoNellUnitaFir(12, 'Kilogrammi')).toEqual({ ok: true, valore: 12 })
  })

  it('unità vuota vale kg', () => {
    expect(nettoNellUnitaFir(12, '')).toEqual({ ok: true, valore: 12 })
    expect(nettoNellUnitaFir(12, null)).toEqual({ ok: true, valore: 12 })
  })

  it('tonnellate: centesimo di tonnellata (10 kg), metà in su', () => {
    expect(nettoNellUnitaFir(999.5, 'T')).toEqual({ ok: true, valore: 1 })
    expect(nettoNellUnitaFir(5, 'T')).toEqual({ ok: true, valore: 0.01 })
    expect(nettoNellUnitaFir(16000, 'Tonnellate')).toEqual({ ok: true, valore: 16 })
  })

  it('tonnellate sotto i 5 kg: errore con il messaggio del backend', () => {
    const r = nettoNellUnitaFir(4.9, 'T')
    expect(r).toEqual({
      ok: false,
      messaggio:
        'Il netto è troppo piccolo per essere espresso nel FIR (minimo 0,01 T): indicare il peso a mano.',
    })
    expect(nettoNellUnitaFir(1, 'T').ok).toBeFalse()
    expect(nettoNellUnitaFir(0.4, 'T').ok).toBeFalse()
  })

  it('unità a volume: non si converte, messaggio del backend', () => {
    expect(nettoNellUnitaFir(16000, 'M3')).toEqual({
      ok: false,
      messaggio: 'Il FIR è in M3: il peso della pesa (kg) non si converte.',
    })
    expect(nettoNellUnitaFir(1, 'litri').ok).toBeFalse()
  })

  it("un netto di zero kg non e' registrabile (minimo 0,01)", () => {
    expect(nettoNellUnitaFir(0, 'KG').ok).toBeFalse()
  })

  it('il minimo è un centesimo', () => {
    expect(PESO_FIR_MINIMO).toBe(0.01)
  })
})
