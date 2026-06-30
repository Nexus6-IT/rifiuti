/**
 * AuditMetadata Value Object
 * Encapsulates audit context information
 * T139: AuditMetadata value object per User Story 4
 *
 * Purpose: Provide consistent audit context across all audit operations
 *
 * Requirements from spec.md FR-018:
 * - Session ID for tracking user sessions
 * - IP address for security auditing
 * - User agent for device tracking
 * - SPID fiscal code for Italian ARPA compliance
 * - Request ID for distributed tracing
 *
 * Requirements from plan.md:
 * - Immutable value object
 * - Support serialization for logging
 */
export class AuditMetadata {
  private constructor(
    public readonly sessionId: string | undefined,
    public readonly ipAddress: string | undefined,
    public readonly userAgent: string | undefined,
    public readonly spidFiscalCode: string | undefined,
    public readonly requestId: string | undefined,
    public readonly geolocation: string | undefined,
    public readonly deviceType: string | undefined
  ) {
    // Freeze object to enforce immutability
    Object.freeze(this)
  }

  /**
   * Factory method: Create audit metadata
   */
  static create(props: {
    sessionId?: string
    ipAddress?: string
    userAgent?: string
    spidFiscalCode?: string
    requestId?: string
    geolocation?: string
    deviceType?: string
  }): AuditMetadata {
    return new AuditMetadata(
      props.sessionId,
      props.ipAddress,
      props.userAgent,
      props.spidFiscalCode,
      props.requestId,
      props.geolocation,
      props.deviceType
    )
  }

  /**
   * Create from HTTP request
   */
  static fromRequest(req: {
    sessionId?: string
    ip?: string
    headers?: Record<string, string>
    user?: {
      spidFiscalCode?: string
    }
  }): AuditMetadata {
    const userAgent = req.headers?.['user-agent']
    const requestId = req.headers?.['x-request-id'] || req.headers?.['x-correlation-id']
    const deviceType = AuditMetadata.detectDeviceType(userAgent)

    return new AuditMetadata(
      req.sessionId,
      req.ip,
      userAgent,
      req.user?.spidFiscalCode,
      requestId,
      undefined, // Geolocation not implemented yet
      deviceType
    )
  }

  /**
   * Create empty metadata (for system operations)
   */
  static empty(): AuditMetadata {
    return new AuditMetadata(
      undefined,
      undefined,
      'System',
      undefined,
      undefined,
      undefined,
      'System'
    )
  }

  /**
   * Check if metadata is complete (has all required fields)
   */
  isComplete(): boolean {
    return !!(this.sessionId && this.ipAddress && this.userAgent && this.requestId)
  }

  /**
   * Check if this is a system operation (no user context)
   */
  isSystemOperation(): boolean {
    return this.userAgent === 'System' && !this.sessionId
  }

  /**
   * Detect device type from user agent
   */
  private static detectDeviceType(userAgent?: string): string | undefined {
    if (!userAgent) return undefined

    const ua = userAgent.toLowerCase()

    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      return 'mobile'
    }

    if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'tablet'
    }

    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return 'bot'
    }

    return 'desktop'
  }

  /**
   * Convert to plain object
   */
  toObject(): {
    sessionId?: string
    ipAddress?: string
    userAgent?: string
    spidFiscalCode?: string
    requestId?: string
    geolocation?: string
    deviceType?: string
  } {
    return {
      sessionId: this.sessionId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      spidFiscalCode: this.spidFiscalCode,
      requestId: this.requestId,
      geolocation: this.geolocation,
      deviceType: this.deviceType,
    }
  }

  /**
   * Serialize for logging
   */
  toString(): string {
    const parts: string[] = []

    if (this.sessionId) parts.push(`session=${this.sessionId}`)
    if (this.ipAddress) parts.push(`ip=${this.ipAddress}`)
    if (this.deviceType) parts.push(`device=${this.deviceType}`)
    if (this.requestId) parts.push(`request=${this.requestId}`)

    return parts.join(' ')
  }

  /**
   * Mask sensitive information for public display
   */
  toPublicView(): {
    sessionId?: string
    ipAddress?: string
    deviceType?: string
    requestId?: string
  } {
    return {
      sessionId: this.sessionId ? this.maskSessionId(this.sessionId) : undefined,
      ipAddress: this.ipAddress ? this.maskIpAddress(this.ipAddress) : undefined,
      deviceType: this.deviceType,
      requestId: this.requestId,
    }
  }

  /**
   * Mask session ID (show first 8 characters)
   */
  private maskSessionId(sessionId: string): string {
    if (sessionId.length <= 8) return sessionId
    return `${sessionId.substring(0, 8)}...`
  }

  /**
   * Mask IP address (hide last octet for IPv4)
   */
  private maskIpAddress(ip: string): string {
    // IPv4
    if (ip.includes('.')) {
      const parts = ip.split('.')
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.***`
      }
    }

    // IPv6 or other format - mask last 4 characters
    if (ip.length > 4) {
      return `${ip.substring(0, ip.length - 4)}****`
    }

    return '***'
  }

  /**
   * Check if IP address is from private network
   */
  isPrivateNetwork(): boolean {
    if (!this.ipAddress) return false

    const ip = this.ipAddress

    // Check common private IP ranges
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.2') || // 172.20-31
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip.startsWith('127.') ||
      ip === 'localhost' ||
      ip === '::1'
    )
  }

  /**
   * Enrich metadata with additional context
   */
  withAdditionalContext(props: { spidFiscalCode?: string; geolocation?: string }): AuditMetadata {
    return new AuditMetadata(
      this.sessionId,
      this.ipAddress,
      this.userAgent,
      props.spidFiscalCode || this.spidFiscalCode,
      this.requestId,
      props.geolocation || this.geolocation,
      this.deviceType
    )
  }
}
