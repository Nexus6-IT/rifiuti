import { AvvisoComunicazione, ComunicazioneVista } from './comunicazioni.model'

/** Contratto API dei tracciati a record (4.9c-d): CONOU e COBAT. Backend: `/comunicazioni/{conou,cobat}`. */

export type ConsorzioTracciato = 'CONOU' | 'COBAT'
export type AffidabilitaTracciato = 'UFFICIALE' | 'RICAVATO_WINWASTE'

/** Dove si corregge un avviso (D14). */
export type CorrezioneAvviso =
  | { tipo: 'MOVIMENTO' }
  | { tipo: 'ANAGRAFICA_SEDE'; sedeDittaId: string }
  | { tipo: 'CONFIGURAZIONE_SEDE' }

export interface AvvisoTracciato extends AvvisoComunicazione {
  bloccante: boolean
  correzione?: CorrezioneAvviso
}

export interface ComunicazioneTracciatoVista extends ComunicazioneVista {
  affidabilita: AffidabilitaTracciato
  notaAffidabilita: string
}

export interface AnteprimaTracciato {
  unitaLocale: { id: string; nome: string }
  consorzio: string
  periodo: { da: string; a: string }
  tracciato: string
  versione: string
  affidabilita: AffidabilitaTracciato
  notaAffidabilita: string
  numeroRecord: number
  numeroMovimenti: number
  avvisi: AvvisoTracciato[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneTracciatoVista | null
  /** Ruolo effettivo nell'azienda selezionata: puo' generare e segnare «inviata». */
  puoGenerare?: boolean
}

export const TESTO_DA_CONFERMARE = 'Tracciato ricavato da WinWaste, da confermare con un file reale'

export const NOMI_CONSORZIO: Readonly<Record<ConsorzioTracciato, string>> = {
  CONOU: 'CONOU (oli minerali usati)',
  COBAT: 'COBAT (batterie)',
}

/** Il tracciato e' da confermare con un file reale: banner, etichetta nello storico e conferma. */
export function daConfermare(
  v: { affidabilita?: AffidabilitaTracciato } | null | undefined
): boolean {
  return v?.affidabilita === 'RICAVATO_WINWASTE'
}

/** Primo e ultimo giorno del mese precedente a `oggi`, `AAAA-MM-GG`. */
export function mesePrecedente(oggi: Date = new Date()): { da: string; a: string } {
  const anno = oggi.getMonth() === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()
  const mese = oggi.getMonth() === 0 ? 12 : oggi.getMonth()
  const ultimo = new Date(Date.UTC(anno, mese, 0)).getUTCDate()
  const mm = String(mese).padStart(2, '0')
  return { da: `${anno}-${mm}-01`, a: `${anno}-${mm}-${String(ultimo).padStart(2, '0')}` }
}

/** Primo e ultimo giorno dell'anno solare, `AAAA-MM-GG`. */
export function annoSolare(anno: number): { da: string; a: string } {
  return { da: `${anno}-01-01`, a: `${anno}-12-31` }
}

export interface LinkCorrezione {
  etichetta: string
  rotta: string
}

/** Link di correzione di un avviso: dove l'utente sistema il dato che lo causa. */
export function linkCorrezione(a: AvvisoTracciato): LinkCorrezione[] {
  switch (a.correzione?.tipo) {
    case 'MOVIMENTO':
      return [{ etichetta: 'Apri il registro', rotta: '/registro' }]
    case 'ANAGRAFICA_SEDE':
      return [
        { etichetta: 'Produttori', rotta: '/produttori' },
        { etichetta: 'Trasportatori', rotta: '/trasportatori' },
        { etichetta: 'Destinatari', rotta: '/destinatari' },
      ]
    case 'CONFIGURAZIONE_SEDE':
      return [{ etichetta: 'Configurazione della sede', rotta: '/comunicazioni' }]
    default:
      return []
  }
}
