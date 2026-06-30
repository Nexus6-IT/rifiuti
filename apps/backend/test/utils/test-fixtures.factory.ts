/**
 * Test Fixtures Factory
 * Provides reusable mock entities for testing with valid data
 */

/**
 * Creates a mock user entity with default values
 * Override any properties as needed in tests
 *
 * @param overrides Partial user properties to override defaults
 * @returns Mock user object with valid Italian fiscal code
 *
 * @example
 * ```typescript
 * const user = createMockUser({
 *   email: 'custom@example.com',
 *   role: 'ADMIN',
 * });
 * ```
 */
export function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-123',
    email: 'mario.rossi@example.com',
    fiscalCode: 'RSSMRA80A01H501U', // Valid Italian fiscal code format
    firstName: 'Mario',
    lastName: 'Rossi',
    tenantId: 'tenant-123',
    role: 'ADMIN',
    authProvider: 'SPID',
    spidLevel: null,
    defaultTenantId: null,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

/**
 * Creates a mock tenant entity
 *
 * @param overrides Partial tenant properties to override defaults
 * @returns Mock tenant object
 *
 * @example
 * ```typescript
 * const tenant = createMockTenant({
 *   name: 'Custom Company',
 * });
 * ```
 */
export function createMockTenant(overrides: Partial<any> = {}) {
  return {
    id: 'tenant-123',
    name: 'Test Company S.r.l.',
    schemaName: 'tenant_test',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

/**
 * Creates a mock user-tenant relationship
 *
 * @param overrides Partial properties to override defaults
 * @returns Mock userTenant object
 */
export function createMockUserTenant(overrides: Partial<any> = {}) {
  return {
    userId: 'user-123',
    tenantId: 'tenant-123',
    role: 'ADMIN',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

/**
 * Valid Italian fiscal codes for testing
 * These follow the correct format and checksum
 */
export const VALID_FISCAL_CODES = {
  MARIO_ROSSI: 'RSSMRA80A01H501U',
  LUIGI_VERDI: 'VRDLGI85M01H501X',
  GIUSEPPE_BIANCHI: 'BNCGPP90L01H501K',
  ANNA_RUSSO: 'RSSNNA75D41H501P',
}

/**
 * Creates a mock SPID user response
 *
 * @param overrides Partial properties to override defaults
 * @returns Mock SPID user object
 */
export function createMockSpidUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-123',
    email: 'mario.rossi@example.com',
    fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
    firstName: 'Mario',
    lastName: 'Rossi',
    isNewUser: false,
    ...overrides,
  }
}

/**
 * Creates a mock SPID profile (from SAML response)
 *
 * @param overrides Partial properties to override defaults
 * @returns Mock SPID profile object
 */
export function createMockSpidProfile(overrides: Partial<any> = {}) {
  return {
    fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
    email: 'mario.rossi@example.com',
    name: 'Mario',
    familyName: 'Rossi',
    nameID: VALID_FISCAL_CODES.MARIO_ROSSI,
    nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    spidLevel: 'SpidL2',
    ...overrides,
  }
}

/**
 * Creates a mock JWT payload
 *
 * @param overrides Partial properties to override defaults
 * @returns Mock JWT payload object
 */
export function createMockJwtPayload(overrides: Partial<any> = {}) {
  return {
    sub: 'user-123',
    email: 'mario.rossi@example.com',
    fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
    tenantId: 'tenant-123',
    role: 'ADMIN',
    type: 'access' as const,
    ...overrides,
  }
}

/**
 * Creates mock JWT tokens
 *
 * @param overrides Partial properties to override defaults
 * @returns Mock token pair
 */
export function createMockTokens(overrides: Partial<any> = {}) {
  return {
    accessToken: 'mock-access-token-jwt-string',
    refreshToken: 'mock-refresh-token-jwt-string',
    expiresIn: 900, // 15 minutes
    ...overrides,
  }
}
