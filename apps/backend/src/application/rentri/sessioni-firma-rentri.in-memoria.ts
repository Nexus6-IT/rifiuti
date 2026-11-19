import { randomUUID, createHash } from 'crypto'
import {
  DatiAutorizzazioneFirma,
  ISessioniFirmaRentriRepository,
  PrenotazioneSessioneFirma,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
  STATI_SESSIONE_APERTA,
  StatoSessioneChiusa,
} from './sessioni-firma-rentri.port'

/** Implementazione in memoria per i test unitari (stesse regole dell'indice unico parziale). */
export class SessioniFirmaRentriInMemoria extends ISessioniFirmaRentriRepository {
  readonly righe: SessioneFirmaRentri[] = []

  private aperta(tenantId: string, firId: string): SessioneFirmaRentri | undefined {
    return this.righe.find(
      r => r.tenantId === tenantId && r.firId === firId && STATI_SESSIONE_APERTA.includes(r.stato)
    )
  }

  async trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    return this.aperta(tenantId, firId) ?? null
  }

  async trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null> {
    return this.righe.find(r => r.id === id && r.tenantId === tenantId) ?? null
  }

  async ultima(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    const mie = this.righe.filter(r => r.tenantId === tenantId && r.firId === firId)
    return mie.length ? mie[mie.length - 1] : null
  }

  // Niente `await` fra controllo e inserimento: e' l'atomicita' dell'indice unico.
  async prenota(dati: PrenotazioneSessioneFirma): Promise<SessioneFirmaRentri> {
    if (this.aperta(dati.tenantId, dati.firId)) throw new SessioneFirmaGiaApertaError(dati.firId)
    const riga: SessioneFirmaRentri = {
      id: randomUUID(),
      tenantId: dati.tenantId,
      firId: dati.firId,
      tipoOperazione: dati.tipoOperazione,
      handle: null,
      tokenHash: null,
      tokenAcquisizione: null,
      digestToSign: null,
      scadenza: dati.scadenza,
      stato: 'IN_AVVIO',
      dettaglioEnte: null,
      utenteId: dati.utenteId ?? null,
      createdAt: new Date(),
    }
    this.righe.push(riga)
    return riga
  }

  async completaAvvio(
    tenantId: string,
    id: string,
    dati: DatiAutorizzazioneFirma
  ): Promise<boolean> {
    const riga = this.righe.find(r => r.id === id && r.tenantId === tenantId)
    if (!riga || riga.stato !== 'IN_AVVIO') return false
    riga.stato = 'IN_ATTESA'
    riga.handle = dati.handle
    riga.tokenAcquisizione = dati.tokenAcquisizione
    riga.tokenHash = createHash('sha256').update(dati.tokenAcquisizione).digest('hex')
    riga.digestToSign = dati.digestToSign
    return true
  }

  async prendiPerFirma(tenantId: string, id: string, scadenzaPresa: Date): Promise<boolean> {
    const riga = this.righe.find(r => r.id === id && r.tenantId === tenantId)
    if (!riga || riga.stato !== 'IN_ATTESA') return false
    riga.stato = 'IN_FIRMA'
    riga.scadenza = scadenzaPresa
    return true
  }

  async chiudi(
    tenantId: string,
    id: string,
    stato: StatoSessioneChiusa,
    dettaglioEnte?: string
  ): Promise<boolean> {
    const riga = this.righe.find(r => r.id === id && r.tenantId === tenantId)
    if (!riga || !STATI_SESSIONE_APERTA.includes(riga.stato)) return false
    riga.stato = stato
    riga.tokenAcquisizione = null
    if (dettaglioEnte !== undefined) riga.dettaglioEnte = dettaglioEnte
    return true
  }

  /** Scorciatoia per i test: prenota e porta subito la sessione a IN_ATTESA. */
  async apriInAttesa(
    dati: PrenotazioneSessioneFirma & Partial<DatiAutorizzazioneFirma>
  ): Promise<SessioneFirmaRentri> {
    const riga = await this.prenota(dati)
    await this.completaAvvio(dati.tenantId, riga.id, {
      handle: dati.handle ?? 'handle-test',
      tokenAcquisizione: dati.tokenAcquisizione ?? 'token-test',
      digestToSign: dati.digestToSign ?? 'digest-test',
    })
    return riga
  }
}
