/**
 * Codici chiusi del legame movimento (fase 4.3): stati, motivi che impediscono la conferma,
 * avvisi che non bloccano, con i messaggi per l'utente. Dominio puro, nessuna dipendenza.
 * Gli stessi insiemi sono imposti dai CHECK del database (`motivi <@ ARRAY[...]`).
 */

export const STATI_LEGAME = [
  'DA_COLLEGARE',
  'PROPOSTO',
  'CONFERMATO',
  'ESCLUSO',
  'ANNULLATO',
  'FATTURATO',
  'IMPORTATO_FATTURATO',
] as const
export type StatoLegame = (typeof STATI_LEGAME)[number]

export const MOTIVI_LEGAME = [
  'SENZA_CLIENTE',
  'SENZA_CONTRATTO',
  'SEDE_SENZA_CONTRATTO',
  'CONTRATTO_AMBIGUO',
  'CONTRATTO_NON_ATTIVO',
  'SENZA_ELENCO',
  'ELENCO_SCADUTO',
  'SENZA_RIGA_CER',
  'RIGA_AMBIGUA',
  'SENZA_PREZZO',
  'SENZA_QUANTITA',
] as const
export type MotivoLegame = (typeof MOTIVI_LEGAME)[number]

export const AVVISI_LEGAME = [
  'CLIENTE_NON_DA_FIR',
  'QUANTITA_MANUALE_NON_DERIVATA',
  'CAMBIO_CER_DA_CONFERMARE',
  'PREZZO_MANUALE',
] as const
export type AvvisoLegame = (typeof AVVISI_LEGAME)[number]

export const MESSAGGI_MOTIVO: Readonly<Record<MotivoLegame, string>> = {
  SENZA_CLIENTE: 'Manca il cliente da fatturare.',
  SENZA_CONTRATTO: 'Il cliente non ha un contratto.',
  SEDE_SENZA_CONTRATTO: 'Nessun contratto per la sede del movimento.',
  CONTRATTO_AMBIGUO: 'Più contratti possibili: scegline uno.',
  CONTRATTO_NON_ATTIVO: 'Il contratto non è attivo alla data del movimento.',
  SENZA_ELENCO: 'Il contratto non ha un elenco di addebiti.',
  ELENCO_SCADUTO: "L'elenco di addebiti non è valido alla data del movimento.",
  SENZA_RIGA_CER: 'Nell’elenco non c’è una riga per il codice CER del movimento.',
  RIGA_AMBIGUA: 'Più righe possibili per il codice CER: scegline una.',
  SENZA_PREZZO: 'Manca il prezzo.',
  SENZA_QUANTITA: 'Manca la quantità.',
}

export const MESSAGGI_AVVISO: Readonly<Record<AvvisoLegame, string>> = {
  CLIENTE_NON_DA_FIR: 'La ditta del FIR non è censita come cliente.',
  QUANTITA_MANUALE_NON_DERIVATA:
    'La quantità è stata scritta a mano e non segue la correzione del movimento.',
  CAMBIO_CER_DA_CONFERMARE: 'Il codice CER è cambiato: conferma di nuovo il legame.',
  PREZZO_MANUALE:
    'Una o più righe hanno il prezzo modificato a mano: «Aggiorna prezzi» non le cambia.',
}

export const STATI_FATTURATI: readonly StatoLegame[] = ['FATTURATO', 'IMPORTATO_FATTURATO']

export function eStatoFatturato(s: StatoLegame): boolean {
  return STATI_FATTURATI.includes(s)
}

export function sonoMotiviValidi(v: readonly unknown[]): v is MotivoLegame[] {
  return v.every(x => typeof x === 'string' && (MOTIVI_LEGAME as readonly string[]).includes(x))
}

export function sonoAvvisiValidi(v: readonly unknown[]): v is AvvisoLegame[] {
  return v.every(x => typeof x === 'string' && (AVVISI_LEGAME as readonly string[]).includes(x))
}

export const MOTIVO_ESCLUSIONE_CAUSALE = 'Causale non fatturabile'
export const MOTIVO_ESCLUSIONE_DATA = 'Data del movimento prima di «fatturazione da»'
export const AVVISO_SCOSTAMENTO =
  'Il movimento è già stato fatturato; la correzione non cambia la fattura'

const LUNGHEZZA_MAX_MOTIVO_ESCLUSIONE = 200

export function validaMotivoEsclusione(
  testo: unknown
): { ok: true; valore: string } | { ok: false; errore: string } {
  if (typeof testo !== 'string') return { ok: false, errore: 'Indica il motivo dell’esclusione.' }
  const valore = testo.trim()
  if (valore.length === 0) return { ok: false, errore: 'Indica il motivo dell’esclusione.' }
  if (valore.length > LUNGHEZZA_MAX_MOTIVO_ESCLUSIONE) {
    return { ok: false, errore: 'Il motivo può avere al massimo 200 caratteri.' }
  }
  // Il testo dei motivi automatici identifica le esclusioni automatiche: un motivo scritto
  // dall'utente uguale a uno di essi sarebbe scambiato per automatico e riammesso.
  if (valore === MOTIVO_ESCLUSIONE_CAUSALE || valore === MOTIVO_ESCLUSIONE_DATA) {
    return { ok: false, errore: 'Scrivi un motivo diverso da quelli automatici.' }
  }
  return { ok: true, valore }
}
