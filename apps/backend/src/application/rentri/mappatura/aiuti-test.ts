import { CostruisciPayloadRentri } from './costruisci-payload-rentri'

/**
 * Aiuti condivisi dai test che costruiscono `SyncFIRToRENTRIUseCase`.
 *
 * Quei test verificano il PROTOCOLLO (ciclo asincrono, resilienza, legame col
 * FIR), non la mappatura: quest'ultima ha il proprio test, giudicato dal
 * validatore del contratto. Serve loro solo un costruttore di corpo che
 * restituisca qualcosa di valido, senza database ne' registri anagrafici.
 *
 * Il corpo arriva dall'aiuto del finto RENTRI invece di essere riscritto qui:
 * quando la validazione dell'oracolo si stringera' ancora, questi test si
 * adegueranno da soli anziche' restare verdi su un corpo ormai rifiutato.
 */

const AIUTO_ORACOLO = '../../../../../../tools/rentri-fake/test/aiuti/formulario'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { corpoNuovoFormularioValido } = require(AIUTO_ORACOLO)

export function costruttorePayloadFinto(): CostruisciPayloadRentri {
  return {
    costruisci: async () => corpoNuovoFormularioValido(),
  } as unknown as CostruisciPayloadRentri
}

/**
 * Corpo valido per `POST /formulari/v1.0/`, da usare nei test che verificano
 * il PROTOCOLLO e non il contenuto (ciclo asincrono, resilienza, limitatore,
 * riconciliazione).
 *
 * Prima della validazione del modello dati questi test passavano
 * `{ dati: 'qualsiasi' }`: funzionava solo perche' il finto accettava
 * qualunque cosa, ed e' lo stesso buco che ha lasciato passare per mesi il
 * segnaposto del backend. Ora il corpo e' vero, e resta in un posto solo.
 *
 * `sovrascritture` permette di cambiare un campo mantenendo il resto valido
 * (per esempio il codice fiscale del produttore, quando il test cerca il
 * formulario per soggetto).
 */
export function corpoFormularioValido(
  sovrascritture?: Record<string, unknown>
): Record<string, unknown> {
  return { ...corpoNuovoFormularioValido(), ...(sovrascritture ?? {}) }
}
