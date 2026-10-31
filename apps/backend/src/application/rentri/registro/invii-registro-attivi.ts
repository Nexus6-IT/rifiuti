/**
 * Interruttore di emergenza degli invii del registro a RENTRI (seguito di F2-9, decisione di
 * Graziano del 31/10/2026).
 *
 * `RENTRI_REGISTRO_INVII_ATTIVI`: assente o qualunque valore diverso dal testo esatto `false` =
 * invii attivi (default). Solo il letterale `false` li sospende: nessuna interpretazione di "0",
 * "no", "FALSE", spazi (un errore di battitura NON deve fermare gli invii ne', al contrario, un
 * valore ambiguo deve lasciare tutto com'e').
 *
 * Sospendere significa: nessuna prenotazione e nessuna POST (`SOSPESO`). La ripresa degli esiti
 * (`riprendiAttese`, solo GET) continua, cosi' le transazioni gia' aperte si chiudono. Si legge a
 * ogni chiamata: dopo averla cambiata in `/opt/rifiuti/.env` basta riavviare il backend.
 */
export const VARIABILE_INVII_REGISTRO = 'RENTRI_REGISTRO_INVII_ATTIVI'

export function inviiRegistroAttivi(): boolean {
  return process.env.RENTRI_REGISTRO_INVII_ATTIVI !== 'false'
}
