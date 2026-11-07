/**
 * Export contabile (4.4c, Task 29, §7.3): elenco degli adattatori e mappature per azienda. Azienda
 * SELEZIONATA (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: solo gli amministratori
 * (§12). Il download vero e proprio sta in `POST /documenti-fattura/export` (formato = codice
 * dell'adattatore).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ExportService } from '../../application/fatturazione/export.service'
import { MappatureService } from '../../application/fatturazione/adattatori/mappature.service'
import { RegistroAdattatori } from '../../application/fatturazione/adattatori/registro-adattatori'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { SelezioneExportDto } from './dto/export.dto'
import { ImpostaMappatureDto, ParametriAdattatoreDto } from './dto/mappature.dto'
import { RUOLI_AMMINISTRATORI } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('export-contabile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportContabileController {
  constructor(
    private readonly registro: RegistroAdattatori,
    private readonly mappature: MappatureService,
    private readonly esportazione: ExportService
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

  @Post(':adattatore/mancanti')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({
    summary: "Chiavi ancora da mappare per i documenti scelti (stessa selezione dell'export)",
  })
  @ApiResponse({
    status: 400,
    description: 'ADATTATORE_SCONOSCIUTO, TROPPI_DOCUMENTI, FILTRO_NON_VALIDO',
  })
  mancanti(
    @Req() req: any,
    @Param() p: ParametriAdattatoreDto,
    @Body() selezione: SelezioneExportDto
  ) {
    return this.esportazione.mancantiPerAdattatore(
      requireRequestTenantId(req),
      p.adattatore,
      selezione
    )
  }

  @Put(':adattatore/mappature')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({
    summary: 'Imposta le mappature: le voci indicate si scrivono, `valore: null` le cancella',
  })
  @ApiResponse({
    status: 400,
    description:
      'ADATTATORE_SCONOSCIUTO, VOCI_NON_VALIDE, VOCI_DUPLICATE; oltre 500 voci risponde la validazione del DTO',
  })
  @ApiResponse({ status: 409, description: 'VERSIONE_SUPERATA, OPERAZIONE_CONCORRENTE' })
  imposta(@Req() req: any, @Param() p: ParametriAdattatoreDto, @Body() dto: ImpostaMappatureDto) {
    return this.mappature.imposta(requireRequestTenantId(req), req.user.id, p.adattatore, dto.voci)
  }
}
