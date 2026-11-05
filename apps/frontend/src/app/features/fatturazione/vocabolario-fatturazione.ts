import {
  MotivoNonAnnullabile,
  MotivoNonStornabile,
  StatoDocumento,
  StatoElaborazione,
} from './fatturazione.model'

/**
 * Vocabolario della fatturazione: etichetta e severità di ogni stato, errore, avviso e motivo.
 * I codici sono gli insiemi chiusi di `apps/backend/src/domain/fatturazione/codici.ts` (copiati
 * alla lettera); i messaggi dei codici del backend sono gli stessi del backend, tranne dove il
 * brief del Task 14 ne fissa uno diverso (RIGA_LEGAME_INCOMPLETA, Q19).
 */
export type SeveritaFatturazione = 'errore' | 'avviso' | 'info' | 'successo'

export interface VoceVocabolario {
  etichetta: string
  severita: SeveritaFatturazione
}

const v = (etichetta: string, severita: SeveritaFatturazione): VoceVocabolario => ({
  etichetta,
  severita,
})

export const STATI_ELABORAZIONE_VOCI: Readonly<Record<StatoElaborazione, VoceVocabolario>> = {
  IN_CODA: v('In coda', 'info'),
  IN_CORSO: v('In calcolo', 'info'),
  ANTEPRIMA_PRONTA: v('Anteprima pronta', 'successo'),
  IN_DEFINITIVA: v('Emissione in corso', 'info'),
  DEFINITIVA: v('Definitiva', 'successo'),
  FALLITA: v('Fallita', 'errore'),
  SCARTATA: v('Scartata', 'avviso'),
}

export const STATI_DOCUMENTO_VOCI: Readonly<Record<StatoDocumento, VoceVocabolario>> = {
  BOZZA: v('Bozza', 'info'),
  DEFINITIVO: v('Definitivo', 'successo'),
  ANNULLATO: v('Annullato', 'avviso'),
}

/** Errori generali (bloccano la definitiva, tranne i legami senza contratto: decisione 24). */
export const ERRORI_GENERALI_VOCI = {
  CEDENTE_INCOMPLETO: v(
    'I dati del cedente sono incompleti: completali nelle impostazioni di fatturazione.',
    'errore'
  ),
  DATA_ANTERIORE_ULTIMA_FATTURA: v(
    "La data del documento è anteriore all'ultima fattura emessa nel registro IVA.",
    'errore'
  ),
  DATA_FUTURA: v('La data del documento non può essere nel futuro.', 'errore'),
  // Decisione 24: non blocca la definitiva, i movimenti restano fuori dalla fattura.
  LEGAMI_SENZA_CONTRATTO: v(
    'Ci sono movimenti collegati a elenchi senza contratto: assegna un contratto.',
    'avviso'
  ),
} as const

export const ERRORI_DOCUMENTO_VOCI = {
  CONTRATTO_SOSPESO: v('Il contratto è sospeso: il documento non si emette.', 'errore'),
  SENZA_REGISTRO_IVA: v(
    'Il contratto non ha un registro IVA: impostalo prima di emettere.',
    'errore'
  ),
  CLIENTE_SENZA_DATI_FISCALI: v('Il cliente non ha partita IVA o codice fiscale.', 'errore'),
  SEDE_CLIENTE_INCOMPLETA: v(
    'La sede del cliente è incompleta: indirizzo, CAP, comune e nazione sono obbligatori.',
    'errore'
  ),
  DATI_PA_INCOMPLETI: v(
    "Fattura alla pubblica amministrazione con CIG o CUP: manca il numero dell'ordine o del contratto di riferimento.",
    'errore'
  ),
  SENZA_CONDIZIONE_PAGAMENTO: v('Il contratto non ha una condizione di pagamento.', 'errore'),
  PAGAMENTO_SENZA_BANCA: v(
    'La modalità di pagamento richiede un conto corrente che non è indicato.',
    'errore'
  ),
  PAGAMENTO_NON_AMMESSO: v(
    "Il pagamento in contanti non è ammesso con la scissione dei pagamenti o con l'IVA differita.",
    'errore'
  ),
  SPESA_SENZA_CODICE_IVA: v("La spesa d'incasso non ha un codice IVA.", 'errore'),
  // Q19: testo fissato dal brief del Task 14.
  RIGA_LEGAME_INCOMPLETA: v(
    'Una riga del legame o del listino è incompleta: mancano quantità o prezzo.',
    'errore'
  ),
  FAMIGLIA_NON_CALCOLATA: v(
    'Il contratto ha un addebito che WasteFlow non calcola ancora: il documento non si emette.',
    'errore'
  ),
  PREZZO_SPECIALE_NON_VALIDO: v('Il prezzo speciale del listino non è valido.', 'errore'),
  UM_NON_UNIVOCA: v('Le righe hanno unità di misura diverse e non si possono sommare.', 'errore'),
  CANONE_PERIODO_SOVRAPPOSTO: v(
    'Il periodo del canone si sovrappone a uno già fatturato.',
    'errore'
  ),
  NATURA_NON_AMMESSA: v(
    'Un codice IVA usa una natura generica (N2, N3 o N6), non più ammessa: indica il sottocodice nel codice IVA (per esempio N2.1).',
    'errore'
  ),
  IMPORTI_NON_COERENTI: v(
    'Gli importi del documento non tornano: controlla righe, riepilogo IVA e totale.',
    'errore'
  ),
  TOTALE_NON_POSITIVO: v('Il totale del documento non è positivo.', 'errore'),
  RITENUTA_NON_GESTITA: v(
    "Il cliente ha una ritenuta d'acconto, che WasteFlow non gestisce ancora.",
    'errore'
  ),
} as const

