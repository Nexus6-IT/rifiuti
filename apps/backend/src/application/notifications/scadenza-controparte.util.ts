import { giornoItaliano } from '../../core/time/anno-italiano'

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
 *
 * GIORNI DI CALENDARIO — `scadenza` arriva da colonne Prisma `@db.Date`, cioè
 * la mezzanotte UTC di una data di calendario (parte AAAA-MM-GG in UTC).
 * `giorniAllaScadenza` è la differenza in giorni di calendario fra quella data
 * e il giorno di Roma di `oggi` (`giornoItaliano`, Europe/Rome): il giorno
 * cambia a mezzanotte italiana, non UTC, quindi fra 00:00 e 01:00/02:00 di
 * Roma non si resta più sul giorno precedente. Niente `Math.ceil` sui
 * millisecondi. `scaduta` = giorni < 0. Il certificato RENTRI, invece, ha un
 * istante preciso (`notAfter`) e usa `Math.floor` in
 * `calcolaGiorniAllaScadenzaCertificato`: differenza intenzionale.
 */
const MS_GIORNO = 24 * 60 * 60 * 1000

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

  const giorniAllaScadenza = Math.round(
    (Date.parse(`${scadenza.toISOString().slice(0, 10)}T00:00:00.000Z`) -
      Date.parse(`${giornoItaliano(oggi)}T00:00:00.000Z`)) /
      MS_GIORNO
  )

  return { giorniAllaScadenza, scaduta: giorniAllaScadenza < 0 }
}
