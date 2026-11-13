import { PESO_MASSIMO_CENTESIMI, type PayloadLettura } from './payload-lettura'

/**
 * Regole di una lettura in ingresso (Fase 4 pezzo 8b, D7). Dominio puro: riceve il payload già
 * verificato e lo stato letto dal database, restituisce accettabile (con avvisi) o rifiutata.
 * `CHIAVE_RIUSATA`, `SEQUENZA_GIA_USATA` e `ALIBI_GIA_USATO` dipendono dallo stato del database e li decide il servizio
 * d'ingresso (B5): qui esistono come codici e messaggi, non come esito di `valutaLettura`.
 */

/** Una lettura si può usare in un accesso entro 24 ore dall'ora dell'agente (Q3). */
export const ORE_VALIDITA_LETTURA = 24
/** Oltre queste ore la lettura si usa ma con un avviso. */
export const ORE_AVVISO_LETTURA_VECCHIA = 2
export const MINUTI_TOLLERANZA_OROLOGIO = 5
export const MINUTI_DIFFERITA = 15
export const MINUTI_SFASAMENTO = 10
export const AVVISO_LETTURA_SIMULATA = 'Lettura simulata: non è un peso reale.'

export type CodiceRifiuto =
  | 'FIRMA_NON_VALIDA'
  | 'PAYLOAD_NON_VALIDO'
  | 'AGENTE_DIVERSO'
  | 'STRUMENTO_NON_ASSEGNATO'
  | 'STRUMENTO_NON_ATTIVO'
  | 'PESO_INSTABILE'
  | 'PESO_NON_VALIDO'
  | 'FUORI_PORTATA'
  | 'OROLOGIO_AVANTI'
  | 'SIMULAZIONE_NON_AMMESSA'
  | 'CHIAVE_RIUSATA'
  | 'SEQUENZA_GIA_USATA'
  | 'ALIBI_GIA_USATO'

export const MESSAGGI_RIFIUTO: Readonly<Record<CodiceRifiuto, string>> = {
  FIRMA_NON_VALIDA: 'Firma della lettura non valida.',
  PAYLOAD_NON_VALIDO: 'Contenuto della lettura non valido.',
  AGENTE_DIVERSO: 'La lettura dichiara un agente diverso da quello che la invia.',
  STRUMENTO_NON_ASSEGNATO: 'Strumento non assegnato a questo agente.',
  STRUMENTO_NON_ATTIVO: 'Strumento non attivo.',
  PESO_INSTABILE: 'Peso instabile: non è un peso acquisito.',
  PESO_NON_VALIDO: 'Peso non valido (deve essere maggiore di zero e al massimo 99.999.999,99 kg).',
  FUORI_PORTATA: 'Peso oltre la portata massima dello strumento.',
  OROLOGIO_AVANTI: 'Orario della lettura nel futuro: controllare l’orologio del PC della pesa.',
  SIMULAZIONE_NON_AMMESSA: 'Letture simulate non ammesse per questa azienda.',
  CHIAVE_RIUSATA: 'Chiave di idempotenza già usata con un contenuto diverso.',
  SEQUENZA_GIA_USATA:
    'Sequenza già usata da un’altra lettura di questo agente: riallineare il contatore.',
  ALIBI_GIA_USATO: 'Alibi già registrato per questo strumento.',
}

export interface StrumentoPerLettura {
  id: string
  agenteId: string | null
  attivo: boolean
  /** null = portata non dichiarata, nessun controllo */
  portataMaxKg: number | null
}

export interface ContestoValutazione {
  /** agente che ha presentato il token (mai quello dichiarato nel payload) */
  agenteId: string
  /** strumento del payload letto nell'azienda del token; null se non esiste lì */
  strumento: StrumentoPerLettura | null
  simulazioneAmmessa: boolean
  /** ora del server alla ricezione */
  ricezione: Date
}

export type EsitoValutazione =
  | { esito: 'ACCETTABILE'; avvisi: string[] }
  | { esito: 'RIFIUTATA'; codice: CodiceRifiuto; messaggio: string }

const MS_MINUTO = 60_000
const rifiuto = (codice: CodiceRifiuto): EsitoValutazione => ({
  esito: 'RIFIUTATA',
  codice,
  messaggio: MESSAGGI_RIFIUTO[codice],
})

export interface DatiPerAvvisi {
  oraAgente: Date
  oraStrumento: Date | null
  oraRicezione: Date
  simulata: boolean
}

/** Avvisi calcolati in lettura dalle colonne, mai salvati. */
export function avvisiLettura(l: DatiPerAvvisi): string[] {
  const avvisi: string[] = []
  const differitaMin = (l.oraRicezione.getTime() - l.oraAgente.getTime()) / MS_MINUTO
  if (differitaMin > MINUTI_DIFFERITA) {
    avvisi.push(`Trasmessa in differita (${Math.round(differitaMin)} min dopo la pesata)`)
  }
  if (l.oraStrumento) {
    const sfasMin = Math.abs(l.oraStrumento.getTime() - l.oraAgente.getTime()) / MS_MINUTO
    if (sfasMin > MINUTI_SFASAMENTO) {
      avvisi.push(`Orologio dello strumento sfasato di ${Math.round(sfasMin)} min rispetto al PC`)
    }
  }
  if (l.simulata) avvisi.push(AVVISO_LETTURA_SIMULATA)
  return avvisi
}

export function valutaLettura(p: PayloadLettura, ctx: ContestoValutazione): EsitoValutazione {
  if (p.agenteId !== ctx.agenteId) return rifiuto('AGENTE_DIVERSO')
  const s = ctx.strumento
  if (!s || s.id !== p.strumentoId || s.agenteId !== ctx.agenteId) {
    return rifiuto('STRUMENTO_NON_ASSEGNATO')
  }
  if (!s.attivo) return rifiuto('STRUMENTO_NON_ATTIVO')
  if (!p.stabile) return rifiuto('PESO_INSTABILE')
  if (p.pesoCentesimi <= 0 || p.pesoCentesimi > PESO_MASSIMO_CENTESIMI)
    return rifiuto('PESO_NON_VALIDO')
  if (s.portataMaxKg !== null && p.pesoCentesimi > Math.round(s.portataMaxKg * 100)) {
    return rifiuto('FUORI_PORTATA')
  }
  const limite = ctx.ricezione.getTime() + MINUTI_TOLLERANZA_OROLOGIO * MS_MINUTO
  if (p.oraAgente.getTime() > limite || (p.oraStrumento && p.oraStrumento.getTime() > limite)) {
    return rifiuto('OROLOGIO_AVANTI')
  }
  if (p.simulata && !ctx.simulazioneAmmessa) return rifiuto('SIMULAZIONE_NON_AMMESSA')
  return {
    esito: 'ACCETTABILE',
    avvisi: avvisiLettura({
      oraAgente: p.oraAgente,
      oraStrumento: p.oraStrumento,
      oraRicezione: ctx.ricezione,
      simulata: p.simulata,
    }),
  }
}
