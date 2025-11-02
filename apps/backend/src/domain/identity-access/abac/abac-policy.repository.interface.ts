/**
 * AbacPolicyRepository Interface
 * T222-224: Phase 10 - ABAC Policy Engine
 */

import { AbacPolicy } from './abac-policy.entity';

export interface AbacPolicyRepository {
  /**
   * Find all active policies for a resource type
   */
  findActiveByResourceType(resourceType: string): Promise<AbacPolicy[]>;

  /**
   * Find all active policies (for global evaluation)
   */
  findAllActive(): Promise<AbacPolicy[]>;

  /**
   * Save a new policy
   */
  save(policy: AbacPolicy): Promise<void>;

  /**
   * Find policy by ID
   */
  findById(id: string): Promise<AbacPolicy | null>;

  /**
   * Update existing policy
   */
  update(policy: AbacPolicy): Promise<void>;

  /**
   * Delete policy
   */
  delete(id: string): Promise<void>;
}
