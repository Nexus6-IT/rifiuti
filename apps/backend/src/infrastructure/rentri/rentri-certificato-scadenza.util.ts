import { X509Certificate } from 'node:crypto'

/**
 * Calcolo condiviso dei giorni alla scadenza di un certificato RENTRI (R5
 * Task 5).
 *
 * Estratto da `GetRentriDiagnosticaUseCase.leggiCertificato` (R5 Task 3):
 * quella era la prima e unica logica di parsing del campo `notAfter` del
 * certificato X.509 salvato dal tenant. Il job giornaliero di scadenza (R5
 * Task 5, `rentri-certificato-scadenza.job.ts`) alimenta il gauge Prometheus
 * `wasteflow_rentri_certificate_expiry_days` — DEVE leggere la stessa data
 * con la stessa logica, non una seconda implementazione del parsing: un
 * allarme e un avviso in UI con numeri diversi (anche di un solo giorno,
 * per un arrotondamento fatto diversamente) confonderebbero l'utente.
 *
 * ARROTONDAMENTO — `Math.floor`, DIVERSO da `Math.ceil` usato in
 * `calcolaScadenza` (rilievo di revisione, minore): differenza intenzionale,
 * non una svista da uniformare. Qui `scadenza` è l'istante esatto
 * (`notAfter` del certificato X.509, con ora e minuti), non una data di
 * calendario: `Math.floor` è la scelta prudente — un certificato con 30
 * giorni e 12 ore residue mostra "30 giorni" (garantiti), non "31"
 * (arrotondando per eccesso un tempo che non c'è ancora). `calcolaScadenza`
 * lavora invece su date di calendario (autorizzazioni, sempre a
 * mezzanotte) dove `Math.ceil` ha un significato diverso e altrettanto
 * intenzionale (vedi commento lì). Uniformare romperebbe il comportamento
 * testato di entrambe (qui `rentri-certificato-scadenza.job.spec.ts`,
 * fissato su `Math.floor` con casi espliciti a +12 ore).
 */
export function calcolaGiorniAllaScadenzaCertificato(certificatePem: string): number | null {
  try {
    const certificato = new X509Certificate(certificatePem)
    const scadenza = new Date(certificato.validTo)
    return Math.floor((scadenza.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  } catch {
    // Un certificato non analizzabile non deve mai far fallire il chiamante
    // (diagnostica o job di metriche): null segnala "non calcolabile", non
    // un'eccezione da propagare.
    return null
  }
}
