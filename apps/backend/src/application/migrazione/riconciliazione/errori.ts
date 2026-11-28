import { ValutazioneChiusura } from '../../../domain/migrazione/riconciliazione/chiusura'

export class RapportoNonTrovatoError extends Error {
  constructor() {
    super('rapporto di riconciliazione inesistente per l azienda')
    this.name = 'RapportoNonTrovatoError'
  }
}

/** Il rapporto e' cambiato dopo che l'operatore lo ha letto (HTTP 409). */
export class VersioneCambiataError extends Error {
  constructor(
    readonly richiesta: number,
    readonly attuale: number
  ) {
    super(`il rapporto e alla versione ${attuale}, non alla ${richiesta}`)
    this.name = 'VersioneCambiataError'
  }
}

export class RapportoChiusoError extends Error {
  constructor() {
    super('il rapporto e chiuso: per riconciliare di nuovo serve un rapporto nuovo')
    this.name = 'RapportoChiusoError'
  }
}

export class RapportoNonChiudibileError extends Error {
  constructor(readonly valutazione: ValutazioneChiusura) {
    super(
      `il rapporto non si puo chiudere: ${valutazione.differenzeAperte.length} differenze aperte, ` +
        `${valutazione.campioniSenzaEsito} campioni senza esito, ` +
        `${valutazione.campioniNonCorrispondono} campioni non corrispondenti`
    )
    this.name = 'RapportoNonChiudibileError'
  }
}

export class DifferenzaInesistenteError extends Error {
  constructor(readonly chiave: string) {
    super(`nessuna differenza aperta con chiave ${chiave}`)
    this.name = 'DifferenzaInesistenteError'
  }
}

export class MotivoNonValidoError extends Error {
  constructor() {
    super('il motivo deve essere un testo di 5-500 caratteri')
    this.name = 'MotivoNonValidoError'
  }
}

export class CampioneInesistenteError extends Error {
  constructor() {
    super('campione inesistente per l azienda')
    this.name = 'CampioneInesistenteError'
  }
}

export class VerbaleNonValidoError extends Error {
  constructor(motivo: string) {
    super(`verbale non valido: ${motivo}`)
    this.name = 'VerbaleNonValidoError'
  }
}

export class VerbaleGiaCaricatoError extends Error {
  constructor() {
    super('questo verbale (stessa impronta) e gia stato caricato per il rapporto')
    this.name = 'VerbaleGiaCaricatoError'
  }
}