export const AVVISI_DOCUMENTO_VOCI = {
  MOVIMENTI_DA_COLLEGARE_ESCLUSI: v(
    'Ci sono movimenti ancora da collegare: restano fuori dal documento.',
    'avviso'
  ),
  MOVIMENTI_SOSPESI: v('Ci sono movimenti sospesi: restano fuori dal documento.', 'avviso'),
  ARRETRATI_PRESENTI: v(
    'Il documento contiene arretrati di canoni fissi di periodi precedenti.',
    'avviso'
  ),
  BOLLO_NON_ADDEBITATO: v(
    'Il bollo è dovuto ma il contratto non lo addebita al cliente.',
    'avviso'
  ),
  DESTINATARIO_ASSENTE: v(
    "Il cliente non ha un codice destinatario né una PEC: sarà consegnato nell'area riservata.",
    'avviso'
  ),
  FPA_DA_FIRMARE: v(
    "Fattura verso la pubblica amministrazione: l'XML va firmato prima dell'invio.",
    'avviso'
  ),
  DATA_OLTRE_TERMINE_DIFFERITA: v(
    'La data supera il 15 del mese successivo al periodo: la fattura differita è emessa oltre il termine.',
    'avviso'
  ),
} as const

/** Esiti di `ElaborazioneDettaglio.errore.codice` (colonna esito). */
export const ESITI_ELABORAZIONE = [
  'ANTEPRIMA_SUPERATA',
  'DOPPIA_FATTURAZIONE',
  'DEFINITIVE_NON_ATTIVE',
  'DATA_ANTERIORE_ULTIMA_FATTURA',
  'CEDENTE_INCOMPLETO',
  'ELABORAZIONE_INTERROTTA',
] as const
export type EsitoElaborazione = (typeof ESITI_ELABORAZIONE)[number]

/** Errori HTTP `{ error, message, details? }`: quelli della spec §11 e i codici aggiunti dal piano (P7). */
export const ERRORI_HTTP_VOCI = {
  ANTEPRIMA_SUPERATA: v(
    "L'anteprima non è più aggiornata: i dati sono cambiati. Ricalcola prima di rendere definitiva.",
    'errore'
  ),
  ELABORAZIONE_GIA_IN_DEFINITIVA: v(
    "L'elaborazione è già in corso di emissione definitiva.",
    'errore'
  ),
  ELABORAZIONE_IN_CORSO: v("Un'elaborazione è già in corso: attendi che finisca.", 'errore'),
  TROPPI_DOCUMENTI: v(
    'Ci sono troppi documenti per questa operazione: restringi la selezione.',
    'errore'
  ),
  ANNULLO_NON_AMMESSO: v(
    "L'annullo non è ammesso: si annulla solo l'ultimo numero del registro, se non è già emesso.",
    'errore'
  ),
  STORNO_GIA_PRESENTE: v(
    'Per questo documento esiste già una nota di credito di storno.',
    'errore'
  ),
  XML_NON_VALIDO: v("L'XML generato non è valido: il documento non si può scaricare.", 'errore'),
  MAPPATURE_MANCANTI: v(
    'Mancano delle mappature per il gestionale: completale prima di esportare.',
    'errore'
  ),
  VERSIONE_SUPERATA: v(
    'I dati sono stati modificati da un altro utente: ricarica e riprova.',
    'errore'
  ),
  OPERAZIONE_CONCORRENTE: v(
    "Un'altra operazione è in corso sugli stessi dati: riprova fra poco.",
    'errore'
  ),
  NESSUN_DOCUMENTO_DEFINIBILE: v(
    "Non c'è nessun documento da rendere definitivo: tutti sono esclusi o hanno errori.",
    'errore'
  ),
  DOPPIA_FATTURAZIONE: v(
    "Una parte di questi addebiti è già stata fatturata da un'altra elaborazione: ricalcola.",
    'errore'
  ),
  PARTENZA_NON_MODIFICABILE: v(
    'Il numero di partenza non si può più cambiare: il registro ha già fatture definitive.',
    'errore'
  ),
  SUFFISSO_NON_MODIFICABILE: v(
    "Il suffisso non si può più cambiare: il registro ha già fatture definitive nell'anno.",
    'errore'
  ),
  PARTENZA_NON_VALIDA: v(
    "Il numero di partenza o la sua data non sono validi: la data deve cadere nell'anno della numerazione.",
    'errore'
  ),
  RIGA_ADDEBITO_IN_USO: v('La riga è usata da movimenti: non si può eliminare.', 'errore'),
  SCOSTAMENTO_NON_APERTO: v('Lo scostamento non è più aperto: è già stato gestito.', 'errore'),
  // Scansione P33.
  DEFINITIVE_NON_ATTIVE: v(
    'Le fatture definitive non sono ancora attive per questa azienda',
    'errore'
  ),
  // Q7.
  XML_NON_DISPONIBILE: v("Un documento annullato non ha l'XML", 'errore'),
  // Q33: `details.motivo` è un MotivoNonStornabile.
  STORNO_NON_AMMESSO: v('Per questo documento lo storno non è ammesso.', 'errore'),
  PERIODO_NON_VALIDO: v(
    'Il periodo non è valido: la data finale non può precedere la iniziale.',
    'errore'
  ),
  DATA_FUTURA: v('La data del documento non può essere nel futuro.', 'errore'),
  CONFERMA_EMISSIONE_RICHIESTA: v(
    'Conferma che il documento diventerà emesso e non si potrà più annullare.',
    'errore'
  ),
  ADATTATORE_SCONOSCIUTO: v('Il gestionale scelto non è tra quelli disponibili.', 'errore'),
} as const

