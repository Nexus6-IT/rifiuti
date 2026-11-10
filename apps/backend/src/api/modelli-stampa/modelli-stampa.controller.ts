/**
 * Modelli di stampa (4.7, T6): logo, testi, colori, ambito e copie per FIR e distinta dei ritiri.
 * L'azienda e' quella SELEZIONATA (`requireRequestTenantId`). Lettura a tutti i ruoli (chi stampa
 * sceglie il modello); scrittura solo SUPER_ADMIN e ADMIN. Le modifiche portano la `versione` letta:
 * un 409 vuol dire che il modello e' cambiato nel frattempo.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { RUOLI_LETTURA } from '../clienti/ruoli'
import {
  CreaModelloStampaDto,
  ModificaModelloStampaDto,
  RendiPredefinitoDto,
} from './dto/modello-stampa.dto'

/** Solo gli amministratori scrivono i modelli (P7 §5). */
export const RUOLI_MODELLI_SCRITTURA = ['SUPER_ADMIN', 'ADMIN'] as const

@ApiTags('modelli-stampa')
@ApiBearerAuth()
@Controller('modelli-stampa')
// P7 §5: i modelli servono sia al FIR sia alla distinta dei ritiri.
@RichiedeModulo('fir', 'ritiri')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ModelliStampaController {
  constructor(private readonly modelli: ModelliStampaService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Modelli di stampa dell’azienda (per ambito, predefinito per primo)' })
  list(@Req() req: any) {
    return this.modelli.list(requireRequestTenantId(req))
  }

  @Post()
  @Roles(...RUOLI_MODELLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un modello (mai predefinito alla creazione)' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  crea(@Req() req: any, @Body() dto: CreaModelloStampaDto) {
    return this.modelli.crea(requireRequestTenantId(req), req.user.id, dto)
  }

  // `:id/predefinito` e' una POST su un percorso piu' lungo: nessuna ambiguita' con `:id`.
  @Post(':id/predefinito')
  @Roles(...RUOLI_MODELLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rende il modello il predefinito del suo ambito' })
  @ApiResponse({ status: 404, description: 'Modello non trovato' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo' })
  rendiPredefinito(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RendiPredefinitoDto
  ) {
    return this.modelli.rendiPredefinito(requireRequestTenantId(req), req.user.id, id, dto.versione)
  }

  @Put(':id')
  @Roles(...RUOLI_MODELLI_SCRITTURA)
  @ApiOperation({ summary: 'Sostituisce i dati del modello (con la versione letta)' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 404, description: 'Modello non trovato' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaModelloStampaDto
  ) {
    return this.modelli.modifica(requireRequestTenantId(req), req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_MODELLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un modello' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    await this.modelli.elimina(requireRequestTenantId(req), req.user.id, id, versione)
  }
}
