/**
 * User Entity - Domain Model
 * Aggregate Root per Auth domain
 * TDD Implementation
 */

import { AggregateRoot, DomainEvent } from '../../../core/domain/aggregate-root'
import { Email } from '../value-objects/email'
import * as bcrypt from 'bcrypt'

export enum UserRole {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  CONSULTANT_ADMIN = 'CONSULTANT_ADMIN',
  MOBILE_OPERATOR = 'MOBILE_OPERATOR',
}

export enum AuthProvider {
  SPID = 'SPID',
  CIE = 'CIE',
  LOCAL = 'LOCAL',
}

export interface CreateUserProps {
  email: string
  fiscalNumber?: string
  firstName?: string
  lastName?: string
  password?: string
  authProvider?: AuthProvider
  spidLevel?: string
}

export interface UserProps extends CreateUserProps {
  id: string
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export class UserCreatedEvent implements DomainEvent {
  readonly occurredOn: Date
  readonly eventName = 'user.created'

  constructor(
    public readonly userId: string,
    public readonly email: string
  ) {
    this.occurredOn = new Date()
  }
}

export class User extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _email: Email,
    private _fiscalNumber: string | null,
    private _firstName: string | null,
    private _lastName: string | null,
    private _password: string | null,
    private _authProvider: AuthProvider,
    private _spidLevel: string | null,
    private _createdAt: Date,
    private _updatedAt: Date,
    private _deletedAt: Date | null
  ) {
    super()
  }

  static create(props: CreateUserProps): User {
    const email = Email.create(props.email)
    const now = new Date()

    // Hash password if provided (for LOCAL auth)
    let hashedPassword: string | null = null
    if (props.password) {
      hashedPassword = bcrypt.hashSync(props.password, 10)
    }

    const user = new User(
      this.generateId(),
      email,
      props.fiscalNumber || null,
      props.firstName || null,
      props.lastName || null,
      hashedPassword,
      props.authProvider || AuthProvider.SPID,
      props.spidLevel || null,
      now,
      now,
      null
    )

    // Emit domain event
    user.addDomainEvent(new UserCreatedEvent(user.id, email.getValue()))

    return user
  }

  static reconstitute(props: UserProps): User {
    return new User(
      props.id,
      Email.create(props.email),
      props.fiscalNumber || null,
      props.firstName || null,
      props.lastName || null,
      props.password || null,
      props.authProvider || AuthProvider.SPID,
      props.spidLevel || null,
      props.createdAt,
      props.updatedAt,
      props.deletedAt || null
    )
  }

  // Password verification for LOCAL auth
  verifyPassword(plainPassword: string): boolean {
    if (!this._password) {
      return false
    }
    return bcrypt.compareSync(plainPassword, this._password)
  }

  // Update methods
  updateProfile(firstName: string, lastName: string): void {
    this._firstName = firstName
    this._lastName = lastName
    this._updatedAt = new Date()
  }

  // Soft delete for GDPR
  softDelete(): void {
    this._deletedAt = new Date()
    this._updatedAt = new Date()
  }

  // Getters
  get id(): string {
    return this._id
  }

  get email(): string {
    return this._email.getValue()
  }

  get fiscalNumber(): string | null {
    return this._fiscalNumber
  }

  get firstName(): string | null {
    return this._firstName
  }

  get lastName(): string | null {
    return this._lastName
  }

  get authProvider(): AuthProvider {
    return this._authProvider
  }

  get spidLevel(): string | null {
    return this._spidLevel
  }

  get createdAt(): Date {
    return this._createdAt
  }

  get updatedAt(): Date {
    return this._updatedAt
  }

  get deletedAt(): Date | null {
    return this._deletedAt
  }

  get isDeleted(): boolean {
    return this._deletedAt !== null
  }

  private static generateId(): string {
    // Simple UUID v4 generation (in production use uuid library)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}
