import { Controller, Get, Query, UseGuards, Req, Res } from '@nestjs/common'
import { Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { MudExportService } from '../../application/mud/export/mud-export.service'

/**
 * MUD Controller
 *
 * Handles MUD (Modello Unico Dichiarazione) annual report generation + export
 * telematico versionato per anno.
 */
@Controller('mud')
@UseGuards(JwtAuthGuard)
@ApiTags('MUD Reports')
@ApiBearerAuth()
export class MudController {
  constructor(
    private readonly mudGenerator: MUDGeneratorService,
    private readonly mudExport: MudExportService
  ) {}

  @Get('generate')
  @ApiOperation({ summary: 'Generate MUD report for a specific year' })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2024 })
  async generateReport(@Req() req: any, @Query('year') year: string) {
    const tenantId = req.user.tenantId
    const reportYear = parseInt(year, 10)

    return await this.mudGenerator.generateMUDReport(tenantId, reportYear)
  }

  @Get('export')
  @ApiOperation({
    summary: 'Esporta il file MUD telematico (versionato per anno)',
    description:
      'Genera il file MUD nel formato telematico Unioncamere della versione ' +
      "corrispondente all'anno richiesto. Il file va validato sull'applicazione " +
      "ufficiale (mudtelematico.it) prima dell'invio.",
  })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2024 })
  async exportTelematico(
    @Req() req: any,
    @Res() res: Response,
    @Query('year') year: string
  ): Promise<void> {
    const tenantId = req.user.tenantId
    const result = await this.mudExport.exportTelematico(tenantId, parseInt(year, 10))

    res.setHeader('Content-Type', 'text/plain; charset=us-ascii')
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.setHeader('X-MUD-Version', result.version)
    res.send(result.content)
  }

  @Get('export/versions')
  @ApiOperation({ summary: 'Versioni tracciato MUD supportate (per anno)' })
  async exportVersions() {
    return { versions: this.mudExport.supportedVersions() }
  }

  @Get('years')
  @ApiOperation({ summary: 'Get available years for MUD reporting' })
  async getAvailableYears(@Req() _req: any) {
    const currentYear = new Date().getFullYear()
    const years = []

    // Last 5 years
    for (let i = 0; i < 5; i++) {
      years.push(currentYear - i)
    }

    return { years }
  }
}
