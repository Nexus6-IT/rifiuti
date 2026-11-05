/** Costanti fiscali della fatturazione (fase 4.4). Importi come stringhe decimali. */

/** Il bollo è dovuto oltre questo importo (DPR 642/1972, tariffa parte I, art. 13, nota 1). */
export const SOGLIA_BOLLO = '77.47'

/**
 * Nature IVA soggette a bollo (DPR 642/1972, tariffa art. 13): N1, N2.1, N2.2, N3.5, N3.6, N4.
 * Ampliarla è un cambio esplicito: c'è una guardia nel test.
 * Da confermare col commercialista: N1 non compare nella procedura bollo dell'Agenzia delle
 * Entrate (provvedimento 34958 del 04/02/2021, Allegato A), che usa N2.1, N2.2, N3.5, N3.6, N4.
 * La riga BOLLO addebitata ha natura N1 e non deve entrare nella base della soglia (calcolo
 * circolare): lo verifica il task iva-bollo.
 */
export const NATURE_SOGGETTE_BOLLO: readonly string[] = ['N1', 'N2.1', 'N2.2', 'N3.5', 'N3.6', 'N4']

/** Nature generiche vietate nell'XML corrente: servono i sottocodici (N2.x, N3.x, N6.x). */
export const NATURE_NON_AMMESSE: readonly string[] = ['N2', 'N3', 'N6']

const BOLLO_IMPORTO_DAL = '2013-06-26'
const BOLLO_IMPORTO = '2.00'

function dataEsistente(data: string): boolean {
  const [a, m, g] = data.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, g))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g
}

/**
 * Importo del bollo virtuale alla data (AAAA-MM-GG): 2,00 euro dal 26/06/2013.
 * Per date precedenti l'importo era diverso e non e gestito: errore.
 */
export function importoBolloAl(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !dataEsistente(data)) {
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

const SEGNAPOSTO_MINIMO_CATEGORIA = 'M<cat>'
/** Forma di `M<cat>`: M + 3 cifre (come in listino/tipi-addebito.ts). */
const FORMA_MINIMO_CATEGORIA = /^M\d{3}$/
/** Tipi letterali: derivati da FAMIGLIE_CALCOLATE, unica fonte di verità. */
const TIPI_CALCOLATI_LETTERALI: ReadonlySet<string> = new Set(
  FAMIGLIE_CALCOLATE.filter(f => f !== SEGNAPOSTO_MINIMO_CATEGORIA)
)
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
  const tipoNoto = TIPI_CALCOLATI_LETTERALI.has(r.tipo) || FORMA_MINIMO_CATEGORIA.test(r.tipo)
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
 * Tolleranze dei controlli SDI sugli importi (Allegato A, Specifiche tecniche FatturaPA, v1.7.1,
 * §2.2.1.11, §2.2.2.5-2.2.2.6 ed elenco dei controlli): il file si scarta se la differenza è
 * SUPERIORE alla tolleranza, quindi si accetta |differenza| <= tolleranza.
 * - 00423 PrezzoTotale = (PrezzoUnitario ± ScontoMaggiorazione) × Quantita: ±0,01 €
 * - 00422 ImponibileImporto = Σ PrezzoTotale + Σ ImportoContributoCassa + Σ Arrotondamento: ±1,00 €
 * - 00421 Imposta = arrotondamento a 2 decimali (5 per eccesso) di AliquotaIVA × ImponibileImporto / 100: ±0,01 €
 */
export const TOLLERANZE_SDI = { prezzoTotale: '0.01', imposta: '0.01', imponibile: '1.00' } as const
