/**
 * CER Controller - REST API
 * Gestione Catalogo Codici Europei Rifiuti
 */

import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger'
import { CERCatalogService } from '../../domain/cer/services/cer-catalog.service'

export class CERResponseDto {
  id: string
  code: string
  description: string
  isPericoloso: boolean
  category: string
  subcategory: string | null
}

export class CERStatisticsDto {
  total: number
  pericolosi: number
  nonPericolosi: number
}

@ApiTags('cer')
@Controller('cer')
export class CERController {
  constructor(private readonly cerCatalogService: CERCatalogService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lista paginata del catalogo CER',
    description:
      'Restituisce i codici CER paginati, con filtri opzionali per categoria/pericolosità.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'pericoloso', required: false, type: Boolean })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('pericoloso') pericoloso?: string
  ): Promise<{
    items: CERResponseDto[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    const pageNum = Number(page) || 1
    const limitNum = Number(limit) || 50
    const filters: any = {}
    if (pericoloso !== undefined) filters.pericoloso = pericoloso === 'true'
    if (category) filters.category = category

    const { items, total } = await this.cerCatalogService.list(pageNum, limitNum, filters)
    return {
      items: items.map(cer => ({
        id: cer.id,
        code: cer.code,
        description: cer.description,
        isPericoloso: cer.isPericoloso,
        category: cer.category,
        subcategory: cer.subcategory,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    }
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerca codici CER per keyword',
    description: 'Full-text search nel catalogo CER con filtri opzionali',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Keyword di ricerca' })
  @ApiQuery({
    name: 'pericoloso',
    required: false,
    type: Boolean,
    description: 'Filtra solo rifiuti pericolosi',
  })
  @ApiQuery({ name: 'category', required: false, description: 'Filtra per categoria (es. "13")' })
  @ApiResponse({ status: 200, description: 'Lista codici CER trovati', type: [CERResponseDto] })
  @ApiResponse({ status: 400, description: 'Keyword mancante o non valida' })
  async search(
    @Query('q') keyword: string,
    @Query('pericoloso') pericoloso?: string,
    @Query('category') category?: string
  ): Promise<CERResponseDto[]> {
    const filters: any = {}

    if (pericoloso !== undefined) {
      filters.pericoloso = pericoloso === 'true'
    }

    if (category) {
      filters.category = category
    }

    const results = await this.cerCatalogService.search(keyword, filters)

    return results.map(cer => ({
      id: cer.id,
      code: cer.code,
      description: cer.description,
      isPericoloso: cer.isPericoloso,
      category: cer.category,
      subcategory: cer.subcategory,
    }))
  }

  @Get('code/:code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ottieni codice CER specifico',
    description: 'Recupera dettagli di un codice CER specifico',
  })
  @ApiResponse({ status: 200, description: 'Codice CER trovato', type: CERResponseDto })
  @ApiResponse({ status: 404, description: 'Codice CER non trovato' })
  async getByCode(@Query('code') code: string): Promise<CERResponseDto | null> {
    const cer = await this.cerCatalogService.getByCode(code)

    if (!cer) return null

    return {
      id: cer.id,
      code: cer.code,
      description: cer.description,
      isPericoloso: cer.isPericoloso,
      category: cer.category,
      subcategory: cer.subcategory,
    }
  }

  @Get('statistics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Statistiche catalogo CER',
    description: 'Restituisce statistiche sul catalogo CER (totale, pericolosi, non pericolosi)',
  })
  @ApiResponse({ status: 200, description: 'Statistiche catalogo', type: CERStatisticsDto })
  async getStatistics(): Promise<CERStatisticsDto> {
    return this.cerCatalogService.getStatistics()
  }
}
