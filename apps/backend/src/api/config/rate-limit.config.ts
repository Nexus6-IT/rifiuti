/**
 * Rate Limiting Configuration
 * T234: Phase 10 - Security Hardening
 *
 * Limits:
 * - Permission requests: 10/hour per user
 * - Audit exports: 5/hour per user
 * - Role changes: 20/hour per admin
 */

import { ThrottlerModuleOptions } from '@nestjs/throttler'

/**
 * Global rate limit configuration
 */
export const rateLimitConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'default',
      ttl: 60000, // 1 minute in milliseconds
      limit: 100, // 100 requests per minute (general API)
    },
    {
      name: 'strict',
      ttl: 60000,
      limit: 10, // 10 requests per minute (sensitive endpoints)
    },
  ],
}

/**
 * Endpoint-specific rate limits
 * Applied via @Throttle() decorator
 */
export const RATE_LIMITS = {
  // Permission management
  PERMISSION_REQUEST: {
    ttl: 3600000, // 1 hour
    limit: 10,
  },

  // Audit log exports
  AUDIT_EXPORT: {
    ttl: 3600000, // 1 hour
    limit: 5,
  },

  // Role changes
  ROLE_CHANGE: {
    ttl: 3600000, // 1 hour
    limit: 20,
  },

  // Authentication
  AUTH_LOGIN: {
    ttl: 900000, // 15 minutes
    limit: 5, // Max 5 login attempts per 15 minutes
  },

  // Password reset
  PASSWORD_RESET: {
    ttl: 3600000, // 1 hour
    limit: 3,
  },

  // FIR creation
  FIR_CREATE: {
    ttl: 60000, // 1 minute
    limit: 10,
  },

  // Report generation
  REPORT_GENERATE: {
    ttl: 300000, // 5 minutes
    limit: 5,
  },
}

/**
 * Custom rate limit error message
 */
export const RATE_LIMIT_MESSAGE = {
  message: 'Rate limit exceeded',
  statusCode: 429,
  error: 'Too Many Requests',
  retryAfter: 'See Retry-After header',
}

/**
 * IP-based rate limiting for public endpoints
 */
export const IP_RATE_LIMITS = {
  PUBLIC_API: {
    ttl: 60000, // 1 minute
    limit: 30, // 30 requests per minute per IP
  },

  SPID_AUTH: {
    ttl: 300000, // 5 minutes
    limit: 10, // 10 SPID auth attempts per 5 minutes per IP
  },
}
