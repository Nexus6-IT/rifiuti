import { Controller, Get, Post, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { ReferenceDataService } from './reference-data.service'
import { ReferenceDataSeederService, ReferenceDataset } from './reference-data-seeder.service'

/**
 * Reference Data Controller — lookup pubblici (autenticati) + gestione admin
 * del popolamento dei dati di riferimento condivisi.
 */
@ApiTags('reference-data')
@Controller('reference-data')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReferenceDataController {
  constructor(
    private readonly referenceData: ReferenceDataService,
    private readonly seeder: ReferenceDataSeederService
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Conteggi dei dataset di riferimento (stato popolamento)' })
  async status() {
    return this.referenceData.counts()
  }

  @Get('comuni')
  @ApiOperation({ summary: 'Ricerca comuni per nome' })
  @ApiQuery({ name: 'q', required: true })
  async searchComuni(@Query('q') q: string) {
    return this.referenceData.searchComuni(q)
  }

  @Get('ateco')
  @ApiOperation({ summary: 'Ricerca codici ATECO' })
  @ApiQuery({ name: 'q', required: true })
  async searchAteco(@Query('q') q: string) {
    return this.referenceData.searchAteco(q)
  }

  @Get('nazioni')
  @ApiOperation({ summary: 'Ricerca nazioni per nome o codice ISO' })
  @ApiQuery({ name: 'q', required: true })
  async searchNazioni(@Query('q') q: string) {
    return this.referenceData.searchNazioni(q)
  }

  @Post('reseed')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Ripopola i dati di riferimento dalle sorgenti (admin)',
    description:
      'Avvia il reseed di tutti i dataset o di uno solo (?dataset=ateco|nazioni|province|comuni).',
  })
  @ApiQuery({ name: 'dataset', required: false })
  async reseed(@Query('dataset') dataset?: ReferenceDataset) {
    // Best-effort in background; ritorna subito.
    this.seeder.reseedAll(dataset).catch(() => undefined)
    return { accepted: true, dataset: dataset || 'all' }
  }
}
