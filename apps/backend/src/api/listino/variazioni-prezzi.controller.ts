/**
 * Variazione automatica dei prezzi dei contratti e adeguamento ISTAT (4.2b, Task 24, D20, D22,
 * R46): `@Controller('variazioni-prezzi')`. Azienda SELEZIONATA; `@Roles` esplicito su ogni rotta:
 * toccano tutti i contratti, quindi solo SUPER_ADMIN e ADMIN (D26). Anteprima e applicazione
 * hanno lo stesso corpo; la seconda porta anche l'impronta dell'anteprima.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { VariazioniPrezziService } from '../../application/listino/variazioni-prezzi.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  ApplicaIstatDto,
  ApplicaVariazioneContrattiDto,
  CorpoIstatDto,
  CorpoVariazioneContrattiDto,
  MesiIstatQueryDto,
} from './dto/variazione-prezzi.dto'
import { RUOLI_VARIAZIONI } from './ruoli'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('variazioni-prezzi')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VariazioniPrezziController {
  constructor(private readonly variazioni: VariazioniPrezziService) {}

  @Post('anteprima')
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anteprima della variazione dei prezzi dei contratti' })
  @ApiResponse({ status: 400, description: 'Criteri non validi o troppe righe' })
  anteprima(@Req() req: any, @Body() dto: CorpoVariazioneContrattiDto) {
    return this.variazioni.anteprima(requireRequestTenantId(req), dto)
  }

  @Post()
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Applica la variazione con l'impronta dell'anteprima: { aggiornati }" })
  @ApiResponse({ status: 400, description: "Errori nell'anteprima: nulla è scritto" })
  @ApiResponse({ status: 409, description: 'I prezzi sono cambiati dopo l’anteprima' })
  applica(@Req() req: any, @Body() dto: ApplicaVariazioneContrattiDto) {
    return this.variazioni.applica(requireRequestTenantId(req), req.user.id, dto)
  }

  @Get('istat/mesi')
  @Roles(...RUOLI_VARIAZIONI)
  @ApiOperation({
    summary: 'Mesi di inizio dei contratti con l’incremento ISTAT: { anno, mese, contratti }',
  })
  @ApiQuery({ name: 'ancheAnnoPrecedente', required: false, enum: ['true', 'false'] })
  mesiIstat(@Req() req: any, @Query() query: MesiIstatQueryDto) {
    return this.variazioni.mesiIstat(
      requireRequestTenantId(req),
      query.ancheAnnoPrecedente === 'true'
    )
  }

  @Post('istat/anteprima')
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anteprima dell’adeguamento ISTAT' })
  @ApiResponse({ status: 400, description: 'Percentuali o tipi non validi' })
  anteprimaIstat(@Req() req: any, @Body() dto: CorpoIstatDto) {
    return this.variazioni.anteprimaIstat(requireRequestTenantId(req), dto)
  }

  @Post('istat')
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Applica l'adeguamento ISTAT con l'impronta dell'anteprima: { aggiornati }",
  })
  @ApiResponse({ status: 409, description: 'I prezzi sono cambiati dopo l’anteprima' })
  applicaIstat(@Req() req: any, @Body() dto: ApplicaIstatDto) {
    return this.variazioni.applicaIstat(requireRequestTenantId(req), req.user.id, dto)
  }
}
