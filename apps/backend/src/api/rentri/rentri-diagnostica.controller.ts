/**
 * RENTRI Diagnostica Controller — REST API (R5 Task 3)
 *
 * VINCOLO CHE DECIDE QUESTO CONTROLLER: la diagnostica NON interroga RENTRI
 * ad ogni caricamento di pagina — sarebbe essa stessa la causa del ban che
 * deve prevenire (v. `docs/superpowers/plans/2026-07-26-r5-robustezza.md`,
 * Task 3). Tutto ciò che l'endpoint restituisce viene da dati già raccolti
 * da altri processi (trasmissioni passate, credenziale salvata, stato dei
 * FIR, stato locale del limitatore): mai da una chiamata live scatenata
 * dalla navigazione dell'utente. `GetRentriDiagnosticaUseCase` non riceve
 * nemmeno `RENTRIApiClient` come dipendenza — non per disciplina di questo
 * controller, ma perché la dipendenza non serve a nessuno dei quattro dati
 * mostrati (v. commento sull'use case).
 *
 * Tenant-scoped: nessun parametro di risorsa nell'URL (la diagnostica è
 * SEMPRE quella del tenant del chiamante, risolto da `CurrentUser`), quindi
 * non esiste uno spazio di identificatori altrui da poter indovinare — non
 * per assenza del controllo, ma per assenza dell'oggetto del controllo. Le
 * query sottostanti (`GetRentriDiagnosticaUseCase`) filtrano comunque sempre
 * per `tenantId` esplicito, mai per un id di risorsa passato dal client:
 * verificato dai test dell'use case (isolamento tra tenant).
 */

import { Controller, Get, UseGuards, Req } from '@nestjs/common'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import {
  GetRentriDiagnosticaUseCase,
  RentriDiagnostica,
} from '../../application/rentri/get-rentri-diagnostica.use-case'

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix è `api/v1` (v. main.ts): path completo `api/v1/rentri/diagnostica`.
@Controller('rentri/diagnostica')
@UseGuards(JwtAuthGuard, RolesGuard)
// Coerente con R1: stessi ruoli con visibilità sull'area RENTRI già usati da
// `RentriFormulariController`/`RentriSyncController` (ricerca/aggancio e
// trasmissione), non i soli ruoli admin di `RentriCredentialController` (la
// diagnostica è consultazione, non gestione del segreto).
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriDiagnosticaController {
  constructor(private readonly getRentriDiagnostica: GetRentriDiagnosticaUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Diagnostica RENTRI del tenant corrente — solo dati già raccolti localmente',
    description:
      'Certificato e scadenza (parsing locale X.509), ultime trasmissioni (RENTRISyncLog), ' +
      'formulari che richiedono attenzione, stato del limitatore preventivo. Non genera MAI ' +
      "una chiamata verso RENTRI: aggiornare i dati è un'azione esplicita altrove (dettaglio FIR, " +
      'riconciliazione periodica), non un effetto del caricamento di questa pagina.',
  })
  @ApiResponse({ status: 200, description: 'Diagnostica del tenant' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  @ApiResponse({ status: 403, description: "Ruolo senza visibilità sull'area RENTRI" })
  async diagnostica(@Req() req: any): Promise<RentriDiagnostica> {
    const tenantId = requireRequestTenantId(req)
    return this.getRentriDiagnostica.execute(tenantId)
  }
}
