import { Prisma } from '@prisma/client';

/**
 * Prisma Client Extension for Row-Level Security (RLS)
 *
 * TODO: RLS implementation currently disabled due to TypeScript type conflicts.
 * The automatic tenantId injection causes type errors when spreading args.where and args.data.
 *
 * IMPLEMENTATION OPTIONS:
 * 1. Use explicit type casting with 'as any' (risky, bypasses type safety)
 * 2. Implement RLS at the service layer instead (recommended)
 * 3. Use Prisma middleware instead of client extensions
 * 4. Wait for improved Prisma extension typing support
 *
 * For now, tenant isolation MUST be implemented manually in service methods
 * by explicitly including tenantId in all queries.
 *
 * Usage:
 * ```typescript
 * const prisma = new PrismaClient().$extends(withRLS(tenantId));
 * // Currently this extension does nothing - queries pass through unchanged
 * ```
 */
export function withRLS(tenantId: string) {
  // Suppress unused parameter warning
  void tenantId;

  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'Row-Level Security (Disabled)',
      // Empty query object - no modifications to queries
      // TODO: Implement RLS at service layer by explicitly including tenantId in all queries
      query: {},
    });
  });
}

/**
 * Type helper to get Prisma client with RLS extension
 */
export type PrismaClientWithRLS = ReturnType<typeof withRLS>;
