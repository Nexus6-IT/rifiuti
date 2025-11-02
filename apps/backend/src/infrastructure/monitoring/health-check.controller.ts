import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';

/**
 * Health Check Controller
 *
 * Provides system health status for monitoring.
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
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get('db')
  @ApiOperation({ summary: 'Database health check' })
  async databaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      return { status: 'error', database: 'disconnected', error: (error as Error).message };
    }
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Detailed health metrics' })
  async detailedHealth() {
    const dbHealth = await this.databaseHealth();

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
    };
  }
}
