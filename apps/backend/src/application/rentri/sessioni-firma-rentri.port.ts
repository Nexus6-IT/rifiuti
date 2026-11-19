/**
 * Porta di persistenza delle sessioni di firma remota RENTRI (piano FIR in viaggio, P1).
 *
 * Una sessione nasce quando l'ente concede un `handle` di autorizzazione e vive finche' l'utente non
 * conferma (COMPLETATA), l'ente la dichiara morta (SCADUTA), la rifiuta (RIFIUTATA) o l'utente la
 * annulla (ANNULLATA). Per FIR ce n'e' al massimo UNA `IN_ATTESA`: e' il vincolo che impedisce la
 * seconda richiesta di autorizzazione sul telefono.
 */

export type StatoSessioneFirma = 'IN_ATTESA' | 'COMPLETATA' | 'SCADUTA' | 'RIFIUTATA' | 'ANNULLATA'

export interface SessioneFirmaRentri {
  id: string
  tenantId: string
  firId: string
  tipoOperazione: string
  handle: string
  /** SHA-256 esadecimale del token di `/hash`: tracciabilita' senza esporre il token. */
  tokenHash: string
  /** Token di `/hash`, necessario ad `acquisizione-firma`. Mai esposto fuori dal backend. */
  tokenAcquisizione: string
  digestToSign: string
  scadenza: Date
  stato: StatoSessioneFirma
  dettaglioEnte: string | null
  utenteId: string | null
  createdAt: Date
}

export type NuovaSessioneFirmaRentri = Pick<
  SessioneFirmaRentri,
  | 'tenantId'
  | 'firId'
  | 'tipoOperazione'
  | 'handle'
  | 'tokenAcquisizione'
  | 'digestToSign'
  | 'scadenza'
> & { utenteId?: string | null }

/** Esiste gia' una sessione `IN_ATTESA` per questo FIR (indice unico parziale). */
export class SessioneFirmaGiaApertaError extends Error {
  constructor(firId: string) {
    super(`Esiste gia' una sessione di firma in attesa per il FIR ${firId}`)
    this.name = 'SessioneFirmaGiaApertaError'
  }
}

export abstract class ISessioniFirmaRentriRepository {
  /** La sessione `IN_ATTESA` del FIR, se c'e'. */
  abstract trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null>
  abstract trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null>
  /** @throws SessioneFirmaGiaApertaError se il FIR ha gia' una sessione `IN_ATTESA`. */
  abstract apri(dati: NuovaSessioneFirmaRentri): Promise<SessioneFirmaRentri>
  /**
   * Chiude la sessione, ma SOLO se e' ancora `IN_ATTESA` (una sessione chiusa non si riapre).
   * @returns `true` se l'ha chiusa, `false` se era gia' chiusa o non esiste.
   */
  abstract chiudi(
    tenantId: string,
    id: string,
    stato: Exclude<StatoSessioneFirma, 'IN_ATTESA'>,
    dettaglioEnte?: string
  ): Promise<boolean>
}
