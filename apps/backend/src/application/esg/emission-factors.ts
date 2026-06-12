/**
 * Fattori di CO₂ evitata per il recupero dei rifiuti.
 *
 * Stima della CO₂ equivalente **evitata** (kg CO₂e) per ogni kg di rifiuto
 * avviato a **recupero** anziché a smaltimento, per capitolo CER (prime 2 cifre).
 *
 * ⚠️ VALORI INDICATIVI / CONFIGURABILI: sono ordini di grandezza per abilitare
 * il reporting ESG. Prima di un uso in rendicontazione ufficiale (CSRD/VSME)
 * vanno sostituiti con i **fattori ufficiali ISPRA/EPA** per materiale.
 */
export const CO2_AVOIDED_FACTOR_BY_CHAPTER: Readonly<Record<string, number>> = {
  '15': 1.2, // imballaggi (carta, plastica, vetro, metallo, legno)
  '16': 1.0, // rifiuti non specificati (apparecchiature, veicoli, ecc.)
  '17': 0.05, // costruzione e demolizione (inerti, basso beneficio per kg)
  '19': 0.4, // rifiuti da impianti di trattamento/recupero
  '20': 0.8, // rifiuti urbani e assimilati (raccolta differenziata)
}

/** Fattore di default quando il capitolo CER non è mappato (kg CO₂e/kg). */
export const DEFAULT_CO2_AVOIDED_FACTOR = 0.5

/** Normalizza un codice CER/EER a sole cifre (rimuove spazi e asterisco). */
export function normalizeCer(cerCode: string): string {
  return (cerCode || '').replace(/[^0-9]/g, '')
}

/**
 * Fattore di CO₂ evitata (kg CO₂e per kg recuperato) per un dato codice CER,
 * basato sul capitolo (prime 2 cifre); fallback al valore di default.
 */
export function co2FactorForCer(cerCode: string): number {
  const chapter = normalizeCer(cerCode).slice(0, 2)
  return CO2_AVOIDED_FACTOR_BY_CHAPTER[chapter] ?? DEFAULT_CO2_AVOIDED_FACTOR
}
