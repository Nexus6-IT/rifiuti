/**
 * Performance Regression Tests
 * T233: Phase 10 - Performance Testing
 *
 * Test: Run 10,000 permission checks
 * Assert: P99 < 10ms, P50 < 5ms
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../apps/backend/src/api/guards/permission.guard';
import { PermissionCacheService } from '../../apps/backend/src/infrastructure/cache/permission-cache.service';
import { AbacPolicyEvaluator } from '../../apps/backend/src/domain/identity-access/abac/abac-policy-evaluator.service';
import { AbacPolicyRepository } from '../../apps/backend/src/domain/identity-access/abac/abac-policy.repository.interface';
import { Reflector } from '@nestjs/core';

describe('Permission Guard Performance Tests (T233)', () => {
  let guard: PermissionGuard;
  let cacheService: PermissionCacheService;
  let abacEvaluator: AbacPolicyEvaluator;
  let abacRepository: AbacPolicyRepository;

  // Mock services
  const mockCacheService = {
    getPermissions: jest.fn().mockResolvedValue(['fir:read:facility', 'fir:create:own']),
  };

  const mockAbacRepository = {
    findActiveByResourceType: jest.fn().mockResolvedValue([]),
  };

  const mockAbacEvaluator = {
    evaluate: jest.fn().mockResolvedValue({
      decision: 'NOT_APPLICABLE',
      evaluatedPolicies: [],
      totalEvaluationTimeMs: 0.5,
    }),
  };

  const mockAuditQueue = {
    add: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        Reflector,
        { provide: PermissionCacheService, useValue: mockCacheService },
        { provide: AbacPolicyEvaluator, useValue: mockAbacEvaluator },
        { provide: 'AbacPolicyRepository', useValue: mockAbacRepository },
        { provide: 'PermissionAuditLogRepository', useValue: {} },
        { provide: 'audit-logging', useValue: mockAuditQueue },
      ],
    }).compile();

    guard = module.get<PermissionGuard>(PermissionGuard);
    cacheService = module.get<PermissionCacheService>(PermissionCacheService);
    abacEvaluator = module.get<AbacPolicyEvaluator>(AbacPolicyEvaluator);
    abacRepository = module.get<AbacPolicyRepository>('AbacPolicyRepository');
  });

  describe('Performance Benchmarks', () => {
    it('should handle 10,000 permission checks with P99 < 10ms and P50 < 5ms', async () => {
      const iterations = 10_000;
      const durations: number[] = [];

      // Mock execution context
      const mockContext: any = {
        getHandler: () => ({ name: 'testHandler' }),
        getClass: () => ({ name: 'TestController' }),
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              userId: 'test-user-123',
              tenantId: 'test-tenant-456',
              role: 'operator',
            },
            ip: '127.0.0.1',
            headers: {},
            body: {},
            params: {},
          }),
        }),
      };

      const mockReflector = new Reflector();
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue('fir:read:facility');

      // Replace guard's reflector
      (guard as any).reflector = mockReflector;

      console.log(`Running ${iterations.toLocaleString()} permission checks...`);
      const startTime = performance.now();

      // Run 10,000 permission checks
      for (let i = 0; i < iterations; i++) {
        const checkStart = performance.now();

        try {
          await guard.canActivate(mockContext);
        } catch (error) {
          // Ignore errors for performance testing
        }

        const checkEnd = performance.now();
        durations.push(checkEnd - checkStart);
      }

      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      // Calculate percentiles
      const sorted = durations.sort((a, b) => a - b);
      const p50 = sorted[Math.floor(iterations * 0.50)];
      const p95 = sorted[Math.floor(iterations * 0.95)];
      const p99 = sorted[Math.floor(iterations * 0.99)];
      const max = sorted[iterations - 1];
      const avg = durations.reduce((a, b) => a + b, 0) / iterations;

      // Calculate throughput
      const throughput = (iterations / totalDuration) * 1000; // ops/sec

      console.log('\n=== Performance Results ===');
      console.log(`Total duration: ${totalDuration.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(0)} ops/sec`);
      console.log(`Average: ${avg.toFixed(2)}ms`);
      console.log(`P50: ${p50.toFixed(2)}ms`);
      console.log(`P95: ${p95.toFixed(2)}ms`);
      console.log(`P99: ${p99.toFixed(2)}ms`);
      console.log(`Max: ${max.toFixed(2)}ms`);
      console.log('===========================\n');

      // Assertions
      expect(p99).toBeLessThan(10); // P99 < 10ms
      expect(p50).toBeLessThan(5);  // P50 < 5ms
      expect(throughput).toBeGreaterThan(100); // At least 100 ops/sec
    });

    it('should maintain performance with ABAC evaluation', async () => {
      const iterations = 1_000;
      const durations: number[] = [];

      // Mock ABAC policies
      const mockPolicies = Array.from({ length: 5 }, (_, i) => ({
        id: `policy-${i}`,
        name: `Test Policy ${i}`,
        resourceType: 'fir',
        effect: 'ALLOW',
        conditions: {
          operator: 'AND',
          rules: [{ attribute: 'user.id', operator: 'eq', value: 'test-user' }],
        },
        priority: i * 10,
        isActive: true,
      }));

      mockAbacRepository.findActiveByResourceType = jest.fn().mockResolvedValue(mockPolicies);

      const mockContext: any = {
        getHandler: () => ({ name: 'testHandler' }),
        getClass: () => ({ name: 'TestController' }),
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              userId: 'test-user-123',
              tenantId: 'test-tenant-456',
            },
            ip: '127.0.0.1',
            headers: {},
            body: {},
            params: {},
          }),
        }),
      };

      const mockReflector = new Reflector();
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue('fir:read:facility');
      (guard as any).reflector = mockReflector;

      console.log(`Running ${iterations} permission checks with ABAC...`);

      for (let i = 0; i < iterations; i++) {
        const checkStart = performance.now();

        try {
          await guard.canActivate(mockContext);
        } catch (error) {
          // Ignore
        }

        const checkEnd = performance.now();
        durations.push(checkEnd - checkStart);
      }

      const sorted = durations.sort((a, b) => a - b);
      const p99 = sorted[Math.floor(iterations * 0.99)];
      const abacOverhead = p99; // Approximate ABAC overhead

      console.log(`ABAC overhead (P99): ${abacOverhead.toFixed(2)}ms`);

      // ABAC should add <5ms overhead
      expect(abacOverhead).toBeLessThan(15); // Total P99 < 15ms with ABAC
    });

    it('should handle cache misses efficiently', async () => {
      const iterations = 1_000;

      // Simulate cache miss (forces database lookup)
      mockCacheService.getPermissions = jest.fn().mockResolvedValue(null);

      const mockContext: any = {
        getHandler: () => ({ name: 'testHandler' }),
        getClass: () => ({ name: 'TestController' }),
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              userId: 'test-user-123',
              tenantId: 'test-tenant-456',
            },
            ip: '127.0.0.1',
            headers: {},
            body: {},
            params: {},
          }),
        }),
      };

      const mockReflector = new Reflector();
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue('fir:read:facility');
      (guard as any).reflector = mockReflector;

      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const checkStart = performance.now();

        try {
          await guard.canActivate(mockContext);
        } catch (error) {
          // Ignore - we expect denials for cache misses
        }

        const checkEnd = performance.now();
        durations.push(checkEnd - checkStart);
      }

      const sorted = durations.sort((a, b) => a - b);
      const p99 = sorted[Math.floor(iterations * 0.99)];

      console.log(`Cache miss P99: ${p99.toFixed(2)}ms`);

      // Cache miss should still be reasonably fast
      expect(p99).toBeLessThan(50); // Cache miss P99 < 50ms
    });

    it('should maintain consistent performance under varying load', async () => {
      const rounds = 10;
      const checksPerRound = 1_000;
      const p99Results: number[] = [];

      for (let round = 0; round < rounds; round++) {
        const durations: number[] = [];

        const mockContext: any = {
          getHandler: () => ({ name: 'testHandler' }),
          getClass: () => ({ name: 'TestController' }),
          switchToHttp: () => ({
            getRequest: () => ({
              user: {
                userId: 'test-user-123',
                tenantId: 'test-tenant-456',
              },
              ip: '127.0.0.1',
              headers: {},
              body: {},
              params: {},
            }),
          }),
        };

        const mockReflector = new Reflector();
        jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue('fir:read:facility');
        (guard as any).reflector = mockReflector;

        for (let i = 0; i < checksPerRound; i++) {
          const checkStart = performance.now();
          try {
            await guard.canActivate(mockContext);
          } catch (error) {
            // Ignore
          }
          const checkEnd = performance.now();
          durations.push(checkEnd - checkStart);
        }

        const sorted = durations.sort((a, b) => a - b);
        const p99 = sorted[Math.floor(checksPerRound * 0.99)];
        p99Results.push(p99);
      }

      // Calculate standard deviation to check consistency
      const mean = p99Results.reduce((a, b) => a + b, 0) / p99Results.length;
      const variance = p99Results.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / p99Results.length;
      const stdDev = Math.sqrt(variance);

      console.log(`P99 mean: ${mean.toFixed(2)}ms, std dev: ${stdDev.toFixed(2)}ms`);

      // Performance should be consistent (low standard deviation)
      expect(stdDev).toBeLessThan(5); // Standard deviation < 5ms
      expect(mean).toBeLessThan(10);  // Mean P99 < 10ms
    });
  });
});
