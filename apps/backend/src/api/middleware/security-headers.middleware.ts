import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * SecurityHeadersMiddleware
 * T235: HTTP security headers for protection against common attacks
 *
 * Purpose: Set security headers on all responses
 *
 * Features:
 * - Content Security Policy (CSP)
 * - X-Frame-Options (clickjacking protection)
 * - X-Content-Type-Options (MIME sniffing prevention)
 * - Strict-Transport-Security (HSTS)
 * - X-XSS-Protection
 * - Referrer-Policy
 * - Permissions-Policy
 *
 * Based on OWASP recommendations and helmet.js best practices
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityHeadersMiddleware.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  use(req: Request, res: Response, next: NextFunction) {
    // Content Security Policy (CSP)
    // Prevents XSS by controlling which resources can be loaded
    const cspDirectives = [
      "default-src 'self'", // Only load resources from same origin by default
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Allow scripts (relaxed for Angular)
      "style-src 'self' 'unsafe-inline'", // Allow inline styles (required for PrimeNG)
      "img-src 'self' data: https:", // Allow images from self, data URLs, and HTTPS
      "font-src 'self' data:", // Allow fonts from self and data URLs
      "connect-src 'self' wss: ws:", // Allow API calls and WebSocket
      "frame-ancestors 'none'", // Prevent framing (clickjacking)
      "base-uri 'self'", // Restrict base tag
      "form-action 'self'", // Restrict form submissions
      "upgrade-insecure-requests", // Upgrade HTTP to HTTPS in production
    ];

    // More restrictive CSP in production
    if (this.isProduction) {
      res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
    } else {
      // Report-only mode in development for easier debugging
      res.setHeader('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
    }

    // X-Frame-Options
    // Prevents clickjacking by disallowing page to be framed
    res.setHeader('X-Frame-Options', 'DENY');

    // X-Content-Type-Options
    // Prevents MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Strict-Transport-Security (HSTS)
    // Forces HTTPS connections
    if (this.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // X-XSS-Protection
    // Legacy XSS protection (most browsers now rely on CSP)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer-Policy
    // Controls how much referrer information is sent
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy (formerly Feature-Policy)
    // Controls which browser features can be used
    const permissionsPolicy = [
      'camera=()', // Disable camera
      'microphone=()', // Disable microphone
      'geolocation=(self)', // Allow geolocation only from same origin
      'payment=()', // Disable payment API
      'usb=()', // Disable USB API
      'accelerometer=()', // Disable accelerometer
      'gyroscope=()', // Disable gyroscope
      'magnetometer=()', // Disable magnetometer
    ];
    res.setHeader('Permissions-Policy', permissionsPolicy.join(', '));

    // X-Permitted-Cross-Domain-Policies
    // Restricts Adobe Flash and PDF cross-domain requests
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Cross-Origin-Embedder-Policy
    // Prevents document from loading cross-origin resources
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    // Cross-Origin-Opener-Policy
    // Isolates browsing context to prevent attacks
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    // Cross-Origin-Resource-Policy
    // Protects against cross-origin attacks
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Remove X-Powered-By header (hides technology stack)
    res.removeHeader('X-Powered-By');

    // Cache-Control for sensitive endpoints
    if (this.isSensitiveEndpoint(req.path)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }

    // Log security header application in development
    if (!this.isProduction) {
      this.logger.debug(`Security headers applied to ${req.method} ${req.path}`);
    }

    next();
  }

  /**
   * Check if endpoint contains sensitive data (no caching)
   */
  private isSensitiveEndpoint(path: string): boolean {
    const sensitivePatterns = [
      '/api/v1/auth', // Authentication endpoints
      '/api/v1/users', // User data
      '/api/v1/admin', // Admin endpoints
      '/api/v1/permissions', // Permission data
      '/api/v1/audit', // Audit logs
    ];

    return sensitivePatterns.some((pattern) => path.startsWith(pattern));
  }
}

/**
 * Helmet-like configuration helper
 * Can be used to customize security headers per environment
 */
export class SecurityHeadersConfig {
  static production(): Record<string, string> {
    return {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss: ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy':
        'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
  }

  static development(): Record<string, string> {
    return {
      'Content-Security-Policy-Report-Only':
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss: ws:; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }

  static test(): Record<string, string> {
    return {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    };
  }
}
