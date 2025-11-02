import { User } from './user.entity';
import { SPIDAttributes } from './spid-attributes.vo';
import { DomainException } from '../shared/domain-exception';

/**
 * User Entity Tests
 *
 * Tests for User aggregate root with SPID authentication support.
 * Focuses on digital signature authorization business rules.
 */
describe('User Entity', () => {
  describe('Construction and Validation', () => {
    it('should create user with required fields', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      });

      expect(user).toBeDefined();
      expect(user.getId()).toBe('user-123');
      expect(user.getFiscalCode()).toBe('RSSMRA80A01H501U');
      expect(user.getFirstName()).toBe('Mario');
      expect(user.getLastName()).toBe('Rossi');
      expect(user.getFullName()).toBe('Mario Rossi');
      expect(user.getEmail()).toBe('mario.rossi@example.it');
      expect(user.getTenantId()).toBe('tenant-123');
    });

    it('should fail with invalid fiscal code', () => {
      expect(() =>
        User.create({
          id: 'user-123',
          fiscalCode: 'INVALID',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          tenantId: 'tenant-123',
        })
      ).toThrow(DomainException);
    });

    it('should fail with invalid email', () => {
      expect(() =>
        User.create({
          id: 'user-123',
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'invalid-email',
          tenantId: 'tenant-123',
        })
      ).toThrow(DomainException);
    });

    it('should create user with optional SPID attributes', () => {
      const spidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: spidAttrs,
      });

      expect(user.getSpidAttributes()).toBe(spidAttrs);
      expect(user.hasSpidAuthentication()).toBe(true);
    });
  });

  describe('canSignDocuments() Business Rule', () => {
    it('should return false when no SPID authentication', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      });

      expect(user.canSignDocuments()).toBe(false);
    });

    it('should return false with SPID Level 1 (insufficient)', () => {
      const spidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 1,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: spidAttrs,
      });

      expect(user.canSignDocuments()).toBe(false);
    });

    it('should return true with SPID Level 2 (sufficient)', () => {
      const spidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: spidAttrs,
      });

      expect(user.canSignDocuments()).toBe(true);
    });

    it('should return true with SPID Level 3 (strongest)', () => {
      const spidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 3,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: spidAttrs,
      });

      expect(user.canSignDocuments()).toBe(true);
    });

    it('should return false when SPID authentication expired (>15 minutes)', () => {
      const oldSpidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: oldSpidAttrs,
      });

      expect(user.canSignDocuments()).toBe(false);
    });

    it('should return true when SPID Level 2+ and authenticated recently (<15 minutes)', () => {
      const recentSpidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: recentSpidAttrs,
      });

      expect(user.canSignDocuments()).toBe(true);
    });
  });

  describe('hasRecentSpidAuth() Helper Method', () => {
    it('should return false when no SPID authentication', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      });

      expect(user.hasRecentSpidAuth()).toBe(false);
    });

    it('should return true when SPID auth is recent', () => {
      const recentSpidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: recentSpidAttrs,
      });

      expect(user.hasRecentSpidAuth()).toBe(true);
    });

    it('should return false when SPID auth is old', () => {
      const oldSpidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
        authenticatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: oldSpidAttrs,
      });

      expect(user.hasRecentSpidAuth()).toBe(false);
    });
  });

  describe('SPID Session Management', () => {
    it('should update SPID attributes on re-authentication', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      });

      const newSpidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-456',
      });

      user.updateSpidAuthentication(newSpidAttrs);

      expect(user.getSpidAttributes()).toBe(newSpidAttrs);
      expect(user.hasSpidAuthentication()).toBe(true);
    });

    it('should clear SPID attributes on logout', () => {
      const spidAttrs = SPIDAttributes.create({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
        sessionId: 'session-123',
      });

      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        spidAttributes: spidAttrs,
      });

      user.clearSpidAuthentication();

      expect(user.getSpidAttributes()).toBeUndefined();
      expect(user.hasSpidAuthentication()).toBe(false);
      expect(user.canSignDocuments()).toBe(false);
    });
  });

  describe('Role Management', () => {
    it('should support multiple roles', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        roles: ['ADMIN', 'OPERATOR'],
      });

      expect(user.hasRole('ADMIN')).toBe(true);
      expect(user.hasRole('OPERATOR')).toBe(true);
      expect(user.hasRole('VIEWER')).toBe(false);
    });

    it('should handle role assignment', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      });

      user.addRole('OPERATOR');

      expect(user.hasRole('OPERATOR')).toBe(true);
    });

    it('should prevent duplicate role assignment', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        roles: ['OPERATOR'],
      });

      user.addRole('OPERATOR');

      const roles = user.getRoles();
      expect(roles.filter(r => r === 'OPERATOR').length).toBe(1);
    });

    it('should handle role removal', () => {
      const user = User.create({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        roles: ['ADMIN', 'OPERATOR'],
      });

      user.removeRole('OPERATOR');

      expect(user.hasRole('ADMIN')).toBe(true);
      expect(user.hasRole('OPERATOR')).toBe(false);
    });
  });
});
