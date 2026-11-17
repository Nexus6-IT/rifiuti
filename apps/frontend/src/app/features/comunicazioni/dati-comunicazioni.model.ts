/** Dati per i tracciati dei consorzi (4.9c-f). Backend: `/comunicazioni/dati`. */

export type TracciatoDati = 'CONOU' | 'COBAT' | 'ORR'
export type ConsorzioConfigurabile = 'CONOU' | 'COBAT' | 'ORSO' | 'ORR'

export interface DatiConou {
  prodotto?: 'A' | 'B' | 'C' | 'E' | 'G'
  percentualeOlio?: number
  causale?: 'B' | 'E' | 'U' | 'M' | 'D' | 'L'
  scaricoInterno?: boolean
}

export interface DatiCobat {
  tipoMovimento?: number
  causa?: number
  pgf?: 'A' | 'B' | 'C' | 'D' | 'E'
}

export type DatiMovimento = DatiConou | DatiCobat | Record<string, unknown>

export interface DatiTracciatoVista {
  tracciato: TracciatoDati
  dati: DatiMovimento
  versioneSchema: number
  aggiornatoIl: string
}

export interface DatiMovimentoRisposta {
  /** `null` se il movimento non ha dati per quel tracciato. */
  dati: DatiTracciatoVista | null
  puoModificare: boolean
}

export interface AnagraficaComunicazioni {
  sedeDittaId: string
  eComune: boolean
  codiceIstatComune: string | null
  codiceAteco: string | null
  codiceOrso: string | null
  alboDataIscrizione: string | null
  alboClassi: string | null
  autorizzazioneData: string | null
  legaleRappresentanteCognome: string | null
  legaleRappresentanteNome: string | null
  esclusaOrr: boolean
}

export type InputAnagraficaComunicazioni = Partial<Omit<AnagraficaComunicazioni, 'sedeDittaId'>>

export type RisoluzioneIstat =
  | { codice: string; origine: 'FORZATO' | 'DA_NOME' }
  | {
      codice: null
      motivo: 'COMUNE_NON_TROVATO' | 'COMUNE_AMBIGUO' | 'COMUNE_O_PROVINCIA_MANCANTE'
    }

export interface AnagraficaComunicazioniRisposta {
  anagrafica: AnagraficaComunicazioni
  istat: RisoluzioneIstat
  puoModificare: boolean
}

export interface ConfigurazioneComunicazioni {
  unitaLocaleId: string
  consorzio: ConsorzioConfigurabile
  /** `false` = la sede non ha una configurazione salvata: i dati sono i predefiniti. */
  salvata: boolean
  dati: Record<string, unknown>
}

export interface ConfigurazioneComunicazioniRisposta extends ConfigurazioneComunicazioni {
  puoModificare: boolean
}

/** Elenco di errori di validazione restituito dal backend (`details.errori`). */
export function erroriDaRisposta(err: unknown): string[] {
  const e = err as { error?: { details?: { errori?: unknown }; message?: unknown } } | null
  const lista = e?.error?.details?.errori
  if (Array.isArray(lista)) return lista.filter((x): x is string => typeof x === 'string')
  const m = e?.error?.message
  return typeof m === 'string' ? [m] : []
}

export const MOTIVI_ISTAT: Readonly<Record<string, string>> = {
  COMUNE_NON_TROVATO: 'Comune non trovato fra i comuni ISTAT: indica il codice a mano.',
  COMUNE_AMBIGUO: 'Più comuni con questo nome nella provincia: indica il codice a mano.',
  COMUNE_O_PROVINCIA_MANCANTE: 'La sede non ha comune o provincia.',
}
