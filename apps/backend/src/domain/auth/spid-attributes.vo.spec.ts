import { SPIDAttributes } from './spid-attributes.vo'
import { DomainException } from '../shared/domain-exception'

/**
 * SPID Attributes Value Object Tests
 *
 * Tests for Italian SPID (Sistema Pubblico Identità Digitale) attributes
 * and authentication level validation.
 *
 * SPID Levels:
 * - Level 1: Username/password
 * - Level 2: Username/password + OTP (minimum for legal signatures)
 * - Level 3: Username/password + hardware token/smart card
 */
describe('SPIDAttributes', () => {
  describe('Construction and Validation', () => {
    it('should create SPID attributes with valid data', () => {
      const attrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(attrs).toBeDefined()
      expect(attrs.getFiscalCode()).toBe('RSSMRA80A01H501U')
      expect(attrs.getFirstName()).toBe('Mario')
      expect(attrs.getLastName()).toBe('Rossi')
      expect(attrs.getFullName()).toBe('Mario Rossi')
      expect(attrs.getEmail()).toBe('mario.rossi@example.it')
      expect(attrs.getSpidLevel()).toBe(2)
      expect(attrs.getIssuer()).toBe('https://identity.infocert.it')
      expect(attrs.getSessionId()).toBe('session-123')
    })

    it('should fail with invalid fiscal code', () => {
      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'INVALID',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)
    })

    it('should fail with invalid SPID level', () => {
      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 0, // Invalid
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)

      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 4, // Invalid
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)
    })

    it('should fail with invalid email', () => {
      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'invalid-email',
          spidLevel: 2,
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)
    })

    it('should fail with empty required fields', () => {
      expect(() =>
        SPIDAttributes.create({
          fiscalCode: '',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)

      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: '',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          issuer: 'https://identity.infocert.it',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)
    })
  })

  describe('SPID Level Business Rules', () => {
    it('should identify Level 2+ authentication as sufficient for signing', () => {
      const level2 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(level2.canSignDocuments()).toBe(true)

      const level3 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 3,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(level3.canSignDocuments()).toBe(true)
    })

    it('should reject Level 1 authentication for signing', () => {
      const level1 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 1,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(level1.canSignDocuments()).toBe(false)
    })
  })

  describe('Identity Provider Validation', () => {
    it('should accept valid SPID identity providers', () => {
      const validIssuers = [
        'https://identity.infocert.it',
        'https://posteid.poste.it',
        'https://login.aruba.it',
        'https://spid.intesa.it',
        'https://spid.register.it',
      ]

      validIssuers.forEach(issuer => {
        const attrs = SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          issuer,
          sessionId: 'session-123',
        })

        expect(attrs.getIssuer()).toBe(issuer)
      })
    })

    it('should fail with invalid issuer URL', () => {
      expect(() =>
        SPIDAttributes.create({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          issuer: 'not-a-url',
          sessionId: 'session-123',
        })
      ).toThrow(DomainException)
    })
  })

  describe('Value Object Equality', () => {
    it('should be equal when all properties match', () => {
      const attrs1 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      const attrs2 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(attrs1.equals(attrs2)).toBe(true)
    })

    it('should not be equal when properties differ', () => {
      const attrs1 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      const attrs2 = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 3, // Different level
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      expect(attrs1.equals(attrs2)).toBe(false)
    })
  })

  describe('Session Management', () => {
    it('should include session timestamp', () => {
      const attrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date('2025-10-19T10:00:00Z'),
      })

      expect(attrs.getAuthenticatedAt()).toEqual(new Date('2025-10-19T10:00:00Z'))
    })

    it('should use current time if authenticatedAt not provided', () => {
      const before = new Date()

      const attrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      })

      const after = new Date()

      const authTime = attrs.getAuthenticatedAt()
      expect(authTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(authTime.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should determine if authentication is recent (within 15 minutes)', () => {
      const recentAuth = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      })

      expect(recentAuth.isAuthenticationRecent()).toBe(true)

      const oldAuth = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      })

      expect(oldAuth.isAuthenticationRecent()).toBe(false)
    })
  })

  describe('Serialization', () => {
    it('should serialize to plain object', () => {
      const attrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date('2025-10-19T10:00:00Z'),
      })

      const plain = attrs.toPlainObject()

      expect(plain).toEqual({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date('2025-10-19T10:00:00Z'),
      })
    })
  })
})
