import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import type { MudModuloGestione } from '../export/mud-export.types'
import {
  classificaMovimento,
  hashAggregato,
  limitiAnnoMud,
  operazioneDaCausale,
  operazioneDaCodice,
  statoFisicoMud,
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
  it("non dipende dall'ordine di rt, re, mg e dei dr a parità di chiave", () => {
    const base = { cerCode: '170405', prodottoKg: 3, recuperoKg: 0, smaltimentoKg: 3, te: [] }
    const dr = [
      { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 1 },
      { codiceFiscale: '111', ragioneSociale: 'A', quantitaKg: 2 },
    ]
    const rt = [
      { codiceFiscale: '222', ragioneSociale: 'B', quantitaKg: 1 },
      { codiceFiscale: '111', ragioneSociale: 'C', quantitaKg: 5 },
    ]
    const re = [
      { istatProvincia: '001', istatComune: '002', quantitaKg: 1 },
      { istatProvincia: '001', istatComune: '002', quantitaKg: 4 },
    ]
    const mg = [{ tipologiaImpianto: 21 }, { tipologiaImpianto: 22 }] as MudModuloGestione[]
    const invertita = {
      ...base,
      dr: [...dr].reverse(),
      rt: [...rt].reverse(),
      re: [...re].reverse(),
      mg: [...mg].reverse(),
    }
    expect(hashAggregato([{ ...base, dr, rt, re, mg }])).toBe(hashAggregato([invertita]))
  })
  it('righe con lo stesso cerCode: ordine di lettura irrilevante', () => {
    const a = riga('170405', 1)
    const b = riga('170405', 2)
    expect(hashAggregato([a, b])).toBe(hashAggregato([b, a]))
  })
  it('ignora le differenze oltre il terzo decimale', () => {
    expect(hashAggregato([riga('170405', 1.0001)])).toBe(hashAggregato([riga('170405', 1)]))
  })
  it('è un SHA-256 esadecimale', () => {
    expect(hashAggregato([])).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('statoFisicoMud', () => {
  it.each([
    ['Solido', 'SOLIDO_NON_POLVERULENTO'],
    ['  LIQUIDO ', 'LIQUIDO'],
    ['Polvere', 'SOLIDO_POLVERULENTO'],
    ['polverulento', 'SOLIDO_POLVERULENTO'],
    ['Fangoso', 'FANGOSO_PALABILE'],
    ['Gassoso', 'AERIFORME'],
    ['Misto', 'ALTRO'],
    ['Vischioso', 'VISCHIOSO_SCIROPPOSO'],
    ['vischioso sciropposo', 'VISCHIOSO_SCIROPPOSO'],
    ['Viscoso-sciropposo', 'VISCHIOSO_SCIROPPOSO'],
    ['Aeriforme', 'AERIFORME'],
    ['Solido polverulento', 'SOLIDO_POLVERULENTO'],
    ['In polvere o pulverulento', 'SOLIDO_POLVERULENTO'],
    ['Solido non polverulento', 'SOLIDO_NON_POLVERULENTO'],
    ['FANGOSO_PALABILE', 'FANGOSO_PALABILE'],
    ['Fangoso palabile', 'FANGOSO_PALABILE'],
    ['Altro', 'ALTRO'],
    ['Rifiuto strano', 'NON_RICONOSCIUTO'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('statoFisicoMud(%j) -> %j', (valore, atteso) => {
    expect(statoFisicoMud(valore)).toBe(atteso)
  })
})
