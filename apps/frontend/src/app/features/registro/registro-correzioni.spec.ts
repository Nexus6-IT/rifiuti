import {
  annotazioneExport,
  eVigente,
  motivoErroreLeggibile,
  statoExport,
  testoAnnotazione,
  testoCorrezione,
  testoEsitoVerifica,
} from './registro-correzioni'
import { giornoLocale, dataDaGiorno, opzioniUnita, opzioniCausali } from './registro-opzioni'
import { Movimento } from './registro.service'

const rif = (n: number, a = 2026) => ({
  progressiveNumber: n,
  progressiveYear: a,
  tipoAnnotazione: 'RETTIFICA' as const,
})

describe('registro-correzioni', () => {
  it('scrive i riferimenti come numero/anno', () => {
    expect(testoCorrezione({ stato: 'RETTIFICATO', correttoDa: rif(14) })).toBe(
      'Rettificato da 14/2026'
    )
    expect(testoCorrezione({ stato: 'ANNULLATO' })).toBe('Annullato')
    expect(testoCorrezione({ stato: 'VIGENTE' })).toBeNull()
    expect(testoAnnotazione({ tipoAnnotazione: 'RETTIFICA', rettificaDi: rif(3, 2025) })).toBe(
      'Rettifica di 3/2025'
    )
    expect(testoAnnotazione({ tipoAnnotazione: 'ANNULLAMENTO', rettificaDi: rif(9) })).toBe(
      'Annullamento di 9/2026'
    )
    expect(testoAnnotazione({ tipoAnnotazione: 'ORDINARIA' })).toBeNull()
    expect(testoAnnotazione({})).toBeNull()
  })

  it('un movimento senza stato è vigente', () => {
    expect(eVigente({})).toBeTrue()
    expect(eVigente({ stato: 'VIGENTE' })).toBeTrue()
    expect(eVigente({ stato: 'RETTIFICATO' })).toBeFalse()
    expect(eVigente({ stato: 'ANNULLATO' })).toBeFalse()
  })

  it('export: Ordinaria / Rettifica di / Annullamento di e Vigente / Rettificato / Annullato', () => {
    const m = {
      tipoAnnotazione: 'RETTIFICA',
      rettificaDi: rif(5),
      stato: 'RETTIFICATO',
    } as Movimento
    expect(annotazioneExport(m)).toBe('Rettifica di 5/2026')
    expect(statoExport(m)).toBe('Rettificato')
    expect(annotazioneExport({} as Movimento)).toBe('Ordinaria')
    expect(statoExport({} as Movimento)).toBe('Vigente')
  })

  it('esito della verifica: integra o prima anomalia', () => {
    const base = {
      registroId: 'r',
      anno: 2026,
      verificate: 12,
      nonVerificabili: [],
      primoErrore: null,
    }
    expect(testoEsitoVerifica(base)).toBe(
      '12 annotazioni verificate, nessuna alterazione (0 storiche non verificabili)'
    )
    expect(testoEsitoVerifica({ ...base, primoErrore: { numero: 4, motivo: 'BUCO' } })).toBe(
      "Anomalia all'annotazione 4/2026: manca un numero nella sequenza del registro"
    )
    expect(motivoErroreLeggibile('VERSIONE_SCONOSCIUTA')).toContain('versione')
    expect(motivoErroreLeggibile('ALTRO')).toBe('ALTRO')
  })
})

describe('registro-opzioni', () => {
  it('giorno locale: nessuno spostamento di fuso e andata e ritorno', () => {
    expect(giornoLocale(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(giornoLocale(dataDaGiorno('2026-10-20T00:00:00.000Z')!)).toBe('2026-10-20')
    expect(giornoLocale(dataDaGiorno('2026-12-31')!)).toBe('2026-12-31')
    expect(dataDaGiorno('boh')).toBeNull()
  })

  it('unità e causali', () => {
    expect(opzioniUnita('kg').map(o => o.value)).toEqual(['KG', 'T', 'M3'])
    expect(opzioniUnita('MC').map(o => o.value)).toEqual(['KG', 'T', 'M3', 'MC'])
    expect(opzioniCausali('CARICO').map(o => o.value)).toContain('PRODUZIONE_INTERNA')
    expect(opzioniCausali('SCARICO').map(o => o.value)).not.toContain('PRODUZIONE_INTERNA')
  })
})
