/**
 * UpdateTrasportatore Use Case
 * Updates an existing Trasportatore entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { TenantContext } from '../../../core/context/tenant-context'
import { ClientDitte } from '../../../infrastructure/persistence/ditta-prisma.repository'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { DitteService } from '../ditte/ditte.service'
import {
  MESSAGGIO_SEDE_E_INDIRIZZO,
  RifiutoRichiestaError,
  eErroreDiDittaDaPropagare,
  messaggioSicuro,
} from '../crea-ruolo-su-ditta'

export interface UpdateTrasportatoreCommand {
  id: string
  ragioneSociale?: string
  /** D2.7: aggiunge l'identificativo mancante della ditta (mai un cambio di quello impostato). */
  codiceFiscale?: string
  /** D2.7 / D2.8: aggiunta, o sostituzione se quella registrata non passa il controllo. */
  partitaIVA?: string
  /** Nuova sede predefinita del ruolo (attiva e della stessa ditta). Esclude l'indirizzo. */
  sedeId?: string
  sedeLegale?: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroIscrizione?: string
  email?: string
  telefono?: string
  pec?: string
  // `undefined` = campo non toccato dalla richiesta; `null` = azzeramento
  // esplicito della scadenza (campo facoltativo). Servono valori distinti,
  // quindi non si può riusare la stessa convenzione di updateContatti (dove
  // `undefined` mantiene il valore corrente per email/telefono/pec).
  scadenzaIscrizione?: Date | null
}

@Injectable()
export class UpdateTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository<ClientDitte>,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: UpdateTrasportatoreCommand): Promise<Result<Trasportatore>> {
    try {
      if (command.sedeId && command.sedeLegale) {
        return Result.fail(MESSAGGIO_SEDE_E_INDIRIZZO)
      }

      // Find existing Trasportatore
      const esistente = await this.trasportatoreRepository.findById(command.id)

      if (!esistente) {
        return Result.fail('Trasportatore not found')
      }

      // Tutto o niente: identificativi della ditta, validazioni e salvataggio in UNA transazione.
      // Un rifiuto o un errore a meta' annulla anche la correzione degli identificativi e l'audit.
      return await this.ditte.transazione(async tx => {
        // Identificativi: si agisce sulla ditta, con i suoi lock e l'audit della correzione
        const cambiaIdentificativi = !!(command.codiceFiscale || command.partitaIVA)
        if (cambiaIdentificativi) {
          await this.ditte.aggiornaDitta(
            esistente.dittaId,
            { partitaIva: command.partitaIVA, codiceFiscale: command.codiceFiscale },
            { userId: TenantContext.getUserId() ?? undefined },
            tx
          )
        }

        // Si rilegge se serve: identificativi aggiornati e, con sedeId, indirizzo e contatti della
        // nuova sede predefinita (D7; sede non valida per il ruolo = 400)
        const trasportatore =
          cambiaIdentificativi || command.sedeId
            ? await this.trasportatoreRepository.findById(
                command.id,
                command.sedeId ? { sedeId: command.sedeId } : undefined,
                tx
              )
            : esistente

        if (!trasportatore) {
          throw new RifiutoRichiestaError('Trasportatore not found')
        }

        // Check if new Numero Iscrizione already exists (if changing)
        if (
          command.numeroIscrizione &&
          command.numeroIscrizione !== trasportatore.numeroIscrizione
        ) {
          const existing = await this.trasportatoreRepository.findByNumeroIscrizione(
            command.numeroIscrizione
          )

          if (existing) {
            throw new RifiutoRichiestaError(
              'Another Trasportatore with this Numero Iscrizione already exists'
            )
          }
        }

        // Update fields using entity methods
        if (command.ragioneSociale) {
          trasportatore.updateRagioneSociale(command.ragioneSociale)
        }

        if (command.sedeLegale) {
          if (this.referenceData) {
            const v = await this.referenceData.validateLocalita(
              command.sedeLegale.citta,
              command.sedeLegale.provincia
            )
            if (!v.ok) throw new RifiutoRichiestaError(v.error!)
          }
          trasportatore.updateSedeLegale(Indirizzo.create(command.sedeLegale))
        }

        if (command.numeroIscrizione) {
          trasportatore.updateNumeroIscrizione(command.numeroIscrizione)
        }

        // `undefined` = campo non presente nella richiesta, nessuna modifica;
        // `null` = azzeramento esplicito della scadenza.
        if (command.scadenzaIscrizione !== undefined) {
          trasportatore.updateScadenzaIscrizione(command.scadenzaIscrizione ?? undefined)
        }

        // Update contacts if any field is provided
        if (
          command.email !== undefined ||
          command.telefono !== undefined ||
          command.pec !== undefined
        ) {
          trasportatore.updateContatti(
            command.email !== undefined ? command.email : trasportatore.email,
            command.telefono !== undefined ? command.telefono : trasportatore.telefono,
            command.pec !== undefined ? command.pec : trasportatore.pec
          )
        }

        // Save updated entity
        await this.trasportatoreRepository.save(trasportatore, tx)

        return Result.ok(trasportatore)
      })
    } catch (error: unknown) {
      if (error instanceof RifiutoRichiestaError) return Result.fail(error.message)
      if (eErroreDiDittaDaPropagare(error)) throw error
      return Result.fail(messaggioSicuro(error))
    }
  }
}
