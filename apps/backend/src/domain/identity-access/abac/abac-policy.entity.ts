/**
 * AbacPolicy Entity - Domain Model
 * T222: Phase 10 - ABAC Policy Engine
 *
 * Represents Attribute-Based Access Control policies for fine-grained authorization
 * Example: "Allow FIR read if user.facility === fir.producerFacility"
 */

export enum AbacPolicyEffect {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
}

export enum AbacOperator {
  EQUALS = 'eq',
  NOT_EQUALS = 'neq',
  IN = 'in',
  NOT_IN = 'not_in',
  GREATER_THAN = 'gt',
  GREATER_THAN_EQUAL = 'gte',
  LESS_THAN = 'lt',
  LESS_THAN_EQUAL = 'lte',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
}

export interface AbacConditionRule {
  attribute: string; // e.g., "user.facility", "resource.producerFacility"
  operator: AbacOperator;
  value: any;
}

export interface AbacConditions {
  operator: 'AND' | 'OR';
  rules: AbacConditionRule[];
}

export interface AbacPolicyProps {
  id: string;
  name: string;
  resourceType: string;
  effect: AbacPolicyEffect;
  conditions: AbacConditions;
  priority: number;
  isActive: boolean;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AbacPolicy {
  private constructor(private readonly props: AbacPolicyProps) {}

  static create(props: Omit<AbacPolicyProps, 'id' | 'createdAt' | 'updatedAt'>): AbacPolicy {
    return new AbacPolicy({
      ...props,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static reconstitute(props: AbacPolicyProps): AbacPolicy {
    return new AbacPolicy(props);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get resourceType(): string {
    return this.props.resourceType;
  }

  get effect(): AbacPolicyEffect {
    return this.props.effect;
  }

  get conditions(): AbacConditions {
    return this.props.conditions;
  }

  get priority(): number {
    return this.props.priority;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get description(): string | undefined {
    return this.props.description;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  deactivate(): void {
    this.props.isActive = false;
    this.props.updatedAt = new Date();
  }

  activate(): void {
    this.props.isActive = true;
    this.props.updatedAt = new Date();
  }

  updatePriority(newPriority: number): void {
    this.props.priority = newPriority;
    this.props.updatedAt = new Date();
  }

  updateConditions(newConditions: AbacConditions): void {
    this.props.conditions = newConditions;
    this.props.updatedAt = new Date();
  }

  toJSON(): AbacPolicyProps {
    return { ...this.props };
  }
}
