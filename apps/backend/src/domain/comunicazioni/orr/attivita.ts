import type { TipoImpiantoOrr } from '../configurazione-sede'
import type { DatiOrr } from '../dati-tracciato'
import { PROVINCE_CAMPANIA, type AttivitaOrr } from './costanti'

/**
 * Regole O.R.R. pure (D13): a quali attivita' appartiene un movimento, tipo detentore, tipo impianto
 * del destinatario, appartenenza alla Campania. Ricavate da `Campania:elabcampania` e `riempiStruttura`
 * di WinWaste (`docs/comunicazioni-orr-campania.md` §3 e §5).
 */

export interface MovimentoPerAttivita {
  tipo: 'CARICO' | 'SCARICO'
  /** Ruolo nel MUD (`RICEVUTO_DA_TERZI` = il movimento e' un rifiuto ricevuto da terzi). */
  ruolo: 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'
  operazione: 'R' | 'D'
}

/** Il codice ISTAT di una provincia (3 cifre) o di un comune (6 cifre) e' in Campania (061-065). */
export function inCampania(istat: string | null | undefined): boolean {
  if (!istat) return false
  const provincia = istat.trim().slice(0, 3)
  return /^[0-9]{3}$/.test(provincia) && Object.values(PROVINCE_CAMPANIA).includes(provincia)
}

/** La sigla di provincia e' campana (AV BN CE NA SA). */
export function siglaInCampania(sigla: string | null | undefined): boolean {
  return !!sigla && sigla.trim().toUpperCase() in PROVINCE_CAMPANIA
}

/**
 * Regola del file `T` (`ricalcolaStringa`, tipo `T`): se la sede e' in Campania, almeno una fra
 * le due parti (produttore e destinatario) deve avere l'ISTAT in Campania.
 */
export function trasportoDaComunicare(
  istatProduttore: string | null | undefined,
  istatDestinatario: string | null | undefined
): boolean {
  return inCampania(istatProduttore) || inCampania(istatDestinatario)
}

/**
 * Attivita' di impianto di un rifiuto ricevuto da terzi, dal tipo impianto della sede e dall'operazione.
 * `STO`/`SMA`/`REC` sono diretti; `R/S`, `AUT`, `ROT`, `FRA` si dividono per operazione (`D` = smaltimento,
 * `R` = recupero). Senza tipo impianto non si puo' decidere: lista vuota, lo segnala il preparatore.
 */
function attivitaDiImpianto(
  tipoImpianto: TipoImpiantoOrr | undefined,
  operazione: 'R' | 'D'
): AttivitaOrr | null {
  switch (tipoImpianto) {
    case 'STO':
      return 'STO'
    case 'SMA':
      return 'SMA'
    case 'REC':
      return 'REC'
    case 'R/S':
    case 'AUT':
    case 'ROT':
    case 'FRA':
      return operazione === 'D' ? 'SMA' : 'REC'
    default:
      return null
  }
}

/**
 * Attivita' del movimento (D13): `TRA` se la sede e' il trasportatore del FIR e/o una fra
 * `STO SMA REC FRA ROT AUT` se il rifiuto e' ricevuto da terzi.
 * Il flag `FRA`/`ROT`/`AUT` del movimento (dati del tracciato, i `§F §R §A` di WinWaste) ha la
 * precedenza sul tipo impianto. Un movimento puo' stare in piu' file (trasporto e impianto).
 */
export function attivitaDelMovimento(
  movimento: MovimentoPerAttivita,
  tipoImpianto: TipoImpiantoOrr | undefined,
  siamoTrasportatore: boolean,
  datiOrr: Pick<DatiOrr, 'attivita'> | null | undefined
): AttivitaOrr[] {
  const attivita: AttivitaOrr[] = []
  if (siamoTrasportatore) attivita.push('TRA')
  if (movimento.tipo === 'CARICO' && movimento.ruolo === 'RICEVUTO_DA_TERZI') {
    const flag = datiOrr?.attivita
    const a = flag ?? attivitaDiImpianto(tipoImpianto, movimento.operazione)
    if (a) attivita.push(a)
  }
  return attivita
}

/** Detentore (`c13`): `STO` se la sede del produttore e' un impianto di stoccaggio, altrimenti `PRO`. */
export function tipoDetentore(tipoImpiantoProduttore: TipoImpiantoOrr | undefined): 'STO' | 'PRO' {
  return tipoImpiantoProduttore === 'STO' ? 'STO' : 'PRO'
}

/**
 * Tipo impianto del destinatario (`e13`, 3 caratteri).
 * - dichiarante `TRA`: dal codice operazione (`R13`/`D15` -> `STO`, `D` -> `SMA`, `R` -> `REC`), con il
 *   flag `FRA`/`ROT`/`AUT` del movimento che ha la precedenza;
 * - altro dichiarante: il tipo impianto della sede se e' `STO SMA REC FRA ROT AUT`, altrimenti
 *   (`R/S` o mancante) l'attivita' stessa del file.
 */
export function tipoImpiantoDestinatario(
  dichiarante: AttivitaOrr,
  tipoImpiantoSede: TipoImpiantoOrr | undefined,
  operationCode: string | null | undefined,
  operazione: 'R' | 'D',
  flag: DatiOrr['attivita'] | undefined
): string {
  if (dichiarante !== 'TRA') {
    return tipoImpiantoSede && tipoImpiantoSede !== 'R/S' ? tipoImpiantoSede : dichiarante
  }
  if (flag) return flag
  const codice = (operationCode ?? '').trim().toUpperCase()
  if (codice === 'R13' || codice === 'D15') return 'STO'
  return operazione === 'D' ? 'SMA' : 'REC'
}
