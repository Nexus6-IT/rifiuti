import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended'

/**
 * Type-safe Prisma mock for Jest tests
 *
 * This utility provides a fully typed Prisma client mock using jest-mock-extended,
 * ensuring type safety when mocking database operations in unit tests.
 *
 * @example
 * ```typescript
 * import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock';
 *
 * let prismaMock: MockPrisma;
 *
 * beforeEach(() => {
 *   prismaMock = createPrismaMock();
 *
 *   // Type-safe mocking with autocomplete
 *   prismaMock.fir.findUnique.mockResolvedValue({
 *     id: 'fir-123',
 *     numero: 'FIR-2025-001',
 *     // ... all required fields with correct types
 *   });
 * });
 * ```
 */
export type MockPrisma = DeepMockProxy<PrismaClient>

/**
 * Creates a new type-safe Prisma mock
 *
 * @returns A deep mock proxy of PrismaClient with full type safety
 */
export const createPrismaMock = (): MockPrisma => {
  return mockDeep<PrismaClient>()
}

/**
 * Resets all mocks on the Prisma client
 *
 * Use this in afterEach or beforeEach to ensure clean state between tests
 *
 * @param prisma The Prisma mock to reset
 */
export const resetPrismaMock = (prisma: MockPrisma): void => {
  mockReset(prisma)
}
