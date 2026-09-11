/**
 * Calcolo condiviso dei giorni alla scadenza di una data facoltativa
 * (autorizzazione impianto, iscrizione Albo Gestori del trasportatore,
 * autorizzazione del destinatario — Task 1 e Task 3 dello scadenzario).
 *
 * Estratto qui (Task 4) da `DeadlineCheckerService`, dove la stessa formula
 * (`Math.ceil((scadenza - oggi) / giorno)`, "scaduta" se negativa) era
 * duplicata fra `checkAuthorizationExpirations` ed
 * `elaboraScadenzaControparte`. Ora la usano ENTRAMBI i punti che
 * necessitano di questo calcolo: il controllo periodico via email/notifica
 * in-app E l'avviso mostrato subito nel form FIR quando l'operatore sceglie
 * una controparte (Task 4) — due implementazioni della stessa regola
 * potrebbero divergere su un dato dichiarato a un ente pubblico.
 *
 * `scadenza` è FACOLTATIVA: l'assenza del dato (anagrafica senza scadenza
 * valorizzata) non significa "scaduta" né "non scade mai", significa "non lo
 * sappiamo" — si ritorna `giorniAllaScadenza: null` e `scaduta: false`, mai
 * un avviso costruito su un dato assente (regola di prodotto: un avviso su
 * un'informazione che non abbiamo è rumore che insegna a ignorare gli
 * avvisi veri).
 */
export interface EsitoScadenza {
  giorniAllaScadenza: number | null
  scaduta: boolean
}

export function calcolaScadenza(
  scadenza: Date | null | undefined,
  oggi: Date = new Date()
): EsitoScadenza {
  if (!scadenza) {
    return { giorniAllaScadenza: null, scaduta: false }
  }

  const giorniAllaScadenza = Math.ceil(
    (scadenza.getTime() - oggi.getTime()) / (1000 * 60 * 60 * 24)
  )

  return { giorniAllaScadenza, scaduta: giorniAllaScadenza < 0 }
}
