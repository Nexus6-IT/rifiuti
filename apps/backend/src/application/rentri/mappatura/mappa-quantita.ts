/**
 * Conversioni delle quantita' del FIR verso `QuantitaModel` del contratto RENTRI
 * (`docs/contracts/rentri/formulari.yaml`): solo chilogrammi (`kg`) e litri (`l`), parte intera di 10
 * cifre e al massimo 4 decimali.
 *
 * Funzioni PURE e FAIL-CLOSED, come {@link mappaRifiuto}: un'unita' che non si traduce con certezza o un
 * valore fuori limite solleva {@link ValoreNonTraducibilePerRentriError}; niente ripieghi silenziosi.
 * L'arrotondamento a 4 decimali e' l'UNICA approssimazione ammessa ed e' esplicito (meta' verso l'alto).
 */
import { ValoreNonTraducibilePerRentriError } from './mappa-rifiuto'

/** `UnitaMisura` del contratto (`GET /codifiche/v1.0/unita-misura`). */
export type UnitaMisuraRentri = 'kg' | 'l'

/** `QuantitaModel` del contratto. */
export interface QuantitaRentri {
  valore: number
  unita_misura: UnitaMisuraRentri
}

/** Massimo del contratto: parte intera 10 cifre, parte decimale 4. */
export const QUANTITA_MASSIMA_RENTRI = 9999999999.9999
const DECIMALI_RENTRI = 4

const UNITA_AMMESSE: readonly string[] = ['kg', 'l']

/**
 * Tabella unita' -> (unita' del contratto, fattore). Il dominio usa `kg`/`litri`/`t`; i metri cubi non
 * sono un'unita' del FIR ma compaiono nei dati importati (WinWaste li moltiplica per 1000 e li invia in
 * litri): li accetta il convertitore, non il dominio.
 */
const CONVERSIONI: Readonly<Record<string, { unita: UnitaMisuraRentri; fattore: number }>> = {
  kg: { unita: 'kg', fattore: 1 },
  chilogrammi: { unita: 'kg', fattore: 1 },
  t: { unita: 'kg', fattore: 1000 },
  tonnellate: { unita: 'kg', fattore: 1000 },
  l: { unita: 'l', fattore: 1 },
  litri: { unita: 'l', fattore: 1 },
  m3: { unita: 'l', fattore: 1000 },
  'm³': { unita: 'l', fattore: 1000 },
  mc: { unita: 'l', fattore: 1000 },
}

function arrotondaA4Decimali(valore: number): number {
  // toPrecision(15) toglie i residui binari (1.15 * 1000 = 1149.9999999999998) prima dell'arrotondamento.
  const pulito = Number(valore.toPrecision(15))
  const fattore = 10 ** DECIMALI_RENTRI
  return Math.round(pulito * fattore) / fattore
}

/**
 * Traduce una quantita' del FIR in `QuantitaModel`.
 * @throws ValoreNonTraducibilePerRentriError per valore non positivo/non finito, unita' sconosciuta,
 *   risultato nullo dopo l'arrotondamento o oltre {@link QUANTITA_MASSIMA_RENTRI}.
 */
export function traduciQuantita(valore: number, unitaMisura: string): QuantitaRentri {
  const conversione = CONVERSIONI[unitaMisura?.trim().toLowerCase()]
  if (!conversione) {
    throw new ValoreNonTraducibilePerRentriError('unita_misura', unitaMisura, UNITA_AMMESSE)
  }
  if (typeof valore !== 'number' || !Number.isFinite(valore) || valore <= 0) {
    throw new ValoreNonTraducibilePerRentriError('quantita', String(valore), [
      'un numero maggiore di zero',
    ])
  }

  const convertito = arrotondaA4Decimali(valore * conversione.fattore)
  if (convertito <= 0) {
    throw new ValoreNonTraducibilePerRentriError('quantita', String(valore), [
      `almeno 0,0001 ${conversione.unita}`,
    ])
  }
  if (convertito > QUANTITA_MASSIMA_RENTRI) {
    throw new ValoreNonTraducibilePerRentriError('quantita', String(valore), [
      `al massimo ${QUANTITA_MASSIMA_RENTRI} ${conversione.unita}`,
    ])
  }
  return { valore: convertito, unita_misura: conversione.unita }
}

const PATTERN_HP = /^HP\s*(\d{1,2})$/i

/**
 * Normalizza le classi di pericolo del FIR (`wasteHazardClasses`, testo separato da virgole o `;`, es.
 * `HP4,HP14`) nel formato `HPnn` del contratto (`HP01`-`HP15`), senza duplicati e nell'ordine dato.
 * Restituisce `undefined` se non c'e' nessuna classe; classi fuori da HP01-HP15 sono un errore.
 */
export function normalizzaCaratteristichePericolo(
  testo: string | null | undefined
): string[] | undefined {
  if (!testo || testo.trim() === '') return undefined

  const risultato: string[] = []
  for (const grezzo of testo.split(/[,;]/)) {
    const voce = grezzo.trim()
    if (voce === '') continue
    const corrispondenza = PATTERN_HP.exec(voce)
    const numero = corrispondenza ? Number(corrispondenza[1]) : NaN
    if (!corrispondenza || numero < 1 || numero > 15) {
      throw new ValoreNonTraducibilePerRentriError('caratteristiche_pericolo', voce, [
        'HP01',
        '...',
        'HP15',
      ])
    }
    const codice = `HP${String(numero).padStart(2, '0')}`
    if (!risultato.includes(codice)) risultato.push(codice)
  }
  return risultato.length > 0 ? risultato : undefined
}
