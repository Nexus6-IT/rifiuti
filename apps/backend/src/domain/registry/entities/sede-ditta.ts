/**
 * Sede di una ditta (F2-10, D4): indirizzo (stessi campi e limiti di oggi), denominazione
 * facoltativa e contatti. Esattamente una sede principale per ditta; le sedi non si cancellano,
 * si disattivano; non si disattiva la principale ne' la sede predefinita di un ruolo.
 */
import { randomUUID } from 'crypto'
import { SedeNonModificabileError } from '../../../core/domain/errors'
import { Indirizzo } from '../value-objects/indirizzo'

export type RuoloControparte = 'PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO'

const NOME_RUOLO: Record<RuoloControparte, string> = {
  PRODUTTORE: 'produttore',
  TRASPORTATORE: 'trasportatore',
  DESTINATARIO: 'destinatario',
}

export const MESSAGGIO_SEDE_PRINCIPALE_NON_DISATTIVABILE =
  "È la sede principale: impostane un'altra come principale prima."
export const MESSAGGIO_SEDE_DISATTIVA_NON_PRINCIPALE =
  'Una sede disattivata non può essere la sede principale.'

export interface ContattiSede {
  denominazione?: string | null
  referente?: string | null
  email?: string | null
  telefono?: string | null
  pec?: string | null
}

export interface SedeDittaProps extends ContattiSede {
  dittaId: string
  indirizzo: Indirizzo
  principale?: boolean
}

export interface SedeDittaRestoreProps extends SedeDittaProps {
  id: string
  principale: boolean
  attiva: boolean
  createdAt: Date
  updatedAt: Date
}

function opzionale(valore: string | null | undefined): string | null {
  const v = valore?.trim()
  return v ? v : null
}

/**
 * Chiave di confronto fra indirizzi: la stessa normalizzazione della migration
 * `20261031110000_ditte_sedi_controparti` (D5.4): `lower` e spazi compressi di via, civico e
 * comune, piu' il CAP e la provincia in maiuscolo, separati da `|`.
 */
export function chiaveIndirizzo(indirizzo: Indirizzo): string {
  const compatta = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
  return [
    compatta(indirizzo.getVia()),
    compatta(indirizzo.getCivico()),
    compatta(indirizzo.getCitta()),
    indirizzo.getCAP().trim(),
    indirizzo.getProvincia().trim().toUpperCase(),
  ].join('|')
}

export class SedeDitta {
  private constructor(
    private readonly _id: string,
    private readonly _dittaId: string,
    private _indirizzo: Indirizzo,
    private _denominazione: string | null,
    private _referente: string | null,
    private _email: string | null,
    private _telefono: string | null,
    private _pec: string | null,
    private _principale: boolean,
    private _attiva: boolean,
    private readonly _createdAt: Date,
    private _updatedAt: Date
  ) {}

  static crea(props: SedeDittaProps): SedeDitta {
    const adesso = new Date()
    return new SedeDitta(
      randomUUID(),
      props.dittaId,
      props.indirizzo,
      opzionale(props.denominazione),
      opzionale(props.referente),
      opzionale(props.email),
      opzionale(props.telefono),
      opzionale(props.pec),
      props.principale ?? false,
      true,
      adesso,
      adesso
    )
  }

  static ripristina(props: SedeDittaRestoreProps): SedeDitta {
    return new SedeDitta(
      props.id,
      props.dittaId,
      props.indirizzo,
      props.denominazione ?? null,
      props.referente ?? null,
      props.email ?? null,
      props.telefono ?? null,
      props.pec ?? null,
      props.principale,
      props.attiva,
      props.createdAt,
      props.updatedAt
    )
  }

  get id(): string {
    return this._id
  }
  get dittaId(): string {
    return this._dittaId
  }
  get indirizzo(): Indirizzo {
    return this._indirizzo
  }
  get denominazione(): string | null {
    return this._denominazione
  }
  get referente(): string | null {
    return this._referente
  }
  get email(): string | null {
    return this._email
  }
  get telefono(): string | null {
    return this._telefono
  }
  get pec(): string | null {
    return this._pec
  }
  get principale(): boolean {
    return this._principale
  }
  get attiva(): boolean {
    return this._attiva
  }
  get createdAt(): Date {
    return this._createdAt
  }
  get updatedAt(): Date {
    return this._updatedAt
  }

  chiaveIndirizzo(): string {
    return chiaveIndirizzo(this._indirizzo)
  }

  /** Aggiorna indirizzo e contatti: un campo `undefined` resta com'e', `null` o vuoto lo svuota. */
  aggiorna(dati: ContattiSede & { indirizzo?: Indirizzo }): void {
    if (dati.indirizzo) this._indirizzo = dati.indirizzo
    if (dati.denominazione !== undefined) this._denominazione = opzionale(dati.denominazione)
    if (dati.referente !== undefined) this._referente = opzionale(dati.referente)
    if (dati.email !== undefined) this._email = opzionale(dati.email)
    if (dati.telefono !== undefined) this._telefono = opzionale(dati.telefono)
    if (dati.pec !== undefined) this._pec = opzionale(dati.pec)
    this._updatedAt = new Date()
  }

  /**
   * D4: la principale e la sede predefinita di un ruolo non si disattivano (409 senza id).
   * `ruoliPredefinita` sono i ruoli che hanno questa sede come predefinita.
   */
  disattiva(ruoliPredefinita: RuoloControparte[]): void {
    if (!this._attiva) return
    if (this._principale) {
      throw new SedeNonModificabileError(MESSAGGIO_SEDE_PRINCIPALE_NON_DISATTIVABILE)
    }
    if (ruoliPredefinita.length > 0) {
      throw new SedeNonModificabileError(
        `È la sede predefinita del ${NOME_RUOLO[ruoliPredefinita[0]]}: scegline un'altra prima`
      )
    }
    this._attiva = false
    this._updatedAt = new Date()
  }

  riattiva(): void {
    if (this._attiva) return
    this._attiva = true
    this._updatedAt = new Date()
  }

  /** Marca la sede come principale (l'unicita' fra le sedi la garantisce il repository). */
  rendiPrincipale(): void {
    if (!this._attiva) {
      throw new SedeNonModificabileError(MESSAGGIO_SEDE_DISATTIVA_NON_PRINCIPALE)
    }
    this._principale = true
    this._updatedAt = new Date()
  }

  togliPrincipale(): void {
    this._principale = false
    this._updatedAt = new Date()
  }
}
