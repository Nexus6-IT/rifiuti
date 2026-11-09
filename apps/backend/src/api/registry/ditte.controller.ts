/**
 * Ditte e sedi (F2-10, D7): ricerca per identificativo, dettaglio, modifica della ditta e gestione
 * delle sedi. Letture senza `@Roles`, scritture come il registry. L'azienda e' sempre quella
 * selezionata (`requireRequestTenantId`), mai quella primaria del token.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import {
  DatiSede,
  AggiornaSedeDati,
  DitteService,
} from '../../application/registry/ditte/ditte.service'
import { TenantContext } from '../../core/context/tenant-context'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AggiornaDittaDto, AggiornaSedeDto, CercaDittaDto, CreaSedeDto } from './dto/ditte.dto'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

const SCRITTURA = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const

const indirizzoDi = (d: {
  via?: string
  civico?: string
  cap?: string
  citta?: string
  provincia?: string
}) =>
  d.via !== undefined
    ? {
        via: d.via,
        civico: d.civico as string,
        cap: d.cap as string,
        citta: d.citta as string,
        provincia: d.provincia as string,
      }
    : undefined

@ApiTags('registry')
@ApiBearerAuth()
@Controller('registry/ditte')
@RichiedeModulo('anagrafiche')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DitteController {
  constructor(private readonly ditte: DitteService) {}

  @ApiOperation({
    summary: 'Cerca una ditta per partita IVA o codice fiscale',
    description:
      'POST e non GET perche un codice fiscale in query string finirebbe nei log. Nessun risultato: `{ ditta: null }`.',
  })
  @ApiResponse({ status: 200, description: 'La ditta trovata oppure `{ ditta: null }`' })
  @ApiResponse({
    status: 400,
    description: 'Identificativo malformato (il valore non e riportato)',
  })
  @Post('cerca')
  @HttpCode(HttpStatus.OK)
  @RichiedeModulo('anagrafiche', 'fir', 'registro', 'contratti', 'pese')
  async cerca(@Req() req: any, @Body() dto: CercaDittaDto) {
    requireRequestTenantId(req)
    return { ditta: await this.ditte.cerca(dto.identificativo) }
  }

  @ApiOperation({ summary: 'Dettaglio di una ditta con sedi e ruoli' })
  @ApiResponse({ status: 200, description: 'Ditta, sedi e id dei ruoli' })
  @ApiResponse({ status: 404, description: "Ditta non trovata nell'azienda selezionata" })
  @Get(':id')
  @RichiedeModulo('anagrafiche', 'fir', 'registro', 'contratti', 'pese')
  async dettaglio(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    requireRequestTenantId(req)
    return this.ditte.dettaglio(id)
  }

  @ApiOperation({
    summary: 'Modifica la ragione sociale o gli identificativi di una ditta',
    description:
      "Aggiunta dell'identificativo mancante, oppure sostituzione della partita IVA solo se quella attuale non passa il controllo e la nuova si.",
  })
  @ApiResponse({ status: 200, description: 'Ditta aggiornata' })
  @ApiResponse({ status: 400, description: 'Identificativi non validi o non modificabili' })
  @ApiResponse({ status: 404, description: 'Ditta non trovata' })
  @ApiResponse({ status: 409, description: "Identificativo gia usato da un'altra ditta" })
  @Put(':id')
  @Roles(...SCRITTURA)
  async aggiornaDitta(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AggiornaDittaDto
  ) {
    requireRequestTenantId(req)
    return this.ditte.aggiornaDitta(
      id,
      {
        ragioneSociale: dto.ragioneSociale,
        partitaIva: dto.partitaIva,
        codiceFiscale: dto.codiceFiscale,
      },
      { userId: TenantContext.getUserId() ?? undefined }
    )
  }

  @ApiOperation({ summary: 'Aggiunge una sede a una ditta' })
  @ApiResponse({ status: 201, description: 'Sede creata' })
  @ApiResponse({ status: 400, description: 'Indirizzo non valido' })
  @ApiResponse({ status: 404, description: 'Ditta non trovata' })
  @ApiResponse({ status: 409, description: 'Esiste gia una sede con questo indirizzo' })
  @Post(':id/sedi')
  @Roles(...SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  async creaSede(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreaSedeDto
  ) {
    requireRequestTenantId(req)
    const { via, civico, cap, citta, provincia, ...contatti } = dto
    const dati: DatiSede = { ...contatti, indirizzo: { via, civico, cap, citta, provincia } }
    return this.ditte.aggiungiSede(id, dati)
  }

  @ApiOperation({
    summary: 'Modifica indirizzo, contatti o stato di una sede',
    description:
      "La sede principale e la predefinita di un ruolo non si disattivano: prima si sceglie un'altra sede.",
  })
  @ApiResponse({ status: 200, description: 'Sede aggiornata' })
  @ApiResponse({ status: 404, description: 'Ditta o sede non trovata' })
  @ApiResponse({
    status: 409,
    description: 'Sede non modificabile (principale, predefinita, duplicata)',
  })
  @Put(':id/sedi/:sedeId')
  @Roles(...SCRITTURA)
  async aggiornaSede(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sedeId', ParseUUIDPipe) sedeId: string,
    @Body() dto: AggiornaSedeDto
  ) {
    requireRequestTenantId(req)
    const { via, civico, cap, citta, provincia, ...resto } = dto
    const dati: AggiornaSedeDati = {
      ...resto,
      indirizzo: indirizzoDi({ via, civico, cap, citta, provincia }),
    }
    return this.ditte.aggiornaSede(id, sedeId, dati)
  }

  @ApiOperation({ summary: 'Rende principale una sede attiva della ditta' })
  @ApiResponse({ status: 200, description: 'Ditta con la nuova sede principale' })
  @ApiResponse({ status: 404, description: 'Ditta o sede non trovata' })
  @ApiResponse({ status: 409, description: 'La sede e disattivata' })
  @Post(':id/sedi/:sedeId/principale')
  @Roles(...SCRITTURA)
  @HttpCode(HttpStatus.OK)
  async impostaPrincipale(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sedeId', ParseUUIDPipe) sedeId: string
  ) {
    requireRequestTenantId(req)
    return this.ditte.impostaPrincipale(id, sedeId)
  }
}
