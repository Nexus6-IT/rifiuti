import { layout, type CampoLayoutPosizionato } from '../fisso/campo-fisso'
import { LUNGHEZZA_RECORD_ORR, type AttivitaOrr } from './costanti'

/**
 * Record O.R.R. (struct `xrec` di WinWaste, 718 caratteri compreso il CRLF) e tabella di layout.
 * I nomi dei campi sono quelli di WinWaste (`docs/comunicazioni-orr-campania.md` §5); gli offset
 * si calcolano dal layout e un test li confronta con la tabella copiata dal documento (D15).
 */

/** Soggetto (produttore/detentore, trasportatore o destinatario) con sede legale e unita' locale. */
export interface SoggettoOrr {
  ragioneSociale: string
  /** Partita IVA se presente, altrimenti codice fiscale. */
  codice: string
  indirizzoSedeLegale: string
  capSedeLegale: string
  istatSedeLegale: string
  indirizzoUnitaLocale: string
  capUnitaLocale: string
  istatUnitaLocale: string
}

export interface DetentoreOrr extends SoggettoOrr {
  /** ATECO `NN.NN.NN`, oppure `00` se la sede lo ammette (`atec00`). */
  ateco: string
  /** `STO` se il produttore e' un impianto di stoccaggio, altrimenti `PRO`. */
  tipo: 'STO' | 'PRO'
}

export interface TrasportatoreOrr extends SoggettoOrr {
  /** Data di iscrizione all'Albo, `AAAA-MM-GG`. */
  alboData: string | null
  alboNumero: string
  alboClassi: string
}

export interface DestinatarioOrr extends SoggettoOrr {
  /** Data dell'autorizzazione, `AAAA-MM-GG`. */
  autorizzazioneData: string | null
  autorizzazioneNumero: string
  /** Tipo impianto, 3 caratteri (`STO`, `SMA`, `REC`, `FRA`, `ROT`, `AUT`). */
  tipoImpianto: string
}

export interface RecordOrr {
  /** Riferimento del movimento («n/anno»): serve ai messaggi di errore, non finisce nel file. */
  movimento: string
  /** Movimento di origine: collega al movimento gli avvisi sui campi (es. caratteri non rappresentabili). */
  movimentoId: string
  anno: number
  mese: number
  /** Numero del formulario, al massimo 15 caratteri. */
  formulario: string
  /** `AAAA-MM-GG`. */
  dataFormulario: string | null
  tipoDichiarante: AttivitaOrr
  cer: string
  /** Quantita' in kg: nel file diventa `kg x MOLTIPLICATORE_QUANTITA_ORR`, 11 cifre. */
  quantitaKg: number
  /** Codice operazione del rifiuto (`D15`, `R13`...), al massimo 3 caratteri. */
  destinazione: string
  /** `null` = detentore privato (`c1` = 1, campi del detentore vuoti). */
  detentore: DetentoreOrr | null
  /** `null` = nessun trasporto (`d1` = 1, campi del trasportatore vuoti). */
  trasportatore: TrasportatoreOrr | null
  destinatario: DestinatarioOrr
}

/** File O.R.R.: un solo tipo di attivita', piu' record. */
export interface DatiFileOrr {
  attivita: AttivitaOrr
  record: RecordOrr[]
}

/**
 * Campi del record nell'ordine del file. Sezioni: A formulario, B rifiuto, C detentore,
 * D trasportatore, E destinatario, F fine riga.
 */
const CAMPI = [
  ['a1', 4],
  ['a2', 2],
  ['a3', 15],
  ['a4', 8],
  ['a5', 3],
  ['b1', 6],
  ['b2', 11],
  ['b3', 3],
  ['b4', 3],
  ['c1', 1],
  ['c2', 45],
  ['c3', 16],
  ['c4', 8],
  ['c5', 45],
  ['c6', 5],
  ['c7', 6],
  ['c8', 8],
  ['c9', 45],
  ['c10', 5],
  ['c11', 6],
  ['c12', 8],
  ['c13', 3],
  ['d1', 1],
  ['d2', 45],
  ['d3', 16],
  ['d4', 8],
  ['d5', 45],
  ['d6', 5],
  ['d7', 6],
  ['d8', 8],
  ['d9', 45],
  ['d10', 5],
  ['d11', 6],
  ['d12', 8],
  ['d13', 16],
  ['d14', 30],
  ['e1', 45],
  ['e2', 16],
  ['e3', 8],
  ['e4', 45],
  ['e5', 5],
  ['e6', 6],
  ['e7', 8],
  ['e8', 45],
  ['e9', 5],
  ['e10', 6],
  ['e11', 8],
  ['e12', 16],
  ['e13', 3],
  ['F1', 2],
] as const

export type NomeCampoOrr = (typeof CAMPI)[number][0]

/** Layout del record: la somma delle lunghezze deve essere 718, altrimenti lancia. */
export const LAYOUT_ORR: readonly CampoLayoutPosizionato[] = layout(
  CAMPI.map(([nome, lunghezza]) => ({ nome, lunghezza })),
  LUNGHEZZA_RECORD_ORR
)
