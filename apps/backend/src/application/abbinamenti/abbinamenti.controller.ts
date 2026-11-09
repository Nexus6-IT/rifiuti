import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { DomainError } from '../../core/domain/errors'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import {
  AbbinamentiQueryDto,
  DifferenzeQueryDto,
  RicalcoloDto,
  SalvaAbbinamentoDto,
} from './abbinamenti.dto'
import { AbbinamentiService, puoModificare, puoRicalcolare } from './abbinamenti.service'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

const MSG_NON_MODIFICA = 'Il tuo ruolo non consente di modificare gli abbinamenti.'
const MSG_NON_RICALCOLA =
  "Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici."
const idValido = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identificativo non valido.'),
})

/**
 * Abbinamenti carico-scarico dello stoccaggio R13/D15: lettura per ogni membro dell'azienda
 * selezionata; override e "abbina i non abbinati" per chi registra; ricalcolo degli automatici
 * solo per gli amministratori.
 */
@ApiTags('abbinamenti')
@Controller('abbinamenti')
@RichiedeModulo('giacenze')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AbbinamentiController {
  constructor(
    private readonly servizio: AbbinamentiService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abbinamenti di un registro: carichi, scarichi, stati e differenze dal FIFO',
    description:
      'Solo i rifiuti con carichi in stoccaggio R13/D15. `puoModificare` e `puoRicalcolare` ' +
      'dipendono dal ruolo effettivo nell’azienda selezionata.',
  })
  @ApiResponse({ status: 200, description: 'Vista degli abbinamenti' })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async vista(@Query() query: AbbinamentiQueryDto, @Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return this.comeHttp(() => this.servizio.vista(tenantId, query.registroId, undefined, ruolo))
  }

  @Get('differenze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Righe persistite contro il FIFO ricalcolato da zero' })
  @ApiResponse({ status: 200, description: 'Elenco delle differenze' })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async differenze(@Query() query: DifferenzeQueryDto, @Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() => this.servizio.differenze(tenantId, query.registroId, query.cerCode))
  }

  @Get('scarichi/:id/proposta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Proposta FIFO e carichi candidati per uno scarico',
    description:
      '`:id` è l’id di una qualunque annotazione della catena dello scarico. I candidati hanno il ' +
      'residuo escluso lo scarico stesso.',
  })
  @ApiResponse({ status: 200, description: 'Proposta' })
  @ApiResponse({ status: 404, description: 'Scarico non trovato' })
  async proposta(@Param('id', idValido) id: string, @Req() req: any) {
    return this.comeHttp(() => this.servizio.proposta(requireRequestTenantId(req), id))
  }

  @Put('scarichi/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imposta a mano gli abbinamenti di uno scarico',
    description:
      'Sostituisce tutte le righe dello scarico con righe manuali (massimo 500). Un elenco vuoto ' +
      'scollega lo scarico, ma NON lo tiene scollegato: il prossimo ricalcolo (anche "solo i non ' +
      'abbinati") lo riabbina con il FIFO; la risposta lo ricorda negli `avvisi`.',
  })
  @ApiResponse({ status: 200, description: 'Scarico aggiornato e avvisi' })
  @ApiResponse({ status: 400, description: 'Righe non valide' })
  @ApiResponse({ status: 403, description: 'Ruolo non abilitato' })
  @ApiResponse({ status: 404, description: 'Scarico non trovato' })
  async salva(
    @Param('id', idValido) id: string,
    @Body() dto: SalvaAbbinamentoDto,
    @Req() req: any
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediModifica(req, tenantId)
    for (const r of dto.righe) {
      if (r.caricoId && r.giacenzaInizialeId) {
        throw new BadRequestException(
          'Indica un carico oppure una giacenza iniziale, non entrambi.'
        )
      }
      if (!r.caricoId && !r.giacenzaInizialeId) {
        throw new BadRequestException(
          'Indica per ogni riga un carico oppure una giacenza iniziale.'
        )
      }
    }
    return this.comeHttp(() => this.servizio.salvaManuale(tenantId, req.user.id, id, dto.righe))
  }

  @Post('ricalcolo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ricalcola gli abbinamenti con il FIFO',
    description:
      'NON_ABBINATI: chi registra, riempie solo gli scarichi senza righe. AUTOMATICI: solo ' +
      'amministratori, rifà le righe automatiche e tiene le manuali. Uno scarico scollegato a mano ' +
      'con elenco vuoto viene riabbinato da entrambe le modalità.',
  })
  @ApiResponse({ status: 200, description: 'Esito del ricalcolo' })
  @ApiResponse({ status: 403, description: 'Ruolo non abilitato' })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async ricalcolo(@Body() dto: RicalcoloDto, @Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!puoModificare(ruolo)) throw new ForbiddenException(MSG_NON_MODIFICA)
    if (dto.modalita === 'AUTOMATICI' && !puoRicalcolare(ruolo)) {
      throw new ForbiddenException(MSG_NON_RICALCOLA)
    }
    return this.comeHttp(() => this.servizio.ricalcola(tenantId, req.user.id, dto))
  }

  private async richiediModifica(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!puoModificare(ruolo)) throw new ForbiddenException(MSG_NON_MODIFICA)
  }

  /** Registro assente o di un'altra azienda: 404 senza id; errori di dominio: 400. */
  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof RegistroNonTrovatoError)
        throw new NotFoundException('Registro non trovato.')
      if (err instanceof DomainError) throw new BadRequestException(err.message)
      throw err
    }
  }
}
