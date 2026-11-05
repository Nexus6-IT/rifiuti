/** Costanti fiscali della fatturazione (fase 4.4). Importi come stringhe decimali. */

/** Il bollo e dovuto oltre questo importo (DPR 642/1972, tariffa art. 13). */
export const SOGLIA_BOLLO = '77.47'

/**
 * Nature IVA soggette a bollo (DPR 642/1972, tariffa art. 13): N1, N2.1, N2.2, N3.5, N3.6, N4.
 * Ampliarla e un cambio esplicito: c'e una guardia nel test.
 */
export const NATURE_SOGGETTE_BOLLO: readonly string[] = ['N1', 'N2.1', 'N2.2', 'N3.5', 'N3.6', 'N4']

/** Nature generiche vietate nell'XML corrente: servono i sottocodici (N2.x, N3.x, N6.x). */
export const NATURE_NON_AMMESSE: readonly string[] = ['N2', 'N3', 'N6']

const BOLLO_IMPORTO_DAL = '2013-06-26'
const BOLLO_IMPORTO = '2.00'

/**
 * Importo del bollo virtuale alla data (AAAA-MM-GG): 2,00 euro dal 26/06/2013.
 * Per date precedenti l'importo era diverso e non e gestito: errore.
 */
export function importoBolloAl(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error('Data non valida per il bollo: atteso AAAA-MM-GG.')
  }
  if (data < BOLLO_IMPORTO_DAL) {
    throw new Error('Importo del bollo non gestito per date anteriori al 26/06/2013.')
  }
  return BOLLO_IMPORTO
}

/**
 * Valori dell'enumerazione RegimeFiscale dell'XSD FatturaPA vigente: RF01, RF02, RF04-RF20,
 * senza RF03 (non piu presente). Il Task 16 prova che coincide con l'XSD.
 */
export const REGIMI_FISCALI: readonly string[] = [
  'RF01',
  'RF02',
  ...Array.from({ length: 17 }, (_, i) => `RF${String(i + 4).padStart(2, '0')}`),
]

/** Tipi riga di addebito che il calcolo sa fare (decisioni 2 e 17). `M<cat>` = M + 3 cifre. */
export const FAMIGLIE_CALCOLATE: readonly string[] = [
  'CER',
  'V',
  'F',
  'MW',
  'MF',
  'M<cat>',
  'TT',
  'TF',
]

const FAMIGLIE_FISSE = new Set(['CER', 'V', 'F', 'MW', 'MF', 'TT', 'TF'])
const FAMIGLIE_PREZZO_SPECIALE = new Set(['CER', 'V'])
const APPLICA_A_PREZZO_SPECIALE = new Set(['DOCUMENTO', 'PERIODO'])

/**
 * Vero se WasteFlow calcola la riga di addebito (spec §6.6, decisione 17). Le altre famiglie
 * (TS, TP, TQ, TR, T<cat>, N..., $..., regole PROGRESSIVO_DA_DATA, CONGUAGLIO_365, GIORNO,
 * condizionate, TT/TF a prezzo speciale) danno FAMIGLIA_NON_CALCOLATA.
 */
export function famigliaCalcolata(r: {
  tipo: string
  prezzoSpeciale: boolean
  applicaA: string | null
  condizione: number | null
  condizioniRiferite: string | null
}): boolean {
  if (r.condizione !== null) return false
  if (r.condizioniRiferite !== null && r.condizioniRiferite.trim() !== '') return false
  const tipoNoto = FAMIGLIE_FISSE.has(r.tipo) || /^M\d{3}$/.test(r.tipo)
  if (!tipoNoto) return false
  if (r.prezzoSpeciale) {
    return (
      FAMIGLIE_PREZZO_SPECIALE.has(r.tipo) &&
      r.applicaA !== null &&
      APPLICA_A_PREZZO_SPECIALE.has(r.applicaA)
    )
  }
  return true
}

/**
 * Tolleranze dei controlli SDI sugli importi (scarti 00421 PrezzoTotale, 00423 Imposta,
 * 00422 ImponibileImporto), dalle specifiche tecniche FatturaPA: 0,01 euro sul prezzo totale e
 * sull'imposta, 1,00 euro sull'imponibile del riepilogo. Valori da riverificare sulle specifiche
 * SDI vigenti prima del rilascio.
 */
export const TOLLERANZE_SDI = { prezzoTotale: '0.01', imposta: '0.01', imponibile: '1.00' } as const
