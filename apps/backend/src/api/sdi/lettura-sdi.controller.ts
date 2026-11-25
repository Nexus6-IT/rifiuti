/**
 * Lettura dello stato SDI di un documento e download delle ricevute (4.5c). Tutti i ruoli di lettura,
 * modulo commerciale `sdi`. Azienda SELEZIONATA, mai dal corpo. Le risposte non riportano credenziali
 * (non esistono in queste tabelle); i file delle ricevute si scaricano a parte.
 */
import { Controller, Get, Param, Req, Res, StreamableFile, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { LetturaSdiService } from '../../application/sdi/lettura-sdi.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { DocumentoParamDto } from '../fatturazione/dto/lista-documenti.dto'
import { RUOLI_LETTURA } from '../legami-movimento/ruoli'
import { RicevutaParamDto } from './dto/lettura-sdi.dto'

@ApiTags('sdi')
@ApiBearerAuth()
@Controller('documenti-fattura')
@RichiedeModulo('sdi')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LetturaSdiController {
  constructor(private readonly lettura: LetturaSdiService) {}

  @Get(':id/sdi')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Trasmissioni SDI del documento con la cronologia delle notifiche' })
  @ApiResponse({ status: 404, description: 'DOCUMENTO_NON_TROVATO' })
  delDocumento(@Req() req: any, @Param() p: DocumentoParamDto) {
    return this.lettura.delDocumento(requireRequestTenantId(req), p.id)
  }

  @Get(':id/sdi/notifiche/:notificaId/file')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Scarica l`XML di una ricevuta SDI' })
  @ApiResponse({ status: 404, description: 'RICEVUTA_NON_TROVATA' })
  async file(
    @Req() req: any,
    @Param() p: RicevutaParamDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const f = await this.lettura.fileRicevuta(requireRequestTenantId(req), p.id, p.notificaId)
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${f.nomeFile}"`)
    res.setHeader('Content-Length', String(f.contenuto.length))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return new StreamableFile(f.contenuto)
  }
}
