import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { annoSolareItaliano } from '../../core/time/anno-italiano'
import { DomainError } from '../../core/domain/errors'
import { RegistriService } from './registri.service'

export interface StatoProgressivoIniziale {
  anno: number
  /** Registro a cui si riferisce lo stato (quello indicato o il predefinito dell'azienda). */
  registroId: string
  primoProgressivo: number | null
  impostatoIl: Date | null
  /** Vero se il registro dell'anno ha già almeno un movimento (non si può più impostare). */
  haMovimenti: boolean
}

/**
 * Progressivo iniziale del registro per registro e anno (decisione C-W-02, per sede da F2-1).
 *
 * Chi arriva da un altro programma (WinWaste) a metà anno ha già trasmesso al RENTRI
 * movimenti numerati: qui imposta il primo numero che prenderà il primo movimento
 * registrato nell'applicazione nel registro indicato (senza indicazione, quello predefinito
 * dell'azienda). Si imposta una volta sola, per l'anno in corso o il prossimo, e solo prima
 * del primo movimento dell'anno di quel registro.
 */
@Injectable()
export class ProgressivoInizialeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registri: RegistriService
  ) {}

  async leggi(
    tenantId: string,
    anno: number,
    registroId?: string
  ): Promise<StatoProgressivoIniziale> {
    await this.registri.preparaRegistri(tenantId, registroId)
    const registro = await this.prisma.$transaction(tx =>
      this.registri.risolvi(tx, tenantId, registroId)
    )
    const [riga, movimento] = await Promise.all([
      this.prisma.registroProgressivoIniziale.findUnique({
        where: { registroId_anno: { registroId: registro.id, anno } },
        select: { primoProgressivo: true, impostatoIl: true },
      }),
      this.prisma.wasteMovement.findFirst({
        where: { tenantId, registroId: registro.id, progressiveYear: anno },
        select: { id: true },
      }),
    ])
    return {
      anno,
      registroId: registro.id,
      primoProgressivo: riga?.primoProgressivo ?? null,
      impostatoIl: riga?.impostatoIl ?? null,
      haMovimenti: movimento !== null,
    }
  }

  async imposta(
    tenantId: string,
    anno: number,
    primoProgressivo: number,
    motivo: string,
    userId: string,
    registroId?: string
  ): Promise<{ anno: number; primoProgressivo: number; registroId: string }> {
    const annoCorrente = annoSolareItaliano(new Date())
    if (anno !== annoCorrente && anno !== annoCorrente + 1) {
      throw new BadRequestException(
        "Il progressivo iniziale si imposta solo per l'anno in corso o per il prossimo."
      )
    }

    // Registri pronti prima della transazione (il lock di creazione non si annida con quello di numerazione).
    try {
      await this.registri.preparaRegistri(tenantId, registroId)
    } catch (err) {
      if (err instanceof DomainError) throw new BadRequestException(err.message)
      throw err
    }

    return this.prisma.$transaction(async tx => {
      let registro
      try {
        registro = await this.registri.risolvi(tx, tenantId, registroId)
      } catch (err) {
        if (err instanceof DomainError) throw new BadRequestException(err.message)
        throw err
      }

      // Stessa chiave del lock della numerazione (RegistraMovimentoUseCase): un movimento
      // concorrente dello stesso registro o viene numerato prima (e qui lo si vede), o dopo
      // (e prende il numero). Registri diversi non si aspettano.
      const lockKey = `${registro.id}-${anno}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

      const esistente = await tx.registroProgressivoIniziale.findUnique({
        where: { registroId_anno: { registroId: registro.id, anno } },
        select: { primoProgressivo: true },
      })
      if (esistente) {
        throw new ConflictException(
          `Il progressivo iniziale del ${anno} è già stato impostato ` +
            `(${esistente.primoProgressivo}): non si può modificare.`
        )
      }

      const movimento = await tx.wasteMovement.findFirst({
        where: { tenantId, registroId: registro.id, progressiveYear: anno },
        select: { id: true },
      })
      if (movimento) {
        throw new ConflictException(
          `Il registro del ${anno} ha già movimenti: il progressivo iniziale si imposta ` +
            `solo prima del primo movimento dell'anno.`
        )
      }

      await tx.registroProgressivoIniziale.create({
        data: {
          tenantId,
          registroId: registro.id,
          anno,
          primoProgressivo,
          motivo,
          impostatoDa: userId,
        },
      })
      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'REGISTRO_PROGRESSIVO_INIZIALE',
          description: `Progressivo iniziale del registro ${anno} impostato a ${primoProgressivo}: ${motivo}`,
          metadata: { anno, primoProgressivo, motivo, registroId: registro.id },
        },
      })

      return { anno, primoProgressivo, registroId: registro.id }
    })
  }
}
