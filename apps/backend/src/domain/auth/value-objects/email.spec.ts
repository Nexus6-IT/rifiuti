/**
 * Email Value Object - TDD Tests
 * Cycle: RED → GREEN → REFACTOR
 */

import { Email } from './email'
import { InvalidEmailError } from '../../../core/domain/errors'

describe('Email Value Object', () => {
  describe('create', () => {
    it('should create valid email', () => {
      const email = Email.create('test@example.com')
      expect(email.getValue()).toBe('test@example.com')
    })

    it('should normalize email to lowercase', () => {
      const email = Email.create('TEST@EXAMPLE.COM')
      expect(email.getValue()).toBe('test@example.com')
    })

    it('should trim whitespace', () => {
      const email = Email.create('  test@example.com  ')
      expect(email.getValue()).toBe('test@example.com')
    })

    it('should throw InvalidEmailError for missing @', () => {
      expect(() => Email.create('invalidemail.com')).toThrow(InvalidEmailError)
    })

    it('should throw InvalidEmailError for missing domain', () => {
      expect(() => Email.create('test@')).toThrow(InvalidEmailError)
    })

    it('should throw InvalidEmailError for empty string', () => {
      expect(() => Email.create('')).toThrow(InvalidEmailError)
    })

    it('should throw InvalidEmailError for spaces in email', () => {
      expect(() => Email.create('test test@example.com')).toThrow(InvalidEmailError)
    })
  })

  describe('equals', () => {
    it('should return true for same email', () => {
      const email1 = Email.create('test@example.com')
      const email2 = Email.create('test@example.com')
      expect(email1.equals(email2)).toBe(true)
    })

    it('should return true for same email with different case', () => {
      const email1 = Email.create('TEST@example.com')
      const email2 = Email.create('test@EXAMPLE.com')
      expect(email1.equals(email2)).toBe(true)
    })

    it('should return false for different emails', () => {
      const email1 = Email.create('test1@example.com')
      const email2 = Email.create('test2@example.com')
      expect(email1.equals(email2)).toBe(false)
    })
  })

  describe('toString', () => {
    it('should return email string', () => {
      const email = Email.create('test@example.com')
      expect(email.toString()).toBe('test@example.com')
    })
  })
})
