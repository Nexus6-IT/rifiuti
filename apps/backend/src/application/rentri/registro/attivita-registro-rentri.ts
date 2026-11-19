/**
 * Attivita' e codici di recupero/smaltimento ammessi per un registro RENTRI
 * (`CreateRegistroRequest`, anagrafiche.yaml). Gli stessi valori sono nei CHECK di
 * `registri_rifiuti` (migration 20261121100000) e nel dialog del frontend.
 */
export const ATTIVITA_REGISTRO_RENTRI = [
  'CentroRaccolta',
  'Produzione',
  'Recupero',
  'Smaltimento',
  'Trasporto',
  'IntermediazioneSenzaDetenzione',
] as const

export const CODICI_RECUPERO_SMALTIMENTO_RENTRI: readonly string[] = [
  ...Array.from({ length: 13 }, (_, i) => `R${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `D${i + 1}`),
]

export const LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI = 250

export interface AttivitaRegistroRentri {
  attivita: string[]
  attivitaRecSmalt: string[]
}

/** Esito del controllo: `null` se valido, altrimenti il motivo (italiano, per l'utente). */
export function motivoAttivitaNonValide(dati: AttivitaRegistroRentri): string | null {
  const { attivita, attivitaRecSmalt } = dati
  if (attivita.length === 0) return "Indica almeno un'attività del registro."
  if (new Set(attivita).size !== attivita.length) return 'Le attività non possono essere ripetute.'
  if (!attivita.every(a => (ATTIVITA_REGISTRO_RENTRI as readonly string[]).includes(a))) {
    return 'Una delle attività indicate non è valida.'
  }
  if (new Set(attivitaRecSmalt).size !== attivitaRecSmalt.length) {
    return 'I codici di recupero e smaltimento non possono essere ripetuti.'
  }
  if (!attivitaRecSmalt.every(c => CODICI_RECUPERO_SMALTIMENTO_RENTRI.includes(c))) {
    return 'Uno dei codici di recupero o smaltimento non è valido (R1-R13, D1-D15).'
  }
  const serveCodici = attivita.includes('Recupero') || attivita.includes('Smaltimento')
  if (serveCodici && attivitaRecSmalt.length === 0) {
    return 'Per Recupero e Smaltimento indica almeno un codice (R1-R13, D1-D15).'
  }
  if (!serveCodici && attivitaRecSmalt.length > 0) {
    return 'I codici R/D si indicano solo con Recupero o Smaltimento.'
  }
  return null
}

/**
 * Attivita' lette da RENTRI, pronte per essere salvate. Se i valori non rispettano i vincoli
 * locali (attivita' nuove del contratto, Recupero senza codici accettato con `forza`) il dettaglio
 * si considera non noto: liste vuote, mai un errore.
 */
export function attivitaDaRentri(
  attivita: readonly unknown[] | null | undefined,
  attivitaRecSmalt: readonly unknown[] | null | undefined
): AttivitaRegistroRentri {
  const testi = (v: readonly unknown[] | null | undefined): string[] =>
    (v ?? []).filter((x): x is string => typeof x === 'string')
  const dati = { attivita: testi(attivita), attivitaRecSmalt: testi(attivitaRecSmalt) }
  return motivoAttivitaNonValide(dati) === null ? dati : { attivita: [], attivitaRecSmalt: [] }
}
