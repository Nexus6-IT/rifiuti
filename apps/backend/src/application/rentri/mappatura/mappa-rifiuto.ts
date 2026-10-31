/**
 * Mappatura dei dati del rifiuto di un FIR interno verso `DatiRifiutoModel`
 * del contratto ufficiale RENTRI (`docs/contracts/rentri/formulari.yaml`).
 *
 * Funzione PURA: nessun accesso a database, HTTP o framework NestJS.
 *
 * Regola non negoziabile: FAIL-CLOSED. Se un valore interno non è
 * traducibile con certezza in un codice ammesso dal contratto, questa
 * mappatura non indovina e non applica un default — solleva
 * `ValoreNonTraducibilePerRentriError`. Trasmettere un dato sbagliato a un
 * ente pubblico (es. lo stato fisico) è peggio che rifiutare l'invio.
 */

/** Provenienza del rifiuto secondo il contratto RENTRI (`ProvenienzaRifiuto`). */
export type ProvenienzaRifiutoRentri = 'U' | 'S'

/** Stato fisico secondo il contratto RENTRI (`StatiFisici`). */
export type StatoFisicoRentri = 'SP' | 'S' | 'FP' | 'L' | 'VS'

/**
 * Sottoinsieme di `DatiRifiutoModel` prodotto da questo mapper.
 *
 * Vengono valorizzate solo le proprietà che il FIR interno può popolare con
 * certezza (`codice_eer`, `provenienza`, `stato_fisico`, `descrizione`).
 * Le altre proprietà del contratto (`caratteristiche_pericolo`, `quantita`,
 * `dati_adr`, ecc.) non rientrano nello scopo di questo mapper.
 */
export interface DatiRifiutoRentri {
  codice_eer: string
  provenienza: ProvenienzaRifiutoRentri
  stato_fisico: StatoFisicoRentri
  descrizione?: string
}

/** Dati del rifiuto così come li conosce il dominio FIR interno. */
export interface DatiRifiutoFIR {
  /** Codice EER (es. `20.03.01`), corrisponde a `codice_eer`. */
  cerCode: string
  /**
   * Stato fisico in testo libero (`wastePhysicalState` su Prisma, VarChar
   * senza vincolo di enum). Nel repository coesistono forme diverse per lo
   * stesso concetto (es. `'Solido'`, `'SOLIDO_NON_POLVERULENTO'`) — vedi
   * `TABELLA_STATI_FISICI` più sotto per l'elenco esatto riconosciuto.
   */
  wastePhysicalState?: string | null
  /** Descrizione libera del rifiuto (`wasteDescription`). */
  wasteDescription?: string | null
}

/**
 * Errore di dominio: un valore interno non ha una traduzione certa in un
 * codice del contratto RENTRI. Il messaggio in italiano riporta sempre il
 * valore ricevuto e i valori ammessi, cosi' chi legge il log sa cosa
 * correggere senza dover aprire il contratto OpenAPI.
 */
export class ValoreNonTraducibilePerRentriError extends Error {
  constructor(
    public readonly campo: string,
    public readonly valoreRicevuto: string | null | undefined,
    public readonly valoriAmmessi: readonly string[]
  ) {
    super(
      `Impossibile tradurre il campo "${campo}" per RENTRI: valore interno ` +
        `${valoreRicevuto === null || valoreRicevuto === undefined ? 'mancante' : `"${valoreRicevuto}"`} ` +
        `non riconosciuto. Valori ammessi: ${valoriAmmessi.join(', ')}.`
    )
    this.name = 'ValoreNonTraducibilePerRentriError'
  }
}

/**
 * Tabella di traduzione esplicita: valore interno normalizzato (maiuscolo,
 * spazi/trattini collassati a underscore) -> codice `StatiFisici` RENTRI.
 *
 * PONTE TEMPORANEO: la soluzione corretta è un campo codificato (enum) nel
 * modello FIR per lo stato fisico, non più una VarChar libera. Finché non
 * esiste, questa tabella collega i valori osservati nel repository (form di
 * registro `STATI_FISICI`, export MUD `StatoFisico`, dati di test) ai 5
 * codici ammessi dal contratto. Qualunque valore non presente qui è
 * fail-closed: niente default.
 *
 * Nota: gli stati interni "Gassoso"/"AERIFORME" e "Misto"/"ALTRO" non hanno
 * alcun codice RENTRI corrispondente (il contratto ammette solo
 * SP/S/FP/L/VS) e restano perciò fuori tabella, quindi non traducibili.
 */
