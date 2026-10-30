/**
 * Mappatura delle PARTI di un FIR interno (produttore, destinatario, trasportatore)
 * verso i modelli del contratto ufficiale RENTRI (docs/contracts/rentri/formulari.yaml).
 *
 * Regole di progettazione (vedi anche i commenti puntuali sotto):
 * - Funzioni PURE: nessun accesso a database, nessun HTTP, nessuna dipendenza NestJS.
 * - FAIL-CLOSED: se un dato obbligatorio manca o non e' traducibile, si solleva
 *   {@link DatoMancantePerRentriError} invece di inviare dati inventati o vuoti a RENTRI.
 * - La risoluzione di comune -> comune_id (codice ISTAT del catalogo RENTRI) NON e'
 *   implementata qui: viene richiesta tramite la porta {@link RisolutoreComune}.
 */

/** Enum "TipoTrasporto" del contratto RENTRI (components.schemas.TipoTrasporto). */
export type TipoTrasporto = 'Terrestre' | 'Ferroviario' | 'Marittimo'

/**
 * Pattern TOLLERANTE del numero di iscrizione all'Albo Gestori Ambientali: due lettere,
 * slash, da una a sei cifre. RENTRI pretende sempre sei cifre con gli zeri davanti
 * (es. "AB/123456"), ma un trasportatore scrive spesso il proprio numero senza gli zeri
 * (es. "MI/7490"): se sappiamo cosa intendeva, lo normalizziamo invece di rifiutarlo
 * (vedi {@link normalizzaNumeroIscrizioneAlbo}). Rifiutiamo solo quando e' davvero
 * ambiguo: piu' di sei cifre, o una sigla che non e' di due lettere.
 */
const PATTERN_NUMERO_ISCRIZIONE_ALBO = /^([A-Za-z]{2})\/([0-9]{1,6})$/

/**
 * Normalizza il numero di iscrizione all'Albo nel formato preteso da RENTRI (due
 * lettere maiuscole, slash, sei cifre con zeri davanti). Restituisce `null` quando il
 * valore e' ambiguo e non va indovinato (sigla non di due lettere, o piu' di sei cifre):
 * in quel caso e' compito del chiamante sollevare {@link DatoMancantePerRentriError}.
 *
 * Allineare a destra con zeri e' sicuro perche' "MI/7490" e "MI/007490" sono lo stesso
 * numero: non si inventano cifre, non si taglia nulla, non si indovina una sigla.
 */
function normalizzaNumeroIscrizioneAlbo(valoreGrezzo: string): string | null {
  const corrispondenza = PATTERN_NUMERO_ISCRIZIONE_ALBO.exec(valoreGrezzo)
  if (!corrispondenza) {
    return null
  }
  const [, sigla, cifre] = corrispondenza
  return `${sigla.toUpperCase()}/${cifre.padStart(6, '0')}`
}

/**
 * Errore di dominio sollevato quando un dato obbligatorio per la trasmissione a RENTRI
 * manca, e' vuoto, oppure non rispetta il formato richiesto dal contratto ufficiale.
 * Il messaggio identifica sempre la PARTE (produttore/destinatario/trasportatore) e il
 * CAMPO mancante o non valido, per evitare diagnosi al buio in produzione.
 */
export class DatoMancantePerRentriError extends Error {
  constructor(
    public readonly parte: string,
    public readonly campo: string,
    dettaglio?: string
  ) {
    super(
      `Dato mancante per RENTRI: manca (o non e' valido) il campo "${campo}" per la parte "${parte}"` +
        (dettaglio ? ` — ${dettaglio}` : '') +
        '.'
    )
    this.name = 'DatoMancantePerRentriError'
  }
}

/**
 * Porta per la risoluzione di un comune anagrafico (nome + provincia) nel codice
 * "comune_id" del catalogo RENTRI (GET /codifiche/v1.0/comuni). Questo modulo NON
 * implementa la porta: la riceve come parametro e resta cosi' puro e testabile.
 * Deve restituire `null` quando il comune non e' risolvibile — in tal caso il mapper
 * fallisce in modo esplicito (fail-closed), non prova a indovinare un codice.
 */
