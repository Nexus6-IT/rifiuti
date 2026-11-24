import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { AllegatiCampoService } from '../../application/campo/allegati-campo.service'
import { EventiCampoService } from '../../application/campo/eventi-campo.service'
import { RicevuteRitiroService } from '../../application/campo/ricevute-ritiro.service'
import { EsitiCampoQueryDto, RicevuteCampoQueryDto } from './dto/campo.dto'
import { comeHttpCampo } from './errori-http'

/**
 * «Esiti dal campo» per l'ufficio (app campo, P4): sola lettura degli eventi inviati dagli autisti,
 * con i «da riconciliare». Azienda SELEZIONATA, tutti i ruoli d'ufficio. Un utente `AUTISTA` non
 * entra: la rotta non e' `@ConsentitoAutista`, quindi `RuoloAutistaInterceptor` la respinge.
 */
@ApiTags('campo')
@Controller('esiti-campo')
@RichiedeModulo('campo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EsitiCampoController {
  constructor(
    private readonly eventi: EventiCampoService,
    private readonly ricevute: RicevuteRitiroService,
    private readonly foto: AllegatiCampoService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Esiti inviati dagli autisti (`esito=DA_RICONCILIARE` per i conflitti)',
  })
  elenca(@Req() req: any, @Query() q: EsitiCampoQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() => this.eventi.elenca(tenantId, { esito: q.esito, pagina: q.pagina }))
  }

  /** Ricevute di ritiro firmate sul telefono (senza byte): archivio dell'ufficio. */
  @Get('ricevute')
  @ApiOperation({ summary: 'Ricevute di ritiro firmate dai clienti sul telefono dell’autista' })
  elencaRicevute(@Req() req: any, @Query() q: RicevuteCampoQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() =>
      this.ricevute.elenca(tenantId, { ritiroId: q.ritiroId, pagina: q.pagina })
    )
  }

  /** PDF archiviato: lo stesso file firmato, mai rigenerato. Impronta riverificata a ogni lettura. */
  @Get('ricevute/:id/pdf')
  @ApiOperation({ summary: 'Scarica il PDF archiviato di una ricevuta di ritiro' })
  async scaricaRicevuta(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const pdf = await comeHttpCampo(() => this.ricevute.leggiPdf(tenantId, id.toLowerCase()))
    res.status(HttpStatus.OK)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.nomeFile}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', 'sandbox')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Length', String(pdf.contenuto.length))
    res.end(pdf.contenuto)
  }

  /** Byte di una foto di un esito: tipo salvato, `nosniff`, `sandbox`, mai in cache. */
  @Get('foto/:id')
  @ApiOperation({ summary: 'Scarica una foto allegata a un esito dal campo' })
  async scaricaFoto(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const f = await comeHttpCampo(() => this.foto.leggi(tenantId, id))
    res.status(HttpStatus.OK)
    res.setHeader('Content-Type', f.mimeType)
    res.setHeader('Content-Disposition', 'inline; filename="foto-campo"')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', 'sandbox')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Length', String(f.contenuto.length))
    res.end(f.contenuto)
  }
}
