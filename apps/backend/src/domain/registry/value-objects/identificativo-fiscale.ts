/**
 * Identificativo fiscale di una ditta (F2-10, D2): partita IVA e/o codice fiscale.
 *
 * Il checksum lo applica questo VO quando un identificativo viene IMPOSTATO; non si applica mai
 * in lettura (le P.IVA migrate non sono mai state controllate) ne' quando si modifica altro.
 * Riusa `PartitaIva.isValid` e `codiceFiscaleSoggettoValido`.
 *
 * Gli errori non riportano mai il valore ricevuto: il codice fiscale di un privato e' un dato
 * personale (D12).
 */
import { PartitaIva } from '../../shared/partita-iva.vo'
import {
  codiceFiscaleSoggettoValido,
  normalizzaCodiceFiscaleSoggetto,
} from '../../shared/codice-fiscale-soggetto'
import { DatiControparteNonValidiError } from '../../../core/domain/errors'
import type { RuoloControparte } from '../entities/sede-ditta'

export interface IdentificativoFiscaleInput {
  partitaIva?: string | null
  codiceFiscale?: string | null
}

export const MESSAGGIO_IDENTIFICATIVO_ASSENTE = 'Indica la partita IVA o il codice fiscale.'
export const MESSAGGIO_PARTITA_IVA_NON_VALIDA =
  'Partita IVA non valida: servono 11 cifre con la cifra di controllo corretta.'
export const MESSAGGIO_CODICE_FISCALE_NON_VALIDO = 'Codice fiscale non valido.'
export const MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO =
  'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite.'
export const MESSAGGIO_PRIVATO_SOLO_PRODUTTORE =
  'Un privato senza partita IVA può essere solo produttore o cliente.'

/** D2.5, D18: il privato e' ammesso solo come produttore o cliente (l'agente e' un fornitore). */
export function ammessoPrivato(ruolo: RuoloControparte): boolean {
  return ruolo === 'PRODUTTORE' || ruolo === 'CLIENTE'
}

function pulito(valore: string | null | undefined): string {
  return (valore ?? '').trim()
}

/** Vero se la partita IVA e' presente ma non passa il checksum (da segnalare, mai da correggere). */
export function partitaIvaDaVerificare(valore: string | null | undefined): boolean {
  if (!valore) return false
  return !PartitaIva.isValid(valore)
}

export class IdentificativoFiscale {
  private constructor(
    readonly partitaIva: string | null,
    readonly codiceFiscale: string | null
  ) {}

  static crea(input: IdentificativoFiscaleInput): IdentificativoFiscale {
    const grezzaPiva = pulito(input.partitaIva)
    const grezzoCf = pulito(input.codiceFiscale)
    if (!grezzaPiva && !grezzoCf) {
      throw new DatiControparteNonValidiError(MESSAGGIO_IDENTIFICATIVO_ASSENTE)
    }

    let partitaIva: string | null = null
    if (grezzaPiva) {
      const normalizzata = normalizzaCodiceFiscaleSoggetto(grezzaPiva)
      if (!PartitaIva.isValid(normalizzata)) {
        throw new DatiControparteNonValidiError(MESSAGGIO_PARTITA_IVA_NON_VALIDA)
      }
      partitaIva = normalizzata
    }

    let codiceFiscale: string | null = null
    if (grezzoCf) {
      const normalizzato = normalizzaCodiceFiscaleSoggetto(grezzoCf)
      if (normalizzato.length > 16) {
        throw new DatiControparteNonValidiError(MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO)
      }
      if (!codiceFiscaleSoggettoValido(normalizzato)) {
        throw new DatiControparteNonValidiError(MESSAGGIO_CODICE_FISCALE_NON_VALIDO)
      }
      // D2.4: se coincidono si conserva solo la P.IVA
      codiceFiscale = normalizzato === partitaIva ? null : normalizzato
    }

    return new IdentificativoFiscale(partitaIva, codiceFiscale)
  }

  /** Privato (D2.5): solo un codice fiscale di 16 caratteri, nessuna partita IVA. */
  get privato(): boolean {
    return (
      this.partitaIva === null && this.codiceFiscale !== null && this.codiceFiscale.length === 16
    )
  }

  /** Valore da inviare a RENTRI come `codice_fiscale`: il CF se c'e', altrimenti la P.IVA. */
  get identificativoRentri(): string {
    return (this.codiceFiscale ?? this.partitaIva) as string
  }

  /** I valori presenti, senza duplicati e in ordine alfabetico (ordine dei lock, niente deadlock). */
  valori(): string[] {
    return [
      ...new Set([this.partitaIva, this.codiceFiscale].filter((v): v is string => !!v)),
    ].sort()
  }
}
