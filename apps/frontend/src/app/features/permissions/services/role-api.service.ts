import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'

/**
 * RoleApiService
 * HTTP client for role-related API endpoints
 * Per plan.md: Frontend service layer for role operations
 */
@Injectable({
  providedIn: 'root',
})
export class RoleApiService {
  private readonly baseUrl = '/api/v1/roles'
  private readonly userRolesUrl = '/api/v1/user-roles'

  constructor(private http: HttpClient) {}

  /**
   * GET /api/v1/roles
   * List all roles for current tenant
   */
  listRoles(): Observable<RolesResponse> {
    return this.http.get<RolesResponse>(this.baseUrl)
  }

  /**
   * GET /api/v1/roles/:id
   * Get role details with permissions
   */
  getRoleById(roleId: string): Observable<RoleDetailResponse> {
    return this.http.get<RoleDetailResponse>(`${this.baseUrl}/${roleId}`)
  }

  /**
   * GET /api/v1/user-roles/user/:userId
   * Get all role assignments for a user
   */
  getUserRoles(userId: string): Observable<UserRolesResponse> {
    return this.http.get<UserRolesResponse>(`${this.userRolesUrl}/user/${userId}`)
  }

  /**
   * POST /api/v1/user-roles/assign
   * Assign a role to a user
   */
  assignRole(dto: AssignRoleDto): Observable<UserRoleAssignment> {
    return this.http.post<UserRoleAssignment>(`${this.userRolesUrl}/assign`, dto)
  }

  /**
   * DELETE /api/v1/user-roles/:id
   * Revoke a role assignment
   */
  revokeRole(userRoleId: string): Observable<void> {
    return this.http.delete<void>(`${this.userRolesUrl}/${userRoleId}`)
  }

  /**
   * T178: Custom Role CRUD Operations
   * POST /api/v1/roles
   * Create custom role (enterprise only)
   */
  createCustomRole(dto: CreateCustomRoleDto): Observable<CustomRoleResponse> {
    return this.http.post<CustomRoleResponse>(this.baseUrl, dto)
  }

  /**
   * PUT /api/v1/roles/:id
   * Update custom role
   */
  updateCustomRole(roleId: string, dto: UpdateCustomRoleDto): Observable<CustomRoleResponse> {
    return this.http.put<CustomRoleResponse>(`${this.baseUrl}/${roleId}`, dto)
  }

  /**
   * DELETE /api/v1/roles/:id
   * Delete custom role
   */
  deleteCustomRole(roleId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${roleId}`)
  }

  /**
   * Alias methods for component compatibility
   */
  getRole(roleId: string): Observable<RoleDetailResponse> {
    return this.getRoleById(roleId)
  }

  createRole(dto: CreateCustomRoleDto): Observable<CustomRoleResponse> {
    return this.createCustomRole(dto)
  }

  updateRole(roleId: string, dto: UpdateCustomRoleDto): Observable<CustomRoleResponse> {
    return this.updateCustomRole(roleId, dto)
  }

  deleteRole(roleId: string): Observable<void> {
    return this.deleteCustomRole(roleId)
  }

  /**
   * POST /api/v1/roles/:id/permissions
   * Add permissions to custom role
   */
  addPermissionsToRole(roleId: string, permissions: string[]): Observable<AddPermissionsResponse> {
    return this.http.post<AddPermissionsResponse>(`${this.baseUrl}/${roleId}/permissions`, {
      permissions,
    })
  }

  /**
   * DELETE /api/v1/roles/:id/permissions/:permissionId
   * Remove permission from custom role
   */
  removePermissionFromRole(
    roleId: string,
    permissionId: string
  ): Observable<RemovePermissionResponse> {
    return this.http.delete<RemovePermissionResponse>(
      `${this.baseUrl}/${roleId}/permissions/${permissionId}`
    )
  }
}

/**
 * Response interfaces
 */
export interface RolesResponse {
  roles: Role[]
}

export interface Role {
  id: string
  name: string
  description: string | null
  isSystemRole: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface RoleDetailResponse extends Role {
  permissions: PermissionDetail[]
}

export interface PermissionDetail {
  id: string
  permission: string
  description: string
  isSensitive: boolean
  module: string
}

export interface UserRolesResponse {
  userRoles: UserRoleAssignment[]
}

export interface UserRoleAssignment {
  id: string
  userId: string
  roleId: string
  assignedBy: string
  assignedAt: string
  expiresAt: string | null
  facilityIds: string[] | null
  isDelegated: boolean
  isActive: boolean
}

export interface AssignRoleDto {
  userId: string
  roleId: string
  expiresAt?: string
  facilityIds?: string[]
  isDelegated?: boolean
  delegationReason?: string
  replaceExisting?: boolean
}

/**
 * T178: Custom Role DTOs
 */
export interface CreateCustomRoleDto {
  name: string
  description: string
  permissions: string[]
}

export interface UpdateCustomRoleDto {
  name?: string
  description?: string
  permissions?: string[]
}

export interface CustomRoleResponse {
  success: boolean
  data: {
    id: string
    name: string
    description: string
    permissions: string[]
    isCustom: boolean
    createdBy?: string
    createdAt?: string
    updatedAt?: string
  }
}

export interface AddPermissionsResponse {
  success: boolean
  data: {
    id: string
    permissions: string[]
    addedCount: number
  }
}

export interface RemovePermissionResponse {
  success: boolean
  data: {
    id: string
    permissions: string[]
    removedPermission: string
  }
}
