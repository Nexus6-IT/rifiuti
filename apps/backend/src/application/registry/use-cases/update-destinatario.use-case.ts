/**
 * UpdateDestinatario Use Case
 * Updates an existing Destinatario entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
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

export interface UpdateDestinatarioCommand {
  id: string
  ragioneSociale?: string
  /** D2.7: aggiunge l'identificativo mancante della ditta (mai un cambio di quello impostato). */
  codiceFiscale?: string
  /** D2.7 / D2.8: aggiunta, o sostituzione se quella registrata non passa il controllo. */
  partitaIVA?: string
  /** Nuova sede predefinita del ruolo (attiva e della stessa ditta). Esclude l'indirizzo. */
  sedeId?: string
  sede?: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroAutorizzazione?: string
  email?: string
  telefono?: string
  pec?: string
  // `undefined` = campo non toccato dalla richiesta; `null` = azzeramento
  // esplicito della scadenza (campo facoltativo).
  scadenzaAutorizzazione?: Date | null
}

@Injectable()
export class UpdateDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository<ClientDitte>,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: UpdateDestinatarioCommand): Promise<Result<Destinatario>> {
    try {
      if (command.sedeId && command.sede) {
        return Result.fail(MESSAGGIO_SEDE_E_INDIRIZZO)
      }

      // Find existing Destinatario
      const esistente = await this.destinatarioRepository.findById(command.id)

      if (!esistente) {
        return Result.fail('Destinatario not found')
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
        const destinatario =
          cambiaIdentificativi || command.sedeId
            ? await this.destinatarioRepository.findById(
                command.id,
                command.sedeId ? { sedeId: command.sedeId } : undefined,
                tx
              )
            : esistente

        if (!destinatario) {
          throw new RifiutoRichiestaError('Destinatario not found')
        }

        // Check if new Numero Autorizzazione already exists (if changing)
        if (
          command.numeroAutorizzazione &&
          command.numeroAutorizzazione !== destinatario.numeroAutorizzazione
        ) {
          const existing = await this.destinatarioRepository.findByNumeroAutorizzazione(
            command.numeroAutorizzazione
          )

          if (existing) {
            throw new RifiutoRichiestaError(
              'Another Destinatario with this Numero Autorizzazione already exists'
            )
          }
        }

        // Update fields using entity methods
        if (command.ragioneSociale) {
          destinatario.updateRagioneSociale(command.ragioneSociale)
        }

        if (command.sede) {
          if (this.referenceData) {
            const v = await this.referenceData.validateLocalita(
              command.sede.citta,
              command.sede.provincia
            )
            if (!v.ok) throw new RifiutoRichiestaError(v.error!)
          }
          destinatario.updateSede(Indirizzo.create(command.sede))
        }

        if (command.numeroAutorizzazione) {
          destinatario.updateNumeroAutorizzazione(command.numeroAutorizzazione)
        }

        // `undefined` = campo non presente nella richiesta, nessuna modifica;
        // `null` = azzeramento esplicito della scadenza.
        if (command.scadenzaAutorizzazione !== undefined) {
          destinatario.updateScadenzaAutorizzazione(command.scadenzaAutorizzazione ?? undefined)
        }

        // Update contacts if any field is provided
        if (
          command.email !== undefined ||
          command.telefono !== undefined ||
          command.pec !== undefined
        ) {
          destinatario.updateContatti(
            command.email !== undefined ? command.email : destinatario.email,
            command.telefono !== undefined ? command.telefono : destinatario.telefono,
            command.pec !== undefined ? command.pec : destinatario.pec
          )
        }

        // Save updated entity
        await this.destinatarioRepository.save(destinatario, tx)

        return Result.ok(destinatario)
      })
    } catch (error: unknown) {
      if (error instanceof RifiutoRichiestaError) return Result.fail(error.message)
      if (eErroreDiDittaDaPropagare(error)) throw error
      return Result.fail(messaggioSicuro(error))
    }
  }
}
