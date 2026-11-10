/**
 * Regole sui dati di un modello di stampa (4.7, T6), mappati sulle colonne di `company_templates`:
 * nome -> name, testoIntestazione -> header_text, testoPiePagina -> footer_text,
 * colorePrimario/Secondario -> primary_color/secondary_color, logoBase64 -> logo_base64.
 * Funzioni pure: nessun I/O. Il servizio le applica e traduce gli errori in 400.
 */
import { esaminaLogo } from './logo'

export const AMBITI_MODELLO = ['GENERALE', 'FIR', 'DISTINTA_RITIRI'] as const
export type AmbitoModelloStampa = (typeof AMBITI_MODELLO)[number]

export const COPIE_MIN = 1
export const COPIE_MAX = 4
export const NOME_MAX = 100
export const TESTO_MAX = 500
export const COLORE_PRIMARIO_PREDEFINITO = '#3b82f6'
export const COLORE_SECONDARIO_PREDEFINITO = '#1e40af'

const COLORE_HEX = /^#[0-9A-Fa-f]{6}$/

export interface DatiModelloStampa {
  nome: string
  ambito: AmbitoModelloStampa
  copie: number
  testoIntestazione: string | null
  testoPiePagina: string | null
  colorePrimario: string
  coloreSecondario: string
  /** Base64 puro (senza `data:`): PNG o JPEG, al massimo 256 KiB. */
  logoBase64: string | null
}

const testoOnull = (t: string | null | undefined): string | null => {
  const v = typeof t === 'string' ? t.trim() : ''
  return v === '' ? null : v
}

/** Taglia gli spazi, porta i testi vuoti a null e il logo a base64 puro (se riconoscibile). */
export function normalizzaModello(d: DatiModelloStampa): DatiModelloStampa {
  let logo = testoOnull(d.logoBase64)
  if (logo !== null) {
    const esito = esaminaLogo(logo)
    if (esito.ok) logo = esito.base64
  }
  return {
    ...d,
    nome: typeof d.nome === 'string' ? d.nome.trim() : d.nome,
    testoIntestazione: testoOnull(d.testoIntestazione),
    testoPiePagina: testoOnull(d.testoPiePagina),
    logoBase64: logo,
  }
}

/** Errori in italiano, uno per regola violata; vuoto se il modello e' valido. */
export function validaModello(d: DatiModelloStampa): string[] {
  const errori: string[] = []
  if (typeof d.nome !== 'string' || d.nome.length < 1 || d.nome.length > NOME_MAX) {
    errori.push(`Il nome è obbligatorio e non può superare ${NOME_MAX} caratteri.`)
  }
  if (!(AMBITI_MODELLO as readonly string[]).includes(d.ambito)) {
    errori.push('L’ambito deve essere GENERALE, FIR o DISTINTA_RITIRI.')
  }
  if (!Number.isInteger(d.copie) || d.copie < COPIE_MIN || d.copie > COPIE_MAX) {
    errori.push(`Le copie devono essere un intero fra ${COPIE_MIN} e ${COPIE_MAX}.`)
  }
  for (const c of [d.colorePrimario, d.coloreSecondario]) {
    if (typeof c !== 'string' || !COLORE_HEX.test(c)) {
      errori.push('I colori devono essere nel formato #RRGGBB.')
      break
    }
  }
  if (d.testoIntestazione !== null && d.testoIntestazione.length > TESTO_MAX) {
    errori.push(`Il testo di intestazione non può superare ${TESTO_MAX} caratteri.`)
  }
  if (d.testoPiePagina !== null && d.testoPiePagina.length > TESTO_MAX) {
    errori.push(`Il testo del piè di pagina non può superare ${TESTO_MAX} caratteri.`)
  }
  if (d.logoBase64 !== null) {
    const esito = esaminaLogo(d.logoBase64)
    if (!esito.ok) errori.push(`Logo non valido: ${esito.motivo}.`)
  }
  return errori
}
