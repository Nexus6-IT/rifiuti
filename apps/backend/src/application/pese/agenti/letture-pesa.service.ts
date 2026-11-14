import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  ORE_AVVISO_LETTURA_VECCHIA,
  ORE_VALIDITA_LETTURA,
  avvisiLettura,
} from '../../../domain/pese/agenti/regole-lettura'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { firmaLetturaValida } from '../viste-accesso'
import { nelContestoTenant } from '../nel-contesto-tenant'

export const LETTURE_MASSIME = 50
const MS_ORA = 60 * 60 * 1000

export interface FiltriLetture {
  registroId?: string
  strumentoId?: string
  /** solo letture non ancora usate in una pesata (default `true`) */
  libere?: boolean
  /** ISO 8601: letture dall'ora dell'agente in poi (default: ultime 24 ore) */
  dal?: Date
}

export interface LetturaVista {
  id: string
  strumento: { id: string; descrizione: string }
  pesoKg: number
  alibiId: string | null
  oraStrumento: string | null
  oraAgente: string
  oraRicezione: string
  simulata: boolean
  usataIn: { accessoId: string; numero: string } | null
  /** `false` se oltre le 24 ore (resta visibile ma non si usa: D12) o gia' usata */
  utilizzabile: boolean
  avvisi: string[]
  /** firma riverificata con la chiave pubblica dell'agente sui byte conservati */
  firmaValida: boolean
}

/** Letture arrivate dagli agenti, per l'operatore che apre un accesso (D15). Solo lettura. */
@Injectable()
export class LetturePesaService {
  /** Sostituibile nei test. */
  protected adesso: () => Date = () => new Date()

  constructor(private readonly prisma: PrismaService) {}

  async elenca(tenantId: string, filtri: FiltriLetture = {}): Promise<LetturaVista[]> {
    const adesso = this.adesso()
    const dal = filtri.dal ?? new Date(adesso.getTime() - ORE_VALIDITA_LETTURA * MS_ORA)
    const libere = filtri.libere ?? true
    const where: Prisma.LetturaPesaWhereInput = {
      tenantId,
      oraAgente: { gte: dal },
      ...(filtri.strumentoId ? { strumentoId: filtri.strumentoId } : {}),
      // Della sede indicata, o di strumenti senza sede (di tutti): mai quelli di un'altra sede.
      ...(filtri.registroId
        ? { strumento: { is: { OR: [{ registroId: filtri.registroId }, { registroId: null }] } } }
        : {}),
      ...(libere ? { pesate: { none: {} } } : {}),
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.letturaPesa.findMany({
          where,
          orderBy: [{ oraAgente: 'desc' }, { id: 'asc' }],
          take: LETTURE_MASSIME,
          include: {
            strumento: { select: { id: true, descrizione: true } },
            agente: { select: { chiavePubblica: true } },
          },
        })
        const ids = righe.map(r => r.id)
        const usi = ids.length
          ? await tx.pesata.findMany({
              where: { tenantId, letturaId: { in: ids } },
              select: {
                letturaId: true,
                accesso: { select: { id: true, numero: true, anno: true } },
              },
            })
          : []
        const perLettura = new Map(usi.map(u => [u.letturaId, u.accesso]))
        return righe.map<LetturaVista>(r => {
          const eta = adesso.getTime() - r.oraAgente.getTime()
          const uso = perLettura.get(r.id) ?? null
          const avvisi = avvisiLettura(r)
          if (eta > ORE_AVVISO_LETTURA_VECCHIA * MS_ORA) {
            avvisi.push(`Lettura di ${Math.round(eta / MS_ORA)} ore fa.`)
          }
          return {
            id: r.id,
            strumento: r.strumento,
            pesoKg: Number(r.pesoKg),
            alibiId: r.alibiId,
            oraStrumento: r.oraStrumento?.toISOString() ?? null,
            oraAgente: r.oraAgente.toISOString(),
            oraRicezione: r.oraRicezione.toISOString(),
            simulata: r.simulata,
            usataIn: uso ? { accessoId: uso.id, numero: `${uso.numero}/${uso.anno}` } : null,
            utilizzabile: uso === null && eta <= ORE_VALIDITA_LETTURA * MS_ORA,
            avvisi,
            firmaValida: firmaLetturaValida(r, r.agente.chiavePubblica),
          }
        })
      })
    )
  }
}
