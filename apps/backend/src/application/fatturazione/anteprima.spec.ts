import { calcolaBozze, costruisciRiepilogo, eViolazioneUnica } from './anteprima'
import { Prisma } from '@prisma/client'
import {
  azzeraContatoreLegami,
  contrattoDi,
  inputDocumentoDi,
  legameDi,
  listinoDi,
} from '../../test-support/calcolo-fatturazione-di-test'
import type { FotografiaDocumento } from '../../domain/fatturazione/tipi'
import type { DocumentoSelezionato } from './selezione-fatturazione'

const FOTO = {} as FotografiaDocumento

function selezionato(
  registroIvaId: string | null,
  o: { contrattoNumero?: string; senzaBanca?: boolean; senzaCondizione?: boolean } = {}
): DocumentoSelezionato {
  const rigaCer = listinoDi({ id: 'r1', tipo: 'CER', prezzo: '0.1' })
  return {
    chiave: `c-${registroIvaId}-${o.contrattoNumero ?? '1'}`,
    contrattoId: `contratto-${o.contrattoNumero ?? '1'}`,
    contrattoNumero: o.contrattoNumero ?? '1',
    elencoId: null,
    clienteId: 'cli',
    clienteFatturazioneId: 'cli',
    denominazione: 'Cliente SRL',
    registroIvaId,
    periodo: { dal: '2026-11-01', al: '2026-11-30' },
    input: inputDocumentoDi({
      contratto: contrattoDi({
        registroIvaId,
        condizione: o.senzaCondizione
          ? null
          : { modalita: 'MP08', giorniRate: [30], fineMese: false },
      }),
      righeListino: [rigaCer],
      legami: [legameDi({ rigaAddebitoId: 'r1' })],
    }),
    fotografia: FOTO,
  }
}

describe('calcolaBozze', () => {
  beforeEach(azzeraContatoreLegami)

  it('un documento senza registro non diventa bozza: finisce in documentiNonGenerati con SENZA_REGISTRO_IVA', () => {
    const { bozze, nonGenerati } = calcolaBozze([
      selezionato('REG1'),
      selezionato(null, { contrattoNumero: '2' }),
    ])
    expect(bozze).toHaveLength(1)
    expect(nonGenerati).toHaveLength(1)
    expect(nonGenerati[0]).toMatchObject({ contrattoNumero: '2', denominazione: 'Cliente SRL' })
    expect(nonGenerati[0].errori.map(e => e.codice)).toContain('SENZA_REGISTRO_IVA')
    // Una sola voce SENZA_REGISTRO_IVA, anche se il calcolo l'ha gia' prodotta.
    expect(nonGenerati[0].errori.filter(e => e.codice === 'SENZA_REGISTRO_IVA')).toHaveLength(1)
  })

  it('ogni bozza ha un id proprio', () => {
    const { bozze } = calcolaBozze([
      selezionato('REG1'),
      selezionato('REG1', { contrattoNumero: '2' }),
    ])
    expect(new Set(bozze.map(b => b.id)).size).toBe(2)
  })
})

describe('costruisciRiepilogo', () => {
  beforeEach(azzeraContatoreLegami)

  const contesto = (ultimo: number, suffisso: string | null) => ({
    codiciRegistro: new Map([
      ['REG1', '01'],
      ['REG2', '02'],
    ]),
    ultimoNumero: new Map([['reg1:2026', ultimo]]),
    suffissi: new Map<string, string | null>([['reg1:2026', suffisso]]),
  })

  it('numerazione prevista «da 15/A a 17/A»: solo i documenti senza errori, nessuna riserva', () => {
    const { bozze, nonGenerati } = calcolaBozze([
      selezionato('REG1'),
      selezionato('REG1', { contrattoNumero: '2' }),
      selezionato('REG1', { contrattoNumero: '3' }),
      selezionato('REG1', { contrattoNumero: '4', senzaCondizione: true }),
    ])
    const r = costruisciRiepilogo(bozze, nonGenerati, [], 2026, contesto(14, '/A'))
    expect(r.numerazionePrevista).toEqual([
      { registroIvaId: 'REG1', codiceRegistro: '01', da: '15/A', a: '17/A' },
    ])
    expect(r.documenti).toBe(4)
    expect(r.errori).toBe(1)
  })

  it('totali per registro e totale generale sono somme esatte a due decimali', () => {
    const { bozze, nonGenerati } = calcolaBozze([
      selezionato('REG2'),
      selezionato('REG1'),
      selezionato('REG1', { contrattoNumero: '2' }),
    ])
    const r = costruisciRiepilogo(bozze, nonGenerati, [], 2026, contesto(0, null))
    expect(r.totaliPerRegistro.map(t => t.registroIvaId)).toEqual(['REG1', 'REG2'])
    const somma = bozze.reduce((s, b) => s.plus(b.calcolato.totaleDocumento), new Prisma.Decimal(0))
    expect(r.totale).toBe(somma.toFixed(2))
    expect(r.totaliPerRegistro[0].totale).toBe(
      new Prisma.Decimal(bozze[1].calcolato.totaleDocumento).times(2).toFixed(2)
    )
    expect(r.numerazionePrevista[0]).toMatchObject({ da: '1', a: '2' })
  })

  it('i documenti non generati contano negli errori', () => {
    const { bozze, nonGenerati } = calcolaBozze([selezionato(null)])
    const r = costruisciRiepilogo(bozze, nonGenerati, [], 2026, contesto(0, null))
    expect(r).toMatchObject({ documenti: 0, errori: 1, totale: '0.00', numerazionePrevista: [] })
    expect(r.documentiNonGenerati).toHaveLength(1)
  })
})

describe('eViolazioneUnica', () => {
  const errore = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '5', meta })

  it('riconosce P2002 e il 23505 di una query raw (P2010)', () => {
    expect(eViolazioneUnica(errore('P2002'))).toBe(true)
    expect(eViolazioneUnica(errore('P2010', { code: '23505' }))).toBe(true)
  })
  it('non confonde gli altri errori', () => {
    expect(eViolazioneUnica(errore('P2010', { code: '40001' }))).toBe(false)
    expect(eViolazioneUnica(errore('P2025'))).toBe(false)
    expect(eViolazioneUnica(new Error('23505'))).toBe(false)
  })
})
