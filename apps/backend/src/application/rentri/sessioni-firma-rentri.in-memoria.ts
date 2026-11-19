import { randomUUID, createHash } from 'crypto'
import {
  ISessioniFirmaRentriRepository,
  NuovaSessioneFirmaRentri,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
  StatoSessioneFirma,
} from './sessioni-firma-rentri.port'

/** Implementazione in memoria per i test unitari (stesse regole dell'indice unico parziale). */
export class SessioniFirmaRentriInMemoria extends ISessioniFirmaRentriRepository {
  readonly righe: SessioneFirmaRentri[] = []

  async trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    return (
      this.righe.find(
        r => r.tenantId === tenantId && r.firId === firId && r.stato === 'IN_ATTESA'
      ) ?? null
    )
  }

  async trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null> {
    return this.righe.find(r => r.id === id && r.tenantId === tenantId) ?? null
  }

  async apri(dati: NuovaSessioneFirmaRentri): Promise<SessioneFirmaRentri> {
    if (await this.trovaAperta(dati.tenantId, dati.firId)) {
      throw new SessioneFirmaGiaApertaError(dati.firId)
    }
    const riga: SessioneFirmaRentri = {
      id: randomUUID(),
      tenantId: dati.tenantId,
      firId: dati.firId,
      tipoOperazione: dati.tipoOperazione,
      handle: dati.handle,
      tokenHash: createHash('sha256').update(dati.tokenAcquisizione).digest('hex'),
      tokenAcquisizione: dati.tokenAcquisizione,
      digestToSign: dati.digestToSign,
      scadenza: dati.scadenza,
      stato: 'IN_ATTESA',
      dettaglioEnte: null,
      utenteId: dati.utenteId ?? null,
      createdAt: new Date(),
    }
    this.righe.push(riga)
    return riga
  }

  async chiudi(
    tenantId: string,
    id: string,
    stato: Exclude<StatoSessioneFirma, 'IN_ATTESA'>,
    dettaglioEnte?: string
  ): Promise<boolean> {
    const riga = this.righe.find(r => r.id === id && r.tenantId === tenantId)
    if (!riga || riga.stato !== 'IN_ATTESA') return false
    riga.stato = stato
    if (dettaglioEnte !== undefined) riga.dettaglioEnte = dettaglioEnte
    return true
  }
}
