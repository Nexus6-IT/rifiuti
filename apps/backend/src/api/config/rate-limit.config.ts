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
 * true se il rate limit globale va spento: solo con RATE_LIMIT_DISATTIVATO=1
 * e MAI con NODE_ENV=production. Serve alla passata 2 E2E della CI, dove tutto
 * il traffico (pagine + API, due worker) arriva da 127.0.0.1 e supera i
 * 100/min per IP: i login venivano respinti con 429 e un record appena creato
 * dalla UI restava orfano (vedi .gitea/workflows/ci.yml).
 */
export function rateLimitDisattivato(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RATE_LIMIT_DISATTIVATO?.trim() === '1' && env.NODE_ENV !== 'production'
}

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