export interface RisolutoreComune {
  risolvi(nomeComune: string, provinciaSigla: string): Promise<string | null>
}

/** Indirizzo cosi' come lo abbiamo nelle anagrafiche interne (Produttore/Trasportatore/Destinatario). */
export interface IndirizzoParte {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

/** Dati minimi comuni a tutte le parti, cosi' come li abbiamo in anagrafica. */
export interface DatiProduttoreParte {
  ragioneSociale: string
  partitaIVA: string
  indirizzo: IndirizzoParte
}

export interface DatiDestinatarioParte {
  ragioneSociale: string
  partitaIVA: string
  indirizzo: IndirizzoParte
}

export interface DatiTrasportatoreParte {
  ragioneSociale: string
  partitaIVA: string
  /** Numero di iscrizione all'Albo Gestori Ambientali, se presente in anagrafica. */
  numeroIscrizione?: string | null
}

/** components.schemas.ComuneModel (variante italiana di IndirizzoModel.citta). */
export interface ComuneRentri {
  comune_id: string
}

/** components.schemas.IndirizzoModel, limitato al caso "comune italiano" (mai citta' estera). */
export interface IndirizzoRentri {
  citta: ComuneRentri
  indirizzo: string
  civico: string
  cap: string
}

/** components.schemas.DatiProduttoreFormularioModel (variante "completa", senza num_iscr_sito). */
export interface DatiProduttoreRentri {
  denominazione: string
  codice_fiscale: string
  indirizzo: IndirizzoRentri
}

/** components.schemas.DatiDestinatarioFormularioModel (variante "completa", senza num_iscr_sito). */
export interface DatiDestinatarioRentri {
  denominazione: string
  codice_fiscale: string
  indirizzo: IndirizzoRentri
}

/** components.schemas.DatiTrasportatoreFormularioModel (variante "completa", senza num_iscr_sito). */
export interface DatiTrasportatoreRentri {
  denominazione: string
  codice_fiscale: string
  tipo_trasporto: TipoTrasporto
  numero_iscrizione_albo?: string
}

/** Solleva DatoMancantePerRentriError se il valore e' assente/vuoto, altrimenti lo ritorna. */
function richiedi(valore: string | null | undefined, parte: string, campo: string): string {
  if (valore === null || valore === undefined || valore.trim().length === 0) {
    throw new DatoMancantePerRentriError(parte, campo)
  }
  return valore
}

/**
 * Mappa l'indirizzo di una parte nel modello IndirizzoModel di RENTRI, risolvendo il
 * comune tramite la porta fornita dal chiamante.
 */
async function mappaIndirizzo(
  indirizzo: IndirizzoParte,
  risolutoreComune: RisolutoreComune,
  nomeParte: string
): Promise<IndirizzoRentri> {
  const via = richiedi(indirizzo.via, nomeParte, 'indirizzo.via')
  const civico = richiedi(indirizzo.civico, nomeParte, 'indirizzo.civico')
  const cap = richiedi(indirizzo.cap, nomeParte, 'indirizzo.cap')
  const comune = richiedi(indirizzo.comune, nomeParte, 'indirizzo.comune')
  const provincia = richiedi(indirizzo.provincia, nomeParte, 'indirizzo.provincia')

  const comuneId = await risolutoreComune.risolvi(comune, provincia)
  if (comuneId === null) {
    throw new DatoMancantePerRentriError(
      nomeParte,
      'indirizzo.citta.comune_id',
      `il comune "${comune}" (provincia ${provincia}) non e' stato risolto nel catalogo RENTRI`
    )
  }

  return {
    citta: { comune_id: comuneId },
    indirizzo: via,
    civico,
    cap,
  }
}

/**
 * Mappa il produttore interno nel modello DatiProduttoreFormularioModel di RENTRI.
 *
 * NOTA: "codice_fiscale" viene valorizzato con il campo `partitaIVA` della parte, che chi
 * costruisce il payload riempie con il codice fiscale della ditta se c'e', altrimenti con la
 * partita IVA (F2-10): per i soggetti con CF distinto o senza P.IVA il dato e' quello giusto.
 */
export async function mappaProduttore(
  produttore: DatiProduttoreParte,
  risolutoreComune: RisolutoreComune
): Promise<DatiProduttoreRentri> {
  const denominazione = richiedi(produttore.ragioneSociale, 'produttore', 'ragioneSociale')
  const codiceFiscale = richiedi(produttore.partitaIVA, 'produttore', 'partitaIVA')
  const indirizzo = await mappaIndirizzo(produttore.indirizzo, risolutoreComune, 'produttore')

  return {
    denominazione,
    codice_fiscale: codiceFiscale,
    indirizzo,
  }
}

/**
 * Mappa il destinatario interno nel modello DatiDestinatarioFormularioModel di RENTRI.
 *
 * NOTA (scelta opinabile): il contratto RENTRI espone anche "autorizzazione" (un
 * oggetto AutorizzazioneModel con ente/numero/date) e "numero_iscrizione_albo" (Albo
 * Gestori Ambientali). In anagrafica memorizziamo solo "numeroAutorizzazione" come
 * stringa libera, senza gli altri campi richiesti da AutorizzazioneModel e senza il
 * formato dell'Albo Gestori. Mapparlo su uno di quei due campi sarebbe una traduzione
 * inventata (violerebbe la regola fail-closed). Questi campi restano percio' NON
 * valorizzati: sono opzionali/nullable nel contratto.
 */
export async function mappaDestinatario(
  destinatario: DatiDestinatarioParte,
  risolutoreComune: RisolutoreComune
): Promise<DatiDestinatarioRentri> {
  const denominazione = richiedi(destinatario.ragioneSociale, 'destinatario', 'ragioneSociale')
  const codiceFiscale = richiedi(destinatario.partitaIVA, 'destinatario', 'partitaIVA')
  const indirizzo = await mappaIndirizzo(destinatario.indirizzo, risolutoreComune, 'destinatario')

  return {
    denominazione,
    codice_fiscale: codiceFiscale,
    indirizzo,
  }
}

/**
 * Mappa il trasportatore interno nel modello DatiTrasportatoreFormularioModel di RENTRI.
 *
 * NOTA: DatiTrasportatoreFormularioModel NON ha un campo "indirizzo" nel contratto
 * ufficiale (a differenza di produttore/destinatario), quindi qui non serve il
 * RisolutoreComune.
 *
 * "tipo_trasporto" non e' un dato che memorizziamo in anagrafica: deve essere fornito
 * esplicitamente dal chiamante ad ogni chiamata. Non esiste un default silenzioso:
 * se manca, si fallisce in modo esplicito.
 */
export function mappaTrasportatore(
  trasportatore: DatiTrasportatoreParte,
  tipoTrasporto: TipoTrasporto | null | undefined
): DatiTrasportatoreRentri {
  if (tipoTrasporto === null || tipoTrasporto === undefined) {
    throw new DatoMancantePerRentriError(
      'trasportatore',
      'tipo_trasporto',
      'deve essere fornito esplicitamente dal chiamante: non esiste un valore di default'
    )
  }

  const denominazione = richiedi(trasportatore.ragioneSociale, 'trasportatore', 'ragioneSociale')
  const codiceFiscale = richiedi(trasportatore.partitaIVA, 'trasportatore', 'partitaIVA')

  const risultato: DatiTrasportatoreRentri = {
    denominazione,
    codice_fiscale: codiceFiscale,
    tipo_trasporto: tipoTrasporto,
  }

  if (trasportatore.numeroIscrizione) {
    const numeroNormalizzato = normalizzaNumeroIscrizioneAlbo(trasportatore.numeroIscrizione)
    if (numeroNormalizzato === null) {
      throw new DatoMancantePerRentriError(
        'trasportatore',
        'numero_iscrizione_albo',
        `il valore "${trasportatore.numeroIscrizione}" non è normalizzabile nel formato richiesto da RENTRI (due lettere, slash, fino a sei cifre — es. "AB/123456" o "MI/7490")`
      )
    }
    risultato.numero_iscrizione_albo = numeroNormalizzato
  }

  return risultato
}
