// Messaggi ESATTI sollevati dai trigger delle pese (migration 20261101600000 e 20261101600100).
// Il servizio li riconosce per uguaglianza del testo, non per parole chiave: se una migration li
// cambia, `messaggi-trigger-pese.spec.ts` (che legge i file SQL) fallisce.
export const MSG_TRIGGER = {
  accessoNonTrovato: 'pesate: accesso non trovato',
  accessoNonAperto: 'pesate: accesso non aperto',
  singolaSoloOrdine1: "pesate: la pesata singola ha solo l'ordine 1",
  singolaSenzaTara: 'pesate: la pesata singola non ammette la tara dichiarata',
  primaNonTara: "pesate: la prima pesata non puo' essere la tara dichiarata",
  secondaEraTara: "pesate: con la tara dichiarata la seconda pesata e' la tara",
  doppiaSenzaTara: 'pesate: la doppia pesata non ammette la tara dichiarata',
  mancaPrima: 'pesate: manca la prima pesata',
  accessoAnnullatoNonModificabile: 'accessi_pesa: accesso annullato, non modificabile',
  pesateInsufficienti: "accessi_pesa: pesate insufficienti per chiudere l'accesso",
  collegamentoAttivo: 'accessi_pesa: collegamento attivo, revocarlo prima di annullare',
  transizioneNonAmmessa: 'accessi_pesa: transizione di stato non ammessa',
  rettificaPesataNonTrovata: 'rettifiche_peso: pesata non trovata',
  rettificaTara: 'rettifiche_peso: la tara dichiarata non si rettifica',
  rettificaAccessoAnnullato: 'rettifiche_peso: accesso annullato',
  rettificaNumero: 'rettifiche_peso: numero non consecutivo',
  rettificaPesoPrecedente: "rettifiche_peso: il peso precedente non e' quello in vigore",
  collegamentoAccessoNonChiuso: "collegamenti_accesso: l'accesso deve essere chiuso",
  collegamentoGiaRevocato: "collegamenti_accesso: collegamento gia' revocato",
} as const

/** Coerenza fonte/modo/ordine: stessa risposta 422 del servizio. */
export const MSG_TRIGGER_INCOERENZA: readonly string[] = [
  MSG_TRIGGER.singolaSoloOrdine1,
  MSG_TRIGGER.singolaSenzaTara,
  MSG_TRIGGER.primaNonTara,
  MSG_TRIGGER.secondaEraTara,
  MSG_TRIGGER.doppiaSenzaTara,
]
