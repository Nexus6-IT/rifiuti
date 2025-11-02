import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

/**
 * QueryOptimizerService
 * T222: Performance optimization for database queries
 *
 * Purpose: Monitor and optimize database query performance
 *
 * Features:
 * - Query execution time tracking
 * - Slow query detection and logging
 * - Query plan analysis recommendations
 * - Connection pool monitoring
 */
@Injectable()
export class QueryOptimizerService {
  private readonly logger = new Logger(QueryOptimizerService.name);
  private readonly SLOW_QUERY_THRESHOLD_MS = 100; // Log queries slower than 100ms

  constructor(private readonly prisma: PrismaService) {
    this.setupQueryMonitoring();
  }

  /**
   * Setup Prisma query event monitoring
   */
  private setupQueryMonitoring(): void {
    // Monitor query execution time
    (this.prisma.$on as any)('query', ((e: any) => {
      const duration = e.duration;

      if (duration > this.SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(
          `Slow query detected (${duration}ms): ${e.query.substring(0, 100)}...`,
          {
            duration,
            query: e.query,
            params: e.params,
          },
        );
      }
    }) as any);

    this.logger.log('✓ Query performance monitoring enabled');
  }

  /**
   * Get database connection pool statistics
   */
  async getConnectionPoolStats(): Promise<{
    active: number;
    idle: number;
    waiting: number;
  }> {
    // Note: Prisma doesn't expose pool stats directly
    // This is a placeholder for monitoring integration
    return {
      active: 0,
      idle: 0,
      waiting: 0,
    };
  }

  /**
   * Analyze query performance and provide recommendations
   */
  analyzeQuery(query: string, durationMs: number): {
    isOptimal: boolean;
    recommendations: string[];
  } {
    const recommendations: string[] = [];

    // Check for N+1 query patterns
    if (query.includes('SELECT') && durationMs > 50) {
      recommendations.push('Consider using Prisma includes to avoid N+1 queries');
    }

    // Check for missing WHERE clauses on large tables
    if (query.includes('FROM "firs"') && !query.includes('WHERE')) {
      recommendations.push('Add WHERE clause to filter results - full table scan detected');
    }

    // Check for ORDER BY without index
    if (query.includes('ORDER BY') && durationMs > 100) {
      recommendations.push('Consider adding index on ORDER BY column');
    }

    // Check for lack of LIMIT
    if (query.includes('SELECT') && !query.includes('LIMIT')) {
      recommendations.push('Consider adding LIMIT clause for pagination');
    }

    return {
      isOptimal: recommendations.length === 0 && durationMs < this.SLOW_QUERY_THRESHOLD_MS,
      recommendations,
    };
  }

  /**
   * Batch query execution with optimization
   * Reduces round-trips for multiple queries
   */
  async executeBatch<T>(queries: Array<() => Promise<T>>): Promise<T[]> {
    const startTime = Date.now();

    // Execute queries in parallel for better performance
    const results = await Promise.all(queries.map((query) => query()));

    const duration = Date.now() - startTime;
    this.logger.debug(`Batch execution of ${queries.length} queries took ${duration}ms`);

    return results;
  }

  /**
   * Cursor-based pagination helper
   * More efficient than offset-based pagination for large datasets
   */
  createCursorPagination(config: {
    cursor?: string;
    take: number;
    orderBy: any;
  }): any {
    return {
      take: config.take,
      skip: config.cursor ? 1 : 0,
      cursor: config.cursor ? { id: config.cursor } : undefined,
      orderBy: config.orderBy,
    };
  }

  /**
   * Monitor and log query statistics
   */
  logQueryStats(operation: string, durationMs: number, recordCount: number): void {
    const avgTimePerRecord = recordCount > 0 ? (durationMs / recordCount).toFixed(2) : 0;

    this.logger.debug(
      `Query stats - Operation: ${operation}, Duration: ${durationMs}ms, Records: ${recordCount}, Avg: ${avgTimePerRecord}ms/record`,
    );

    if (durationMs > this.SLOW_QUERY_THRESHOLD_MS) {
      this.logger.warn(
        `Performance alert: ${operation} took ${durationMs}ms for ${recordCount} records`,
      );
    }
  }
}
