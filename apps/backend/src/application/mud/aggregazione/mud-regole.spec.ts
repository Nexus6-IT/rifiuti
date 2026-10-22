import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import {
  classificaMovimento,
  hashAggregato,
  limitiAnnoMud,
  operazioneDaCausale,
  operazioneDaCodice,
} from './mud-regole'

describe('limitiAnnoMud', () => {
  it("limitiAnnoMud usa l'anno solare italiano", () => {
    const { inizio, fine } = limitiAnnoMud(2025)
    expect(inizio.toISOString()).toBe('2024-12-31T23:00:00.000Z')
    expect(fine.toISOString()).toBe('2025-12-31T23:00:00.000Z')
    const dentro = (d: Date) => d >= inizio && d < fine
    expect(dentro(new Date('2025-12-31T22:30:00Z'))).toBe(true) // 31/12 23:30 a Roma
    expect(dentro(new Date('2025-12-31T23:30:00Z'))).toBe(false) // 1/1/2026 00:30 a Roma
    expect(dentro(new Date('2024-12-31T23:00:00Z'))).toBe(true) // 1/1/2025 00:00 a Roma
  })
  it.each([2024, 2025, 2026, 2030])('limitiAnnoMud coincide con annoSolareItaliano (%i)', anno => {
    const { inizio, fine } = limitiAnnoMud(anno)
    expect(annoSolareItaliano(inizio)).toBe(anno)
    expect(annoSolareItaliano(new Date(inizio.getTime() - 1))).toBe(anno - 1)
    expect(annoSolareItaliano(new Date(fine.getTime() - 1))).toBe(anno)
    expect(annoSolareItaliano(fine)).toBe(anno + 1)
  })
})

describe('classificaMovimento', () => {
  it.each([
    ['CARICO', 'PRODUZIONE_INTERNA', 'PRODOTTO'],
    ['CARICO', 'RECUPERO_PARZIALE', 'PRODOTTO'],
    ['CARICO', 'INGRESSO_ESTERNO', 'RICEVUTO_DA_TERZI'],
    ['CARICO', 'RICLASSIFICAZIONE', 'ESCLUSO'],
    ['CARICO', 'ALTRO_CARICO', 'ESCLUSO'],
    ['SCARICO', 'CONFERIMENTO_TRASPORTATORE', 'AVVIATO'],
    ['SCARICO', 'AVVIO_RECUPERO', 'AVVIATO'],
    ['SCARICO', 'AVVIO_SMALTIMENTO', 'AVVIATO'],
    ['SCARICO', 'CESSIONE', 'AVVIATO'],
    ['SCARICO', 'RICLASSIFICAZIONE', 'ESCLUSO'],
    ['SCARICO', 'ALTRO_SCARICO', 'ESCLUSO'],
    ['SCARICO', 'CAUSALE_SCONOSCIUTA', 'ESCLUSO'],
  ])('%s %s → %s', (type, causale, atteso) => {
    expect(classificaMovimento(type as 'CARICO' | 'SCARICO', causale)).toBe(atteso)
  })
})

describe('operazione R/D', () => {
  it('dal codice operazione', () => {
    expect(operazioneDaCodice('R13')).toBe('R')
    expect(operazioneDaCodice(' d15')).toBe('D')
    expect(operazioneDaCodice('')).toBeUndefined()
    expect(operazioneDaCodice(null)).toBeUndefined()
    expect(operazioneDaCodice('X1')).toBeUndefined()
  })
  it('dalla causale', () => {
    expect(operazioneDaCausale('AVVIO_RECUPERO')).toBe('R')
    expect(operazioneDaCausale('AVVIO_SMALTIMENTO')).toBe('D')
    expect(operazioneDaCausale('CONFERIMENTO_TRASPORTATORE')).toBeUndefined()
  })
})

describe('hashAggregato', () => {
  const riga = (cer: string, kg: number) => ({
    cerCode: cer,
    prodottoKg: kg,
    recuperoKg: 0,
    smaltimentoKg: kg,
    dr: [],
    te: [],
  })
  it("non dipende dall'ordine delle righe", () => {
    expect(hashAggregato([riga('170405', 1), riga('150101', 2)])).toBe(
      hashAggregato([riga('150101', 2), riga('170405', 1)])
    )
  })
  it('cambia se cambia una quantità', () => {
    expect(hashAggregato([riga('170405', 1)])).not.toBe(hashAggregato([riga('170405', 1.001)]))
  })
  it("non dipende dall'ordine di dr e te", () => {
    const a = { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 1 }
    const b = { codiceFiscale: '222', ragioneSociale: 'B', quantitaKg: 2 }
    const t1 = { codiceFiscale: '333', ragioneSociale: 'C' }
    const t2 = { codiceFiscale: '333', ragioneSociale: 'D' }
    const base = { cerCode: '170405', prodottoKg: 3, recuperoKg: 0, smaltimentoKg: 3 }
    expect(hashAggregato([{ ...base, dr: [a, b], te: [t1, t2] }])).toBe(
      hashAggregato([{ ...base, dr: [b, a], te: [t2, t1] }])
    )
  })
  it('ignora le differenze oltre il terzo decimale', () => {
    expect(hashAggregato([riga('170405', 1.0001)])).toBe(hashAggregato([riga('170405', 1)]))
  })
  it('è un SHA-256 esadecimale', () => {
    expect(hashAggregato([])).toMatch(/^[0-9a-f]{64}$/)
  })
})
