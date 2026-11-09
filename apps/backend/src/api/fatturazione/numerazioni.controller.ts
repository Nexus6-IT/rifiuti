/**
 * Numerazione delle fatture (4.4a, §4.6). Azienda SELEZIONATA (`requireRequestTenantId`);
 * `@Roles` esplicito su ogni rotta: lettura a tutti i ruoli, numero di partenza solo agli
 * amministratori (§12).
 */
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { oggiRoma } from '../../application/fatturazione/numerazione'
import { NumerazioniService } from '../../application/fatturazione/numerazioni.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  ElencoNumerazioniQueryDto,
  ImpostaPartenzaDto,
  ParametriNumerazioneDto,
} from './dto/numerazione.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA } from './ruoli'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

/** Anno corrente nel fuso italiano. */
const annoCorrente = (): number => Number(oggiRoma().slice(0, 4))

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('numerazioni-fattura')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NumerazioniController {
  constructor(private readonly numerazioni: NumerazioniService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Numerazioni di un anno: un elemento per registro IVA attivo' })
  elenco(@Req() req: any, @Query() q: ElencoNumerazioniQueryDto) {
    return this.numerazioni.elenco(requireRequestTenantId(req), q.anno ?? annoCorrente())
  }

  @Put(':registroIvaId/:anno')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Imposta il numero di partenza di un registro e anno' })
  @ApiResponse({ status: 404, description: 'Registro IVA non trovato' })
  @ApiResponse({
    status: 409,
    description: 'PARTENZA_NON_MODIFICABILE, VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE',
  })
  impostaPartenza(
    @Req() req: any,
    @Param() p: ParametriNumerazioneDto,
    @Body() dto: ImpostaPartenzaDto
  ) {
    return this.numerazioni.impostaPartenza(
      requireRequestTenantId(req),
      req.user.id,
      p.registroIvaId,
      p.anno,
      {
        numeroPartenza: dto.numeroPartenza,
        dataPartenza: dto.dataPartenza,
        versione: dto.versione,
      }
    )
  }
}
