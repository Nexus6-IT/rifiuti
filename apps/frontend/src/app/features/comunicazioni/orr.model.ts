import type { AvvisoComunicazione, ComunicazioneVista } from './comunicazioni.model'
import { nomeMese } from './comunicazioni.model'

/** Contratto API della 4.9f (`/comunicazioni/orr`): un file O.R.R. Campania per sede e attività. */

export type AttivitaOrr = 'TRA' | 'STO' | 'SMA' | 'REC' | 'FRA' | 'ROT' | 'AUT'

export const ATTIVITA_ORR_ETICHETTE: Readonly<Record<AttivitaOrr, string>> = {
  TRA: 'Trasportatore',
  STO: 'Stoccaggio',
  SMA: 'Smaltimento',
  REC: 'Recupero',
  FRA: 'Frantumatore',
  ROT: 'Rottamatore',
  AUT: 'Autodemolitore',
}

/** Dove si corregge un avviso (D14). */
export type CorrezioneAvviso =
  | { tipo: 'MOVIMENTO' }
  | { tipo: 'ANAGRAFICA_SEDE'; sedeDittaId: string }
  | { tipo: 'CONFIGURAZIONE_SEDE' }

export interface AvvisoOrr extends AvvisoComunicazione {
  bloccante: boolean
  correzione?: CorrezioneAvviso
}

export interface AnteprimaFileOrr {
  attivita: AttivitaOrr
  tracciato: string
  versione: string
  affidabilita: 'UFFICIALE' | 'RICAVATO_WINWASTE'
  notaAffidabilita: string
  numeroRecord: number
  numeroMovimenti: number
  avvisi: AvvisoOrr[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneVista | null
}

export interface AnteprimaOrr {
  unitaLocaleId: string
  periodo: { da: string; a: string }
  file: AnteprimaFileOrr[]
  avvisiGenerali: AvvisoOrr[]
  bloccanti: boolean
  nessunDato: boolean
  puoGenerare?: boolean
}

export interface ComunicazioneOrr extends ComunicazioneVista {
  attivita: AttivitaOrr
}

export interface GeneraOrrRisposta {
  file: ComunicazioneOrr[]
}

/** Avviso fisso mostrato sulla scheda (D8): il tracciato non e' stato verificato con l'ORGR. */
export const AVVISO_TRACCIATO_ORR =
  'Tracciato ricavato da WinWaste, da confermare con un file reale. Dal 2017 la Campania usa O.R.So.: verifica che l’Osservatorio accetti ancora questo file prima di caricarlo.'

/** Primo e ultimo giorno di un intervallo di mesi interi `AAAA-MM-GG`. */
export function periodoOrr(anno: number, meseDa: number, meseA: number): { da: string; a: string } {
  const mm = (m: number) => String(m).padStart(2, '0')
  const ultimo = new Date(Date.UTC(anno, meseA, 0)).getUTCDate()
  return {
    da: `${anno}-${mm(meseDa)}-01`,
    a: `${anno}-${mm(meseA)}-${String(ultimo).padStart(2, '0')}`,
  }
}

export function etichettaPeriodoOrr(da: string, a: string): string {
  const md = Number(da.slice(5, 7))
  const ma = Number(a.slice(5, 7))
  const anno = da.slice(0, 4)
  return md === ma ? `${nomeMese(md)} ${anno}` : `${nomeMese(md)} – ${nomeMese(ma)} ${anno}`
}
