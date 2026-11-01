/**
 * Allegati PDF dei contratti cliente (4.1b, Task 19, R28/R37). Controller proprio con le quattro
 * rotte `contratti-clienti/:id/allegati…`. L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito: letture a tutti i ruoli, scritture senza VIEWER.
 * Upload multipart: file `allegato` e campo `posizione` (testo -> intero 1 o 2). Il tipo (solo PDF)
 * e la dimensione li controlla il servizio, che non salva nulla se non passano.
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  AllegatiContrattoClienteService,
  MESSAGGIO_POSIZIONE_ALLEGATO,
  nomePulito,
} from '../../application/contratti-cliente/allegati-contratto-cliente.service'
import {
  AllegatoContrattoInterceptor,
  nomeUtf8,
  type FileMulter,
} from './allegato-contratto-upload'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

/** `Content-Disposition` di un download: nome ASCII di ripiego + `filename*` UTF-8 (RFC 5987). */
function contentDispositionAttachment(nome: string): string {
  const pulito = nomePulito(nome)
  const ascii = pulito.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;%]/g, '_')
  const codificato = encodeURIComponent(pulito).replace(
    /['()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificato}`
}

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('contratti-clienti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AllegatiContrattoClienteController {
  constructor(private readonly allegati: AllegatiContrattoClienteService) {}

  @Get(':id/allegati')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Allegati PDF del contratto (senza contenuto)' })
  @ApiResponse({ status: 404, description: 'Contratto non trovato' })
  elenco(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.allegati.elenco(requireRequestTenantId(req), id)
  }

  @Post(':id/allegati')
  @Roles(...RUOLI_SCRITTURA)
  @UseInterceptors(AllegatoContrattoInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        allegato: { type: 'string', format: 'binary', description: 'PDF, max 4 MB' },
        posizione: { type: 'integer', enum: [1, 2] },
      },
      required: ['allegato', 'posizione'],
    },
  })
  @ApiOperation({ summary: 'Carica un allegato PDF in posizione 1 o 2' })
  @ApiResponse({ status: 409, description: 'Posizione già occupata (ALLEGATO_POSIZIONE_OCCUPATA)' })
  @ApiResponse({ status: 413, description: "L'allegato supera i 4 MB." })
  @ApiResponse({ status: 415, description: "L'allegato del contratto deve essere un PDF." })
  carica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('posizione') grezza: unknown,
    @UploadedFile() file?: FileMulter
  ) {
    const tenantId = requireRequestTenantId(req)
    // Solo cifre: "1.5", "abc", "" e "1e0" non sono posizioni.
    if (typeof grezza !== 'string' || !/^\d{1,3}$/.test(grezza.trim())) {
      throw new BadRequestException(MESSAGGIO_POSIZIONE_ALLEGATO)
    }
    if (!file) throw new BadRequestException('Manca il file "allegato".')
    return this.allegati.carica(tenantId, req.user.id, id, Number(grezza.trim()) as 1 | 2, {
      originalname: nomeUtf8(file.originalname),
      size: file.size,
      buffer: file.buffer,
    })
  }

  @Get(':id/allegati/:allegatoId/contenuto')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Scarica il PDF' })
  @ApiResponse({ status: 404, description: 'Allegato non trovato' })
  async scarica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allegatoId', ParseUUIDPipe) allegatoId: string,
    @Res({ passthrough: true }) res: { setHeader(nome: string, valore: string): void }
  ): Promise<StreamableFile> {
    const { nomeFile, contenuto } = await this.allegati.contenuto(
      requireRequestTenantId(req),
      id,
      allegatoId
    )
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return new StreamableFile(contenuto, {
      type: 'application/pdf',
      disposition: contentDispositionAttachment(nomeFile),
      length: contenuto.length,
    })
  }

  @Delete(':id/allegati/:allegatoId')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rimuove un allegato' })
  @ApiResponse({ status: 404, description: 'Allegato non trovato' })
  async rimuovi(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('allegatoId', ParseUUIDPipe) allegatoId: string
  ): Promise<void> {
    await this.allegati.rimuovi(requireRequestTenantId(req), req.user.id, id, allegatoId)
  }
}
