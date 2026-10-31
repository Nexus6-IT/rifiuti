import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'

/**
 * D7: avviso mostrato dopo una rettifica o un annullamento quando l'annotazione corretta era gia'
 * su RENTRI (`TRASMESSA`/`GIA_SU_RENTRI`): la correzione verra' trasmessa come rettifica o
 * annullamento. Si calcola DOPO la correzione (gia' scritta): un errore di lettura non la fa
 * fallire, l'avviso manca e basta.
 */
@Injectable()
export class AvvisoRentriCorrezioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AvvisoRentriCorrezioneService')
  }

  async calcola(
    tenantId: string,
    movimentoCorrettoId: string,
    tipo: 'RETTIFICA' | 'ANNULLAMENTO'
  ): Promise<string | null> {
    try {
      const riga = await TenantContext.run(
        { tenantId },
        async () =>
          await this.prisma.movimentoTrasmissioneRentri.findFirst({
            where: { tenantId, movimentoId: movimentoCorrettoId },
            select: { stato: true },
          })
      )
      if (riga?.stato !== 'TRASMESSA' && riga?.stato !== 'GIA_SU_RENTRI') return null
      return `L'annotazione corretta era già su RENTRI: la correzione sarà trasmessa come ${
        tipo === 'RETTIFICA' ? 'rettifica' : 'annullamento'
      }.`
    } catch {
      this.logger.warn('Avviso RENTRI della correzione non calcolabile: la risposta ne è priva')
      return null
    }
  }
}
