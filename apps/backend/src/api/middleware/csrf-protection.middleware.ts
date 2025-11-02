import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

/**
 * CsrfProtectionMiddleware
 * T233: Cross-Site Request Forgery (CSRF) protection
 *
 * Purpose: Prevent CSRF attacks on state-changing operations
 *
 * Features:
 * - Token-based CSRF protection
 * - Exempts GET/HEAD/OPTIONS requests (safe methods)
 * - Session-based token storage
 * - Double-submit cookie pattern
 * - Token rotation on authentication
 *
 * Usage:
 * - Frontend must include CSRF token in X-CSRF-Token header
 * - Token is also sent as cookie for validation
 */
@Injectable()
export class CsrfProtectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CsrfProtectionMiddleware.name);
  private readonly TOKEN_LENGTH = 32;
  private readonly COOKIE_NAME = 'XSRF-TOKEN';
  private readonly HEADER_NAME = 'x-csrf-token';

  // Safe HTTP methods that don't require CSRF protection
  private readonly SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

  // Paths that are exempted from CSRF protection
  private readonly EXEMPT_PATHS = [
    '/api/v1/auth/login', // Login creates new session
    '/api/v1/auth/spid', // SPID callback
    '/api/v1/health', // Health check
    '/api/v1/webhooks', // External webhooks with signature verification
  ];

  use(req: Request, res: Response, next: NextFunction) {
    try {
      // Skip CSRF check for safe methods
      if (this.SAFE_METHODS.includes(req.method)) {
        // Generate and set token for safe methods
        this.ensureCsrfToken(req, res);
        return next();
      }

      // Skip CSRF check for exempt paths
      if (this.isExemptPath(req.path)) {
        return next();
      }

      // Verify CSRF token for state-changing requests
      this.verifyCsrfToken(req);

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('CSRF protection error', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'CSRF token validation failed',
          error: 'InvalidCsrfToken',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Ensure CSRF token exists in session and cookie
   */
  private ensureCsrfToken(req: Request, res: Response): void {
    // Check if token already exists in session
    const session = (req as any).session;
    if (!session) {
      this.logger.warn('Session not available for CSRF token storage');
      return;
    }

    // Generate new token if doesn't exist
    if (!session.csrfToken) {
      session.csrfToken = this.generateToken();
    }

    // Set token in cookie for frontend access
    res.cookie(this.COOKIE_NAME, session.csrfToken, {
      httpOnly: false, // Must be accessible to JavaScript
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict', // Prevent CSRF via cookie
      path: '/',
    });
  }

  /**
   * Verify CSRF token matches between header and session
   */
  private verifyCsrfToken(req: Request): void {
    const session = (req as any).session;

    // Check session exists
    if (!session || !session.csrfToken) {
      this.logger.warn('CSRF token missing from session', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'CSRF token not found in session',
          error: 'MissingCsrfToken',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Get token from header
    const headerToken = req.headers[this.HEADER_NAME] as string;

    // Get token from cookie (double-submit pattern)
    const cookieToken = req.cookies?.[this.COOKIE_NAME];

    // Verify header token exists
    if (!headerToken) {
      this.logger.warn('CSRF token missing from request header', {
        path: req.path,
        method: req.method,
        user: (req as any).user?.userId,
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'CSRF token required in X-CSRF-Token header',
          error: 'MissingCsrfToken',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Verify token matches session
    if (!this.secureCompare(headerToken, session.csrfToken)) {
      this.logger.warn('CSRF token mismatch', {
        path: req.path,
        method: req.method,
        user: (req as any).user?.userId,
        ip: req.ip,
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Invalid CSRF token',
          error: 'InvalidCsrfToken',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Verify double-submit cookie matches
    if (cookieToken && !this.secureCompare(headerToken, cookieToken)) {
      this.logger.warn('CSRF double-submit cookie mismatch', {
        path: req.path,
        method: req.method,
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'CSRF token cookie mismatch',
          error: 'InvalidCsrfToken',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Generate cryptographically secure CSRF token
   */
  private generateToken(): string {
    return crypto.randomBytes(this.TOKEN_LENGTH).toString('hex');
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Check if path is exempted from CSRF protection
   */
  private isExemptPath(path: string): boolean {
    return this.EXEMPT_PATHS.some((exemptPath) => path.startsWith(exemptPath));
  }

  /**
   * Rotate CSRF token (call after login/logout)
   */
  static rotateToken(req: Request, res: Response): void {
    const session = (req as any).session;
    if (session) {
      // Generate new token
      session.csrfToken = crypto.randomBytes(32).toString('hex');

      // Update cookie
      res.cookie('XSRF-TOKEN', session.csrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      });
    }
  }
}
