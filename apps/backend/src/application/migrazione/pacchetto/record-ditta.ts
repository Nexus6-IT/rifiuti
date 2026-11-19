/**
 * Record della fase `ditte` (ambito ANAGRAFICHE) e sua validazione. Pura: la usano sia
 * `migrazione:prepara` (workstation) sia il caricamento lato server, che NON si fida del pacchetto
 * e rivalida ogni riga. Gli errori non riportano mai valori (sono dati dell'azienda).
 */
import { chiaveDitta } from '../../../domain/migrazione/chiavi-legacy'
import { PacchettoError } from './errori-pacchetto'
import { partitaIvaItalianaValida } from './mappa-import'

export interface RecordDitta {
  /** `ditta|FISC|<P.IVA o CF>` (vedi `chiaveDitta`). */
  readonly legacyKey: string
  readonly ragioneSociale: string
  readonly partitaIva: string | null
  readonly codiceFiscale: string | null
}

export type CodiceRecordDitta =
  | 'FORMA'
  | 'RAGIONE_SOCIALE'
  | 'PARTITA_IVA'
  | 'CODICE_FISCALE'
  | 'FISCALE_ASSENTE'
  | 'CHIAVE'

function riga(codice: CodiceRecordDitta): never {
  throw new PacchettoError('RIGA_NON_VALIDA', `ditta: ${codice}`)
}

export function codiceFiscaleFormaValida(v: string): boolean {
  return /^[A-Z0-9]{16}$/.test(v) || /^[0-9]{11}$/.test(v)
}

/** @param dittaWinWaste ditta WinWaste di 4 cifre della mappa (prefisso della chiave legacy). */
export function validaRecordDitta(valore: unknown, dittaWinWaste: string): RecordDitta {
  if (valore === null || typeof valore !== 'object' || Array.isArray(valore)) riga('FORMA')
  const o = valore as Record<string, unknown>
  const chiavi = Object.keys(o)
  if (
    chiavi.length !== 4 ||
    !['legacyKey', 'ragioneSociale', 'partitaIva', 'codiceFiscale'].every(k => k in o)
  ) {
    riga('FORMA')
  }
  const { legacyKey, ragioneSociale, partitaIva, codiceFiscale } = o
  if (typeof ragioneSociale !== 'string') riga('RAGIONE_SOCIALE')
  const rs = (ragioneSociale as string).trim()
  if (rs.length === 0 || rs.length > 255) riga('RAGIONE_SOCIALE')
  if (
    partitaIva !== null &&
    (typeof partitaIva !== 'string' || !partitaIvaItalianaValida(partitaIva))
  ) {
    riga('PARTITA_IVA')
  }
  if (
    codiceFiscale !== null &&
    (typeof codiceFiscale !== 'string' || !codiceFiscaleFormaValida(codiceFiscale))
  ) {
    riga('CODICE_FISCALE')
  }
  const fiscale = (partitaIva ?? codiceFiscale) as string | null
  if (fiscale === null) riga('FISCALE_ASSENTE')
  let atteso: string
  try {
    atteso = chiaveDitta(dittaWinWaste, fiscale as string)
  } catch {
    return riga('CHIAVE')
  }
  if (legacyKey !== atteso) riga('CHIAVE')
  return {
    legacyKey: atteso,
    ragioneSociale: rs,
    partitaIva: partitaIva as string | null,
    codiceFiscale: codiceFiscale as string | null,
  }
}
