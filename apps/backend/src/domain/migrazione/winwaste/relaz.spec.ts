import { decodificaRelaz } from './relaz'

const dodici = (n: number): string => n.toFixed(3).replace('.', ',').padStart(12, ' ')
const seg = (tipo: string, codice: string, classe: string, kg: number, m3 = 0): string =>
  `${tipo}${codice.padEnd(8, ' ')}${classe}${dodici(kg)}${dodici(m3)}`

// docs/giacenze.md §2.2: segmenti di 34 caratteri.
describe('decodificaRelaz', () => {
  it.each([[''], [null]])('vuota (%p): nessun segmento', v => {
    expect(decodificaRelaz(v)).toEqual({ ok: true, valore: [] })
  })

  it('un segmento di carico dell anno corrente', () => {
    const s = seg('C', '00000001', 'R', 600, 1.5)
    expect(s).toHaveLength(34)
    expect(decodificaRelaz(s)).toEqual({
      ok: true,
      valore: [{ tipo: 'C', cod: 1, classe: 'R', kg: 600, m3: 1.5 }],
    })
  })

  it('piu segmenti, anche P e classi minuscole', () => {
    const r = decodificaRelaz(
      seg('C', '00000010', 'T', 100.25) + seg('P', '77', 'd', 50, 0.5) + seg('C', '3', 'X', 1)
    )
    expect(r).toEqual({
      ok: true,
      valore: [
        { tipo: 'C', cod: 10, classe: 'T', kg: 100.25, m3: 0 },
        { tipo: 'P', cod: 77, classe: 'd', kg: 50, m3: 0.5 },
        { tipo: 'C', cod: 3, classe: 'X', kg: 1, m3: 0 },
      ],
    })
  })

  it('migliaia con il punto nei kg', () => {
    const s = `C00000001R${'1.234,500'.padStart(12, ' ')}${dodici(0)}`
    expect(decodificaRelaz(s)).toMatchObject({ ok: true, valore: [{ kg: 1234.5 }] })
  })

  it.each([
    ['G1', 1],
    ['1', 1],
    ['G0', 0],
    ['G5', 5],
    ['0', 0],
  ])('riga di giacenza iniziale %s (forma accettata)', (codice, riga) => {
    expect(decodificaRelaz(seg('G', codice, 'R', 100))).toMatchObject({
      ok: true,
      valore: [{ tipo: 'G', riga, kg: 100 }],
    })
  })

  it('lunghezza non multipla di 34', () => {
    expect(decodificaRelaz(`${seg('C', '1', 'R', 1)}XX`)).toMatchObject({
      ok: false,
      codice: 'RELAZ_LUNGHEZZA',
    })
    expect(decodificaRelaz(' ')).toMatchObject({ ok: false, codice: 'RELAZ_LUNGHEZZA' })
  })

  it('tipo ignoto', () => {
    expect(decodificaRelaz(seg('Z', '1', 'R', 1))).toMatchObject({
      ok: false,
      codice: 'RELAZ_TIPO',
    })
  })

  it('classe ignota', () => {
    expect(decodificaRelaz(seg('C', '1', 'Z', 1))).toMatchObject({
      ok: false,
      codice: 'RELAZ_CLASSE',
    })
  })

  it.each([
    ['G con codice fuori G0..G5', seg('G', 'G6', 'R', 1)],
    ['G senza codice', seg('G', '', 'R', 1)],
    ['carico con codice non numerico', seg('C', 'ABC', 'R', 1)],
    ['carico con codice zero', seg('C', '0', 'R', 1)],
    ['carico senza codice', seg('C', '', 'R', 1)],
  ])('RELAZ_CODICE: %s', (_n, s) => {
    expect(decodificaRelaz(s)).toMatchObject({ ok: false, codice: 'RELAZ_CODICE' })
  })

  it('kg o m3 non validi', () => {
    expect(decodificaRelaz(`C00000001R${'12.5'.padStart(12, ' ')}${dodici(0)}`)).toMatchObject({
      ok: false,
      codice: 'RELAZ_QUANTITA',
    })
    expect(decodificaRelaz(`C00000001R${' '.repeat(12)}${dodici(0)}`)).toMatchObject({
      ok: false,
      codice: 'RELAZ_QUANTITA',
    })
    expect(decodificaRelaz(`C00000001R${dodici(1)}${' '.repeat(12)}`)).toMatchObject({
      ok: false,
      codice: 'RELAZ_QUANTITA',
    })
  })

  it('indica il numero del segmento ma non il valore', () => {
    const r = decodificaRelaz(seg('C', '1', 'R', 1) + seg('Z', '9', 'R', 1))
    expect(r.ok === false && r.dettaglio).toContain('segmento 2')
  })
})
