/**
 * Porta di persistenza delle sessioni di firma remota RENTRI (piano FIR in viaggio, P1).
 *
 * Ciclo di vita: `IN_AVVIO` (riga prenotata PRIMA di `/hash` e `authorize`, senza handle: chi perde la
 * corsa non tocca mai l'ente) -> `IN_ATTESA` (handle concesso, l'utente deve confermare sul telefono) ->
 * `IN_FIRMA` (una richiesta ha preso la sessione in modo esclusivo per `sign-hash` e
 * `acquisizione-firma`, con una scadenza di sicurezza) -> chiusa (COMPLETATA, SCADUTA, RIFIUTATA,
 * ANNULLATA). Per FIR c'e' al massimo UNA sessione aperta (IN_AVVIO/IN_ATTESA/IN_FIRMA, indice unico
 * parziale): e' il vincolo che impedisce la seconda richiesta di autorizzazione sul telefono.
 */

export type StatoSessioneFirma =
  | 'IN_AVVIO'
  | 'IN_ATTESA'
  | 'IN_FIRMA'
  | 'COMPLETATA'
  | 'SCADUTA'
  | 'RIFIUTATA'
  | 'ANNULLATA'

export type StatoSessioneChiusa = Extract<
  StatoSessioneFirma,
  'COMPLETATA' | 'SCADUTA' | 'RIFIUTATA' | 'ANNULLATA'
>

export const STATI_SESSIONE_APERTA: readonly StatoSessioneFirma[] = [
  'IN_AVVIO',
  'IN_ATTESA',
  'IN_FIRMA',
]

export interface SessioneFirmaRentri {
  id: string
  tenantId: string
  firId: string
  tipoOperazione: string
  /** Assente finche' la sessione e' IN_AVVIO. */
  handle: string | null
  /** SHA-256 esadecimale del token di `/hash`: tracciabilita' senza esporre il token. */
  tokenHash: string | null
  /** Token di `/hash`, necessario ad `acquisizione-firma`; azzerato alla chiusura. Mai esposto fuori dal backend. */
  tokenAcquisizione: string | null
  digestToSign: string | null
  scadenza: Date
  stato: StatoSessioneFirma
  dettaglioEnte: string | null
  utenteId: string | null
  createdAt: Date
}

export interface PrenotazioneSessioneFirma {
  tenantId: string
  firId: string
  tipoOperazione: string
  scadenza: Date
  utenteId?: string | null
}

export interface DatiAutorizzazioneFirma {
  handle: string
  tokenAcquisizione: string
  digestToSign: string
  /** Nuova scadenza: da qui parte l'attesa dell'utente (la prenotazione ne aveva una di recupero, piu' lunga). */
  scadenza: Date
}

/** Esiste gia' una sessione aperta per questo FIR (indice unico parziale). */
export class SessioneFirmaGiaApertaError extends Error {
  constructor(firId: string) {
    super(`Esiste gia' una sessione di firma aperta per il FIR ${firId}`)
    this.name = 'SessioneFirmaGiaApertaError'
  }
}

export abstract class ISessioniFirmaRentriRepository {
  /** La sessione aperta (IN_AVVIO, IN_ATTESA o IN_FIRMA) del FIR, se c'e'. */
  abstract trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null>
  abstract trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null>
  /** L'ultima sessione del FIR, di qualunque stato (per il banner dopo una scadenza o un rifiuto). */
  abstract ultima(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null>
  /**
   * Prenota la sessione (IN_AVVIO) PRIMA di chiamare l'ente.
   * @throws SessioneFirmaGiaApertaError se il FIR ha gia' una sessione aperta.
   */
  abstract prenota(dati: PrenotazioneSessioneFirma): Promise<SessioneFirmaRentri>
  /** IN_AVVIO -> IN_ATTESA con handle, token e digest. `false` se la sessione non era piu' IN_AVVIO. */
  abstract completaAvvio(
    tenantId: string,
    id: string,
    dati: DatiAutorizzazioneFirma
  ): Promise<boolean>
  /**
   * Presa esclusiva IN_ATTESA -> IN_FIRMA, con scadenza di sicurezza `scadenzaPresa`: di due riprese
   * concorrenti una sola ottiene `true` e puo' chiamare `sign-hash`.
   */
  abstract prendiPerFirma(tenantId: string, id: string, scadenzaPresa: Date): Promise<boolean>
  /**
   * Chiude la sessione se e' ancora aperta (una chiusa non si riapre) e azzera il token.
   * @returns `true` se l'ha chiusa, `false` se era gia' chiusa o non esiste.
   */
  abstract chiudi(
    tenantId: string,
    id: string,
    stato: StatoSessioneChiusa,
    dettaglioEnte?: string
  ): Promise<boolean>
}
