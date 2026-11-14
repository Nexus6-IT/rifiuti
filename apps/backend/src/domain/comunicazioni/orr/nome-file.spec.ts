import { codiceUnitaLocaleOrr, inizialeProvinciaOrr, meseOrr, nomeFileOrr } from './nome-file'
import { ATTIVITA_ORR, LETTERA_ATTIVITA_ORR, MESI_ORR } from './costanti'

describe('nome file O.R.R. (nomeFileOrr)', () => {
  it('esempio ricostruito: Napoli, sede 0001, gennaio 2025, trasportatore -> N0001GE25T.txt', () => {
    expect(nomeFileOrr('NA', '0001', 1, 2025, 'TRA')).toBe('N0001GE25T.txt')
  })

  it('le lettere dei mesi sono GE FE MR AP MG GI LU AG SE OT NO DI', () => {
    expect(MESI_ORR.join(' ')).toBe('GE FE MR AP MG GI LU AG SE OT NO DI')
    for (let m = 1; m <= 12; m += 1) expect(meseOrr(m)).toBe(MESI_ORR[m - 1])
    expect(() => meseOrr(0)).toThrow(RangeError)
    expect(() => meseOrr(13)).toThrow(RangeError)
  })

  it("le lettere delle attivita' sono T S D R F M A", () => {
    expect(ATTIVITA_ORR.map(a => LETTERA_ATTIVITA_ORR[a]).join('')).toBe('TSDRFMA')
    expect(nomeFileOrr('SA', '0012', 12, 2026, 'ROT')).toBe('S0012DI26M.txt')
    expect(nomeFileOrr('CE', '0003', 6, 2024, 'SMA')).toBe('C0003GI24D.txt')
  })

  it('le iniziali di provincia sono A B C N S', () => {
    expect(['AV', 'BN', 'CE', 'NA', 'SA'].map(inizialeProvinciaOrr).join('')).toBe('ABCNS')
    expect(inizialeProvinciaOrr(' na ')).toBe('N')
    expect(() => inizialeProvinciaOrr('MI')).toThrow('provincia non campana')
  })

  it('anno a due cifre e codice sede validati', () => {
    expect(nomeFileOrr('AV', '0100', 3, 2007, 'FRA')).toBe('A0100MR07F.txt')
    expect(() => nomeFileOrr('NA', '1', 1, 2025, 'TRA')).toThrow('codice sede')
    expect(() => nomeFileOrr('NA', '0001', 1, 25, 'TRA')).toThrow('anno')
  })
})

describe('INFERENZA codice sede (codiceUnitaLocaleOrr)', () => {
  it('progressivo MUD a 4 cifre, null se manca o non entra', () => {
    expect(codiceUnitaLocaleOrr(1)).toBe('0001')
    expect(codiceUnitaLocaleOrr(0)).toBe('0000')
    expect(codiceUnitaLocaleOrr(9999)).toBe('9999')
    expect(codiceUnitaLocaleOrr(10000)).toBeNull()
    expect(codiceUnitaLocaleOrr(null)).toBeNull()
    expect(codiceUnitaLocaleOrr(-1)).toBeNull()
  })
})
