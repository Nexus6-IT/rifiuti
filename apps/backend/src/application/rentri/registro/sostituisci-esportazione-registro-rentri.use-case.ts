/**
 * «Sostituisci da qui» (eREGI E6, scelta di Graziano del 23/11/2026): azione riservata all'ADMIN che
 * sblocca la catena dopo un'esportazione rifiutata da RENTRI.
 *
 * L'esportazione rifiutata e TUTTE le successive passano a `SOSTITUITA`: restano sul database per
 * audit (mai un DELETE: ogni file firmato vale come registro), escono dalla catena viva e dagli unici
 * parziali. La generazione successiva riparte dall'ultimo anello valido e crea una riga nuova con lo
 * stesso `precedente_id` (e puo' riusare `progressivo_a`). Nessuna chiamata a RENTRI: solo database.
 *
 * Sotto lo stesso advisory lock della generazione (`rentri-esportazione|<registro>`): una
 * generazione in corso e una sostituzione non si incrociano. Una validazione in volo su una riga
 * sostituita non la sovrascrive (`registra` agisce solo sugli stati senza esito).
 */
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  EsportazioneNonSostituibileError,
  EsportazioneNonTrovataError,
} from './errori-esportazioni-registro-rentri'
import { ordinaCatena } from './ordina-catena-esportazioni'

type Tx = Prisma.TransactionClient

export interface EsitoSostituzioneEsportazioni {
  /** Quante esportazioni sono passate a `SOSTITUITA` (la rifiutata e le successive). */
  sostituite: number
  /** Ultimo anello valido da cui riparte la catena, `null` se la catena riparte dall'inizio. */
  ultimaValidaId: string | null
}

@Injectable()
export class SostituisciEsportazioneRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('SostituisciEsportazioneRegistroRentriUseCase')
  }

  /**
   * @throws EsportazioneNonTrovataError 404 assente o di un'altra azienda
   * @throws EsportazioneNonSostituibileError 409 non rifiutata o gia' fuori dalla catena viva
   */
  async sostituisciDa(
    tenantId: string,
    esportazioneId: string
  ): Promise<EsitoSostituzioneEsportazioni> {
    const esito = await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.$transaction(tx => this.nellaTransazione(tx, tenantId, esportazioneId))
    )
    this.logger.info('Esportazioni del registro sostituite', { sostituite: esito.sostituite })
    return esito
  }

  private async nellaTransazione(
    tx: Tx,
    tenantId: string,
    esportazioneId: string
  ): Promise<EsitoSostituzioneEsportazioni> {
    const scelta = await tx.esportazioneRegistroRentri.findFirst({
      where: { id: esportazioneId, tenantId },
      select: { registroId: true },
    })
    if (!scelta) throw new EsportazioneNonTrovataError()
    const registroId = scelta.registroId

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-esportazione|' + registroId}))`

    // Catena viva riletta sotto lock: lo stato puo' essere cambiato mentre si aspettava.
    const catena = ordinaCatena(
      await tx.esportazioneRegistroRentri.findMany({
        where: { tenantId, registroId, stato: { not: 'SOSTITUITA' } },
        select: { id: true, precedenteId: true, stato: true },
      })
    )
    const posizione = catena.findIndex(e => e.id === esportazioneId)
    if (posizione === -1 || catena[posizione].stato !== 'RIFIUTATA') {
      throw new EsportazioneNonSostituibileError()
    }
    const { count } = await tx.esportazioneRegistroRentri.updateMany({
      where: { tenantId, registroId, id: { in: catena.slice(posizione).map(e => e.id) } },
      data: { stato: 'SOSTITUITA' },
    })
    return {
      sostituite: count,
      ultimaValidaId: posizione > 0 ? catena[posizione - 1].id : null,
    }
  }
}
