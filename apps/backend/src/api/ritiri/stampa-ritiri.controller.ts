import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { StampaRitiriService } from '../../application/ritiri/stampa-ritiri.service'
import { DistintaQueryDto, StampaFirDto } from './dto/ritiri.dto'
import { comeHttpRitiri } from './errori-http'

/**
 * Stampe dei ritiri (4.7, T16): distinta del giorno e FIR dei ritiri scelti. Lettura: tutti i ruoli
 * dell'azienda selezionata. Dichiarato PRIMA di `RitiriController` nel modulo (rotte fisse).
 */
@ApiTags('ritiri')
@Controller('ritiri')
@RichiedeModulo('ritiri')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StampaRitiriController {
  constructor(private readonly stampa: StampaRitiriService) {}

  @Get('distinta.pdf')
  @ApiOperation({ summary: 'Distinta dei ritiri programmati di un giorno (un mezzo o tutti)' })
  async distinta(@Req() req: any, @Query() q: DistintaQueryDto, @Res() res: Response) {
    const tenantId = requireRequestTenantId(req)
    const { buffer, nomeFile } = await comeHttpRitiri(() =>
      this.stampa.distinta(tenantId, q.data, q.automezzoId, q.modelloId)
    )
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeFile}"`,
      'Content-Length': buffer.length,
    })
    res.send(buffer)
  }

  @Post('stampa-fir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'PDF unico dei FIR attivi dei ritiri indicati (da 1 a 100); X-Ritiri-Saltati conta quelli senza FIR',
  })
  async stampaFir(@Req() req: any, @Body() dto: StampaFirDto, @Res() res: Response) {
    const tenantId = requireRequestTenantId(req)
    const { buffer, nomeFile, saltati } = await comeHttpRitiri(() =>
      this.stampa.stampaFir(tenantId, dto.ritiroIds, dto.modelloId)
    )
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeFile}"`,
      'Content-Length': buffer.length,
      'X-Ritiri-Saltati': String(saltati),
    })
    res.send(buffer)
  }
}
