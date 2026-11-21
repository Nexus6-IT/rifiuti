/**
 * Errori di dominio delle esportazioni XML del registro (eREGI E6). Il controller li traduce in
 * HTTP; i messaggi sono per l'utente: niente id interni, dati fiscali o contenuto del registro.
 */
import { DomainError } from '../../../core/domain/errors'

/** 404: l'esportazione non esiste (o non e' di questa azienda). */
export class EsportazioneNonTrovataError extends DomainError {
  constructor() {
    super('Esportazione non trovata.')
    this.name = 'EsportazioneNonTrovataError'
  }
}

/** 409: la validazione si rilancia solo se manca l'esito (generata, in corso o non disponibile). */
export class EsportazioneNonRivalidabileError extends DomainError {
  constructor() {
    super('Questa esportazione ha già un esito di validazione: non si rilancia.')
    this.name = 'EsportazioneNonRivalidabileError'
  }
}

/**
 * 409: l'ultima esportazione e' stata rifiutata da RENTRI. Una nuova esportazione la citerebbe nella
 * catena dei digest: serve una decisione di una persona prima di proseguire.
 */
export class UltimaEsportazioneRifiutataError extends DomainError {
  constructor() {
    super(
      "L'ultima esportazione è stata rifiutata da RENTRI: una nuova esportazione la citerebbe nella catena. Verifica i messaggi dell'esito prima di proseguire."
    )
    this.name = 'UltimaEsportazioneRifiutataError'
  }
}

/** 409: la catena delle esportazioni salvate non e' coerente (biforcazioni, anelli non firmati, buchi). */
export class CatenaEsportazioniNonCoerenteError extends DomainError {
  constructor(motivo: string) {
    super(`La catena delle esportazioni del registro non è coerente: ${motivo}.`)
    this.name = 'CatenaEsportazioniNonCoerenteError'
  }
}

/** 502: l'eREGI scaricato da RENTRI non e' utilizzabile (forma inattesa o identificativo diverso). */
export class EregiNonDisponibileError extends DomainError {
  constructor(motivo: string) {
    super(`L'eREGI del registro scaricato da RENTRI non è utilizzabile: ${motivo}.`)
    this.name = 'EregiNonDisponibileError'
  }
}
