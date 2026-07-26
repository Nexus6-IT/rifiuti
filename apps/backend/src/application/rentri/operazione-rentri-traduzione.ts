import { Operazione } from '../../infrastructure/rentri/rentri-api.client'

/**
 * Traduzione di ogni {@link Operazione} del contratto RENTRI (28 valori,
 * `docs/contracts/rentri/formulari.yaml`, riga 9935) in un verbo di mestiere
 * italiano, comprensibile a un operatore che non conosce il gergo
 * dell'ente.
 *
 * Condivisa, non duplicata: `GetAzioniDisponibiliUseCase` restituisce il
 * verbo già tradotto in ogni elemento di `azioni` della risposta HTTP — il
 * frontend (task futuro, R3) legge quella stringa dalla risposta, non
 * reimplementa questa tabella. Non esiste nel monorepo un meccanismo di
 * codice condiviso backend/frontend (niente `libs/`, niente pacchetto
 * comune): "condivisa" qui significa "una sola fonte di verità nel backend,
 * servita via API", non un pacchetto importato da entrambi.
 *
 * `Record<Operazione, string>` completo: se un domani il contratto aggiunge
 * o rinomina un'operazione e questa tabella non viene aggiornata, la build
 * TypeScript fallisce — è la garanzia strutturale voluta (v. task-2-brief.md,
 * Step 3), non un `Partial` con fallback silenzioso.
 */
export const TRADUZIONE_OPERAZIONE_RENTRI: Record<Operazione, string> = {
  Trasporto: 'Inserisci i dati di trasporto',
  TrasportoUpdate: 'Modifica i dati di trasporto',
  DatiQuantita: 'Inserisci la quantità del rifiuto',
  DatiQuantitaUpdate: 'Modifica la quantità del rifiuto',
  Accettazione: 'Accetta o respingi il carico',
  Allegato: 'Aggiungi un allegato',
  Annotazione: 'Aggiungi un’annotazione',
  Reset: 'Annulla le modifiche non ancora firmate',
  Rilascia: 'Rilascia il formulario',
  Annulla: 'Annulla il formulario',
  NoteAnnullamento: "Inserisci le note dell'annullamento",
  Hash: "Calcola l'impronta (hash) per la firma",
  TrasbordoTotale: 'Dichiara un trasbordo totale',
  TrasbordoParziale: 'Dichiara un trasbordo parziale',
  SostaTecnica: 'Dichiara una sosta tecnica',
  NuovoDestinatario: 'Indica un nuovo destinatario',
  AcquisizioneFirma: 'Acquisisci la firma',
  AcquisizioneFirmaAnnullamento: "Firma l'annullamento",
  AcquisizioneFirmaTrasportatore: 'Firma come trasportatore',
  AcquisizioneFirmaProduttore: 'Firma come produttore',
  AcquisizioneFirmaProduttoreTrasportatore: 'Firma come produttore e trasportatore',
  AcquisizioneFirmaDestinatario: 'Firma come destinatario',
  AcquisizioneFirmaAnnotazione: "Firma l'annotazione",
  AcquisizioneFirmaTrasbordoTotale: 'Firma il trasbordo totale',
  AcquisizioneFirmaSostaTecnica: 'Firma la sosta tecnica',
  AcquisizioneFirmaTrasbordoParziale: 'Firma il trasbordo parziale',
  AcquisizioneFirmaDestinatarioSuccessivo: 'Firma come destinatario successivo',
  AcquisizioneFirmaAccettazioneSuccessiva: "Firma l'accettazione successiva",
  RollbackFirma: 'Annulla una firma già acquisita',
  Modifica: 'Modifica il formulario',
}

/** Traduce una singola {@link Operazione}: usata da {@link traduciOperazioniRentri}. */
export function traduciOperazioneRentri(operazione: Operazione): string {
  return TRADUZIONE_OPERAZIONE_RENTRI[operazione]
}

/** Elemento della lista `azioni` restituita da `GetAzioniDisponibiliUseCase`: l'operazione grezza più il suo verbo. */
export interface AzioneTradotta {
  operazione: Operazione
  verbo: string
}

/** Traduce ogni {@link Operazione} di una lista, preservandone l'ordine. */
export function traduciOperazioniRentri(azioni: Operazione[]): AzioneTradotta[] {
  return azioni.map(operazione => ({ operazione, verbo: traduciOperazioneRentri(operazione) }))
}
