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
