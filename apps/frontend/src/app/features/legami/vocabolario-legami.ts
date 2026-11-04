import {
  AVVISI_LEGAME,
  AvvisoLegame,
  MOTIVI_LEGAME,
  MotivoLegame,
  STATI_LEGAME,
  STATI_VIRTUALI,
  StatoLista,
} from './legami.model'

export { AVVISI_LEGAME, MOTIVI_LEGAME, STATI_LEGAME }

/** Stati della lista: quelli del database più i due virtuali. */
export const STATI_LISTA: readonly StatoLista[] = [...STATI_LEGAME, ...STATI_VIRTUALI]

const STATI: Record<StatoLista, string> = {
  DA_COLLEGARE: 'Da collegare',
  PROPOSTO: 'Proposto',
  CONFERMATO: 'Confermato',
  ESCLUSO: 'Escluso',
  ANNULLATO: 'Annullato',
  FATTURATO: 'Fatturato',
  IMPORTATO_FATTURATO: 'Già fatturato (importato)',
  MANCANTE: 'Senza legame',
  DA_RIALLINEARE: 'Da riallineare',
}

const MOTIVI: Record<MotivoLegame, string> = {
  SENZA_CLIENTE: 'Manca il cliente da fatturare',
  SENZA_CONTRATTO: 'Il cliente non ha un contratto',
  SEDE_SENZA_CONTRATTO: 'Nessun contratto per la sede del movimento',
  CONTRATTO_AMBIGUO: 'Più contratti possibili: scegline uno',
  CONTRATTO_NON_ATTIVO: 'Il contratto non è attivo alla data del movimento',
  SENZA_ELENCO: 'Il contratto non ha un elenco di addebiti',
  ELENCO_SCADUTO: "L'elenco di addebiti non è valido alla data del movimento",
  SENZA_RIGA_CER: 'Rifiuto non trovato in contratto',
  RIGA_AMBIGUA: 'Più righe possibili per il codice CER: scegline una',
  SENZA_PREZZO: 'Manca il prezzo',
  SENZA_QUANTITA: 'Manca la quantità',
}

const AVVISI: Record<AvvisoLegame, string> = {
  CLIENTE_NON_DA_FIR: 'La ditta del FIR non è censita come cliente',
  QUANTITA_MANUALE_NON_DERIVATA:
    'La quantità è scritta a mano e non segue la correzione del movimento',
  CAMBIO_CER_DA_CONFERMARE: 'Il codice CER è cambiato: conferma di nuovo il legame',
  PREZZO_MANUALE: 'Prezzo modificato a mano: «Aggiorna prezzi» non lo cambia',
  CONTRATTO_ALTRA_SEDE: 'Contratto scelto di un’altra sede',
}

// Un codice che il backend aggiungesse in futuro si mostra così com'è, senza rompere la pagina.
export const etichettaStato = (s: StatoLista): string => STATI[s] ?? s
export const etichettaMotivo = (m: MotivoLegame): string => MOTIVI[m] ?? m
export const etichettaAvviso = (a: AvvisoLegame): string => AVVISI[a] ?? a

export type SeveritaStato = 'success' | 'info' | 'warn' | 'danger' | 'secondary'

export function severitaStato(s: StatoLista): SeveritaStato {
  switch (s) {
    case 'CONFERMATO':
    case 'FATTURATO':
      return 'success'
    case 'PROPOSTO':
      return 'info'
    case 'DA_COLLEGARE':
      return 'warn'
    case 'MANCANTE':
    case 'DA_RIALLINEARE':
      return 'danger'
    default:
      return 'secondary'
  }
}

/** Come `severitaStato`, ma con i nomi che `p-tag` di PrimeNG 17 accetta (`warning`, non `warn`). */
export function severitaTag(
  s: StatoLista
): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
  const v = severitaStato(s)
  return v === 'warn' ? 'warning' : v
}
