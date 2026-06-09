/**
 * Create FIR Use Case - Application Layer
 * Business logic orchestration
 */

import { FIR, ParteFIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { TrasportatoreRepository } from '../../../domain/registry/repositories/trasportatore.repository'
import { DestinatarioRepository } from '../../../domain/registry/repositories/destinatario.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { Result } from '../../../core/application/result'
import { CreateFIRCommand } from '../commands/create-fir.command'

export class CreateFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cerRepository: ICERRepository,
    private readonly produttoreRepository: ProduttoreRepository,
    private readonly trasportatoreRepository: TrasportatoreRepository,
    private readonly destinatarioRepository: DestinatarioRepository
  ) {}

  async execute(command: CreateFIRCommand): Promise<Result<FIR>> {
    // 1. Validate CER code exists
    const cerExists = await this.cerRepository.exists(command.rifiuto.cerCode)
    if (!cerExists) {
      return Result.fail<FIR>(`CER code not found: ${command.rifiuto.cerCode}`)
    }

    // 2. Validate the three parties are provided
    if (!command.produttoreId || !command.trasportatoreId || !command.destinatarioId) {
      return Result.fail<FIR>('Produttore, Trasportatore and Destinatario are required')
    }

    // 3. Load the three parties from the registry. A FIR is a legal document:
    //    the anagrafica must be captured as an immutable SNAPSHOT at creation
    //    time, not referenced live. Missing registry records → cannot produce a
    //    valid FIR.
    const produttore = await this.produttoreRepository.findById(command.produttoreId)
    if (!produttore) {
      return Result.fail<FIR>(`Produttore not found: ${command.produttoreId}`)
    }

    const trasportatore = await this.trasportatoreRepository.findById(command.trasportatoreId)
    if (!trasportatore) {
      return Result.fail<FIR>(`Trasportatore not found: ${command.trasportatoreId}`)
    }

    const destinatario = await this.destinatarioRepository.findById(command.destinatarioId)
    if (!destinatario) {
      return Result.fail<FIR>(`Destinatario not found: ${command.destinatarioId}`)
    }

    // 4. Create FIR aggregate with the frozen anagrafica snapshots
    try {
      const fir = FIR.create({
        produttoreId: command.produttoreId,
        rifiuto: command.rifiuto,
        trasportatoreId: command.trasportatoreId,
        destinatarioId: command.destinatarioId,
        creatoDaUserId: command.userId,
        produttore: this.snapshotProduttore(produttore),
        trasportatore: this.snapshotTrasportatore(trasportatore),
        destinatario: this.snapshotDestinatario(destinatario),
      })

      // 5. Persist FIR
      await this.firRepository.save(fir)

      // 6. Return success
      return Result.ok<FIR>(fir)
    } catch (error) {
      return Result.fail<FIR>(`Failed to create FIR: ${error.message}`)
    }
  }

  private snapshotProduttore(p: Produttore): ParteFIR {
    return {
      registroId: p.id,
      ragioneSociale: p.ragioneSociale,
      partitaIva: p.partitaIVA.getValue(),
      indirizzo: p.sedeLegale.getFormatted(),
      contatto: p.pec || p.email || undefined,
    }
  }

  private snapshotTrasportatore(t: Trasportatore): ParteFIR {
    return {
      registroId: t.id,
      ragioneSociale: t.ragioneSociale,
      partitaIva: t.partitaIVA.getValue(),
      indirizzo: t.sedeLegale.getFormatted(),
      contatto: t.pec || t.email || undefined,
    }
  }

  private snapshotDestinatario(d: Destinatario): ParteFIR {
    return {
      registroId: d.id,
      ragioneSociale: d.ragioneSociale,
      partitaIva: d.partitaIVA.getValue(),
      indirizzo: d.sede.getFormatted(),
      contatto: d.pec || d.email || undefined,
    }
  }
}
