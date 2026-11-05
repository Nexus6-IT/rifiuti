import type { AvvisoDocumento, ErroreDocumento, Segnalazione } from './codici'
import type { RigaDocumentoCalcolata } from './tipi'

/** Riga calcolata prima della numerazione delle linee (la assegna il calcolo del documento). */
export type RigaSenzaLinea = Omit<RigaDocumentoCalcolata, 'numeroLinea'>

/** Esito di un calcolo di righe: righe prodotte, errori del documento e avvisi. */
export interface EsitoRighe {
  righe: RigaSenzaLinea[]
  errori: Segnalazione<ErroreDocumento>[]
  avvisi: Segnalazione<AvvisoDocumento>[]
}

const dueCifre = (n: number): string => String(n).padStart(2, '0')

/** 'AAAA-MM-GG' -> 'gg/mm/aaaa'. */
export function dataIt(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`
}

/** Testo del periodo per le descrizioni: «dal gg/mm/aaaa al gg/mm/aaaa». */
export function testoPeriodo(p: { dal: string; al: string }): string {
  return `dal ${dataIt(p.dal)} al ${dataIt(p.al)}`
}

export { dueCifre }
