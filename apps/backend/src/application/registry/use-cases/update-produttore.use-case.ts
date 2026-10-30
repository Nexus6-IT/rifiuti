/**
 * UpdateProduttore Use Case
 * Updates an existing Produttore entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
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

export interface UpdateProduttoreCommand {
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
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class UpdateProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository<ClientDitte>,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: UpdateProduttoreCommand): Promise<Result<Produttore>> {
    try {
      if (command.sedeId && command.sedeLegale) {
        return Result.fail(MESSAGGIO_SEDE_E_INDIRIZZO)
      }

      // Find existing Produttore
      const esistente = await this.produttoreRepository.findById(command.id)

      if (!esistente) {
        return Result.fail('Produttore not found')
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
        const produttore =
          cambiaIdentificativi || command.sedeId
            ? await this.produttoreRepository.findById(
                command.id,
                command.sedeId ? { sedeId: command.sedeId } : undefined,
                tx
              )
            : esistente

        if (!produttore) {
          throw new RifiutoRichiestaError('Produttore not found')
        }

        // Update fields using entity methods
        if (command.ragioneSociale) {
          produttore.updateRagioneSociale(command.ragioneSociale)
        }

        if (command.sedeLegale) {
          if (this.referenceData) {
            const v = await this.referenceData.validateLocalita(
              command.sedeLegale.citta,
              command.sedeLegale.provincia
            )
            if (!v.ok) throw new RifiutoRichiestaError(v.error!)
          }
          produttore.updateSedeLegale(Indirizzo.create(command.sedeLegale))
        }

        // Update contacts if any field is provided
        if (
          command.email !== undefined ||
          command.telefono !== undefined ||
          command.pec !== undefined
        ) {
          produttore.updateContatti(
            command.email !== undefined ? command.email : produttore.email,
            command.telefono !== undefined ? command.telefono : produttore.telefono,
            command.pec !== undefined ? command.pec : produttore.pec
          )
        }

        // Save updated entity
        await this.produttoreRepository.save(produttore, tx)

        return Result.ok(produttore)
      })
    } catch (error: unknown) {
      if (error instanceof RifiutoRichiestaError) return Result.fail(error.message)
      if (eErroreDiDittaDaPropagare(error)) throw error
      return Result.fail(messaggioSicuro(error))
    }
  }
}
