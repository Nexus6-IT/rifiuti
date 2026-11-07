/**
 * Export contabile (4.4c, Task 29, §7.3): elenco degli adattatori e mappature per azienda. Azienda
 * SELEZIONATA (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: solo gli amministratori
 * (§12). Il download vero e proprio sta in `POST /documenti-fattura/export` (formato = codice
 * dell'adattatore).
 */
import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { MappatureService } from '../../application/fatturazione/adattatori/mappature.service'
import { RegistroAdattatori } from '../../application/fatturazione/adattatori/registro-adattatori'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ImpostaMappatureDto, ParametriAdattatoreDto } from './dto/mappature.dto'
import { RUOLI_AMMINISTRATORI } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('export-contabile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportContabileController {
  constructor(
    private readonly registro: RegistroAdattatori,
    private readonly mappature: MappatureService
  ) {}

  @Get('adattatori')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Adattatori contabili disponibili' })
  adattatori() {
    return this.registro.tutti().map(a => ({
      codice: a.codice,
      nome: a.nome,
      modalita: a.modalita,
      verificato: a.verificato,
    }))
  }

  @Get(':adattatore/mappature')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: "Mappature dell'azienda per un adattatore" })
  @ApiResponse({ status: 400, description: 'ADATTATORE_SCONOSCIUTO' })
  lista(@Req() req: any, @Param() p: ParametriAdattatoreDto) {
    return this.mappature.lista(requireRequestTenantId(req), p.adattatore)
  }

  @Put(':adattatore/mappature')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({
    summary: 'Imposta le mappature: le voci indicate si scrivono, `valore: null` le cancella',
  })
  @ApiResponse({
    status: 400,
    description:
      'ADATTATORE_SCONOSCIUTO, TROPPE_VOCI (al massimo 500), VOCI_NON_VALIDE, VOCI_DUPLICATE',
  })
  @ApiResponse({ status: 409, description: 'OPERAZIONE_CONCORRENTE' })
  imposta(@Req() req: any, @Param() p: ParametriAdattatoreDto, @Body() dto: ImpostaMappatureDto) {
    return this.mappature.imposta(requireRequestTenantId(req), req.user.id, p.adattatore, dto.voci)
  }
}
