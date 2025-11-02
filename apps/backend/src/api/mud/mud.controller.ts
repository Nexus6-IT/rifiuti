import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { MUDGeneratorService } from '../../application/mud/mud-generator.service';

/**
 * MUD Controller
 *
 * Handles MUD (Modello Unico Dichiarazione) annual report generation.
 */
@Controller('mud')
@UseGuards(JwtAuthGuard)
@ApiTags('MUD Reports')
@ApiBearerAuth()
export class MudController {
  constructor(private readonly mudGenerator: MUDGeneratorService) {}

  @Get('generate')
  @ApiOperation({ summary: 'Generate MUD report for a specific year' })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2024 })
  async generateReport(@Req() req: any, @Query('year') year: string) {
    const tenantId = req.user.tenantId;
    const reportYear = parseInt(year, 10);

    return await this.mudGenerator.generateMUDReport(tenantId, reportYear);
  }

  @Get('years')
  @ApiOperation({ summary: 'Get available years for MUD reporting' })
  async getAvailableYears(@Req() req: any) {
    const currentYear = new Date().getFullYear();
    const years = [];

    // Last 5 years
    for (let i = 0; i < 5; i++) {
      years.push(currentYear - i);
    }

    return { years };
  }
}
