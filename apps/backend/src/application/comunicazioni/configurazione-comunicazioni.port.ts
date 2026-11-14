import type {
  ConfigurazionePerConsorzio,
  ConsorzioConfigurabile,
} from '../../domain/comunicazioni/configurazione-sede'

/**
 * Porta della configurazione delle comunicazioni per sede propria e consorzio (4.9c-f, D4).
 */
export const CONFIGURAZIONE_COMUNICAZIONI_SERVICE = Symbol('CONFIGURAZIONE_COMUNICAZIONI_SERVICE')

export interface ConfigurazioneVista<C extends ConsorzioConfigurabile = ConsorzioConfigurabile> {
  unitaLocaleId: string
  consorzio: C
  /** false = la sede non ha una configurazione salvata: i dati sono i predefiniti. */
  salvata: boolean
  dati: ConfigurazionePerConsorzio[C]
}

export interface ConfigurazioneComunicazioniPort {
  /** Con i predefiniti se la sede non ha una riga. */
  leggi<C extends ConsorzioConfigurabile>(
    tenantId: string,
    unitaLocaleId: string,
    consorzio: C
  ): Promise<ConfigurazioneVista<C>>
  imposta<C extends ConsorzioConfigurabile>(
    tenantId: string,
    unitaLocaleId: string,
    consorzio: C,
    dati: unknown
  ): Promise<ConfigurazioneVista<C>>
}

/** Configurazione non valida: risponde 400, con l'elenco degli errori. */
export class ConfigurazioneComunicazioniNonValidaError extends Error {
  constructor(readonly errori: string[]) {
    super(`Configurazione non valida: ${errori.join('; ')}`)
    this.name = 'ConfigurazioneComunicazioniNonValidaError'
  }
}

export class UnitaLocaleNonTrovataError extends Error {
  constructor() {
    super('Sede non trovata.')
    this.name = 'UnitaLocaleNonTrovataError'
  }
}
