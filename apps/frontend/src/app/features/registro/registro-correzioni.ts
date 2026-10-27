import { EsitoVerificaCatena, Movimento } from './registro.service'

/**
 * Testi dell'interfaccia per rettifiche, annullamenti e verifica della catena.
 * Il numero di un'annotazione si scrive N/AAAA (numero e anno del registro).
 */

export type TipoAnnotazione = NonNullable<Movimento['tipoAnnotazione']>

export const numeroAnnotazione = (r: { progressiveNumber: number; progressiveYear: number }) =>
  `${r.progressiveNumber}/${r.progressiveYear}`

/** Un movimento è vigente salvo che il backend dica altro (backend vecchio: nessun campo). */
export const eVigente = (m: Pick<Movimento, 'stato'>): boolean => !m.stato || m.stato === 'VIGENTE'

/** Cosa è questa annotazione rispetto a un'altra: "Rettifica di 12/2026", "Annullamento di ..." o null. */
export function testoAnnotazione(
  m: Pick<Movimento, 'tipoAnnotazione' | 'rettificaDi'>
): string | null {
  if (m.tipoAnnotazione === 'RETTIFICA' || m.tipoAnnotazione === 'ANNULLAMENTO') {
    const nome = m.tipoAnnotazione === 'RETTIFICA' ? 'Rettifica' : 'Annullamento'
    return m.rettificaDi ? `${nome} di ${numeroAnnotazione(m.rettificaDi)}` : nome
  }
  return null
}

/** Cosa è successo a questa annotazione: "Rettificato da 14/2026", "Annullato" o null. */
export function testoCorrezione(m: Pick<Movimento, 'stato' | 'correttoDa'>): string | null {
  if (m.stato === 'RETTIFICATO') {
    return m.correttoDa ? `Rettificato da ${numeroAnnotazione(m.correttoDa)}` : 'Rettificato'
  }
  if (m.stato === 'ANNULLATO') return 'Annullato'
  return null
}

/** Colonna "Annotazione" dell'export: Ordinaria / Rettifica di N/AAAA / Annullamento di N/AAAA. */
export function annotazioneExport(m: Movimento): string {
  return testoAnnotazione(m) ?? 'Ordinaria'
}

/** Colonna "Stato" dell'export: Vigente / Rettificato / Annullato. */
export function statoExport(m: Movimento): string {
  if (m.stato === 'RETTIFICATO') return 'Rettificato'
  if (m.stato === 'ANNULLATO') return 'Annullato'
  return 'Vigente'
}

const MOTIVI_ERRORE: Record<string, string> = {
  HASH_DIVERSO: "i dati non corrispondono all'impronta registrata",
  VERSIONE_SCONOSCIUTA: "la versione dell'impronta non è riconosciuta",
  BUCO: 'manca un numero nella sequenza del registro',
}

export function motivoErroreLeggibile(motivo: string): string {
  return MOTIVI_ERRORE[motivo] ?? motivo
}

/** Esito della verifica in una frase: integra oppure la prima anomalia. */
export function testoEsitoVerifica(e: EsitoVerificaCatena): string {
  if (e.primoErrore) {
    return (
      `Anomalia all'annotazione ${e.primoErrore.numero}/${e.anno}: ` +
      motivoErroreLeggibile(e.primoErrore.motivo)
    )
  }
  return `${e.verificate} annotazioni verificate, nessuna alterazione (${e.nonVerificabili.length} storiche non verificabili)`
}
