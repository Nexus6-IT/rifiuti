import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'

/**
 * Health Check Controller
 *
 * Provides system health status for monitoring.
 *
 * Unico controller sulla rotta `/health` (in precedenza duplicato con
 * `api/health/health.controller.ts`, rimosso: la doppia registrazione su
 * `@Controller('health')` rendeva la risposta dipendente dall'ordine di
 * init dei moduli). Il contratto di `/health` semplice è quello osservato
 * in produzione — usato dallo smoke test di deploy e dall'healthcheck
 * Docker — e NON va alterato.
 */
@Controller('health')
@ApiTags('Health')
export class HealthCheckController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'wasteflow-backend',
      version: '0.1.0',
    }
  }

  @Get('db')
  @ApiOperation({ summary: 'Database health check' })
  async databaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', database: 'connected' }
    } catch (error) {
      return { status: 'error', database: 'disconnected', error: (error as Error).message }
    }
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detailed health metrics (SUPER_ADMIN/ADMIN only)' })
  async detailedHealth() {
    const dbHealth = await this.databaseHealth()

    return {
      status: dbHealth.status === 'ok' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        rss: process.memoryUsage().rss,
      },
      database: dbHealth,
    }
  }
}
