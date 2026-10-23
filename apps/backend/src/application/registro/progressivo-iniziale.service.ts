import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { annoSolareItaliano } from '../../core/time/anno-italiano'

export interface StatoProgressivoIniziale {
  anno: number
  primoProgressivo: number | null
  impostatoIl: Date | null
  /** Vero se il registro dell'anno ha già almeno un movimento (non si può più impostare). */
  haMovimenti: boolean
}

/**
 * Progressivo iniziale del registro per azienda e anno (decisione C-W-02).
 *
 * Chi arriva da un altro programma (WinWaste) a metà anno ha già trasmesso al RENTRI
 * movimenti numerati: qui imposta il primo numero che prenderà il primo movimento
 * registrato nell'applicazione. Si imposta una volta sola, per l'anno in corso o il
 * prossimo, e solo prima del primo movimento dell'anno.
 */
@Injectable()
export class ProgressivoInizialeService {
  constructor(private readonly prisma: PrismaService) {}

  async leggi(tenantId: string, anno: number): Promise<StatoProgressivoIniziale> {
    const [riga, movimento] = await Promise.all([
      this.prisma.registroProgressivoIniziale.findUnique({
        where: { tenantId_anno: { tenantId, anno } },
        select: { primoProgressivo: true, impostatoIl: true },
      }),
      this.prisma.wasteMovement.findFirst({
        where: { tenantId, progressiveYear: anno },
        select: { id: true },
      }),
    ])
    return {
      anno,
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
    userId: string
  ): Promise<{ anno: number; primoProgressivo: number }> {
    const annoCorrente = annoSolareItaliano(new Date())
    if (anno !== annoCorrente && anno !== annoCorrente + 1) {
      throw new BadRequestException(
        "Il progressivo iniziale si imposta solo per l'anno in corso o per il prossimo."
      )
    }

    return this.prisma.$transaction(async tx => {
      // Stessa chiave del lock della numerazione (RegistraMovimentoUseCase): un movimento
      // concorrente o viene numerato prima (e qui lo si vede), o dopo (e prende il numero).
      const lockKey = `${tenantId}-${anno}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

      const esistente = await tx.registroProgressivoIniziale.findUnique({
        where: { tenantId_anno: { tenantId, anno } },
        select: { primoProgressivo: true },
      })
      if (esistente) {
        throw new ConflictException(
          `Il progressivo iniziale del ${anno} è già stato impostato ` +
            `(${esistente.primoProgressivo}): non si può modificare.`
        )
      }

      const movimento = await tx.wasteMovement.findFirst({
        where: { tenantId, progressiveYear: anno },
        select: { id: true },
      })
      if (movimento) {
        throw new ConflictException(
          `Il registro del ${anno} ha già movimenti: il progressivo iniziale si imposta ` +
            `solo prima del primo movimento dell'anno.`
        )
      }

      await tx.registroProgressivoIniziale.create({
        data: { tenantId, anno, primoProgressivo, motivo, impostatoDa: userId },
      })
      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'REGISTRO_PROGRESSIVO_INIZIALE',
          description: `Progressivo iniziale del registro ${anno} impostato a ${primoProgressivo}: ${motivo}`,
          metadata: { anno, primoProgressivo, motivo },
        },
      })

      return { anno, primoProgressivo }
    })
  }
}
