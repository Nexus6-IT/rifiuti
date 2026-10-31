/**
 * Ditta (F2-10): la controparte unica di un'azienda, identificata da partita IVA e/o codice
 * fiscale. I ruoli (produttore, trasportatore, destinatario) e le sedi stanno a parte.
 *
 * Regole sugli identificativi (D2): quelli impostati non si cambiano; si puo' AGGIUNGERE quello
 * mancante (D2.7); unica eccezione la sostituzione della partita IVA quando quella attuale non
 * passa il checksum e la nuova si' (D2.8). Nessun messaggio riporta i valori.
 */
import { randomUUID } from 'crypto'
import {
  DatiControparteNonValidiError,
  IdentificativoNonCorrispondenteError,
} from '../../../core/domain/errors'
import { PartitaIva } from '../../shared/partita-iva.vo'
import {
  IdentificativoFiscale,
  partitaIvaDaVerificare,
} from '../value-objects/identificativo-fiscale'

export const MESSAGGIO_RAGIONE_SOCIALE_ASSENTE = 'La ragione sociale è obbligatoria.'
export const MESSAGGIO_RAGIONE_SOCIALE_TROPPO_LUNGA =
  'La ragione sociale ha al massimo 255 caratteri.'
export const MESSAGGIO_IDENTIFICATIVO_CONTRADDITTORIO =
  "Il codice fiscale o la partita IVA indicati non corrispondono a quelli già registrati per l'anagrafica."
export const MESSAGGIO_PARTITA_IVA_NON_SOSTITUIBILE =
  'La partita IVA registrata è valida: non si può sostituire.'
export const MESSAGGIO_NUOVA_PARTITA_IVA_NON_VALIDA =
  'La nuova partita IVA non è valida: serve per sostituire quella registrata, che non passa il controllo.'

export interface DittaRestoreProps {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
  createdAt: Date
  updatedAt: Date
}

function ragioneSocialeValida(valore: string): string {
  const pulita = valore.trim()
  if (!pulita) throw new DatiControparteNonValidiError(MESSAGGIO_RAGIONE_SOCIALE_ASSENTE)
  if (pulita.length > 255) {
    throw new DatiControparteNonValidiError(MESSAGGIO_RAGIONE_SOCIALE_TROPPO_LUNGA)
  }
  return pulita
}

export class Ditta {
  private constructor(
    private readonly _id: string,
    private _ragioneSociale: string,
    private _partitaIva: string | null,
    private _codiceFiscale: string | null,
    private readonly _createdAt: Date,
    private _updatedAt: Date
  ) {}

  static crea(props: { ragioneSociale: string; identificativo: IdentificativoFiscale }): Ditta {
    const adesso = new Date()
    return new Ditta(
      randomUUID(),
      ragioneSocialeValida(props.ragioneSociale),
      props.identificativo.partitaIva,
      props.identificativo.codiceFiscale,
      adesso,
      adesso
    )
  }

  /** Ricostruisce da un record gia' salvato: nessun controllo (le P.IVA migrate possono non passare il checksum). */
  static ripristina(props: DittaRestoreProps): Ditta {
    return new Ditta(
      props.id,
      props.ragioneSociale,
      props.partitaIva,
      props.codiceFiscale,
      props.createdAt,
      props.updatedAt
    )
  }

  get id(): string {
    return this._id
  }
  get ragioneSociale(): string {
    return this._ragioneSociale
  }
  get partitaIva(): string | null {
    return this._partitaIva
  }
  get codiceFiscale(): string | null {
    return this._codiceFiscale
  }
  get createdAt(): Date {
    return this._createdAt
  }
  get updatedAt(): Date {
    return this._updatedAt
  }

  /** Privato: solo codice fiscale di 16 caratteri, nessuna partita IVA. */
  get privato(): boolean {
    return (
      this._partitaIva === null && this._codiceFiscale !== null && this._codiceFiscale.length === 16
    )
  }

  get partitaIvaDaVerificare(): boolean {
    return partitaIvaDaVerificare(this._partitaIva)
  }

  /** I valori presenti, ordinati e senza duplicati. */
  valori(): string[] {
    return [
      ...new Set([this._partitaIva, this._codiceFiscale].filter((v): v is string => !!v)),
    ].sort()
  }

  rinomina(ragioneSociale: string): boolean {
    const nuova = ragioneSocialeValida(ragioneSociale)
    if (nuova === this._ragioneSociale) return false
    this._ragioneSociale = nuova
    this._updatedAt = new Date()
    return true
  }

  /**
   * D2.7: aggiunge l'identificativo mancante. Un valore gia' impostato non si cambia: se
   * contraddice quello registrato si rifiuta (400). Ritorna `true` se qualcosa e' cambiato.
   * Un codice fiscale uguale alla partita IVA registrata (o viceversa) non contraddice nulla.
   */
  aggiungiIdentificativi(identificativo: IdentificativoFiscale): boolean {
    const { partitaIva, codiceFiscale } = identificativo
    let nuovaPiva = this._partitaIva
    let nuovoCf = this._codiceFiscale

    if (partitaIva !== null) {
      if (nuovaPiva === null) {
        nuovaPiva = partitaIva
      } else if (nuovaPiva !== partitaIva) {
        throw new IdentificativoNonCorrispondenteError(MESSAGGIO_IDENTIFICATIVO_CONTRADDITTORIO)
      }
    }
    if (codiceFiscale !== null) {
      if (nuovoCf === null) {
        // un CF numerico uguale alla P.IVA registrata e' gia' coperto da quella
        if (codiceFiscale !== nuovaPiva) nuovoCf = codiceFiscale
      } else if (nuovoCf !== codiceFiscale && nuovaPiva !== codiceFiscale) {
        throw new IdentificativoNonCorrispondenteError(MESSAGGIO_IDENTIFICATIVO_CONTRADDITTORIO)
      }
    }
    // D2.4: se coincidono si conserva solo la partita IVA
    if (nuovoCf !== null && nuovoCf === nuovaPiva) nuovoCf = null

    const cambiata = nuovaPiva !== this._partitaIva || nuovoCf !== this._codiceFiscale
    if (cambiata) {
      this._partitaIva = nuovaPiva
      this._codiceFiscale = nuovoCf
      this._updatedAt = new Date()
    }
    return cambiata
  }

  /**
   * D2.8: sostituisce la partita IVA, ma solo se quella attuale non passa il checksum e la
   * nuova si'. Altrimenti 400 senza valori.
   */
  sostituisciPartitaIva(nuova: string): void {
    if (this._partitaIva === null || !this.partitaIvaDaVerificare) {
      throw new IdentificativoNonCorrispondenteError(MESSAGGIO_PARTITA_IVA_NON_SOSTITUIBILE)
    }
    const normalizzata = PartitaIva.normalize(nuova)
    if (!PartitaIva.isValid(normalizzata)) {
      throw new IdentificativoNonCorrispondenteError(MESSAGGIO_NUOVA_PARTITA_IVA_NON_VALIDA)
    }
    this._partitaIva = normalizzata
    if (this._codiceFiscale === normalizzata) this._codiceFiscale = null
    this._updatedAt = new Date()
  }
}
