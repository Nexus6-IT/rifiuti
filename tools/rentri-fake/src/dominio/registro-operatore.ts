import { SCHEMA_CREA_REGISTRO, DEFINIZIONI_CREA_REGISTRO } from './schema-crea-registro'
import {
  SCHEMA_MODIFICA_REGISTRO,
  DEFINIZIONI_MODIFICA_REGISTRO,
} from './schema-modifica-registro'
import { creaValidatoreContratto } from './validatore-contratto'
import type { SitoFixture } from '../stato/fixture-anagrafiche'

/**
 * Validazione dei corpi di `POST /operatore/registri` (`CreateRegistroRequest`)
 * e `PUT /operatore/registri/{identificativo}` (`UpdateRegistroOperatoreRequest`)
 * contro lo schema del contratto ufficiale `anagrafiche.yaml`, copiato verbatim
 * (v. `npm run genera-schema:crea-registro` / `:modifica-registro`).
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 * Le regole di dominio che il contratto descrive solo a parole (coerenza con le
 * attivita' dell'unita' locale, codici di recupero/smaltimento dichiarati) stanno
 * in {@link verificaCoerenzaAttivita}.
 */
export const validaCreaRegistro = creaValidatoreContratto(
  SCHEMA_CREA_REGISTRO,
  DEFINIZIONI_CREA_REGISTRO
)
export const validaModificaRegistro = creaValidatoreContratto(
  SCHEMA_MODIFICA_REGISTRO,
  DEFINIZIONI_MODIFICA_REGISTRO
)

const ATTIVITA_CON_OPERAZIONI = ['Recupero', 'Smaltimento']

/** Il registro ha almeno un'attivita' che richiede i codici R/D? */
export function richiedeOperazioniRecuperoSmaltimento(attivita: readonly string[]): boolean {
  return attivita.some(a => ATTIVITA_CON_OPERAZIONI.includes(a))
}

/** Codici R/D dichiarati per l'unita' locale in fase di iscrizione (unione delle autorizzazioni). */
function codiciDichiarati(sito: SitoFixture): Set<string> {
  return new Set(sito.autorizzazioni.flatMap(a => a.attivitaRecuperoSmaltimento))
}

/**
 * Regole descritte dal contratto nei campi `attivita` e `attivita_rec_smalt`
 * (`anagrafiche.yaml`, `CreateRegistroRequest`):
 *
 * - `attivita` deve contenere almeno un'attivita' prevista dall'unita' locale
 *   (lettura LETTERALE del contratto: le altre non sono rifiutate);
 * - `attivita_rec_smalt` e' richiesto se `attivita` contiene Recupero o
 *   Smaltimento, e i codici devono essere fra quelli dichiarati per l'unita'
 *   locale; `forza` (= `forza_salvataggio_attivita_rec_smalt`) salta solo il
 *   confronto coi codici dichiarati, non l'obbligo di indicarli;
 * - DIVERGENZA RESTRITTIVA dichiarata: `attivita_rec_smalt` valorizzato senza
 *   Recupero/Smaltimento e' rifiutato (il contratto dice "richiesto solamente
 *   se", non che il resto vada vietato).
 *
 * `attivita` e' quella del registro (alla creazione quella del corpo, alla
 * modifica quella gia' memorizzata: il PUT non la puo' cambiare).
 */
export function verificaCoerenzaAttivita(
  sito: SitoFixture,
  attivita: readonly string[],
  attivitaRecSmalt: readonly string[] | null | undefined,
  opzioni: { controllaAttivitaSito: boolean; forza: boolean }
): string | null {
  if (opzioni.controllaAttivitaSito && !attivita.some(a => sito.attivita.includes(a))) {
    return `Nessuna delle attivita' indicate e' prevista dall'unita' locale ${sito.numIscrSito}.`
  }

  const codici = attivitaRecSmalt ?? []
  if (richiedeOperazioniRecuperoSmaltimento(attivita)) {
    if (codici.length === 0) {
      return "Campo 'attivita_rec_smalt' obbligatorio se le attivita' comprendono Recupero o Smaltimento."
    }
    if (!opzioni.forza) {
      const dichiarati = codiciDichiarati(sito)
      const nonDichiarati = codici.filter(c => !dichiarati.has(c))
      if (nonDichiarati.length > 0) {
        return `Codici di recupero/smaltimento non dichiarati per l'unita' locale ${sito.numIscrSito}: ${nonDichiarati.join(', ')}.`
      }
    }
  } else if (codici.length > 0) {
    return "Campo 'attivita_rec_smalt' non ammesso: le attivita' del registro non comprendono Recupero ne' Smaltimento."
  }

  return null
}
