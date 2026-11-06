/**
 * Insiemi chiusi della fatturazione per periodo (fase 4.4): stati, tipi, errori e avvisi.
 * I valori sono quelli della spec §19 e dei Global Constraints del piano: non si reinterpretano.
 */

export const STATI_ELABORAZIONE = [
  'IN_CODA',
  'IN_CORSO',
  'ANTEPRIMA_PRONTA',
  'IN_DEFINITIVA',
  'DEFINITIVA',
  'FALLITA',
  'SCARTATA',
] as const
export type StatoElaborazione = (typeof STATI_ELABORAZIONE)[number]

export const STATI_DOCUMENTO = ['BOZZA', 'DEFINITIVO', 'ANNULLATO'] as const
export type StatoDocumento = (typeof STATI_DOCUMENTO)[number]

export const TIPI_DOCUMENTO = ['TD01', 'TD04', 'TD24'] as const
export type TipoDocumento = (typeof TIPI_DOCUMENTO)[number]

export const RAGGRUPPAMENTI = ['PER_CONTRATTO', 'PER_ELENCO'] as const
export type Raggruppamento = (typeof RAGGRUPPAMENTI)[number]

/**
 * `QUANTITA_MOVIMENTI` (P8, decisione 17) e il tipo delle righe TT e TF: ne' MOVIMENTO (nessun
 * legame), ne' FISSO (nessun marcatore), ne' FASCIA_SPECIALE (nessuna tabella a scaglioni).
 */
export const TIPI_RIGA_DOCUMENTO = [
  'MOVIMENTO',
  'FASCIA_SPECIALE',
  'FISSO',
  'MINIMO',
  'SPESA_INCASSO',
  'BOLLO',
  'STORNO',
  'QUANTITA_MOVIMENTI',
] as const
export type TipoRigaDocumento = (typeof TIPI_RIGA_DOCUMENTO)[number]

export const TIPI_MARCATORE = [
  'SCADENZA_FISSO',
  'PERIODO_CANONE',
  'CONGUAGLIO',
  'ACCONTO_FATTURATO',
  'ACCONTO_DETRATTO',
] as const
export type TipoMarcatore = (typeof TIPI_MARCATORE)[number]

export const ERRORI_GENERALI = [
  'CEDENTE_INCOMPLETO',
  'DATA_ANTERIORE_ULTIMA_FATTURA',
  'DATA_FUTURA',
  'LEGAMI_SENZA_CONTRATTO',
] as const
export type ErroreGenerale = (typeof ERRORI_GENERALI)[number]

/**
 * Errori generali che bloccano la definitiva (decisione 24): la richiesta risponde 409 con il
 * codice. `DATA_FUTURA` e' controllato anche all'avvio. `LEGAMI_SENZA_CONTRATTO` non blocca: quei
 * movimenti restano fuori dai documenti.
 */
export const ERRORI_GENERALI_BLOCCANTI: readonly ErroreGenerale[] = [
  'CEDENTE_INCOMPLETO',
  'DATA_ANTERIORE_ULTIMA_FATTURA',
  'DATA_FUTURA',
]

/**
 * Errori HTTP (400) della numerazione delle fatture, insieme chiuso e separato dagli altri: non
 * sono errori di un'elaborazione (nessun CHECK nel database li elenca).
 */
export const ERRORI_NUMERAZIONE = ['PARTENZA_NON_VALIDA'] as const
export type ErroreNumerazione = (typeof ERRORI_NUMERAZIONE)[number]

export const MESSAGGI_NUMERAZIONE: Readonly<Record<ErroreNumerazione, string>> = {
  PARTENZA_NON_VALIDA:
    "Il numero di partenza o la sua data non sono validi: la data deve cadere nell'anno della numerazione.",
}

export const ERRORI_DOCUMENTO = [
  'CONTRATTO_SOSPESO',
  'SENZA_REGISTRO_IVA',
  'CLIENTE_SENZA_DATI_FISCALI',
  'SEDE_CLIENTE_INCOMPLETA',
  'DATI_PA_INCOMPLETI',
  'SENZA_CONDIZIONE_PAGAMENTO',
  'PAGAMENTO_SENZA_BANCA',
  'PAGAMENTO_NON_AMMESSO',
  'SPESA_SENZA_CODICE_IVA',
  'RIGA_LEGAME_INCOMPLETA',
  'FAMIGLIA_NON_CALCOLATA',
  'PREZZO_SPECIALE_NON_VALIDO',
  'UM_NON_UNIVOCA',
  'CANONE_PERIODO_SOVRAPPOSTO',
  'NATURA_NON_AMMESSA',
  'IMPORTI_NON_COERENTI',
  'TOTALE_NON_POSITIVO',
  'RITENUTA_NON_GESTITA',
] as const
export type ErroreDocumento = (typeof ERRORI_DOCUMENTO)[number]

export const AVVISI_DOCUMENTO = [
  'MOVIMENTI_DA_COLLEGARE_ESCLUSI',
  'MOVIMENTI_SOSPESI',
  'ARRETRATI_PRESENTI',
  'BOLLO_NON_ADDEBITATO',
  'DESTINATARIO_ASSENTE',
  'FPA_DA_FIRMARE',
  'DATA_OLTRE_TERMINE_DIFFERITA',
] as const
export type AvvisoDocumento = (typeof AVVISI_DOCUMENTO)[number]

