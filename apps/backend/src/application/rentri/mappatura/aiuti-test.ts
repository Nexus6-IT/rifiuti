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
