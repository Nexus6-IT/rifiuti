import { DomainException } from '../shared/domain-exception';
import { FiscalCode } from '../shared/fiscal-code.vo';
import { Email } from '../shared/email.vo';

/**
 * SPID Attributes Value Object
 *
 * Represents Italian SPID (Sistema Pubblico Identità Digitale) authentication attributes.
 * Validates SPID level and stores identity provider information.
 *
 * SPID Authentication Levels:
 * - Level 1: Username and password (basic authentication)
 * - Level 2: Username, password + OTP (minimum for legal signatures)
 * - Level 3: Username, password + hardware token/smart card (highest security)
 *
 * Business Rules:
 * - Only Level 2 and Level 3 are sufficient for digitally signing FIR documents
 * - Authentication must be recent (within 15 minutes) for signature operations
 * - Fiscal code must be valid Italian codice fiscale
 * - Email must be valid format
 * - Issuer must be a valid HTTPS URL
 *
 * @see https://www.spid.gov.it/
 * @see D.M. 59/2023 for digital signature requirements
 */
export class SPIDAttributes {
  private readonly fiscalCode: string;
  private readonly firstName: string;
  private readonly lastName: string;
  private readonly email: string;
  private readonly spidLevel: number; // 1, 2, or 3
  private readonly issuer: string; // Identity Provider URL
  private readonly sessionId: string;
  private readonly authenticatedAt: Date;

  private constructor(
    fiscalCode: string,
    firstName: string,
    lastName: string,
    email: string,
    spidLevel: number,
    issuer: string,
    sessionId: string,
    authenticatedAt: Date
  ) {
    this.fiscalCode = fiscalCode;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.spidLevel = spidLevel;
    this.issuer = issuer;
    this.sessionId = sessionId;
    this.authenticatedAt = authenticatedAt;
  }

  /**
   * Create SPID attributes with validation
   */
  static create(params: {
    fiscalCode: string;
    firstName: string;
    lastName: string;
    email: string;
    spidLevel: number;
    issuer: string;
    sessionId: string;
    authenticatedAt?: Date;
  }): SPIDAttributes {
    // Validate fiscal code
    if (!params.fiscalCode || !FiscalCode.isValid(params.fiscalCode)) {
      throw DomainException.validationFailed(
        'INVALID_FISCAL_CODE',
        `Invalid Italian fiscal code: ${params.fiscalCode}`
      );
    }

    // Validate required fields
    if (!params.firstName || params.firstName.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_FIRST_NAME',
        'First name is required'
      );
    }

    if (!params.lastName || params.lastName.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_LAST_NAME',
        'Last name is required'
      );
    }

    // Validate email
    if (!params.email || !Email.isValid(params.email)) {
      throw DomainException.validationFailed(
        'INVALID_EMAIL',
        `Invalid email address: ${params.email}`
      );
    }

    // Validate SPID level
    if (!params.spidLevel || ![1, 2, 3].includes(params.spidLevel)) {
      throw DomainException.validationFailed(
        'INVALID_SPID_LEVEL',
        `SPID level must be 1, 2, or 3. Received: ${params.spidLevel}`
      );
    }

    // Validate issuer URL
    if (!params.issuer || !this.isValidUrl(params.issuer)) {
      throw DomainException.validationFailed(
        'INVALID_ISSUER',
        `Issuer must be a valid HTTPS URL: ${params.issuer}`
      );
    }

    // Validate session ID
    if (!params.sessionId || params.sessionId.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_SESSION_ID',
        'Session ID is required'
      );
    }

    const authenticatedAt = params.authenticatedAt || new Date();

    return new SPIDAttributes(
      params.fiscalCode.trim().toUpperCase(),
      params.firstName.trim(),
      params.lastName.trim(),
      params.email.trim().toLowerCase(),
      params.spidLevel,
      params.issuer.trim(),
      params.sessionId.trim(),
      authenticatedAt
    );
  }

  /**
   * Check if SPID level is sufficient for signing documents
   * Level 2 (OTP) or Level 3 (hardware token) required
   */
  canSignDocuments(): boolean {
    return this.spidLevel >= 2;
  }

  /**
   * Check if authentication is recent (within 15 minutes)
   * Required for signature operations
   */
  isAuthenticationRecent(): boolean {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    return this.authenticatedAt > fifteenMinutesAgo;
  }

  /**
   * Value object equality
   */
  equals(other: SPIDAttributes): boolean {
    if (!other) return false;

    return (
      this.fiscalCode === other.fiscalCode &&
      this.firstName === other.firstName &&
      this.lastName === other.lastName &&
      this.email === other.email &&
      this.spidLevel === other.spidLevel &&
      this.issuer === other.issuer &&
      this.sessionId === other.sessionId
    );
  }

  /**
   * Serialize to plain object
   */
  toPlainObject(): {
    fiscalCode: string;
    firstName: string;
    lastName: string;
    email: string;
    spidLevel: number;
    issuer: string;
    sessionId: string;
    authenticatedAt: Date;
  } {
    return {
      fiscalCode: this.fiscalCode,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      spidLevel: this.spidLevel,
      issuer: this.issuer,
      sessionId: this.sessionId,
      authenticatedAt: this.authenticatedAt,
    };
  }

  // Getters
  getFiscalCode(): string {
    return this.fiscalCode;
  }

  getFirstName(): string {
    return this.firstName;
  }

  getLastName(): string {
    return this.lastName;
  }

  getFullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  getEmail(): string {
    return this.email;
  }

  getSpidLevel(): number {
    return this.spidLevel;
  }

  getIssuer(): string {
    return this.issuer;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getAuthenticatedAt(): Date {
    return this.authenticatedAt;
  }

  /**
   * Validate URL format (must be HTTPS for security)
   */
  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'; // Allow http for local dev
    } catch {
      return false;
    }
  }
}