const TABELLA_STATI_FISICI: Readonly<Record<string, StatoFisicoRentri>> = {
  // In polvere o pulverulento (SP)
  POLVERE: 'SP',
  SOLIDO_POLVERULENTO: 'SP',
  IN_POLVERE_O_PULVERULENTO: 'SP',

  // Solido (S)
  SOLIDO: 'S',
  SOLIDO_NON_POLVERULENTO: 'S',

  // Fangoso (FP)
  FANGOSO: 'FP',
  FANGOSO_PALABILE: 'FP',

  // Liquido (L)
  LIQUIDO: 'L',

  // Vischioso sciropposo (VS)
  VISCHIOSO_SCIROPPOSO: 'VS',
  VISCOSO_SCIROPPOSO: 'VS',
}

const CODICI_STATI_FISICI_AMMESSI: readonly StatoFisicoRentri[] = ['SP', 'S', 'FP', 'L', 'VS']

/** Normalizza un valore libero per il confronto con la tabella di traduzione. */
function normalizzaChiave(valore: string): string {
  return valore
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
}

/** Traduce lo stato fisico interno in un codice `StatiFisici` RENTRI, o fallisce. */
export function traduciStatoFisico(
  wastePhysicalState: string | null | undefined
): StatoFisicoRentri {
  if (!wastePhysicalState || wastePhysicalState.trim() === '') {
    throw new ValoreNonTraducibilePerRentriError(
      'stato_fisico',
      wastePhysicalState,
      CODICI_STATI_FISICI_AMMESSI
    )
  }

  const chiave = normalizzaChiave(wastePhysicalState)
  const codice = TABELLA_STATI_FISICI[chiave]
  if (!codice) {
    throw new ValoreNonTraducibilePerRentriError(
      'stato_fisico',
      wastePhysicalState,
      CODICI_STATI_FISICI_AMMESSI
    )
  }
  return codice
}

/**
 * Un codice EER è "generico" (`.99`) quando l'ultimo gruppo di due cifre è
 * `99` — in quel caso il contratto richiede obbligatoriamente `descrizione`.
 * Accetta sia la forma puntata (`20.03.99`) sia quella senza punti
 * (`200399`), le uniche osservate nel dominio FIR.
 */
export function codiceEerRichiedeDescrizione(cerCode: string): boolean {
  const soloCifre = cerCode.replace(/\D/g, '')
  return soloCifre.endsWith('99')
}

/**
 * Mappa i dati del rifiuto di un FIR interno in `DatiRifiutoModel` RENTRI.
 *
 * @param datiRifiuto dati del rifiuto cosi' come persistiti sul FIR.
 * @param provenienza provenienza (`U`/`S`) — il FIR interno non la
 *   registra, quindi va sempre fornita esplicitamente dal chiamante. Non
 *   viene mai dedotta dal codice EER.
 * @throws ValoreNonTraducibilePerRentriError se lo stato fisico non è
 *   riconosciuto, se la provenienza manca, o se il codice EER è di tipo
 *   `.99` e manca la descrizione.
 */
export function mappaRifiuto(
  datiRifiuto: DatiRifiutoFIR,
  provenienza: ProvenienzaRifiutoRentri | null | undefined
): DatiRifiutoRentri {
  if (provenienza !== 'U' && provenienza !== 'S') {
    throw new ValoreNonTraducibilePerRentriError('provenienza', provenienza, ['U', 'S'])
  }

  const statoFisico = traduciStatoFisico(datiRifiuto.wastePhysicalState)

  const descrizione = datiRifiuto.wasteDescription?.trim() || undefined
  if (codiceEerRichiedeDescrizione(datiRifiuto.cerCode) && !descrizione) {
    throw new ValoreNonTraducibilePerRentriError('descrizione', descrizione, [
      `qualunque testo non vuoto (obbligatorio perché il codice EER ` +
        `"${datiRifiuto.cerCode}" è di tipo .99, generico)`,
    ])
  }

  return {
    codice_eer: datiRifiuto.cerCode,
    provenienza,
    stato_fisico: statoFisico,
    ...(descrizione ? { descrizione } : {}),
  }
}
