import { Pipe, PipeTransform } from '@angular/core'

/**
 * RoleDescriptionPipe
 * Transforms role IDs or names into human-readable descriptions
 * T126: Role description pipe for User Story 3
 *
 * Purpose: Provide clear role descriptions for permission discovery pages
 *
 * Usage:
 * ```
 * {{ 'FIELD_OPERATOR' | roleDescription }}
 * // Output: "Operators who create and manage FIRs in the field"
 *
 * {{ 'FACILITY_MANAGER' | roleDescription:'short' }}
 * // Output: "Facility Manager"
 * ```
 *
 * Requirements from spec.md:
 * - Provide clear, concise role descriptions
 * - Help users understand what each role can do
 * - Support both short (name) and long (description) formats
 */
@Pipe({
  name: 'roleDescription',
  standalone: true,
})
export class RoleDescriptionPipe implements PipeTransform {
  /**
   * Role metadata: display names and descriptions
   */
  private readonly roleMetadata: Record<
    string,
    {
      displayName: string
      shortDescription: string
      longDescription: string
    }
  > = {
    SYSTEM_ADMIN: {
      displayName: 'System Administrator',
      shortDescription: 'Full system access',
      longDescription:
        'System administrators have complete control over the platform, including user management, system configuration, and all tenant operations.',
    },
    FACILITY_MANAGER: {
      displayName: 'Facility Manager',
      shortDescription: 'Manages facility operations',
      longDescription:
        'Facility managers oversee waste management operations for their assigned facilities, including creating FIRs, managing staff, and viewing analytics.',
    },
    FIELD_OPERATOR: {
      displayName: 'Field Operator',
      shortDescription: 'Creates and manages FIRs',
      longDescription:
        'Field operators work on-site to create and manage FIRs for waste collection, transportation, and disposal activities.',
    },
    COMPLIANCE_OFFICER: {
      displayName: 'Compliance Officer',
      shortDescription: 'Reviews audit trails',
      longDescription:
        'Compliance officers review permission audit trails, generate reports for regulatory inspections, and ensure ARPA compliance.',
    },
    ENVIRONMENTAL_CONSULTANT: {
      displayName: 'Environmental Consultant',
      shortDescription: 'Manages multiple clients',
      longDescription:
        'Environmental consultants provide waste management expertise across multiple client tenants, with the ability to switch contexts and view aggregated data.',
    },
    VIEWER: {
      displayName: 'Viewer',
      shortDescription: 'Read-only access',
      longDescription:
        'Viewers have read-only access to FIRs and reports within their assigned facilities, without the ability to create or modify data.',
    },
  }

  /**
   * Transform role name/ID to human-readable description
   *
   * @param roleNameOrId Role name (e.g., "FIELD_OPERATOR") or ID
   * @param mode Format mode: "name", "short", or "long" (default)
   * @returns Human-readable role description
   */
  transform(roleNameOrId: string, mode: 'name' | 'short' | 'long' = 'long'): string {
    // Validation
    if (!roleNameOrId || typeof roleNameOrId !== 'string') {
      return 'Unknown role'
    }

    // Normalize role name (convert to uppercase, handle both IDs and names)
    const normalizedRole = this.normalizeRoleName(roleNameOrId)

    // Get role metadata
    const metadata = this.roleMetadata[normalizedRole]

    if (!metadata) {
      // Fallback for unknown roles
      return this.formatUnknownRole(roleNameOrId, mode)
    }

    // Return appropriate format
    switch (mode) {
      case 'name':
        return metadata.displayName
      case 'short':
        return metadata.shortDescription
      case 'long':
      default:
        return metadata.longDescription
    }
  }

  /**
   * Normalize role name to standard format
   */
  private normalizeRoleName(roleNameOrId: string): string {
    // If it's a UUID-like ID, can't normalize - return as-is
    if (roleNameOrId.includes('-') && roleNameOrId.length > 20) {
      return roleNameOrId
    }

    // Convert to uppercase and handle common variations
    const normalized = roleNameOrId.toUpperCase().trim()

    // Handle common name variations
    const nameMap: Record<string, string> = {
      ADMIN: 'SYSTEM_ADMIN',
      ADMINISTRATOR: 'SYSTEM_ADMIN',
      MANAGER: 'FACILITY_MANAGER',
      OPERATOR: 'FIELD_OPERATOR',
      CONSULTANT: 'ENVIRONMENTAL_CONSULTANT',
      AUDITOR: 'COMPLIANCE_OFFICER',
      OFFICER: 'COMPLIANCE_OFFICER',
      'READ-ONLY': 'VIEWER',
      READONLY: 'VIEWER',
    }

    return nameMap[normalized] || normalized
  }

  /**
   * Format unknown role name gracefully
   */
  private formatUnknownRole(roleNameOrId: string, mode: 'name' | 'short' | 'long'): string {
    // Try to make it human-readable
    const formatted = roleNameOrId
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    switch (mode) {
      case 'name':
        return formatted
      case 'short':
        return `Custom role: ${formatted}`
      case 'long':
      default:
        return `This is a custom role named "${formatted}". Contact your administrator for details about this role's permissions.`
    }
  }

  /**
   * Get all available roles
   * Useful for dropdowns and selection components
   */
  getAllRoles(): Array<{
    name: string
    displayName: string
    description: string
  }> {
    return Object.entries(this.roleMetadata).map(([name, metadata]) => ({
      name,
      displayName: metadata.displayName,
      description: metadata.shortDescription,
    }))
  }
}
