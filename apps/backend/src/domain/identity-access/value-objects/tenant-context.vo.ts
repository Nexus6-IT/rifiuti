/**
 * TenantContext Value Object
 * Represents the tenant context for multi-tenant operations
 * Per plan.md FR-033: Tenant isolation
 *
 * Ensures all operations carry tenant context to prevent cross-tenant access
 */
export class TenantContext {
  private constructor(
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly userRole: string | null = null,
    public readonly facilityIds: string[] | null = null,
  ) {}

  /**
   * Create TenantContext
   */
  static create(data: {
    tenantId: string;
    userId: string;
    userRole?: string;
    facilityIds?: string[];
  }): TenantContext {
    // Validate tenantId
    if (!data.tenantId || data.tenantId.trim() === '') {
      throw new Error('Tenant ID is required for tenant context');
    }

    // Validate userId
    if (!data.userId || data.userId.trim() === '') {
      throw new Error('User ID is required for tenant context');
    }

    return new TenantContext(
      data.tenantId,
      data.userId,
      data.userRole || null,
      data.facilityIds || null,
    );
  }

  /**
   * Check if context has facility access
   */
  hasFacilityAccess(facilityId: string): boolean {
    // If no facility restriction, has access to all
    if (!this.facilityIds || this.facilityIds.length === 0) {
      return true;
    }

    // Check if facility is in allowed list
    return this.facilityIds.includes(facilityId);
  }

  /**
   * Check if context is for specific tenant
   */
  isTenant(tenantId: string): boolean {
    return this.tenantId === tenantId;
  }

  /**
   * Check if context is for specific user
   */
  isUser(userId: string): boolean {
    return this.userId === userId;
  }

  /**
   * Check if context has role
   */
  hasRole(roleName: string): boolean {
    return this.userRole?.toLowerCase() === roleName.toLowerCase();
  }

  /**
   * Validate that resource belongs to this tenant
   * Throws error if tenant mismatch
   */
  validateResourceTenant(resourceTenantId: string, resourceType: string): void {
    if (resourceTenantId !== this.tenantId) {
      throw new Error(
        `Cross-tenant access denied: ${resourceType} belongs to different tenant`,
      );
    }
  }

  /**
   * Clone context with additional facility restrictions
   */
  withFacilityRestriction(facilityIds: string[]): TenantContext {
    return new TenantContext(
      this.tenantId,
      this.userId,
      this.userRole,
      facilityIds,
    );
  }

  /**
   * Convert to plain object for logging/serialization
   */
  toObject(): {
    tenantId: string;
    userId: string;
    userRole: string | null;
    facilityIds: string[] | null;
  } {
    return {
      tenantId: this.tenantId,
      userId: this.userId,
      userRole: this.userRole,
      facilityIds: this.facilityIds,
    };
  }

  /**
   * Get string representation (for logging)
   */
  toString(): string {
    return `TenantContext(tenant=${this.tenantId}, user=${this.userId}, role=${this.userRole})`;
  }
}
