import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  EsitoEventoFirRentri,
  EventoFirRentri,
  IEventiFirRentriRepository,
  NuovoEventoFirRentri,
} from '../../application/rentri/eventi-fir-rentri.port'
import { PrismaService } from './prisma.service'

type Riga = NonNullable<Awaited<ReturnType<PrismaService['firEventoRentri']['findFirst']>>>

function aDominio(r: Riga): EventoFirRentri {
  return {
    id: r.id,
    tenantId: r.tenantId,
    firId: r.firId,
    operazione: r.operazione,
    payload: r.payload,
    transazioneId: r.transazioneId,
    esito: r.esito as EsitoEventoFirRentri,
    dettaglioEnte: r.dettaglioEnte,
    statoFormularioDopo: r.statoFormularioDopo,
    utenteId: r.utenteId,
    createdAt: r.createdAt,
  }
}

/** Persistenza Prisma dello storico del viaggio; ogni query filtra anche per tenant (oltre alla RLS). */
@Injectable()
export class EventiFirRentriRepository extends IEventiFirRentriRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async registra(evento: NuovoEventoFirRentri): Promise<EventoFirRentri> {
    const r = await this.prisma.firEventoRentri.create({
      data: {
        tenantId: evento.tenantId,
        firId: evento.firId,
        operazione: evento.operazione,
        payload:
          evento.payload === null || evento.payload === undefined
            ? Prisma.DbNull
            : (evento.payload as Prisma.InputJsonValue),
        transazioneId: evento.transazioneId,
        esito: evento.esito,
        dettaglioEnte: evento.dettaglioEnte,
        statoFormularioDopo: evento.statoFormularioDopo as never,
        utenteId: evento.utenteId,
      },
    })
    return aDominio(r)
  }

  async elenca(tenantId: string, firId: string, limite = 200): Promise<EventoFirRentri[]> {
    const righe = await this.prisma.firEventoRentri.findMany({
      where: { tenantId, firId },
      orderBy: { createdAt: 'desc' },
      take: limite,
    })
    return righe.map(aDominio)
  }
}
