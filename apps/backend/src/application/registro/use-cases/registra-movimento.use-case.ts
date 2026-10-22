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
import {
  annoSolareItaliano,
  formattaDataItaliana,
  giornoItaliano,
} from '../../../core/time/anno-italiano'

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
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RegistraMovimentoUseCase.name)
  }

  async execute(command: RegistraMovimentoCommand): Promise<Result<MovimentoRegistrato>> {
    // 0. Validazione causale anticipata (prima di qualunque operazione DB)
    if (command.type === 'CARICO') {
      if (!CAUSALI_CARICO.includes(command.causale as (typeof CAUSALI_CARICO)[number])) {
        return Result.fail(
          `Causale non valida per CARICO: ${command.causale}. Valori: ${CAUSALI_CARICO.join(', ')}`
        )
      }
    } else {
      if (!CAUSALI_SCARICO.includes(command.causale as (typeof CAUSALI_SCARICO)[number])) {
        return Result.fail(
          `Causale non valida per SCARICO: ${command.causale}. Valori: ${CAUSALI_SCARICO.join(', ')}`
        )
      }
    }

    // 0b. Validazione codice CER contro il catalogo ufficiale.
    // Normalizza al formato canonico "NN NN NN" (con "*" per i pericolosi) e
    // verifica che esista in catalogo: un CER inesistente non è registrabile.
    const cerCode = this.normalizeCerCode(command.cerCode)
    const cerEsiste = await this.cerCodeExists(cerCode)
    if (!cerEsiste) {
      return Result.fail(`Codice CER non valido: ${command.cerCode}`)
    }

    // 0c. Le date di operazione/registrazione non possono essere nel futuro.
    // Il confronto è fra giorni del calendario italiano: il frontend manda date senza ora
    // (AAAA-MM-GG), che il backend legge come mezzanotte UTC, cioè l'01:00 o le 02:00
    // italiane. Confrontando gli istanti, la data di oggi fra le 00:00 e quell'ora
    // risulterebbe nel futuro.
    const oggi = giornoItaliano(new Date())
    if (giornoItaliano(command.movementDate) > oggi) {
      return Result.fail(
        `La data dell'operazione non può essere nel futuro: ` +
          `${formattaDataItaliana(command.movementDate)}`
      )
    }
    if (giornoItaliano(command.registrationDate) > oggi) {
      return Result.fail(
        `La data di registrazione non può essere nel futuro: ` +
          `${formattaDataItaliana(command.registrationDate)}`
      )
    }

    // 0d. Se è indicato un FIR collegato, deve esistere e appartenere al tenant.
    // Evita movimenti con FK penzolante verso un formulario inesistente.
    if (command.firId) {
      const fir = await this.prisma.fIR.findFirst({
        where: { id: command.firId, tenantId: command.tenantId },
        select: { id: true },
      })
      if (!fir) {
        return Result.fail(
          `FIR collegato non trovato o non appartenente al tenant: ${command.firId}`
        )
      }
    }

    // 1. Validazione preventiva giacenza per SCARICO
    if (command.type === 'SCARICO') {
      const giacenza = await this.getGiacenzaCer(command.tenantId, cerCode)
      if (giacenza < command.quantity) {
        return Result.fail(
          `Giacenza insufficiente per CER ${cerCode}: ` +
            `disponibili ${giacenza} ${command.unit}, richiesti ${command.quantity} ${command.unit}. ` +
            `Verifica i movimenti di carico registrati.`
        )
      }
    }

    // 2. Assegnazione numero progressivo (transazionale con SELECT FOR UPDATE)
    // Anno solare italiano (non quello del fuso del processo): il progressivo riparte
    // alle 00:00 italiane del 1° gennaio.
    const anno = annoSolareItaliano(command.registrationDate)

    let movimento: MovimentoRegistrato
    try {
      movimento = await this.prisma.$transaction(async tx => {
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
          cerCode: cerCode,
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
          `(${TERMINE_REGISTRAZIONE_PRODUTTORE_GG} gg) per tenant ${command.tenantId}`
      )
    }

    this.logger.info(
      `Movimento registrato: ${movimento.type} ` +
        `#${movimento.progressiveYear}/${movimento.progressiveNumber} ` +
        `CER ${movimento.cerCode} qty ${movimento.quantity} ${movimento.unit}`
    )

    return Result.ok(movimento)
  }

  /**
   * Normalizza un codice CER al formato canonico del catalogo "NN NN NN"
   * (con "*" finale per i pericolosi). Accetta input senza spazi ("200301")
   * o con spaziatura irregolare; se il formato non è 6 cifre lascia invariato
   * (la validazione di esistenza fallirà con messaggio chiaro).
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

  /**
   * Verifica che il codice CER esista nel catalogo ufficiale. Il catalogo
   * memorizza i pericolosi con "*" finale: l'operatore potrebbe ometterlo,
   * quindi accetta il match sia con sia senza asterisco.
   */
  private async cerCodeExists(cerCode: string): Promise<boolean> {
    const withoutStar = cerCode.replace(/\*$/, '')
    const withStar = `${withoutStar}*`
    const count = await this.prisma.cERCode.count({
      where: { code: { in: [withoutStar, withStar] } },
    })
    return count > 0
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
