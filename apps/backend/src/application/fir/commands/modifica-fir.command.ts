/**
 * Modifica FIR Command - sostituzione del contenuto di una bozza (piano D6).
 *
 * Stesso contenuto di `CreateFIRCommand` piu' `firId` e `versione` (quella che il client ha letto),
 * con l'unita' di misura obbligatoria: in modifica un'assenza cambierebbe l'unita' di nascosto.
 * `descrizione`, `categoria` e `tipoOperazione` del rifiuto non sono ammessi: la modifica li conserva.
 */

import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta, ProvenienzaRifiuto } from '../../../domain/fir/aggregates/fir.aggregate'
import { TrasportatoreAggiuntivoInput } from './create-fir.command'

export interface ModificaFIRCommand {
  firId: string
  tenantId: string
  userId: string
  /** Versione del FIR letta dal client: se non e' piu' quella corrente, 409. */
  versione: number
  produttoreId: string
  trasportatoreId: string
  destinatarioId: string
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: UnitaMisura
    statoFisico?: string | null
    caratteristichePericolo?: string | null
    numeroColli?: number | null
    codiceOperazione?: string | null
  }
  provenienza: ProvenienzaRifiuto
  tipoTrattaPrincipale: TipoTratta
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoInput[]
  annotazioni?: string | null
}
