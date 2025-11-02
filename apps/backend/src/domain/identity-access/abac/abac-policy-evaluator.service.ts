/**
 * AbacPolicyEvaluator Service
 * T223: Phase 10 - ABAC Policy Engine
 *
 * Evaluates ABAC policies against user and resource attributes
 * Target: <5ms overhead for policy evaluation
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AbacPolicy,
  AbacPolicyEffect,
  AbacOperator,
  AbacConditions,
  AbacConditionRule,
} from './abac-policy.entity';

export interface EvaluationContext {
  user: Record<string, any>;
  resource: Record<string, any>;
  action: string;
  environment?: Record<string, any>;
}

export interface EvaluationResult {
  decision: 'ALLOW' | 'DENY' | 'NOT_APPLICABLE';
  evaluatedPolicies: Array<{
    policyId: string;
    policyName: string;
    effect: AbacPolicyEffect;
    matched: boolean;
    evaluationTimeMs: number;
  }>;
  totalEvaluationTimeMs: number;
}

@Injectable()
export class AbacPolicyEvaluator {
  private readonly logger = new Logger(AbacPolicyEvaluator.name);

  /**
   * Evaluate all policies for a given context
   * Returns first matching DENY, or first matching ALLOW, or NOT_APPLICABLE
   */
  async evaluate(
    policies: AbacPolicy[],
    context: EvaluationContext,
  ): Promise<EvaluationResult> {
    const startTime = performance.now();
    const evaluatedPolicies: EvaluationResult['evaluatedPolicies'] = [];

    // Sort by priority (lower number = higher priority)
    const sortedPolicies = [...policies].sort((a, b) => a.priority - b.priority);

    let finalDecision: 'ALLOW' | 'DENY' | 'NOT_APPLICABLE' = 'NOT_APPLICABLE';

    for (const policy of sortedPolicies) {
      if (!policy.isActive) {
        continue;
      }

      const policyStartTime = performance.now();
      const matched = this.evaluateConditions(policy.conditions, context);
      const policyEndTime = performance.now();

      evaluatedPolicies.push({
        policyId: policy.id,
        policyName: policy.name,
        effect: policy.effect,
        matched,
        evaluationTimeMs: policyEndTime - policyStartTime,
      });

      if (matched) {
        // First match wins
        finalDecision = policy.effect === AbacPolicyEffect.DENY ? 'DENY' : 'ALLOW';
        break;
      }
    }

    const endTime = performance.now();
    const totalEvaluationTimeMs = endTime - startTime;

    // Log slow evaluations
    if (totalEvaluationTimeMs > 5) {
      this.logger.warn(
        `ABAC evaluation took ${totalEvaluationTimeMs.toFixed(2)}ms (exceeds 5ms target)`,
        {
          action: context.action,
          resourceType: context.resource.type,
          policiesEvaluated: evaluatedPolicies.length,
        },
      );
    }

    return {
      decision: finalDecision,
      evaluatedPolicies,
      totalEvaluationTimeMs,
    };
  }

  /**
   * Evaluate a set of conditions (AND/OR)
   */
  private evaluateConditions(conditions: AbacConditions, context: EvaluationContext): boolean {
    const { operator, rules } = conditions;

    if (operator === 'AND') {
      return rules.every((rule) => this.evaluateRule(rule, context));
    } else if (operator === 'OR') {
      return rules.some((rule) => this.evaluateRule(rule, context));
    }

    return false;
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(rule: AbacConditionRule, context: EvaluationContext): boolean {
    const attributeValue = this.getAttribute(rule.attribute, context);

    // Resolve rule value if it's an attribute reference
    let ruleValue = rule.value;
    if (typeof ruleValue === 'string' && this.isAttributeReference(ruleValue)) {
      ruleValue = this.getAttribute(ruleValue, context);
    }

    switch (rule.operator) {
      case AbacOperator.EQUALS:
        return attributeValue === ruleValue;

      case AbacOperator.NOT_EQUALS:
        return attributeValue !== ruleValue;

      case AbacOperator.IN:
        return Array.isArray(ruleValue) && ruleValue.includes(attributeValue);

      case AbacOperator.NOT_IN:
        return Array.isArray(ruleValue) && !ruleValue.includes(attributeValue);

      case AbacOperator.GREATER_THAN:
        return attributeValue > ruleValue;

      case AbacOperator.GREATER_THAN_EQUAL:
        return attributeValue >= ruleValue;

      case AbacOperator.LESS_THAN:
        return attributeValue < ruleValue;

      case AbacOperator.LESS_THAN_EQUAL:
        return attributeValue <= ruleValue;

      case AbacOperator.CONTAINS:
        if (typeof attributeValue === 'string' && typeof ruleValue === 'string') {
          return attributeValue.includes(ruleValue);
        }
        if (Array.isArray(attributeValue)) {
          return attributeValue.includes(ruleValue);
        }
        return false;

      case AbacOperator.NOT_CONTAINS:
        if (typeof attributeValue === 'string' && typeof ruleValue === 'string') {
          return !attributeValue.includes(ruleValue);
        }
        if (Array.isArray(attributeValue)) {
          return !attributeValue.includes(ruleValue);
        }
        return true;

      default:
        this.logger.error(`Unknown operator: ${rule.operator}`);
        return false;
    }
  }

  /**
   * Get attribute value from context using dot notation
   * Example: "user.facility" -> context.user.facility
   */
  private getAttribute(path: string, context: EvaluationContext): any {
    const parts = path.split('.');
    let value: any = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Check if a value is an attribute reference
   * Attribute references start with 'user.', 'resource.', or 'environment.'
   */
  private isAttributeReference(value: string): boolean {
    return (
      value.startsWith('user.') ||
      value.startsWith('resource.') ||
      value.startsWith('environment.')
    );
  }
}
