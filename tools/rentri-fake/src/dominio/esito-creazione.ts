/**
 * Numero del formulario nell'esito di creazione, secondo il contratto ufficiale.
 *
 * - Richiesta: `DatiPartenzaModel.numero_fir` (formulari.yaml): «Numero di vidimazione da
 *   attribuire al nuovo FIR digitale. Qualora non venga specificato, il sistema ne assegnerà
 *   uno automaticamente».
 * - Esito: `EsitoNuovoFormularioModel.numero_fir` (stringa nullable).
 *
 * Ne segue che, se la richiesta indica un numero, l'ente attribuisce quel numero e lo
 * restituisce; se non lo indica, lo sceglie l'ente. Un numero diverso da quello richiesto non e'
 * previsto dal contratto: la fake non lo produce da sola e rifiuta di dichiararlo, salvo che il
 * test lo chieda esplicitamente (`esito_non_conforme`) per simulare un ente difettoso.
 */

export function numeroRichiestoDaCreazione(richiesta: Record<string, unknown>): string | undefined {
  const partenza = richiesta.dati_partenza
  if (!partenza || typeof partenza !== 'object') return undefined
  const numero = (partenza as { numero_fir?: unknown }).numero_fir
  return typeof numero === 'string' && numero.trim() !== '' ? numero : undefined
}

function numeroDichiarato(esito: unknown): string | undefined {
  if (!esito || typeof esito !== 'object' || !('numero_fir' in esito)) return undefined
  const numero = (esito as { numero_fir?: unknown }).numero_fir
  return typeof numero === 'string' && numero !== '' ? numero : undefined
}

export type ConformitaNumeroEsito =
  | { conforme: true; esito: unknown }
  | { conforme: false; motivo: string }

/**
 * Applica la regola del contratto a un esito di creazione RIUSCITO.
 * Con numero richiesto: esito senza numero -> numero richiesto; stesso numero -> invariato;
 * numero diverso -> non conforme. Senza numero richiesto: l'esito resta quello dichiarato.
 */
export function applicaNumeroRichiesto(
  richiesta: Record<string, unknown>,
  esito: unknown
): ConformitaNumeroEsito {
  const richiesto = numeroRichiestoDaCreazione(richiesta)
  if (!richiesto) return { conforme: true, esito }

  const dichiarato = numeroDichiarato(esito)
  if (dichiarato === undefined) {
    const base = esito && typeof esito === 'object' ? (esito as Record<string, unknown>) : {}
    return { conforme: true, esito: { ...base, numero_fir: richiesto } }
  }
  if (dichiarato === richiesto) return { conforme: true, esito }

  return {
    conforme: false,
    motivo:
      `La richiesta di creazione indicava il numero '${richiesto}' ma l'esito dichiarato porta ` +
      `'${dichiarato}': il contratto (DatiPartenzaModel.numero_fir) attribuisce il numero richiesto. ` +
      `Per simulare un ente difettoso passare esito_non_conforme: true.`,
  }
}
