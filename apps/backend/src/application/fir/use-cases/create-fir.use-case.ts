/**
 * Create FIR Use Case - Application Layer
 * Business logic orchestration
 */

import {
  FIR,
  ParteFIR,
  TrattaTrasportoFIR,
  TipoTratta,
} from '../../../domain/fir/aggregates/fir.aggregate'
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
    // 1. Normalize + validate CER code. Il catalogo memorizza i codici nel
    //    formato canonico "NN NN NN" (con spazi, "*" per i pericolosi): si
    //    accetta anche l'input senza spazi (es. "200301") normalizzandolo.
    const cerCode = this.normalizeCerCode(command.rifiuto.cerCode)
    const cerExists = await this.cerRepository.exists(cerCode)
    if (!cerExists) {
      return Result.fail<FIR>(`CER code not found: ${command.rifiuto.cerCode}`)
    }
    // Il cerCode normalizzato sovrascrive il valore originale (normalizzato a
    // "NN NN NN" / "NN NN NN*"). Gli altri campi del rifiuto passano invariati.
    const rifiuto = { ...command.rifiuto, cerCode }

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

    // 3b. Load the additional carriers (intermodal legs) from the registry, with
    //     the same tenant scoping as the principal carrier. Each one becomes an
    //     immutable anagrafica SNAPSHOT frozen on the FIR.
    const trasportatoriAggiuntivi: TrattaTrasportoFIR[] = []
    for (const tratta of command.trasportatoriAggiuntivi ?? []) {
      const carrier = await this.trasportatoreRepository.findById(tratta.trasportatoreId)
      if (!carrier) {
        return Result.fail<FIR>(`Trasportatore not found: ${tratta.trasportatoreId}`)
      }
      trasportatoriAggiuntivi.push(this.snapshotTratta(carrier, tratta.ordine, tratta.tipoTratta))
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
        produttore: this.snapshotProduttore(produttore),
        trasportatore: this.snapshotTrasportatore(trasportatore),
        destinatario: this.snapshotDestinatario(destinatario),
        trasportatoriAggiuntivi,
        annotazioni: command.annotazioni,
      })

      // 5. Persist FIR
      await this.firRepository.save(fir)

      // 6. Return success
      return Result.ok<FIR>(fir)
    } catch (error) {
      return Result.fail<FIR>(`Failed to create FIR: ${error.message}`)
    }
  }

  /**
   * Normalizza un codice CER al formato canonico del catalogo "NN NN NN"
   * (con "*" finale per i pericolosi). Accetta input senza spazi ("200301")
   * o con spaziatura irregolare; se il formato non è 6 cifre lascia invariato
   * (la validazione successiva fallirà con messaggio chiaro).
   */
  private normalizeCerCode(raw: string): string {
    if (!raw) return raw
    const trimmed = raw.trim().toUpperCase()
    const hazardous = trimmed.includes('*')
    const digits = trimmed.replace(/[^0-9]/g, '')
    if (digits.length !== 6) return trimmed
    const spaced = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
    return hazardous ? `${spaced}*` : spaced
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

  /**
   * Snapshot anagrafico immutabile di un trasportatore aggiuntivo (tratta
   * intermodale). Mezzo e data presa in carico restano vuoti alla creazione:
   * verranno valorizzati a runtime durante l'esecuzione del trasporto.
   */
  private snapshotTratta(
    t: Trasportatore,
    ordine: number,
    tipoTratta: TipoTratta
  ): TrattaTrasportoFIR {
    return {
      ordine,
      tipoTratta,
      trasportatoreId: t.id,
      denominazione: t.ragioneSociale,
      partitaIva: t.partitaIVA.getValue(),
      numeroIscrizioneAlbo: t.numeroIscrizione,
    }
  }
}
