/**
 * Riconciliazione di un import WinWaste (piano import 3.6, I8): tipi del rapporto di destinazione e
 * dei sei confronti. Dominio puro: nessuna dipendenza da Prisma o NestJS. Mai valori personali nei
 * rapporti: solo codici, conteggi, totali e identificativi tecnici.
 */

/** Soglia sotto la quale due quantita' in kg si considerano uguali (confronto 3 e totali). */
export const SOGLIA_KG = 0.001

export type AmbitoLotto = 'ANAGRAFICHE' | 'REGISTRO' | 'GIACENZE' | 'FIR'

export interface LottoDestinazione {
  readonly id: string
  readonly ambito: AmbitoLotto
  readonly archivio: string
  readonly stato: string
  /** Conteggi registrati dal caricatore: `inserite` e' il numero di righe che portano l'id del lotto. */
  readonly inserite: number
  readonly lette: number
  readonly saltate: number
}

export interface TotaleDestinazione {
  readonly anno: number
  readonly cer: string
  readonly verso: 'CARICO' | 'SCARICO'
  readonly movimenti: number
  /** Somma in kg (unita' KG e T convertite). Mai sommata ai m3. */
  readonly kg: number
  /** Somma in m3 (unita' M3). */
  readonly m3: number
}

export interface RegistroNumerazione {
  readonly registroId: string
  readonly anno: number
  readonly conteggio: number
  readonly primo: number
  readonly ultimo: number
  /** Numeri mancanti fra primo e ultimo, al massimo `MAX_BUCHI` (poi `buchiTotali`). */
  readonly buchi: readonly number[]
  readonly buchiTotali: number
}

export const MAX_BUCHI = 200

export interface GiacenzaDestinazione {
  readonly registroId: string
  readonly cer: string
  readonly statoFisico: string
  readonly kg: number
}

export interface RentriDestinazione {
  /** Movimenti importati dai lotti. */
  readonly movimenti: number
  /** Righe di trasmissione ancora `DA_RICONCILIARE`. */
  readonly daRiconciliare: number
  /** Movimenti importati con una riga di trasmissione diversa da `DA_RICONCILIARE` o senza riga. */
  readonly nonBloccati: number
  /** Righe `DA_RICONCILIARE` che portano un identificativo RENTRI. */
  readonly conIdentificativo: number
  /** Identificativi (dell'ente, non dati personali) con il registro RENTRI del movimento. */
  readonly identificativi: ReadonlyArray<{ identificativo: string; registroRentri: string | null }>
}

export interface RapportoDestinazione {
  readonly lotti: readonly LottoDestinazione[]
  /** Righe con l'id di uno dei lotti, per tabella (nomi dei modelli: `Ditta`, `WasteMovement`...). */
  readonly righePerTabella: Readonly<Record<string, number>>
  readonly movimentiPerVerso: Readonly<Record<'CARICO' | 'SCARICO', number>>
  readonly totali: readonly TotaleDestinazione[]
  readonly numerazione: readonly RegistroNumerazione[]
  /** Numeri duplicati per (registro, anno): impossibili per l'unico del database, la prova resta. */
  readonly collisioniNumerazione: number
  readonly firImportati: number
  readonly giacenze: readonly GiacenzaDestinazione[]
  readonly rentri: RentriDestinazione
}

export type EsitoVoce = 'OK' | 'DIFFERENZA'
export type EsitoConfronto = 'OK' | 'DIFFERENZE' | 'NON_APPLICABILE' | 'NON_VERIFICATO'

export type Valore = number | string | null

export interface VoceConfronto {
  /** Chiave stabile della voce dentro il confronto (serve ad accettare una differenza). */
  readonly chiave: string
  readonly descrizione: string
  readonly sorgente: Valore
  readonly destinazione: Valore
  readonly esito: EsitoVoce
}

export interface ConfrontoRiconciliazione {
  readonly numero: 1 | 2 | 3 | 4 | 5
  readonly titolo: string
  readonly esito: EsitoConfronto
  /** Perche' il confronto non si applica o non e' verificato. */
  readonly nota?: string
  readonly voci: readonly VoceConfronto[]
}

/** Giacenza attesa al taglio per CER (kg), da `migrazione:prepara`: opzionale, vedi confronto 3. */
export interface GiacenzaAttesa {
  readonly cer: string
  readonly kg: number
}

export interface Accettazione {
  readonly motivo: string
  readonly da: string
  readonly il: string
}

/** Chiave di una differenza accettabile: `<numero confronto>:<chiave voce>`. */
export type ChiaveDifferenza = string

export const chiaveDifferenza = (numero: number, chiave: string): ChiaveDifferenza =>
  `${numero}:${chiave}`

/** Esito di una verifica in sola lettura su RENTRI per un identificativo. */
export type EsitoVerificaRentri = 'PRESENTE' | 'ASSENTE' | 'NON_RAGGIUNGIBILE'

export interface VerificaRentri {
  readonly identificativo: string
  readonly esito: EsitoVerificaRentri
}

export interface Confronto6Campione {
  readonly seme: string
  readonly richiesti: number
  readonly movimenti: number
  readonly fir: number
}

/** Contenuto di `rapporti_riconciliazione.esiti`. */
export interface EsitiRiconciliazione {
  readonly formato: 'wasteflow-riconciliazione/1'
  readonly archivioSorgente: string
  readonly hashRapportoSorgente: string
  readonly confronti: readonly ConfrontoRiconciliazione[]
  readonly campione: Confronto6Campione
  readonly accettazioni: Readonly<Record<ChiaveDifferenza, Accettazione>>
}
