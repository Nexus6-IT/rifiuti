/**
 * ABAC Integration Tests
 * T227: Phase 10 - ABAC Workflow Integration Test
 *
 * Test scenario:
 * - User has "fir:read:facility" permission (RBAC ALLOW)
 * - ABAC policy: DENY if user.facility != fir.producerFacility
 * - Expected: 403 Forbidden
 */

import { Test, TestingModule } from '@nestjs/testing'
import { AbacPolicyEvaluator, EvaluationContext } from './abac-policy-evaluator.service'
import { AbacPolicy, AbacPolicyEffect, AbacOperator, AbacConditions } from './abac-policy.entity'

describe('ABAC Integration Tests (T227)', () => {
  let evaluator: AbacPolicyEvaluator

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AbacPolicyEvaluator],
    }).compile()

    evaluator = module.get<AbacPolicyEvaluator>(AbacPolicyEvaluator)
  })

  describe('Scenario: FIR Facility Scoping', () => {
    it('should DENY access when user facility does not match FIR producer facility', async () => {
      // Arrange: Create ABAC policy
      const conditions: AbacConditions = {
        operator: 'AND',
        rules: [
          {
            attribute: 'user.facility',
            operator: AbacOperator.NOT_EQUALS,
            value: 'resource.producerFacility',
          },
        ],
      }

      // Note: This policy denies access when facilities don't match
      // In reality, we'd want a policy that allows when they DO match
      // But for testing the DENY scenario, we use NOT_EQUALS
      const policy = AbacPolicy.create({
        name: 'Deny FIR access for different facilities',
        resourceType: 'fir',
        effect: AbacPolicyEffect.DENY,
        conditions,
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      // Create evaluation context
      const context: EvaluationContext = {
        user: {
          id: 'user-123',
          facility: 'facility-A',
          tenantId: 'tenant-1',
        },
        resource: {
          type: 'fir',
          id: 'fir-456',
          producerFacility: 'facility-B', // Different facility!
        },
        action: 'read',
      }

      // Act: Evaluate policy
      const result = await evaluator.evaluate([policy], context)

      // Assert: Should DENY because facilities don't match
      expect(result.decision).toBe('DENY')
      expect(result.evaluatedPolicies).toHaveLength(1)
      expect(result.evaluatedPolicies[0].matched).toBe(true)
      expect(result.evaluatedPolicies[0].effect).toBe(AbacPolicyEffect.DENY)
      expect(result.totalEvaluationTimeMs).toBeLessThan(5) // <5ms target
    })

    it('should ALLOW access when user facility matches FIR producer facility', async () => {
      // Arrange: Create ABAC policy that allows matching facilities
      const conditions: AbacConditions = {
        operator: 'AND',
        rules: [
          {
            attribute: 'user.facility',
            operator: AbacOperator.EQUALS,
            value: 'resource.producerFacility',
          },
        ],
      }

      const policy = AbacPolicy.create({
        name: 'Allow FIR access for same facility',
        resourceType: 'fir',
        effect: AbacPolicyEffect.ALLOW,
        conditions,
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      const context: EvaluationContext = {
        user: {
          id: 'user-123',
          facility: 'facility-A',
          tenantId: 'tenant-1',
        },
        resource: {
          type: 'fir',
          id: 'fir-456',
          producerFacility: 'facility-A', // Same facility!
        },
        action: 'read',
      }

      // Act
      const result = await evaluator.evaluate([policy], context)

      // Assert: Should ALLOW because facilities match
      expect(result.decision).toBe('ALLOW')
      expect(result.evaluatedPolicies[0].matched).toBe(true)
      expect(result.totalEvaluationTimeMs).toBeLessThan(5)
    })

    it('should handle complex conditions with multiple rules (AND)', async () => {
      // Arrange: Policy with multiple conditions
      const conditions: AbacConditions = {
        operator: 'AND',
        rules: [
          {
            attribute: 'user.facility',
            operator: AbacOperator.EQUALS,
            value: 'resource.producerFacility',
          },
          {
            attribute: 'user.department',
            operator: AbacOperator.IN,
            value: ['waste-management', 'environmental'],
          },
        ],
      }

      const policy = AbacPolicy.create({
        name: 'Allow FIR access for same facility AND specific departments',
        resourceType: 'fir',
        effect: AbacPolicyEffect.ALLOW,
        conditions,
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      // Test case 1: Both conditions match
      const context1: EvaluationContext = {
        user: {
          facility: 'facility-A',
          department: 'waste-management',
        },
        resource: {
          producerFacility: 'facility-A',
        },
        action: 'read',
      }

      const result1 = await evaluator.evaluate([policy], context1)
      expect(result1.decision).toBe('ALLOW')

      // Test case 2: Only first condition matches
      const context2: EvaluationContext = {
        user: {
          facility: 'facility-A',
          department: 'finance', // Wrong department
        },
        resource: {
          producerFacility: 'facility-A',
        },
        action: 'read',
      }

      const result2 = await evaluator.evaluate([policy], context2)
      expect(result2.decision).toBe('NOT_APPLICABLE') // AND fails
    })

    it('should handle OR conditions', async () => {
      const conditions: AbacConditions = {
        operator: 'OR',
        rules: [
          {
            attribute: 'user.role',
            operator: AbacOperator.EQUALS,
            value: 'admin',
          },
          {
            attribute: 'user.facility',
            operator: AbacOperator.EQUALS,
            value: 'resource.producerFacility',
          },
        ],
      }

      const policy = AbacPolicy.create({
        name: 'Allow FIR access for admins OR same facility',
        resourceType: 'fir',
        effect: AbacPolicyEffect.ALLOW,
        conditions,
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      // Test: User is not admin but has matching facility
      const context: EvaluationContext = {
        user: {
          role: 'operator',
          facility: 'facility-A',
        },
        resource: {
          producerFacility: 'facility-A',
        },
        action: 'read',
      }

      const result = await evaluator.evaluate([policy], context)
      expect(result.decision).toBe('ALLOW') // OR succeeds
    })

    it('should respect priority order (lower number = higher priority)', async () => {
      // Arrange: Two conflicting policies
      const denyPolicy = AbacPolicy.create({
        name: 'Deny all FIR access',
        resourceType: 'fir',
        effect: AbacPolicyEffect.DENY,
        conditions: {
          operator: 'AND',
          rules: [
            {
              attribute: 'user.id',
              operator: AbacOperator.EQUALS,
              value: 'user.id', // Always matches
            },
          ],
        },
        priority: 1, // Higher priority (lower number)
        isActive: true,
        createdBy: 'system',
      })

      const allowPolicy = AbacPolicy.create({
        name: 'Allow all FIR access',
        resourceType: 'fir',
        effect: AbacPolicyEffect.ALLOW,
        conditions: {
          operator: 'AND',
          rules: [
            {
              attribute: 'user.id',
              operator: AbacOperator.EQUALS,
              value: 'user.id',
            },
          ],
        },
        priority: 100, // Lower priority (higher number)
        isActive: true,
        createdBy: 'system',
      })

      const context: EvaluationContext = {
        user: { id: 'user-123' },
        resource: { id: 'fir-456' },
        action: 'read',
      }

      // Act: Evaluate with DENY policy first (priority 1)
      const result = await evaluator.evaluate([denyPolicy, allowPolicy], context)

      // Assert: DENY should win because it has higher priority
      expect(result.decision).toBe('DENY')
      expect(result.evaluatedPolicies[0].policyName).toBe('Deny all FIR access')
    })

    it('should NOT_APPLICABLE when no policies match', async () => {
      const policy = AbacPolicy.create({
        name: 'Allow for specific user only',
        resourceType: 'fir',
        effect: AbacPolicyEffect.ALLOW,
        conditions: {
          operator: 'AND',
          rules: [
            {
              attribute: 'user.id',
              operator: AbacOperator.EQUALS,
              value: 'user-999',
            },
          ],
        },
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      const context: EvaluationContext = {
        user: { id: 'user-123' }, // Different user
        resource: { id: 'fir-456' },
        action: 'read',
      }

      const result = await evaluator.evaluate([policy], context)
      expect(result.decision).toBe('NOT_APPLICABLE')
    })

    it('should skip inactive policies', async () => {
      const policy = AbacPolicy.create({
        name: 'Inactive policy',
        resourceType: 'fir',
        effect: AbacPolicyEffect.DENY,
        conditions: {
          operator: 'AND',
          rules: [
            {
              attribute: 'user.id',
              operator: AbacOperator.EQUALS,
              value: 'user.id',
            },
          ],
        },
        priority: 10,
        isActive: true,
        createdBy: 'system',
      })

      policy.deactivate() // Deactivate

      const context: EvaluationContext = {
        user: { id: 'user-123' },
        resource: { id: 'fir-456' },
        action: 'read',
      }

      const result = await evaluator.evaluate([policy], context)
      expect(result.decision).toBe('NOT_APPLICABLE')
      expect(result.evaluatedPolicies).toHaveLength(0)
    })

    it('should support all comparison operators', async () => {
      const testCases = [
        {
          operator: AbacOperator.GREATER_THAN,
          userValue: 100,
          ruleValue: 50,
          expected: true,
        },
        {
          operator: AbacOperator.LESS_THAN,
          userValue: 50,
          ruleValue: 100,
          expected: true,
        },
        {
          operator: AbacOperator.CONTAINS,
          userValue: 'hello world',
          ruleValue: 'world',
          expected: true,
        },
        {
          operator: AbacOperator.NOT_CONTAINS,
          userValue: 'hello world',
          ruleValue: 'foo',
          expected: true,
        },
      ]

      for (const testCase of testCases) {
        const policy = AbacPolicy.create({
          name: `Test ${testCase.operator}`,
          resourceType: 'fir',
          effect: AbacPolicyEffect.ALLOW,
          conditions: {
            operator: 'AND',
            rules: [
              {
                attribute: 'user.value',
                operator: testCase.operator,
                value: testCase.ruleValue,
              },
            ],
          },
          priority: 10,
          isActive: true,
          createdBy: 'system',
        })

        const context: EvaluationContext = {
          user: { value: testCase.userValue },
          resource: {},
          action: 'read',
        }

        const result = await evaluator.evaluate([policy], context)
        expect(result.evaluatedPolicies[0].matched).toBe(testCase.expected)
      }
    })

    it('should maintain performance target of <5ms', async () => {
      // Create 10 policies to evaluate
      const policies = Array.from({ length: 10 }, (_, i) =>
        AbacPolicy.create({
          name: `Policy ${i}`,
          resourceType: 'fir',
          effect: AbacPolicyEffect.ALLOW,
          conditions: {
            operator: 'AND',
            rules: [
              {
                attribute: 'user.id',
                operator: AbacOperator.EQUALS,
                value: `user-${i}`,
              },
            ],
          },
          priority: i,
          isActive: true,
          createdBy: 'system',
        })
      )

      const context: EvaluationContext = {
        user: { id: 'user-5' },
        resource: {},
        action: 'read',
      }

      const result = await evaluator.evaluate(policies, context)

      // Should find match at policy 5
      expect(result.decision).toBe('ALLOW')
      expect(result.totalEvaluationTimeMs).toBeLessThan(5) // Performance target
    })
  })
})
