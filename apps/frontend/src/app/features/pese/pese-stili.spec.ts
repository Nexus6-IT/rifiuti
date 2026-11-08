import { STILI_PESE } from './pese-stili'

describe('STILI_PESE', () => {
  it('la griglia dei campi non impone 220 px: a 390 px il campo non esce dal dialog', () => {
    expect(STILI_PESE).not.toMatch(/minmax\(\s*220px/)
    expect(STILI_PESE).toMatch(/minmax\(\s*min\(\s*220px\s*,\s*100%\s*\)/)
  })

  it("l'avviso della pesata manuale non ha la banda colorata laterale da 4 px", () => {
    expect(STILI_PESE).not.toMatch(/border-(left|right):\s*[2-9]px/)
  })

  it("l'avviso della pesata manuale usa i token di stato, non colori letterali", () => {
    const blocco = /\.avviso-manuale\s*\{[^}]*\}/.exec(STILI_PESE)![0]
    expect(blocco).toContain('--stato-warn-bg')
    expect(blocco).toContain('--stato-warn-edge')
    expect(blocco).not.toMatch(/#[0-9a-f]{3,6}/i)
  })
})
