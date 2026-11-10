/** Ambito di un modello di stampa (enum `AmbitoModelloStampa` del backend). */
export type AmbitoModelloStampa = 'GENERALE' | 'FIR' | 'DISTINTA_RITIRI'

export const AMBITI_MODELLO: readonly { valore: AmbitoModelloStampa; etichetta: string }[] = [
  { valore: 'GENERALE', etichetta: 'Generale' },
  { valore: 'FIR', etichetta: 'FIR' },
  { valore: 'DISTINTA_RITIRI', etichetta: 'Distinta dei ritiri' },
]

export function etichettaAmbito(ambito: AmbitoModelloStampa): string {
  return AMBITI_MODELLO.find(a => a.valore === ambito)?.etichetta ?? ambito
}

export const COPIE_MIN = 1
export const COPIE_MAX = 4
export const COLORE_PRIMARIO_PREDEFINITO = '#3b82f6'
export const COLORE_SECONDARIO_PREDEFINITO = '#1e40af'

/** Un modello di stampa (`company_templates`) com'e' restituito da `/modelli-stampa`. */
export interface ModelloStampaVista {
  id: string
  nome: string
  ambito: AmbitoModelloStampa
  copie: number
  testoIntestazione: string | null
  testoPiePagina: string | null
  colorePrimario: string
  coloreSecondario: string
  /** Solo base64 (senza prefisso `data:`): PNG o JPEG, al massimo 256 KiB. */
  logoBase64: string | null
  predefinito: boolean
  versione: number
}

/** Dati di creazione o modifica. In modifica si aggiunge `versione` (lock ottimistico). */
export interface DatiModelloStampa {
  nome: string
  ambito: AmbitoModelloStampa
  copie: number
  testoIntestazione: string | null
  testoPiePagina: string | null
  colorePrimario: string
  coloreSecondario: string
  logoBase64: string | null
}
