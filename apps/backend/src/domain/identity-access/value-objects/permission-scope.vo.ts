/**
 * PermissionScope Value Object
 * Represents the scope of a permission in the hierarchy: own < facility < all
 * Per plan.md FR-002
 *
 * Immutable value object that ensures scope validity
 */
export class PermissionScope {
  private static readonly VALID_SCOPES = ['own', 'facility', 'all'] as const;
  private static readonly SCOPE_LEVELS = { own: 0, facility: 1, all: 2 };

  private constructor(public readonly value: string) {}

  /**
   * Create PermissionScope from string
   */
  static fromString(scope: string): PermissionScope {
    const normalizedScope = scope.toLowerCase();

    if (!PermissionScope.VALID_SCOPES.includes(normalizedScope as any)) {
      throw new Error(
        `Invalid permission scope: ${scope}. Must be one of: ${PermissionScope.VALID_SCOPES.join(', ')}`,
      );
    }

    return new PermissionScope(normalizedScope);
  }

  /**
   * Create Own scope
   */
  static own(): PermissionScope {
    return new PermissionScope('own');
  }

  /**
   * Create Facility scope
   */
  static facility(): PermissionScope {
    return new PermissionScope('facility');
  }

  /**
   * Create All scope
   */
  static all(): PermissionScope {
    return new PermissionScope('all');
  }

  /**
   * Get scope level (0=own, 1=facility, 2=all)
   */
  getLevel(): number {
    return PermissionScope.SCOPE_LEVELS[this.value as keyof typeof PermissionScope.SCOPE_LEVELS];
  }

  /**
   * Check if this scope implies another scope
   * Example: 'all' implies 'facility' and 'own'
   */
  implies(other: PermissionScope): boolean {
    return this.getLevel() >= other.getLevel();
  }

  /**
   * Check if this scope is broader than another
   */
  isBroaderThan(other: PermissionScope): boolean {
    return this.getLevel() > other.getLevel();
  }

  /**
   * Check if this scope is narrower than another
   */
  isNarrowerThan(other: PermissionScope): boolean {
    return this.getLevel() < other.getLevel();
  }

  /**
   * Check if this scope equals another
   */
  equals(other: PermissionScope): boolean {
    return this.value === other.value;
  }

  /**
   * Get string representation
   */
  toString(): string {
    return this.value;
  }
}
