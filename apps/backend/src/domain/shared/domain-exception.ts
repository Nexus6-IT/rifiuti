/**
 * Base Domain Exception
 *
 * All domain-layer exceptions should extend this class.
 * Domain exceptions represent business rule violations.
 *
 * Examples:
 * - Invalid fiscal code format
 * - FIR cannot be signed twice by same user
 * - Cannot sync FIR to RENTRI before all signatures collected
 */
export class DomainException extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly metadata?: Record<string, any>,
  ) {
    super(message);
    this.name = 'DomainException';
    Object.setPrototypeOf(this, DomainException.prototype);
  }

  /**
   * Create exception for business rule violation
   */
  static businessRuleViolation(rule: string, details?: string): DomainException {
    const message = `Business rule violated: ${rule}. ${details || ''}`;
    return new DomainException(message, 'BUSINESS_RULE_VIOLATION', { rule, details });
  }

  /**
   * Create exception for invalid entity state
   */
  static invalidState(entity: string, state: string, reason: string): DomainException {
    const message = `Invalid ${entity} state: ${state}. ${reason}`;
    return new DomainException(message, 'INVALID_STATE', { entity, state, reason });
  }

  /**
   * Create exception for not found entity
   */
  static notFound(entity: string, identifier: string): DomainException {
    const message = `${entity} not found: ${identifier}`;
    return new DomainException(message, 'NOT_FOUND', { entity, identifier });
  }

  /**
   * Create exception for concurrent modification
   */
  static concurrencyConflict(entity: string, identifier: string): DomainException {
    const message = `Concurrent modification detected for ${entity}: ${identifier}`;
    return new DomainException(message, 'CONCURRENCY_CONFLICT', { entity, identifier });
  }

  /**
   * Create exception for validation failure
   */
  static validationFailed(code: string, message: string, metadata?: Record<string, any>): DomainException {
    return new DomainException(message, code, metadata);
  }
}
