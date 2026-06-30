/**
 * User Entity - TDD Tests
 * Cycle: RED → GREEN → REFACTOR
 */

import { User, AuthProvider, UserCreatedEvent } from './user.entity'
import { InvalidEmailError } from '../../../core/domain/errors'

describe('User Entity', () => {
  describe('create', () => {
    it('should create user with valid email', () => {
      const user = User.create({
        email: 'marco@officina.it',
        fiscalNumber: 'FRRMRC80A01H501U',
        firstName: 'Marco',
        lastName: 'Ferri',
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('marco@officina.it')
      expect(user.fiscalNumber).toBe('FRRMRC80A01H501U')
      expect(user.firstName).toBe('Marco')
      expect(user.lastName).toBe('Ferri')
      expect(user.authProvider).toBe(AuthProvider.SPID)
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user.isDeleted).toBe(false)
    })

    it('should throw InvalidEmailError for invalid email', () => {
      expect(() =>
        User.create({
          email: 'invalid-email',
        })
      ).toThrow(InvalidEmailError)
    })

    it('should hash password when provided for LOCAL auth', () => {
      const user = User.create({
        email: 'test@example.com',
        password: 'plainPassword123',
        authProvider: AuthProvider.LOCAL,
      })

      // Password should be hashed
      expect(user.verifyPassword('plainPassword123')).toBe(true)
      expect(user.verifyPassword('wrongPassword')).toBe(false)
    })

    it('should emit UserCreatedEvent on creation', () => {
      const user = User.create({
        email: 'test@example.com',
      })

      const events = user.domainEvents
      expect(events.length).toBe(1)
      expect(events[0]).toBeInstanceOf(UserCreatedEvent)
      expect((events[0] as UserCreatedEvent).userId).toBe(user.id)
      expect((events[0] as UserCreatedEvent).email).toBe('test@example.com')
    })

    it('should default to SPID auth provider', () => {
      const user = User.create({
        email: 'test@example.com',
      })

      expect(user.authProvider).toBe(AuthProvider.SPID)
    })

    it('should store SPID level when provided', () => {
      const user = User.create({
        email: 'test@example.com',
        spidLevel: 'https://www.spid.gov.it/SpidL2',
      })

      expect(user.spidLevel).toBe('https://www.spid.gov.it/SpidL2')
    })
  })

  describe('reconstitute', () => {
    it('should reconstitute user from persistence', () => {
      const props = {
        id: 'existing-uuid',
        email: 'test@example.com',
        fiscalNumber: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        authProvider: AuthProvider.SPID,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-15'),
      }

      const user = User.reconstitute(props)

      expect(user.id).toBe('existing-uuid')
      expect(user.email).toBe('test@example.com')
      expect(user.fiscalNumber).toBe('RSSMRA80A01H501U')
      expect(user.createdAt).toEqual(new Date('2025-01-01'))
      expect(user.domainEvents.length).toBe(0) // No events on reconstitute
    })
  })

  describe('updateProfile', () => {
    it('should update firstName and lastName', () => {
      const user = User.create({
        email: 'test@example.com',
        firstName: 'OldFirst',
        lastName: 'OldLast',
      })

      const _originalUpdatedAt = user.updatedAt

      // Wait a bit to ensure timestamp changes
      const beforeUpdate = new Date()
      user.updateProfile('NewFirst', 'NewLast')

      expect(user.firstName).toBe('NewFirst')
      expect(user.lastName).toBe('NewLast')
      expect(user.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime())
    })
  })

  describe('softDelete', () => {
    it('should mark user as deleted (GDPR compliance)', () => {
      const user = User.create({
        email: 'test@example.com',
      })

      expect(user.isDeleted).toBe(false)
      expect(user.deletedAt).toBeNull()

      user.softDelete()

      expect(user.isDeleted).toBe(true)
      expect(user.deletedAt).toBeInstanceOf(Date)
    })

    it('should update updatedAt timestamp on soft delete', () => {
      const user = User.create({
        email: 'test@example.com',
      })

      const _originalUpdatedAt = user.updatedAt
      const beforeDelete = new Date()

      user.softDelete()

      expect(user.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime())
    })
  })

  describe('verifyPassword', () => {
    it('should return true for correct password', () => {
      const user = User.create({
        email: 'test@example.com',
        password: 'correctPassword123',
        authProvider: AuthProvider.LOCAL,
      })

      expect(user.verifyPassword('correctPassword123')).toBe(true)
    })

    it('should return false for incorrect password', () => {
      const user = User.create({
        email: 'test@example.com',
        password: 'correctPassword123',
        authProvider: AuthProvider.LOCAL,
      })

      expect(user.verifyPassword('wrongPassword')).toBe(false)
    })

    it('should return false when no password is set (SPID users)', () => {
      const user = User.create({
        email: 'test@example.com',
        authProvider: AuthProvider.SPID,
      })

      expect(user.verifyPassword('anyPassword')).toBe(false)
    })
  })

  describe('clearDomainEvents', () => {
    it('should clear domain events after processing', () => {
      const user = User.create({
        email: 'test@example.com',
      })

      expect(user.domainEvents.length).toBe(1)

      user.clearDomainEvents()

      expect(user.domainEvents.length).toBe(0)
    })
  })
})
