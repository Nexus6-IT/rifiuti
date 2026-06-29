import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { Result } from '../../../core/application/result'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import {
  WasteMovement,
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
  TERMINE_REGISTRAZIONE_PRODUTTORE_GG,
} from '../../../domain/waste-movement/waste-movement.entity'

export interface MovimentoRegistrato {
  id: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  movementDate: Date
  registrationDate: Date
  causale: string
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
  /** Segnala all'operatore se la registrazione supera i termini di legge. */
  fuoriTermine: boolean
  ritardoGg: number
}

/**
 * Use case per la registrazione di un movimento nel registro cronologico
 * di carico/scarico. Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Assegna automaticamente il numero progressivo per tenant/anno tramite
 * SELECT ... FOR UPDATE per evitare race condition in ambienti multi-worker.
 *
 * Calcola e persiste l'hash SHA-256 di vidimazione digitale (art. 4 DM 59/2023).
 *
 * Verifica che lo SCARICO non porti la giacenza del CER sotto zero
 * (anomaly detection: "scarico > carico"). Se la giacenza risulta insufficiente
 * restituisce un errore bloccante.
 */
@Injectable()
export class RegistraMovimentoUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(RegistraMovimentoUseCase.name)
  }

  async execute(command: RegistraMovimentoCommand): Promise<Result<MovimentoRegistrato>> {
    // 0. Validazione causale anticipata (prima di qualunque operazione DB)
    if (command.type === 'CARICO') {
      if (!CAUSALI_CARICO.includes(command.causale as (typeof CAUSALI_CARICO)[number])) {
        return Result.fail(
          `Causale non valida per CARICO: ${command.causale}. Valori: ${CAUSALI_CARICO.join(', ')}`,
        )
      }
    } else {
      if (!CAUSALI_SCARICO.includes(command.causale as (typeof CAUSALI_SCARICO)[number])) {
        return Result.fail(
          `Causale non valida per SCARICO: ${command.causale}. Valori: ${CAUSALI_SCARICO.join(', ')}`,
        )
      }
    }

    // 1. Validazione preventiva giacenza per SCARICO
    if (command.type === 'SCARICO') {
      const giacenza = await this.getGiacenzaCer(command.tenantId, command.cerCode)
      if (giacenza < command.quantity) {
        return Result.fail(
          `Giacenza insufficiente per CER ${command.cerCode}: ` +
            `disponibili ${giacenza} ${command.unit}, richiesti ${command.quantity} ${command.unit}. ` +
            `Verifica i movimenti di carico registrati.`,
        )
      }
    }

    // 2. Assegnazione numero progressivo (transazionale con SELECT FOR UPDATE)
    const anno = command.registrationDate.getFullYear()

    let movimento: MovimentoRegistrato
    try {
      movimento = await this.prisma.$transaction(async (tx) => {
        // Advisory lock per-tenant/anno: serializza le numerazioni dello stesso
        // tenant in transazioni concorrenti senza usare FOR UPDATE su aggregati
        // (PostgreSQL 0A000: "FOR UPDATE is not allowed with aggregate functions").
        // pg_advisory_xact_lock è rilasciato automaticamente al commit/rollback.
        const lockKey = `${command.tenantId}-${anno}`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

        const [row] = await tx.$queryRaw<Array<{ max_num: number | null }>>`
          SELECT MAX(progressive_number) AS max_num
          FROM waste_movements
          WHERE tenant_id = ${command.tenantId}::uuid
            AND progressive_year = ${anno}
        `
        const nextProgressivo = (row.max_num ?? 0) + 1

        // 3. Costruzione entità di dominio (con validazioni)
        const entity = WasteMovement.create({
          tenantId: command.tenantId,
          progressiveNumber: nextProgressivo,
          progressiveYear: anno,
          type: command.type,
          movementDate: command.movementDate,
          registrationDate: command.registrationDate,
          causale: command.causale,
          cerCode: command.cerCode,
          wasteDescription: command.wasteDescription,
          quantity: command.quantity,
          unit: command.unit,
          wastePhysicalState: command.wastePhysicalState,
          wasteHazardClasses: command.wasteHazardClasses,
          operationCode: command.operationCode,
          counterpartName: command.counterpartName,
          counterpartAddress: command.counterpartAddress,
          firId: command.firId,
          recordedByUserId: command.userId,
          notes: command.notes,
        })

        const ritardoGg = entity.ritardoRegistrazioneGg

        // 4. Persistenza
        const record = await tx.wasteMovement.create({
          data: {
            tenantId: entity.tenantId,
            progressiveNumber: entity.progressiveNumber,
            progressiveYear: entity.progressiveYear,
            type: entity.type,
            movementDate: entity.movementDate,
            registrationDate: entity.registrationDate,
            causale: entity.causale,
            cerCode: entity.cerCode,
            wasteDescription: entity.wasteDescription,
            quantity: entity.quantity,
            unit: entity.unit,
            wastePhysicalState: entity.wastePhysicalState,
            wasteHazardClasses: entity.wasteHazardClasses,
            operationCode: entity.operationCode,
            counterpartName: entity.counterpartName,
            counterpartAddress: entity.counterpartAddress,
            firId: entity.firId,
            recordedByUserId: entity.recordedByUserId,
            entryHash: entity.entryHash,
            notes: entity.notes,
          },
        })

        return {
          id: record.id,
          tenantId: record.tenantId,
          progressiveNumber: record.progressiveNumber,
          progressiveYear: record.progressiveYear,
          type: record.type,
          movementDate: record.movementDate,
          registrationDate: record.registrationDate,
          causale: record.causale,
          cerCode: record.cerCode,
          wasteDescription: record.wasteDescription ?? undefined,
          quantity: Number(record.quantity),
          unit: record.unit,
          wastePhysicalState: record.wastePhysicalState ?? undefined,
          wasteHazardClasses: record.wasteHazardClasses ?? undefined,
          operationCode: record.operationCode ?? undefined,
          counterpartName: record.counterpartName ?? undefined,
          counterpartAddress: record.counterpartAddress ?? undefined,
          firId: record.firId ?? undefined,
          recordedByUserId: record.recordedByUserId ?? undefined,
          entryHash: record.entryHash,
          notes: record.notes ?? undefined,
          fuoriTermine: ritardoGg > 0,
          ritardoGg,
        }
      })
    } catch (err) {
      this.logger.error(`Errore registrazione movimento: ${err.message}`)
      return Result.fail(`Errore durante la registrazione: ${err.message}`)
    }

    if (movimento.fuoriTermine) {
      this.logger.warn(
        `Movimento ${movimento.progressiveYear}/${movimento.progressiveNumber} ` +
          `registrato con ${movimento.ritardoGg} gg di ritardo sul termine di legge ` +
          `(${TERMINE_REGISTRAZIONE_PRODUTTORE_GG} gg) per tenant ${command.tenantId}`,
      )
    }

    this.logger.info(
      `Movimento registrato: ${movimento.type} ` +
        `#${movimento.progressiveYear}/${movimento.progressiveNumber} ` +
        `CER ${movimento.cerCode} qty ${movimento.quantity} ${movimento.unit}`,
    )

    return Result.ok(movimento)
  }

  /** Calcola la giacenza corrente per un CER del tenant (carico - scarico). */
  private async getGiacenzaCer(tenantId: string, cerCode: string): Promise<number> {
    const rows = await this.prisma.wasteMovement.groupBy({
      by: ['type'],
      where: { tenantId, cerCode },
      _sum: { quantity: true },
    })
    let carico = 0
    let scarico = 0
    for (const r of rows) {
      const qty = r._sum.quantity ? Number(r._sum.quantity) : 0
      if (r.type === 'CARICO') carico += qty
      else if (r.type === 'SCARICO') scarico += qty
    }
    return Math.max(0, carico - scarico)
  }
}
