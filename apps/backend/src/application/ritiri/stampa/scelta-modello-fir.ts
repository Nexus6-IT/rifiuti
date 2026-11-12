import type { ModelloStampaFir } from '../../../infrastructure/pdf/definizione-fir'

/** Il modello salvato, nei soli campi che servono alla scelta e alla stampa del FIR. */
export interface ModelloSalvato {
  ambito: 'FIR' | 'GENERALE' | 'DISTINTA_RITIRI'
  predefinito: boolean
  copie: number
  logoBase64: string | null
  testoIntestazione: string | null
  testoPiePagina: string | null
  colorePrimario: string
  coloreSecondario: string
}

export type SceltaModelloFir =
  /** modello indicato dal chiamante, gia' letto (e verificato come dell'azienda) */
  | { tipo: 'ESPLICITO'; modello: ModelloSalvato }
  /** nessun modello indicato: si sceglie fra i modelli dell'azienda */
  | { tipo: 'PREDEFINITO'; elenco: readonly ModelloSalvato[] }

export type EsitoSceltaModelloFir =
  | { esito: 'OK'; modello: ModelloStampaFir | null }
  | { esito: 'AMBITO_NON_VALIDO' }

/**
 * Scelta pura del modello di stampa del FIR, condivisa da `GET /pdf/fir*` e dalla stampa dei ritiri.
 * Esplicito: vale se dell'ambito FIR o GENERALE, altrimenti (DISTINTA_RITIRI) esito
 * AMBITO_NON_VALIDO. Senza: il predefinito FIR, poi il predefinito GENERALE, altrimenti nessun
 * modello (`null`: PDF come prima). Ogni chiamante traduce l'esito nel proprio errore.
 */
export function sceglieModelloFir(scelta: SceltaModelloFir): EsitoSceltaModelloFir {
  let scelto: ModelloSalvato | undefined
  if (scelta.tipo === 'ESPLICITO') {
    if (scelta.modello.ambito === 'DISTINTA_RITIRI') return { esito: 'AMBITO_NON_VALIDO' }
    scelto = scelta.modello
  } else {
    scelto =
      scelta.elenco.find(m => m.predefinito && m.ambito === 'FIR') ??
      scelta.elenco.find(m => m.predefinito && m.ambito === 'GENERALE')
  }
  if (!scelto) return { esito: 'OK', modello: null }
  return {
    esito: 'OK',
    modello: {
      ambito: scelto.ambito,
      copie: scelto.copie,
      logoBase64: scelto.logoBase64,
      headerText: scelto.testoIntestazione,
      footerText: scelto.testoPiePagina,
      primaryColor: scelto.colorePrimario,
      secondaryColor: scelto.coloreSecondario,
    },
  }
}
