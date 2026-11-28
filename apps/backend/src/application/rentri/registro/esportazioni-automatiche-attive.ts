/**
 * Interruttore dell'esportazione XML mensile AUTOMATICA del registro (eREGI E7).
 *
 * `RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE`: SPENTO di predefinito. Solo il testo esatto `true` lo
 * accende; assente o qualunque altro valore ("1", "TRUE", "si", spazi) lo lascia spento, di
 * proposito: un errore di battitura non deve mai avviare da solo la generazione e la validazione
 * dei file verso RENTRI (la catena dei digest va prima provata sull'ambiente demo, piano eREGI Q6).
 * E' l'opposto di `RENTRI_REGISTRO_INVII_ATTIVI`, che e' acceso di predefinito.
 *
 * Il job gira comunque solo se anche gli invii del registro sono attivi: sospendere gli invii
 * (`RENTRI_REGISTRO_INVII_ATTIVI=false`) ferma anche questo. «Genera ora» dal pannello non dipende
 * da questo interruttore. Si legge a ogni giro: dopo averlo cambiato basta riavviare il backend.
 */
export const VARIABILE_ESPORTAZIONI_AUTOMATICHE = 'RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE'

export function esportazioniAutomaticheAttive(): boolean {
  return process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE === 'true'
}
