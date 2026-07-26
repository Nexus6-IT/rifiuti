/**
 * `Operazione` (`docs/contracts/rentri/formulari.yaml`, riga 9935): le 28
 * operazioni ammesse dal ciclo di vita di un formulario, restituite da
 * `GET /{numero_fir}/azioni` (`AzioniResult.azioni`). Copiate 1:1 dal
 * contratto (stessi 28 valori, stesso ordine dichiarato), non un
 * sottoinsieme: è lo stesso vincolo di fedeltà già applicato a
 * `StatoFormulario` nell'aggregate FIR del backend (R3 Task 1).
 */
export type Operazione =
  | 'Trasporto'
  | 'TrasportoUpdate'
  | 'DatiQuantita'
  | 'DatiQuantitaUpdate'
  | 'Accettazione'
  | 'Allegato'
  | 'Annotazione'
  | 'Reset'
  | 'Rilascia'
  | 'Annulla'
  | 'NoteAnnullamento'
  | 'Hash'
  | 'TrasbordoTotale'
  | 'TrasbordoParziale'
  | 'SostaTecnica'
  | 'NuovoDestinatario'
  | 'AcquisizioneFirma'
  | 'AcquisizioneFirmaAnnullamento'
  | 'AcquisizioneFirmaTrasportatore'
  | 'AcquisizioneFirmaProduttore'
  | 'AcquisizioneFirmaProduttoreTrasportatore'
  | 'AcquisizioneFirmaDestinatario'
  | 'AcquisizioneFirmaAnnotazione'
  | 'AcquisizioneFirmaTrasbordoTotale'
  | 'AcquisizioneFirmaSostaTecnica'
  | 'AcquisizioneFirmaTrasbordoParziale'
  | 'AcquisizioneFirmaDestinatarioSuccessivo'
  | 'AcquisizioneFirmaAccettazioneSuccessiva'
  | 'RollbackFirma'
  | 'Modifica'

/**
 * Macchina a stati MINIMA (v. Step 1, task-2-brief.md): non replica l'intera
 * macchina reale dell'ente — che non è documentata in dettaglio dal
 * contratto e non serve a questo scopo — ma basta a dimostrare che WasteFlow
 * (a) consulta `/azioni` prima di proporre un'operazione, (b) riceve liste
 * OSSERVABILMENTE diverse a seconda dello stato, non lo stesso elenco
 * sempre.
 *
 * Tre gruppi, scelti per rappresentare i tre momenti macroscopici del ciclo:
 * - **iniziale**: prima che il destinatario abbia accettato — nessuna
 *   `Accettazione` disponibile, ha senso ancora modificare trasporto/quantità.
 * - **accettazione**: il destinatario sta decidendo l'esito — `Accettazione`
 *   compare, insieme alle firme di quella fase.
 * - **terminale** (`Accettato`/`RespintoAccettatoParzialmente`/`Annullato`):
 *   nessuna operazione di scrittura ha più senso — lista vuota.
 * - **annullamento** e **indeterminato**: gruppi minori, non decisivi per il
 *   test ma coerenti col resto della tabella.
 */
const OPERAZIONI_STATO_INIZIALE: Operazione[] = [
  'Trasporto',
  'TrasportoUpdate',
  'DatiQuantita',
  'DatiQuantitaUpdate',
  'Allegato',
  'Annotazione',
  'Hash',
  'TrasbordoTotale',
  'TrasbordoParziale',
  'SostaTecnica',
  'NuovoDestinatario',
  'AcquisizioneFirma',
  'AcquisizioneFirmaTrasportatore',
  'AcquisizioneFirmaProduttore',
  'AcquisizioneFirmaProduttoreTrasportatore',
  'AcquisizioneFirmaAnnotazione',
  'AcquisizioneFirmaTrasbordoTotale',
  'AcquisizioneFirmaSostaTecnica',
  'AcquisizioneFirmaTrasbordoParziale',
  'Reset',
  'Annulla',
  'NoteAnnullamento',
  'Modifica',
]

const OPERAZIONI_STATO_ACCETTAZIONE: Operazione[] = [
  'Accettazione',
  'AcquisizioneFirmaDestinatario',
  'AcquisizioneFirmaDestinatarioSuccessivo',
  'AcquisizioneFirmaAccettazioneSuccessiva',
  'Allegato',
  'Annotazione',
  'Annulla',
  'NoteAnnullamento',
  'Reset',
  'Modifica',
]

const OPERAZIONI_STATO_ANNULLAMENTO: Operazione[] = [
  'AcquisizioneFirmaAnnullamento',
  'NoteAnnullamento',
  'RollbackFirma',
]

const STATI_ACCETTAZIONE = new Set([
  'InserimentoAccettazione',
  'FirmaAccettazione',
  'FirmaDestinatarioSuccessivo',
  'FirmaAccettazioneSuccessiva',
])

const STATI_ANNULLAMENTO = new Set(['FirmaAnnullamento'])

const STATI_TERMINALI = new Set(['Accettato', 'RespintoAccettatoParzialmente', 'Annullato'])

/**
 * Restituisce il sottoinsieme di {@link Operazione} plausibile per lo stato
 * corrente di un formulario. Stato sconosciuto/`Indeterminato` → lista vuota
 * (scelta conservativa: un'incoerenza dati non giustifica proporre scritture).
 */
export function operazioniPerStato(stato: string): Operazione[] {
  if (STATI_TERMINALI.has(stato)) {
    return []
  }
  if (STATI_ANNULLAMENTO.has(stato)) {
    return [...OPERAZIONI_STATO_ANNULLAMENTO]
  }
  if (STATI_ACCETTAZIONE.has(stato)) {
    return [...OPERAZIONI_STATO_ACCETTAZIONE]
  }
  if (stato === 'Indeterminato') {
    return []
  }
  // Tutti gli altri 15 stati "di lavorazione iniziale" (dall'inserimento
  // quantità/trasporto alla firma produttore/trasportatore) — v. commento di
  // testata.
  return [...OPERAZIONI_STATO_INIZIALE]
}
