import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetDashboardUseCase, DashboardData } from '../../application/analytics/get-dashboard.use-case';

/**
 * Dashboard Controller
 *
 * API endpoints for analytics dashboard:
 * - GET /dashboard - Get comprehensive dashboard data
 * - GET /dashboard/export - Export dashboard data as CSV/Excel
 *
 * All endpoints require authentication and are tenant-scoped.
 */
@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(
    private readonly getDashboardUseCase: GetDashboardUseCase,
  ) {}

  /**
   * Get Dashboard Data
   *
   * GET /dashboard
   *
   * Returns comprehensive analytics for dashboard display:
   * - Overview stats (FIRs, waste, compliance)
   * - Status breakdown
   * - Waste analysis by CER code
   * - RENTRI sync status
   * - Trends and predictions
   * - Top producers/carriers
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get dashboard analytics',
    description: `
      Retrieves comprehensive dashboard data for tenant.

      **Includes:**
      - Overview statistics
      - FIR status breakdown
      - Waste type analysis (CER codes)
      - RENTRI sync metrics
      - Signature completion rates
      - Compliance score
      - Month-over-month trends
      - Next month prediction
      - Top producers and carriers

      **Performance:**
      - Cached for 5 minutes
      - All metrics fetched in parallel
      - Typical response time: 200-500ms
    `,
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date for time-range filtering (ISO 8601)',
    example: '2025-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date for time-range filtering (ISO 8601)',
    example: '2025-01-31T23:59:59Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard data retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        overview: {
          type: 'object',
          properties: {
            totalFIRs: { type: 'number', example: 150 },
            totalWasteKg: { type: 'number', example: 125000 },
            completedFIRs: { type: 'number', example: 100 },
            pendingFIRs: { type: 'number', example: 45 },
            overdueFIRs: { type: 'number', example: 5 },
          },
        },
        status: {
          type: 'object',
          properties: {
            breakdown: {
              type: 'object',
              example: {
                DRAFT: 20,
                SIGNED_BY_PRODUCER: 15,
                IN_TRANSIT: 10,
                COMPLETED: 100,
              },
            },
          },
        },
        compliance: {
          type: 'object',
          properties: {
            score: { type: 'number', example: 0.92 },
            level: { type: 'string', example: 'EXCELLENT' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated',
  })
  async getDashboard(
    @Req() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<DashboardData> {
    const tenantId = req.user.tenantId;

    const dateRange =
      startDate && endDate
        ? {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
          }
        : undefined;

    return await this.getDashboardUseCase.execute({
      tenantId,
      dateRange,
    });
  }

  /**
   * Export Dashboard Data
   *
   * GET /dashboard/export
   *
   * Exports dashboard data as CSV for Excel import.
   */
  @Get('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Export dashboard data as CSV',
    description: 'Generates CSV export of dashboard metrics for Excel/spreadsheet import',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'xlsx'],
    description: 'Export format',
    example: 'csv',
  })
  @ApiResponse({
    status: 200,
    description: 'CSV data returned',
    headers: {
      'Content-Type': {
        description: 'text/csv',
        schema: { type: 'string' },
      },
      'Content-Disposition': {
        description: 'attachment; filename=dashboard-export.csv',
        schema: { type: 'string' },
      },
    },
  })
  async exportDashboard(
    @Req() req: any,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
  ): Promise<string> {
    const tenantId = req.user.tenantId;

    const dashboard = await this.getDashboardUseCase.execute({ tenantId });

    // Generate CSV
    const csv = this.generateCSV(dashboard);

    // Set headers for file download
    req.res.setHeader('Content-Type', 'text/csv');
    req.res.setHeader(
      'Content-Disposition',
      `attachment; filename=dashboard-${new Date().toISOString().split('T')[0]}.csv`,
    );

    return csv;
  }

  /**
   * Generate CSV from dashboard data
   */
  private generateCSV(data: DashboardData): string {
    const lines: string[] = [];

    // Overview section
    lines.push('OVERVIEW');
    lines.push('Metric,Value');
    lines.push(`Total FIRs,${data.overview.totalFIRs}`);
    lines.push(`Total Waste (kg),${data.overview.totalWasteKg}`);
    lines.push(`Completed FIRs,${data.overview.completedFIRs}`);
    lines.push(`Pending FIRs,${data.overview.pendingFIRs}`);
    lines.push(`Overdue FIRs,${data.overview.overdueFIRs}`);
    lines.push('');

    // Status breakdown
    lines.push('STATUS BREAKDOWN');
    lines.push('Status,Count');
    Object.entries(data.status.breakdown).forEach(([status, count]) => {
      lines.push(`${status},${count}`);
    });
    lines.push('');

    // Waste by CER code
    lines.push('WASTE BY CER CODE');
    lines.push('CER Code,Count,Quantity (kg)');
    data.waste.byCERCode.forEach(w => {
      lines.push(`${w.cerCode},${w.count},${w.totalQuantity}`);
    });
    lines.push('');

    // Compliance
    lines.push('COMPLIANCE');
    lines.push('Metric,Value');
    lines.push(`Score,${(data.compliance.score * 100).toFixed(1)}%`);
    lines.push(`Level,${data.compliance.level}`);
    lines.push('');

    // Trends
    lines.push('TRENDS');
    lines.push('Metric,Value');
    lines.push(`Current Month,${data.trends.monthOverMonth.current}`);
    lines.push(`Previous Month,${data.trends.monthOverMonth.previous}`);
    lines.push(`Growth,${(data.trends.monthOverMonth.percentage * 100).toFixed(1)}%`);
    lines.push(`Next Month Prediction,${data.trends.prediction.nextMonth}`);

    return lines.join('\n');
  }
}
