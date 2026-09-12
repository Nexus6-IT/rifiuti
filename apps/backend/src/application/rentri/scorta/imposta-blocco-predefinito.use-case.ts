import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriVidimazioneClient } from '../../../infrastructure/rentri/rentri-vidimazione.client'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { risolviCfTenant } from './risolvi-cf-tenant'

export interface EsitoImpostaBloccoPredefinito {
  codiceBlocco: string
  numIscrSito: string
}

/**
 * `PUT /rentri/blocchi/:codiceBlocco/predefinito` (R6). Il chiamante indica
 * solo il `codiceBlocco` (è tutto ciò che vede in `GET /rentri/blocchi`): la
 * sede a cui appartiene si risolve interrogando l'ente, mai chiesta
 * all'utente due volte. Fail-closed su due fronti:
 * 1. blocco non trovato presso l'ente → 404, nessuna scrittura locale;
 * 2. nessuna `RentriUnitaLocale` locale per quel `numIscrSito` → 404
 *    (v. `RentriUnitaLocaleService.impostaBloccoPredefinitoPerNumIscrSito`):
 *    un blocco può esistere sul portale per una sede che qui non è ancora
 *    stata registrata (R2), e non ha senso impostare un predefinito su una
 *    sede che non esiste per noi.
 */
@Injectable()
export class ImpostaBloccoPredefinitoUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vidimazioneClient: RentriVidimazioneClient,
    private readonly unitaLocaleService: RentriUnitaLocaleService
  ) {}

  async execute(tenantId: string, codiceBlocco: string): Promise<EsitoImpostaBloccoPredefinito> {
    const cf = await risolviCfTenant(this.prisma, tenantId)

    const { risultati } = await this.vidimazioneClient.elencaBlocchi(
      cf,
      { codiceBlocco, ancheDisattivi: true },
      tenantId
    )
    const blocco = risultati.find(b => b.codice_blocco === codiceBlocco)

    if (!blocco || !blocco.num_iscr_sito) {
      throw new NotFoundException(
        `Nessun blocco virtuale RENTRI con codice ${codiceBlocco} trovato per questo operatore.`
      )
    }

    await this.unitaLocaleService.impostaBloccoPredefinitoPerNumIscrSito(
      tenantId,
      blocco.num_iscr_sito,
      codiceBlocco
    )

    return { codiceBlocco, numIscrSito: blocco.num_iscr_sito }
  }
}