/** Messaggi per l'utente: brevi, senza id ne' dati personali. */
export const MESSAGGI_ERRORE: Readonly<Record<ErroreGenerale | ErroreDocumento, string>> = {
  CEDENTE_INCOMPLETO:
    'I dati del cedente sono incompleti: completali nelle impostazioni di fatturazione.',
  DATA_ANTERIORE_ULTIMA_FATTURA:
    "La data del documento è anteriore all'ultima fattura emessa nel registro IVA.",
  DATA_FUTURA: 'La data del documento non può essere nel futuro.',
  LEGAMI_SENZA_CONTRATTO:
    'Ci sono movimenti collegati a elenchi senza contratto: assegna un contratto.',
  CONTRATTO_SOSPESO: 'Il contratto è sospeso: il documento non si emette.',
  SENZA_REGISTRO_IVA: 'Il contratto non ha un registro IVA: impostalo prima di emettere.',
  CLIENTE_SENZA_DATI_FISCALI: 'Il cliente non ha partita IVA o codice fiscale.',
  SEDE_CLIENTE_INCOMPLETA:
    'La sede del cliente è incompleta: indirizzo, CAP, comune e nazione sono obbligatori.',
  DATI_PA_INCOMPLETI:
    "Fattura alla pubblica amministrazione con CIG o CUP: manca il numero dell'ordine o del contratto di riferimento.",
  SENZA_CONDIZIONE_PAGAMENTO: 'Il contratto non ha una condizione di pagamento.',
  PAGAMENTO_SENZA_BANCA: 'La modalità di pagamento richiede un conto corrente che non è indicato.',
  PAGAMENTO_NON_AMMESSO:
    "Il pagamento in contanti non è ammesso con la scissione dei pagamenti o con l'IVA differita.",
  SPESA_SENZA_CODICE_IVA: "La spesa d'incasso non ha un codice IVA.",
  RIGA_LEGAME_INCOMPLETA:
    'Una riga del legame o del listino è incompleta: mancano quantità o prezzo.',
  FAMIGLIA_NON_CALCOLATA:
    'Il contratto ha un addebito che WasteFlow non calcola ancora: il documento non si emette.',
  PREZZO_SPECIALE_NON_VALIDO: 'Il prezzo speciale del listino non è valido.',
  UM_NON_UNIVOCA: 'Le righe hanno unità di misura diverse e non si possono sommare.',
  CANONE_PERIODO_SOVRAPPOSTO: 'Il periodo del canone si sovrappone a uno già fatturato.',
  NATURA_NON_AMMESSA:
    'Un codice IVA usa una natura generica (N2, N3 o N6), non più ammessa: indica il sottocodice nel codice IVA (per esempio N2.1).',
  IMPORTI_NON_COERENTI:
    'Gli importi del documento non tornano: controlla righe, riepilogo IVA e totale.',
  TOTALE_NON_POSITIVO: 'Il totale del documento non è positivo.',
  RITENUTA_NON_GESTITA: "Il cliente ha una ritenuta d'acconto, che WasteFlow non gestisce ancora.",
}

export const MESSAGGI_AVVISO: Readonly<Record<AvvisoDocumento, string>> = {
  MOVIMENTI_DA_COLLEGARE_ESCLUSI:
    'Ci sono movimenti ancora da collegare: restano fuori dal documento.',
  MOVIMENTI_SOSPESI: 'Ci sono movimenti sospesi: restano fuori dal documento.',
  ARRETRATI_PRESENTI: 'Il documento contiene arretrati di canoni fissi di periodi precedenti.',
  BOLLO_NON_ADDEBITATO: 'Il bollo è dovuto ma il contratto non lo addebita al cliente.',
  DESTINATARIO_ASSENTE:
    "Il cliente non ha un codice destinatario né una PEC: sarà consegnato nell'area riservata.",
  FPA_DA_FIRMARE: "Fattura verso la pubblica amministrazione: l'XML va firmato prima dell'invio.",
  DATA_OLTRE_TERMINE_DIFFERITA:
    'La data supera il 15 del mese successivo al periodo: la fattura differita è emessa oltre il termine.',
}

/**
 * Messaggio «in uso» quando a citare e' un documento di fatturazione (Q37): anche una bozza o
 * un'anteprima aperta lo tiene occupato, e si libera scartando le anteprime.
 */
export const MESSAGGIO_IN_USO_DA_DOCUMENTI =
  'È usato da documenti di fatturazione, anche da anteprime aperte: scarta le anteprime per liberarlo.'

/** Una segnalazione di calcolo. `dettaglio` non contiene id ne' dati personali. */
export interface Segnalazione<C extends string> {
  codice: C
  dettaglio?: string
}

const LUNGHEZZA_MASSIMA_TESTO_BREVE = 200

/** Testo breve (motivo di annullo/storno, nota di presa d'atto): da 1 a 200 caratteri dopo trim. */
export function validaTestoBreve(
  testo: unknown
): { ok: true; valore: string } | { ok: false; errore: string } {
  if (typeof testo !== 'string') return { ok: false, errore: 'Il testo è obbligatorio.' }
  const valore = testo.trim()
  if (valore.length === 0) return { ok: false, errore: 'Il testo è obbligatorio.' }
  if (valore.length > LUNGHEZZA_MASSIMA_TESTO_BREVE) {
    return {
      ok: false,
      errore: `Il testo può avere al massimo ${LUNGHEZZA_MASSIMA_TESTO_BREVE} caratteri.`,
    }
  }
  return { ok: true, valore }
}

/** Tetto dei documenti numerati da una sola definitiva (400 TROPPI_DOCUMENTI oltre). */
export const TETTO_DOCUMENTI_DEFINITIVA = 500
