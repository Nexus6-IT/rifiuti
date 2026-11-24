/**
 * Corpi delle due operazioni che completano la fase iniziale di un FIR digitale (FIR in viaggio, P2):
 * `POST /{numero_fir}/quantita` (`QuantitaRifiutoModel`) e `POST /{numero_fir}/trasporto` per il
 * trasporto terrestre (`DatiTrasportoTerrestreModel`).
 *
 * Funzioni PURE e FAIL-CLOSED (stessa regola di `mappa-rifiuto`/`mappa-parti`): un dato mancante o
 * oltre i limiti del contratto solleva {@link DatoMancantePerRentriError}; nessun valore e' inventato.
 * Il giudice dei corpi prodotti e' il validatore del finto RENTRI (v. lo spec accanto).
 *
 * Il corpo di `/quantita` e il blocco `rifiuto.quantita` della creazione hanno gli stessi campi.
 */
import { DatoMancantePerRentriError } from './mappa-parti'
import { QuantitaRentri, traduciQuantita } from './mappa-quantita'

/** Limiti del contratto (`formulari.yaml`). */
export const LIMITE_NUMERO_COLLI = 50
export const LIMITE_NOME_CONDUCENTE = 50
export const LIMITE_TARGA = 10
export const LIMITE_PERCORSO = 250
export const LIMITE_ANNOTAZIONI = 10000

/** `QuantitaRifiutoModel`. */
export interface QuantitaRifiutoRentri {
  quantita: QuantitaRentri
  verificato_in_partenza?: boolean
  numero_colli?: string
  rinfusa?: boolean
}

export interface DatiQuantitaInput {
  valore: number
  /** Unita' del FIR (`kg`, `litri`, `t`, ...): la converte {@link traduciQuantita}. */
  unitaMisura: string
  numeroColli?: number | string | null
  rinfusa?: boolean | null
  verificatoInPartenza?: boolean | null
}

/**
 * Mappa quantita', colli, rinfusa e verifica in partenza.
 *
 * Il contratto chiede il numero di colli «in caso non si imposti rinfusa a true»: senza colli e senza
 * rinfusa il corpo non e' completo e si rifiuta qui, prima di arrivare all'ente. Con `rinfusa: true`
 * i colli non si inviano (il rifiuto non e' partizionato in colli).
 */
export function mappaQuantitaRifiuto(input: DatiQuantitaInput): QuantitaRifiutoRentri {
  const quantita = traduciQuantita(input.valore, input.unitaMisura)

  const corpo: QuantitaRifiutoRentri = { quantita }
  if (input.verificatoInPartenza !== undefined && input.verificatoInPartenza !== null) {
    corpo.verificato_in_partenza = input.verificatoInPartenza
  }

  if (input.rinfusa === true) {
    corpo.rinfusa = true
    return corpo
  }

  const colli =
    input.numeroColli === null || input.numeroColli === undefined
      ? ''
      : String(input.numeroColli).trim()
  if (colli === '') {
    throw new DatoMancantePerRentriError(
      'rifiuto',
      'numero_colli',
      'indicare il numero di colli oppure segnare il rifiuto come rinfusa'
    )
  }
  if (colli.length > LIMITE_NUMERO_COLLI) {
    throw new DatoMancantePerRentriError(
      'rifiuto',
      'numero_colli',
      `al massimo ${LIMITE_NUMERO_COLLI} caratteri`
    )
  }
  corpo.numero_colli = colli
  if (input.rinfusa === false) corpo.rinfusa = false
  return corpo
}

/** `DatiTrasportoTerrestreModel`. */
export interface DatiTrasportoTerrestreRentri {
  data_ora_inizio_trasporto: string
  conducente: { nome: string; cognome: string }
  targa_automezzo?: string
  targa_rimorchio?: string
  percorso?: string
  presa_in_carico_rimorchio_precedente?: boolean
  annotazioni?: string
}

export interface DatiTrasportoTerrestreInput {
  conducenteNome: string
  conducenteCognome: string
  targaAutomezzo?: string | null
  targaRimorchio?: string | null
  percorso?: string | null
  dataOraInizioTrasporto: Date
  annotazioni?: string | null
}

function pulisci(valore: string | null | undefined): string {
  return (valore ?? '').trim()
}

function richiediTesto(valore: string, campo: string, massimo: number): string {
  if (valore === '') {
    throw new DatoMancantePerRentriError('trasporto', campo)
  }
  if (valore.length > massimo) {
    throw new DatoMancantePerRentriError('trasporto', campo, `al massimo ${massimo} caratteri`)
  }
  return valore
}

function facoltativo(valore: string, campo: string, massimo: number): string | undefined {
  if (valore === '') return undefined
  if (valore.length > massimo) {
    throw new DatoMancantePerRentriError('trasporto', campo, `al massimo ${massimo} caratteri`)
  }
  return valore
}

/**
 * Mappa i dati del trasporto terrestre. Conducente (nome e cognome in campi separati, mai spezzati
 * sull'ultimo spazio) obbligatorio; targhe in maiuscolo (come WinWaste), con almeno una delle due:
 * il contratto vuole la targa dell'automezzo «se non si indica una targa per il rimorchio».
 */
export function mappaDatiTrasportoTerrestre(
  input: DatiTrasportoTerrestreInput
): DatiTrasportoTerrestreRentri {
  const nome = richiediTesto(
    pulisci(input.conducenteNome),
    'conducente.nome',
    LIMITE_NOME_CONDUCENTE
  )
  const cognome = richiediTesto(
    pulisci(input.conducenteCognome),
    'conducente.cognome',
    LIMITE_NOME_CONDUCENTE
  )

  const targaAutomezzo = facoltativo(
    pulisci(input.targaAutomezzo).toUpperCase(),
    'targa_automezzo',
    LIMITE_TARGA
  )
  const targaRimorchio = facoltativo(
    pulisci(input.targaRimorchio).toUpperCase(),
    'targa_rimorchio',
    LIMITE_TARGA
  )
  if (!targaAutomezzo && !targaRimorchio) {
    throw new DatoMancantePerRentriError(
      'trasporto',
      'targa_automezzo',
      "serve la targa dell'automezzo o quella del rimorchio"
    )
  }

  const percorso = facoltativo(pulisci(input.percorso), 'percorso', LIMITE_PERCORSO)
  const annotazioni = facoltativo(pulisci(input.annotazioni), 'annotazioni', LIMITE_ANNOTAZIONI)

  const inizio = input.dataOraInizioTrasporto
  if (!(inizio instanceof Date) || Number.isNaN(inizio.getTime())) {
    throw new DatoMancantePerRentriError(
      'trasporto',
      'data_ora_inizio_trasporto',
      'data e ora di inizio non valide'
    )
  }

  return {
    data_ora_inizio_trasporto: inizio.toISOString(),
    conducente: { nome, cognome },
    ...(targaAutomezzo ? { targa_automezzo: targaAutomezzo } : {}),
    ...(targaRimorchio ? { targa_rimorchio: targaRimorchio } : {}),
    ...(percorso ? { percorso } : {}),
    ...(annotazioni ? { annotazioni } : {}),
  }
}
