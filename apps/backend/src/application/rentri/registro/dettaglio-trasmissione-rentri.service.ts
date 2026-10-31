import { Injectable } from '@nestjs/common'
import { StatoTrasmissioneRentri } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { MovimentoNonTrovatoError } from './errori-azioni-rentri-registro'

/**
 * Fase dell'invio per l'interfaccia. Distingue una conferma di RENTRI (`CONFERMATA`) da un invio
 * accettato ma non ancora confermato (`INVIATA_IN_ATTESA_DI_CONFERMA`) e da uno di esito ignoto.
 */
export type FaseTrasmissioneRentri =
  | 'IN_CODA'
  | 'INVIO_IN_CORSO'
  | 'INVIATA_IN_ATTESA_DI_CONFERMA'
  | 'ESITO_INCERTO'
  | 'CONFERMATA'
  | 'RIFIUTATA'
  | 'NON_TRASMISSIBILE'

const FASE: Record<StatoTrasmissioneRentri, FaseTrasmissioneRentri> = {
  DA_TRASMETTERE: 'IN_CODA',
  IN_INVIO: 'INVIO_IN_CORSO',
  ATTESA_ESITO: 'INVIATA_IN_ATTESA_DI_CONFERMA',
  INCERTA: 'ESITO_INCERTO',
  TRASMESSA: 'CONFERMATA',
  GIA_SU_RENTRI: 'CONFERMATA',
  RIFIUTATA: 'RIFIUTATA',
  NON_TRASMISSIBILE: 'NON_TRASMISSIBILE',
}

export interface DettaglioTrasmissione {
  stato: StatoTrasmissioneRentri
  fase: FaseTrasmissioneRentri
  /** `true` solo se RENTRI ha confermato (o l'annotazione e' dichiarata gia' su RENTRI). */
  confermata: boolean
  origine: string
  identificativo: string | null
  motivoBlocco: string | null
  ultimoErrore: string | null
  messaggi: unknown
  trasmessoIl: Date | null
}

/** Lettura dello stato di trasmissione di una singola annotazione (D12). */
@Injectable()
export class DettaglioTrasmissioneRentriService {
  constructor(private readonly prisma: PrismaService) {}

  /** @throws MovimentoNonTrovatoError se l'annotazione non ha una riga per questa azienda */
  async dettaglio(tenantId: string, movimentoId: string): Promise<DettaglioTrasmissione> {
    const riga = await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.movimentoTrasmissioneRentri.findFirst({
          where: { tenantId, movimentoId },
          select: {
            stato: true,
            origine: true,
            identificativoRentri: true,
            motivoBlocco: true,
            ultimoErrore: true,
            messaggi: true,
            trasmessoIl: true,
          },
        })
    )
    if (!riga) throw new MovimentoNonTrovatoError()
    return {
      stato: riga.stato,
      fase: FASE[riga.stato],
      confermata: FASE[riga.stato] === 'CONFERMATA',
      origine: riga.origine,
      identificativo: riga.identificativoRentri,
      motivoBlocco: riga.motivoBlocco,
      ultimoErrore: riga.ultimoErrore,
      messaggi: riga.messaggi,
      trasmessoIl: riga.trasmessoIl,
    }
  }
}
