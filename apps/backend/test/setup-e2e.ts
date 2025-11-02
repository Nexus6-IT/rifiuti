/**
 * E2E Test Setup
 * Configure test environment
 */

// Set test environment
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@localhost:5432/wasteflow_test?schema=public'

// Increase timeout for E2E tests
jest.setTimeout(30000)
