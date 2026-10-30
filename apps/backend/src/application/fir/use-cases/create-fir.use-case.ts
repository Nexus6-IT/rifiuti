/**
 * Create FIR Use Case - Application Layer
 * Business logic orchestration
 */

import { FIR, TrattaTrasportoFIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { TrasportatoreRepository } from '../../../domain/registry/repositories/trasportatore.repository'
import { DestinatarioRepository } from '../../../domain/registry/repositories/destinatario.repository'
import { Result } from '../../../core/application/result'
import { SedeNonValidaPerRuoloError } from '../../../core/domain/errors'
import { CreateFIRCommand } from '../commands/create-fir.command'
import { verificaCerPerFormulario } from '../verifica-cer-formulario'
import {
  snapshotProduttore,
  snapshotTrasportatore,
  snapshotDestinatario,
  snapshotTratta,
} from '../snapshot-parti'

export class CreateFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cerRepository: ICERRepository,
    private readonly produttoreRepository: ProduttoreRepository,
    private readonly trasportatoreRepository: TrasportatoreRepository,
    private readonly destinatarioRepository: DestinatarioRepository
  ) {}

  async execute(command: CreateFIRCommand): Promise<Result<FIR>> {
    // 1. Normalize + validate CER code. Il catalogo memorizza i codici nel
    //    formato canonico "NN NN NN" (con spazi, "*" per i pericolosi): si
    //    accetta anche l'input senza spazi (es. "200301") normalizzandolo.
    //    Verifica condivisa con la modifica della bozza.
    const cer = await verificaCerPerFormulario(this.cerRepository, command.rifiuto.cerCode)
    if (cer.isFailure) {
      return Result.fail<FIR>(cer.error)
    }
    // Il cerCode normalizzato sovrascrive il valore originale (normalizzato a
    // "NN NN NN" / "NN NN NN*"). Gli altri campi del rifiuto passano invariati.
    const rifiuto = { ...command.rifiuto, cerCode: cer.value }

    // 2. Validate the three parties are provided
    if (!command.produttoreId || !command.trasportatoreId || !command.destinatarioId) {
      return Result.fail<FIR>('Produttore, Trasportatore and Destinatario are required')
    }

    // 3. Load the three parties from the registry. A FIR is a legal document:
    //    the anagrafica must be captured as an immutable SNAPSHOT at creation
    //    time, not referenced live. Missing registry records → cannot produce a
    //    valid FIR.
    // F2-10 D9: la sede indicata deve essere attiva e della ditta del ruolo (altrimenti 400); senza
    // sede nel DTO vale la predefinita del ruolo, come prima della migration.
    let produttore
    let destinatario
    try {
      produttore = command.produttoreSedeId
        ? await this.produttoreRepository.findById(command.produttoreId, {
            sedeId: command.produttoreSedeId,
          })
        : await this.produttoreRepository.findById(command.produttoreId)
      if (!produttore) {
        return Result.fail<FIR>(`Produttore not found: ${command.produttoreId}`)
      }
    } catch (error) {
      if (error instanceof SedeNonValidaPerRuoloError) return Result.fail<FIR>(error.message)
      throw error
    }

    const trasportatore = await this.trasportatoreRepository.findById(command.trasportatoreId)
    if (!trasportatore) {
      return Result.fail<FIR>(`Trasportatore not found: ${command.trasportatoreId}`)
    }

    try {
      destinatario = command.destinatarioSedeId
        ? await this.destinatarioRepository.findById(command.destinatarioId, {
            sedeId: command.destinatarioSedeId,
          })
        : await this.destinatarioRepository.findById(command.destinatarioId)
      if (!destinatario) {
        return Result.fail<FIR>(`Destinatario not found: ${command.destinatarioId}`)
      }
    } catch (error) {
      if (error instanceof SedeNonValidaPerRuoloError) return Result.fail<FIR>(error.message)
      throw error
    }

    // 3b. Load the additional carriers (intermodal legs) from the registry, with
    //     the same tenant scoping as the principal carrier. Each one becomes an
    //     immutable anagrafica SNAPSHOT frozen on the FIR.
    const trasportatoriAggiuntivi: TrattaTrasportoFIR[] = []
    for (const tratta of command.trasportatoriAggiuntivi ?? []) {
      const carrier = await this.trasportatoreRepository.findById(tratta.trasportatoreId)
      if (!carrier) {
        return Result.fail<FIR>(`Trasportatore not found: ${tratta.trasportatoreId}`)
      }
      trasportatoriAggiuntivi.push(snapshotTratta(carrier, tratta.ordine, tratta.tipoTratta))
    }

    // 4. Create FIR aggregate with the frozen anagrafica snapshots
    try {
      const fir = FIR.create({
        produttoreId: command.produttoreId,
        rifiuto,
        trasportatoreId: command.trasportatoreId,
        destinatarioId: command.destinatarioId,
        tenantId: command.tenantId,
        creatoDaUserId: command.userId,
        produttore: snapshotProduttore(produttore),
        trasportatore: snapshotTrasportatore(trasportatore),
        destinatario: snapshotDestinatario(destinatario),
        trasportatoriAggiuntivi,
        annotazioni: command.annotazioni,
        provenienza: command.provenienza,
        tipoTrattaPrincipale: command.tipoTrattaPrincipale,
      })

      // 5. Persist FIR
      await this.firRepository.save(fir)

      // 6. Return success
      return Result.ok<FIR>(fir)
    } catch (error) {
      return Result.fail<FIR>(`Failed to create FIR: ${error.message}`)
    }
  }
}