/** Esiti che non sono anche errori HTTP né errori generali. */
const ESITI_PROPRI = {
  ELABORAZIONE_INTERROTTA: v(
    "L'elaborazione si è interrotta: richiedi di nuovo la definitiva",
    'errore'
  ),
} as const

export const ESITI_ELABORAZIONE_VOCI: Readonly<Record<EsitoElaborazione, VoceVocabolario>> = {
  ANTEPRIMA_SUPERATA: ERRORI_HTTP_VOCI.ANTEPRIMA_SUPERATA,
  DOPPIA_FATTURAZIONE: ERRORI_HTTP_VOCI.DOPPIA_FATTURAZIONE,
  DEFINITIVE_NON_ATTIVE: ERRORI_HTTP_VOCI.DEFINITIVE_NON_ATTIVE,
  DATA_ANTERIORE_ULTIMA_FATTURA: ERRORI_GENERALI_VOCI.DATA_ANTERIORE_ULTIMA_FATTURA,
  CEDENTE_INCOMPLETO: ERRORI_GENERALI_VOCI.CEDENTE_INCOMPLETO,
  ELABORAZIONE_INTERROTTA: ESITI_PROPRI.ELABORAZIONE_INTERROTTA,
}

/** Q9. */
export const MOTIVI_NON_ANNULLABILE_VOCI: Readonly<Record<MotivoNonAnnullabile, VoceVocabolario>> =
  {
    NON_DEFINITIVO: v('Solo un documento definitivo si annulla.', 'info'),
    NOTA_DI_CREDITO: v('Una nota di credito non si annulla.', 'info'),
    STORNATO: v('Il documento è già stato stornato.', 'info'),
    EMESSO: v('Il documento è già emesso: non si può più annullare, si storna.', 'info'),
    NON_ULTIMO: v("Si annulla solo l'ultimo numero del registro.", 'info'),
  }

/** Q33. */
export const MOTIVI_NON_STORNABILE_VOCI: Readonly<Record<MotivoNonStornabile, VoceVocabolario>> = {
  NON_DEFINITIVO: v('Solo un documento definitivo si storna.', 'info'),
  NOTA_DI_CREDITO: v('Una nota di credito non si storna.', 'info'),
}

export const TIPI_RIGA_VOCI: Readonly<Record<string, VoceVocabolario>> = {
  MOVIMENTO: v('Movimento', 'info'),
  FASCIA_SPECIALE: v('Fascia speciale', 'info'),
  FISSO: v('Canone fisso', 'info'),
  MINIMO: v('Minimo di fatturazione', 'info'),
  SPESA_INCASSO: v("Spesa d'incasso", 'info'),
  BOLLO: v('Bollo', 'info'),
  STORNO: v('Storno', 'info'),
  QUANTITA_MOVIMENTI: v('Quantità dei movimenti', 'info'),
}

export const TIPI_CORREZIONE_VOCI = {
  RETTIFICA: v('Rettifica', 'avviso'),
  ANNULLO: v('Annullo', 'avviso'),
  CAMBIO_CER: v('Cambio di codice CER', 'avviso'),
  CAMBIO_CAUSALE: v('Cambio di causale', 'avviso'),
} as const

const TUTTE_LE_SEGNALAZIONI: Readonly<Record<string, VoceVocabolario>> = {
  ...ERRORI_HTTP_VOCI,
  ...ERRORI_GENERALI_VOCI,
  ...ERRORI_DOCUMENTO_VOCI,
  ...AVVISI_DOCUMENTO_VOCI,
  ...ESITI_PROPRI,
}

/**
 * Voce di un codice qualunque (errore generale o del documento, avviso, esito, errore HTTP).
 * Un codice sconosciuto non rompe la UI: etichetta il codice stesso, come errore.
 */
export function voceSegnalazione(codice: string): VoceVocabolario {
  return Object.prototype.hasOwnProperty.call(TUTTE_LE_SEGNALAZIONI, codice)
    ? TUTTE_LE_SEGNALAZIONI[codice]
    : v(codice, 'errore')
}
