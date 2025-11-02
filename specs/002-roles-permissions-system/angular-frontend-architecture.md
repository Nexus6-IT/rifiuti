# Angular Frontend Architecture: Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Created**: 2025-10-31
**Angular Version**: 17+ (Standalone Components)
**State Management**: NgRx SignalStore
**UI Library**: PrimeNG 17

---

## Table of Contents

1. [Component Hierarchy](#1-component-hierarchy)
2. [State Management Architecture](#2-state-management-architecture)
3. [Permission Directive & Pipe System](#3-permission-directive--pipe-system)
4. [Mobile-Responsive Strategy](#4-mobile-responsive-strategy)
5. [PrimeNG Component Integration](#5-primeng-component-integration)
6. [Performance Optimization](#6-performance-optimization)
7. [Type Definitions](#7-type-definitions)
8. [Feature Module Structure](#8-feature-module-structure)

---

## 1. Component Hierarchy

### 1.1 Feature Module Structure

```
features/
  permissions/
    pages/
      permission-management-page.component.ts        # Smart (Container)
      role-management-page.component.ts              # Smart (Container)
      user-roles-page.component.ts                   # Smart (Container)
      my-permissions-page.component.ts               # Smart (Container)
      permission-requests-page.component.ts          # Smart (Container)
      view-as-user-page.component.ts                 # Smart (Container)

    components/
      # Role Components (Presentational)
      role-list.component.ts                         # Display roles table
      role-form.component.ts                         # Create/edit role
      role-card.component.ts                         # Mobile-friendly role card
      role-permission-matrix.component.ts            # Permission matrix builder
      role-preview.component.ts                      # Preview permissions before assign

      # Permission Components (Presentational)
      permission-list.component.ts                   # Display permissions list
      permission-category.component.ts               # Grouped permissions by module
      permission-badge.component.ts                  # Visual permission indicator
      permission-error-dialog.component.ts           # Contextual error messages

      # User Role Assignment (Presentational)
      user-role-list.component.ts                    # User-role associations
      user-role-assignment-wizard.component.ts       # Multi-step role assignment
      user-invite-dialog.component.ts                # Invite with role
      facility-scope-selector.component.ts           # Facility-scoped role selector

      # Temporary Permissions (Presentational)
      temp-permission-request-dialog.component.ts    # Request temporary access
      temp-permission-approval-card.component.ts     # Approve/deny requests
      temp-permission-countdown.component.ts         # Time remaining indicator

      # Audit & Discovery (Presentational)
      permission-audit-log.component.ts              # Audit trail display
      permission-discovery-card.component.ts         # Mobile discovery interface
      permission-tooltip.component.ts                # Inline help tooltips

      # Multi-Tenant (Presentational)
      tenant-role-switcher.component.ts              # Show role per tenant
      consultant-dashboard-widget.component.ts       # Aggregated client view

    directives/
      has-permission.directive.ts                    # *appHasPermission="'fir:create'"
      require-permission.directive.ts                # Disables elements
      permission-tooltip.directive.ts                # Auto-tooltip on disabled

    pipes/
      has-permission.pipe.ts                         # {{ 'fir:create' | hasPermission }}
      permission-label.pipe.ts                       # Format permission strings
      role-name.pipe.ts                              # Format role names

    services/
      permission.service.ts                          # Permission API calls
      role.service.ts                                # Role CRUD operations
      permission-cache.service.ts                    # Local permission cache
      permission-check.service.ts                    # Client-side checks

    guards/
      permission.guard.ts                            # Route protection
      role.guard.ts                                  # Role-based routing

    stores/
      permission.store.ts                            # NgRx SignalStore
      role.store.ts                                  # NgRx SignalStore
      temp-permission.store.ts                       # NgRx SignalStore
```

---

## 2. State Management Architecture

### 2.1 NgRx SignalStore - Permission Store

**File**: `features/permissions/stores/permission.store.ts`

```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, debounceTime } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { PermissionService } from '../services/permission.service';

// State Interface
interface PermissionState {
  // Current user's permissions
  userPermissions: Permission[];

  // Tenant-specific permissions (for consultants)
  tenantPermissions: Record<string, Permission[]>;

  // Current tenant context
  currentTenantId: string | null;

  // Permission check cache
  permissionCache: Map<string, boolean>;

  // Loading states
  isLoading: boolean;
  isRefreshing: boolean;

  // Last sync timestamp
  lastSyncedAt: Date | null;

  // Error state
  error: string | null;
}

// Initial State
const initialState: PermissionState = {
  userPermissions: [],
  tenantPermissions: {},
  currentTenantId: null,
  permissionCache: new Map(),
  isLoading: false,
  isRefreshing: false,
  lastSyncedAt: null,
  error: null,
};

export const PermissionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  // Computed Signals - Fine-grained reactivity
  withComputed((store) => ({
    // Get effective permissions for current tenant
    effectivePermissions: computed(() => {
      const tenantId = store.currentTenantId();
      if (!tenantId) return store.userPermissions();

      return store.tenantPermissions()[tenantId] || [];
    }),

    // Check if permissions are stale (>1 hour old)
    isStale: computed(() => {
      const lastSynced = store.lastSyncedAt();
      if (!lastSynced) return true;

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return lastSynced < oneHourAgo;
    }),

    // Grouped permissions by module
    permissionsByModule: computed(() => {
      const permissions = store.effectivePermissions();
      return permissions.reduce((acc, permission) => {
        const [module] = permission.resource.split(':');
        if (!acc[module]) acc[module] = [];
        acc[module].push(permission);
        return acc;
      }, {} as Record<string, Permission[]>);
    }),

    // Count of high-sensitivity permissions
    sensitivePermissionCount: computed(() => {
      return store.effectivePermissions().filter(p => p.sensitivity === 'HIGH').length;
    }),
  })),

  // Methods - State mutations and API calls
  withMethods((store, permissionService = inject(PermissionService)) => ({
    // Load user permissions
    loadUserPermissions: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          permissionService.getUserPermissions().pipe(
            tapResponse({
              next: (permissions) => {
                patchState(store, {
                  userPermissions: permissions,
                  lastSyncedAt: new Date(),
                  isLoading: false,
                  error: null,
                });

                // Update cache
                store.rebuildCache();
              },
              error: (error: Error) => {
                patchState(store, {
                  error: error.message,
                  isLoading: false,
                });
              },
            })
          )
        )
      )
    ),

    // Load permissions for specific tenant (consultant multi-tenant)
    loadTenantPermissions: rxMethod<string>(
      pipe(
        debounceTime(100), // Prevent rapid tenant switches
        tap(() => patchState(store, { isRefreshing: true, error: null })),
        switchMap((tenantId) =>
          permissionService.getTenantPermissions(tenantId).pipe(
            tapResponse({
              next: (permissions) => {
                const tenantPermissions = { ...store.tenantPermissions() };
                tenantPermissions[tenantId] = permissions;

                patchState(store, {
                  tenantPermissions,
                  currentTenantId: tenantId,
                  lastSyncedAt: new Date(),
                  isRefreshing: false,
                  error: null,
                });

                store.rebuildCache();
              },
              error: (error: Error) => {
                patchState(store, {
                  error: error.message,
                  isRefreshing: false,
                });
              },
            })
          )
        )
      )
    ),

    // Fast permission check (uses cache)
    hasPermission(permission: string): boolean {
      const cache = store.permissionCache();

      // Check cache first
      if (cache.has(permission)) {
        return cache.get(permission)!;
      }

      // Compute and cache
      const hasPermission = store.effectivePermissions().some(p => {
        const permissionString = `${p.resource}:${p.action}:${p.scope}`;
        return permissionString === permission || this.matchesWildcard(permissionString, permission);
      });

      cache.set(permission, hasPermission);
      return hasPermission;
    },

    // Check multiple permissions (AND logic)
    hasAllPermissions(permissions: string[]): boolean {
      return permissions.every(p => this.hasPermission(p));
    },

    // Check multiple permissions (OR logic)
    hasAnyPermission(permissions: string[]): boolean {
      return permissions.some(p => this.hasPermission(p));
    },

    // Rebuild permission cache after permissions change
    rebuildCache(): void {
      patchState(store, { permissionCache: new Map() });
    },

    // Invalidate cache (call after permission changes via WebSocket)
    invalidateCache(): void {
      patchState(store, {
        permissionCache: new Map(),
        lastSyncedAt: null,
      });
    },

    // Switch tenant context (for consultants)
    switchTenant(tenantId: string): void {
      patchState(store, { currentTenantId: tenantId });
      this.loadTenantPermissions(tenantId);
    },

    // Wildcard matching helper
    matchesWildcard(permissionString: string, pattern: string): boolean {
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return regex.test(permissionString);
    },
  }))
);

// Types
export interface Permission {
  id: string;
  resource: string; // e.g., 'fir', 'facility', 'report'
  action: string;   // e.g., 'create', 'read', 'update', 'delete'
  scope: string;    // e.g., 'own', 'facility', 'all'
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}
```

### 2.2 NgRx SignalStore - Role Store

**File**: `features/permissions/stores/role.store.ts`

```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { RoleService } from '../services/role.service';

interface RoleState {
  // All roles in current tenant
  roles: Role[];

  // Selected role for editing
  selectedRole: Role | null;

  // User-role assignments
  userRoles: UserRole[];

  // Loading states
  isLoading: boolean;
  isSaving: boolean;

  // Filter state
  filterText: string;
  filterType: 'all' | 'system' | 'custom';

  // Error state
  error: string | null;
}

const initialState: RoleState = {
  roles: [],
  selectedRole: null,
  userRoles: [],
  isLoading: false,
  isSaving: false,
  filterText: '',
  filterType: 'all',
  error: null,
};

export const RoleStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((store) => ({
    // Filtered roles based on search and type
    filteredRoles: computed(() => {
      let roles = store.roles();

      // Filter by type
      if (store.filterType() === 'system') {
        roles = roles.filter(r => r.isSystemRole);
      } else if (store.filterType() === 'custom') {
        roles = roles.filter(r => !r.isSystemRole);
      }

      // Filter by text
      const filterText = store.filterText().toLowerCase();
      if (filterText) {
        roles = roles.filter(r =>
          r.name.toLowerCase().includes(filterText) ||
          r.description.toLowerCase().includes(filterText)
        );
      }

      return roles;
    }),

    // Roles grouped by type
    rolesByType: computed(() => {
      const roles = store.roles();
      return {
        system: roles.filter(r => r.isSystemRole),
        custom: roles.filter(r => !r.isSystemRole),
      };
    }),

    // Permission count per role
    permissionCounts: computed(() => {
      return store.roles().reduce((acc, role) => {
        acc[role.id] = role.permissions.length;
        return acc;
      }, {} as Record<string, number>);
    }),

    // Users count per role
    userCounts: computed(() => {
      const userRoles = store.userRoles();
      return userRoles.reduce((acc, ur) => {
        acc[ur.roleId] = (acc[ur.roleId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }),
  })),

  withMethods((store, roleService = inject(RoleService)) => ({
    // Load all roles
    loadRoles: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          roleService.getRoles().pipe(
            tapResponse({
              next: (roles) => {
                patchState(store, { roles, isLoading: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isLoading: false });
              },
            })
          )
        )
      )
    ),

    // Load user-role assignments
    loadUserRoles: rxMethod<void>(
      pipe(
        switchMap(() =>
          roleService.getUserRoles().pipe(
            tapResponse({
              next: (userRoles) => {
                patchState(store, { userRoles });
              },
              error: (error: Error) => {
                console.error('Failed to load user roles', error);
              },
            })
          )
        )
      )
    ),

    // Create new role
    createRole: rxMethod<CreateRoleDTO>(
      pipe(
        tap(() => patchState(store, { isSaving: true, error: null })),
        switchMap((dto) =>
          roleService.createRole(dto).pipe(
            tapResponse({
              next: (role) => {
                const roles = [...store.roles(), role];
                patchState(store, { roles, isSaving: false, selectedRole: null });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSaving: false });
              },
            })
          )
        )
      )
    ),

    // Update existing role
    updateRole: rxMethod<{ id: string; dto: UpdateRoleDTO }>(
      pipe(
        tap(() => patchState(store, { isSaving: true, error: null })),
        switchMap(({ id, dto }) =>
          roleService.updateRole(id, dto).pipe(
            tapResponse({
              next: (updatedRole) => {
                const roles = store.roles().map(r => r.id === id ? updatedRole : r);
                patchState(store, { roles, isSaving: false, selectedRole: null });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSaving: false });
              },
            })
          )
        )
      )
    ),

    // Delete role
    deleteRole: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { isSaving: true, error: null })),
        switchMap((id) =>
          roleService.deleteRole(id).pipe(
            tapResponse({
              next: () => {
                const roles = store.roles().filter(r => r.id !== id);
                patchState(store, { roles, isSaving: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSaving: false });
              },
            })
          )
        )
      )
    ),

    // Assign role to user
    assignRole: rxMethod<AssignRoleDTO>(
      pipe(
        tap(() => patchState(store, { isSaving: true, error: null })),
        switchMap((dto) =>
          roleService.assignRole(dto).pipe(
            tapResponse({
              next: (userRole) => {
                const userRoles = [...store.userRoles(), userRole];
                patchState(store, { userRoles, isSaving: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSaving: false });
              },
            })
          )
        )
      )
    ),

    // Update filter
    setFilter(filterText: string, filterType: 'all' | 'system' | 'custom'): void {
      patchState(store, { filterText, filterType });
    },

    // Select role for editing
    selectRole(role: Role | null): void {
      patchState(store, { selectedRole: role });
    },
  }))
);

// Types
export interface Role {
  id: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  facilityIds: string[] | null;
  expiresAt: Date | null;
  assignedBy: string;
  assignedAt: Date;
}

export interface CreateRoleDTO {
  name: string;
  description: string;
  permissionIds: string[];
}

export interface UpdateRoleDTO {
  name?: string;
  description?: string;
  permissionIds?: string[];
}

export interface AssignRoleDTO {
  userId: string;
  roleId: string;
  facilityIds?: string[];
  expiresAt?: Date;
}
```

### 2.3 NgRx SignalStore - Temporary Permission Store

**File**: `features/permissions/stores/temp-permission.store.ts`

```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, interval } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { PermissionService } from '../services/permission.service';

interface TempPermissionState {
  // Pending requests (for admins)
  pendingRequests: TempPermissionRequest[];

  // User's active grants
  activeGrants: TempPermissionGrant[];

  // User's request history
  requestHistory: TempPermissionRequest[];

  // Loading states
  isLoading: boolean;
  isSubmitting: boolean;

  // Current time (for countdown)
  currentTime: Date;

  error: string | null;
}

const initialState: TempPermissionState = {
  pendingRequests: [],
  activeGrants: [],
  requestHistory: [],
  isLoading: false,
  isSubmitting: false,
  currentTime: new Date(),
  error: null,
};

export const TempPermissionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((store) => ({
    // Grants expiring soon (within 1 hour)
    expiringSoon: computed(() => {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      return store.activeGrants().filter(g => new Date(g.expiresAt) < oneHourFromNow);
    }),

    // Count of pending requests (for badge)
    pendingCount: computed(() => store.pendingRequests().length),

    // Time remaining for each grant
    grantTimeRemaining: computed(() => {
      const currentTime = store.currentTime();
      return store.activeGrants().reduce((acc, grant) => {
        const remaining = new Date(grant.expiresAt).getTime() - currentTime.getTime();
        acc[grant.id] = Math.max(0, remaining);
        return acc;
      }, {} as Record<string, number>);
    }),
  })),

  withMethods((store, permissionService = inject(PermissionService)) => ({
    // Load pending requests (admin view)
    loadPendingRequests: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          permissionService.getPendingRequests().pipe(
            tapResponse({
              next: (requests) => {
                patchState(store, { pendingRequests: requests, isLoading: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isLoading: false });
              },
            })
          )
        )
      )
    ),

    // Load user's active grants
    loadActiveGrants: rxMethod<void>(
      pipe(
        switchMap(() =>
          permissionService.getActiveGrants().pipe(
            tapResponse({
              next: (grants) => {
                patchState(store, { activeGrants: grants });
              },
              error: (error: Error) => {
                console.error('Failed to load active grants', error);
              },
            })
          )
        )
      )
    ),

    // Request temporary permission
    requestPermission: rxMethod<TempPermissionRequestDTO>(
      pipe(
        tap(() => patchState(store, { isSubmitting: true, error: null })),
        switchMap((dto) =>
          permissionService.requestTempPermission(dto).pipe(
            tapResponse({
              next: (request) => {
                const requestHistory = [...store.requestHistory(), request];
                patchState(store, { requestHistory, isSubmitting: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSubmitting: false });
              },
            })
          )
        )
      )
    ),

    // Approve request (admin action)
    approveRequest: rxMethod<{ requestId: string; durationHours: number }>(
      pipe(
        tap(() => patchState(store, { isSubmitting: true, error: null })),
        switchMap(({ requestId, durationHours }) =>
          permissionService.approveTempPermission(requestId, durationHours).pipe(
            tapResponse({
              next: () => {
                const pendingRequests = store.pendingRequests().filter(r => r.id !== requestId);
                patchState(store, { pendingRequests, isSubmitting: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSubmitting: false });
              },
            })
          )
        )
      )
    ),

    // Deny request (admin action)
    denyRequest: rxMethod<{ requestId: string; reason: string }>(
      pipe(
        tap(() => patchState(store, { isSubmitting: true, error: null })),
        switchMap(({ requestId, reason }) =>
          permissionService.denyTempPermission(requestId, reason).pipe(
            tapResponse({
              next: () => {
                const pendingRequests = store.pendingRequests().filter(r => r.id !== requestId);
                patchState(store, { pendingRequests, isSubmitting: false });
              },
              error: (error: Error) => {
                patchState(store, { error: error.message, isSubmitting: false });
              },
            })
          )
        )
      )
    ),

    // Start countdown timer (updates currentTime every second)
    startCountdown(): void {
      interval(1000).subscribe(() => {
        patchState(store, { currentTime: new Date() });
      });
    },

    // Remove expired grants from active list
    removeExpiredGrants(): void {
      const now = new Date();
      const activeGrants = store.activeGrants().filter(g => new Date(g.expiresAt) > now);
      patchState(store, { activeGrants });
    },
  }))
);

// Types
export interface TempPermissionRequest {
  id: string;
  userId: string;
  userName: string;
  permissionsRequested: string[];
  justification: string;
  requestedDurationHours: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  createdAt: Date;
}

export interface TempPermissionGrant {
  id: string;
  userId: string;
  permissions: string[];
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date;
  justification: string;
}

export interface TempPermissionRequestDTO {
  permissionsRequested: string[];
  justification: string;
  durationHours: number;
}
```

---

## 3. Permission Directive & Pipe System

### 3.1 Structural Directive - `*appHasPermission`

**File**: `features/permissions/directives/has-permission.directive.ts`

```typescript
import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  inject,
  OnInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { PermissionStore } from '../stores/permission.store';

/**
 * Structural directive for permission-based rendering
 *
 * Usage:
 * <button *appHasPermission="'fir:create:all'">Create FIR</button>
 * <div *appHasPermission="['fir:read', 'fir:update']; requireAll: true">...</div>
 * <div *appHasPermission="'admin:*'; else noAccess">Admin Panel</div>
 *
 * Performance: Uses signal-based reactivity - only re-renders when permissions change
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnInit, OnDestroy {
  private readonly templateRef = inject(TemplateRef<any>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly permissionStore = inject(PermissionStore);

  private hasView = false;
  private effectRef: any;

  @Input('appHasPermission') permission!: string | string[];
  @Input('appHasPermissionRequireAll') requireAll = false; // AND vs OR logic
  @Input('appHasPermissionElse') elseTemplate?: TemplateRef<any>;

  ngOnInit(): void {
    // Use effect for automatic reactivity when permissions change
    this.effectRef = effect(() => {
      const hasPermission = this.checkPermission();
      this.updateView(hasPermission);
    });
  }

  ngOnDestroy(): void {
    if (this.effectRef) {
      this.effectRef.destroy();
    }
  }

  private checkPermission(): boolean {
    if (Array.isArray(this.permission)) {
      return this.requireAll
        ? this.permissionStore.hasAllPermissions(this.permission)
        : this.permissionStore.hasAnyPermission(this.permission);
    }

    return this.permissionStore.hasPermission(this.permission);
  }

  private updateView(hasPermission: boolean): void {
    if (hasPermission) {
      if (!this.hasView) {
        this.viewContainer.clear();
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      }
    } else {
      if (this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }

      if (this.elseTemplate && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.elseTemplate);
      }
    }
  }
}
```

### 3.2 Attribute Directive - `appRequirePermission`

**File**: `features/permissions/directives/require-permission.directive.ts`

```typescript
import {
  Directive,
  Input,
  ElementRef,
  Renderer2,
  inject,
  OnInit,
  effect,
} from '@angular/core';
import { PermissionStore } from '../stores/permission.store';

/**
 * Attribute directive for disabling elements based on permissions
 *
 * Usage:
 * <button appRequirePermission="'fir:delete'">Delete</button>
 * <p-button appRequirePermission="'report:export'" label="Export" />
 *
 * Behavior:
 * - Adds 'disabled' attribute if permission not granted
 * - Adds CSS class 'permission-disabled'
 * - Prevents click events
 * - Can show tooltip explaining why disabled (via companion directive)
 */
@Directive({
  selector: '[appRequirePermission]',
  standalone: true,
  host: {
    '(click)': 'onClick($event)',
  },
})
export class RequirePermissionDirective implements OnInit {
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly permissionStore = inject(PermissionStore);

  @Input('appRequirePermission') permission!: string;

  private hasPermission = false;

  ngOnInit(): void {
    effect(() => {
      this.hasPermission = this.permissionStore.hasPermission(this.permission);
      this.updateElementState();
    });
  }

  private updateElementState(): void {
    if (this.hasPermission) {
      this.renderer.removeAttribute(this.el.nativeElement, 'disabled');
      this.renderer.removeClass(this.el.nativeElement, 'permission-disabled');
      this.renderer.setStyle(this.el.nativeElement, 'opacity', '1');
      this.renderer.setStyle(this.el.nativeElement, 'pointer-events', 'auto');
    } else {
      this.renderer.setAttribute(this.el.nativeElement, 'disabled', 'true');
      this.renderer.addClass(this.el.nativeElement, 'permission-disabled');
      this.renderer.setStyle(this.el.nativeElement, 'opacity', '0.5');
      this.renderer.setStyle(this.el.nativeElement, 'cursor', 'not-allowed');
    }
  }

  onClick(event: Event): void {
    if (!this.hasPermission) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}
```

### 3.3 Permission Check Pipe

**File**: `features/permissions/pipes/has-permission.pipe.ts`

```typescript
import { Pipe, PipeTransform, inject } from '@angular/core';
import { PermissionStore } from '../stores/permission.store';

/**
 * Pipe for permission checks in templates
 *
 * Usage:
 * <div *ngIf="'fir:create' | hasPermission">...</div>
 * <button [disabled]="!('fir:delete' | hasPermission)">Delete</button>
 *
 * Performance: Pure pipe with signal-based memoization
 */
@Pipe({
  name: 'hasPermission',
  standalone: true,
  pure: true, // Pure pipe - Angular handles caching
})
export class HasPermissionPipe implements PipeTransform {
  private readonly permissionStore = inject(PermissionStore);

  transform(permission: string | string[], requireAll = false): boolean {
    if (Array.isArray(permission)) {
      return requireAll
        ? this.permissionStore.hasAllPermissions(permission)
        : this.permissionStore.hasAnyPermission(permission);
    }

    return this.permissionStore.hasPermission(permission);
  }
}
```

### 3.4 Permission Tooltip Directive

**File**: `features/permissions/directives/permission-tooltip.directive.ts`

```typescript
import {
  Directive,
  Input,
  ElementRef,
  Renderer2,
  inject,
  OnInit,
  effect,
} from '@angular/core';
import { Tooltip } from 'primeng/tooltip';
import { PermissionStore } from '../stores/permission.store';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Auto-tooltip directive for disabled permission elements
 *
 * Usage:
 * <button
 *   appRequirePermission="'fir:delete'"
 *   appPermissionTooltip
 * >Delete</button>
 *
 * Behavior:
 * - Shows tooltip only when element disabled due to permissions
 * - Explains: current role, required permission, who to contact
 * - Mobile-friendly: works with touch events
 */
@Directive({
  selector: '[appPermissionTooltip]',
  standalone: true,
  hostDirectives: [Tooltip], // Compose PrimeNG Tooltip
})
export class PermissionTooltipDirective implements OnInit {
  private readonly el = inject(ElementRef);
  private readonly tooltip = inject(Tooltip);
  private readonly permissionStore = inject(PermissionStore);
  private readonly authService = inject(AuthService);

  @Input('appPermissionTooltip') permission?: string;

  ngOnInit(): void {
    effect(() => {
      const hasPermission = this.permission
        ? this.permissionStore.hasPermission(this.permission)
        : true;

      if (!hasPermission) {
        const currentUser = this.authService.currentUser();
        const role = currentUser?.role || 'Unknown';

        this.tooltip.tooltipOptions = {
          tooltipLabel: `Accesso negato: il tuo ruolo (${role}) non permette questa azione. Contatta l'amministratore.`,
          tooltipPosition: 'top',
          showDelay: 300,
          hideDelay: 300,
          tooltipStyleClass: 'permission-tooltip',
        };
      } else {
        this.tooltip.tooltipOptions = { tooltipLabel: '' };
      }
    });
  }
}
```

---

## 4. Mobile-Responsive Strategy

### 4.1 Breakpoint Configuration

**File**: `features/permissions/config/breakpoints.config.ts`

```typescript
/**
 * Responsive breakpoints for permission UI
 *
 * Mobile-first approach:
 * - xs: 0-575px (mobile portrait)
 * - sm: 576-767px (mobile landscape, small tablets)
 * - md: 768-991px (tablets)
 * - lg: 992-1199px (desktop)
 * - xl: 1200px+ (large desktop)
 */
export const PERMISSION_BREAKPOINTS = {
  xs: 0,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
} as const;

/**
 * Touch target sizes (WCAG 2.1 Level AAA compliance)
 * Minimum 48x48px for mobile touch targets
 */
export const TOUCH_TARGETS = {
  minimum: 48, // WCAG AA
  recommended: 56, // Material Design
  comfortable: 64, // Extra spacing
} as const;

/**
 * Grid configurations per breakpoint
 */
export const GRID_CONFIG = {
  xs: { cols: 1, gap: '1rem' },
  sm: { cols: 2, gap: '1rem' },
  md: { cols: 3, gap: '1.5rem' },
  lg: { cols: 4, gap: '1.5rem' },
  xl: { cols: 4, gap: '2rem' },
} as const;
```

### 4.2 Responsive Service

**File**: `core/services/responsive.service.ts`

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/**
 * Responsive layout service using Angular CDK
 *
 * Provides signal-based reactive breakpoint detection
 * Used throughout permission UI for adaptive layouts
 */
@Injectable({
  providedIn: 'root',
})
export class ResponsiveService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  // Observable breakpoint matches converted to signals
  private readonly breakpoints = toSignal(
    this.breakpointObserver.observe([
      Breakpoints.XSmall,
      Breakpoints.Small,
      Breakpoints.Medium,
      Breakpoints.Large,
      Breakpoints.XLarge,
    ]).pipe(
      map(result => result.breakpoints)
    ),
    { initialValue: {} }
  );

  // Computed signals for each breakpoint
  readonly isXSmall = computed(() => this.breakpoints()[Breakpoints.XSmall] === true);
  readonly isSmall = computed(() => this.breakpoints()[Breakpoints.Small] === true);
  readonly isMedium = computed(() => this.breakpoints()[Breakpoints.Medium] === true);
  readonly isLarge = computed(() => this.breakpoints()[Breakpoints.Large] === true);
  readonly isXLarge = computed(() => this.breakpoints()[Breakpoints.XLarge] === true);

  // Convenience computed signals
  readonly isMobile = computed(() => this.isXSmall() || this.isSmall());
  readonly isTablet = computed(() => this.isMedium());
  readonly isDesktop = computed(() => this.isLarge() || this.isXLarge());

  // Touch device detection
  readonly isTouchDevice = signal(this.detectTouchDevice());

  // Current breakpoint name
  readonly currentBreakpoint = computed(() => {
    if (this.isXSmall()) return 'xs';
    if (this.isSmall()) return 'sm';
    if (this.isMedium()) return 'md';
    if (this.isLarge()) return 'lg';
    return 'xl';
  });

  private detectTouchDevice(): boolean {
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (navigator as any).msMaxTouchPoints > 0
    );
  }
}
```

### 4.3 Mobile Permission Discovery Component

**File**: `features/permissions/components/permission-discovery-card.component.ts`

```typescript
import { Component, Input, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { AccordionModule } from 'primeng/accordion';
import { BadgeModule } from 'primeng/badge';
import { ChipModule } from 'primeng/chip';
import { ButtonModule } from 'primeng/button';
import { ResponsiveService } from '../../../core/services/responsive.service';
import { Permission } from '../stores/permission.store';

/**
 * Mobile-optimized permission discovery card
 *
 * Features:
 * - Touch-friendly accordion (48px+ touch targets)
 * - Categorized permissions by module
 * - Visual permission indicators (icons + color)
 * - Swipe gestures for navigation (future)
 * - Optimized for portrait/landscape orientations
 *
 * Performance:
 * - OnPush change detection
 * - Virtual scrolling for large permission lists
 * - Lazy-loaded accordion panels
 */
@Component({
  selector: 'app-permission-discovery-card',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    AccordionModule,
    BadgeModule,
    ChipModule,
    ButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-card [styleClass]="cardClass()">
      <ng-template pTemplate="header">
        <div class="card-header">
          <h2 class="header-title">{{ title }}</h2>
          <p-badge [value]="totalPermissions()" severity="info" />
        </div>
      </ng-template>

      <ng-template pTemplate="content">
        <!-- Mobile View: Accordion -->
        @if (responsive.isMobile()) {
          <p-accordion
            [multiple]="true"
            [activeIndex]="[0]"
            styleClass="mobile-accordion"
          >
            @for (category of permissionCategories(); track category.module) {
              <p-accordionTab>
                <ng-template pTemplate="header">
                  <div class="accordion-header">
                    <i [class]="category.icon" class="module-icon"></i>
                    <span class="module-name">{{ category.label }}</span>
                    <p-badge [value]="category.permissions.length" />
                  </div>
                </ng-template>

                <ng-template pTemplate="content">
                  <div class="permission-list">
                    @for (permission of category.permissions; track permission.id) {
                      <div class="permission-item">
                        <div class="permission-info">
                          <i [class]="getActionIcon(permission.action)" [style.color]="getSensitivityColor(permission.sensitivity)"></i>
                          <div class="permission-details">
                            <span class="permission-name">{{ formatPermissionName(permission) }}</span>
                            <span class="permission-description">{{ permission.description }}</span>
                          </div>
                        </div>
                        <p-chip
                          [label]="permission.scope"
                          [styleClass]="getScopeClass(permission.scope)"
                        />
                      </div>
                    }
                  </div>
                </ng-template>
              </p-accordionTab>
            }
          </p-accordion>
        }

        <!-- Desktop View: Grid -->
        @if (responsive.isDesktop()) {
          <div class="permission-grid">
            @for (category of permissionCategories(); track category.module) {
              <div class="category-section">
                <div class="category-header">
                  <i [class]="category.icon"></i>
                  <h3>{{ category.label }}</h3>
                  <p-badge [value]="category.permissions.length" />
                </div>

                <div class="permission-list-desktop">
                  @for (permission of category.permissions; track permission.id) {
                    <div class="permission-item-desktop">
                      <i [class]="getActionIcon(permission.action)" [style.color]="getSensitivityColor(permission.sensitivity)"></i>
                      <div class="permission-content">
                        <span class="permission-name">{{ formatPermissionName(permission) }}</span>
                        <span class="permission-description">{{ permission.description }}</span>
                        <p-chip [label]="permission.scope" [styleClass]="getScopeClass(permission.scope)" />
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </ng-template>

      <ng-template pTemplate="footer">
        <div class="card-footer">
          <p-button
            label="Richiedi Permesso Temporaneo"
            icon="pi pi-clock"
            [outlined]="true"
            styleClass="w-full"
            [style.height]="responsive.isMobile() ? '48px' : 'auto'"
            (onClick)="onRequestTempPermission()"
          />
        </div>
      </ng-template>
    </p-card>
  `,
  styles: [`
    /* Base styles */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
    }

    .header-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
    }

    /* Mobile accordion styles */
    :host ::ng-deep .mobile-accordion {
      .p-accordion-header-link {
        min-height: 56px; /* Comfortable touch target */
        padding: 1rem;
      }

      .p-accordion-content {
        padding: 0;
      }
    }

    .accordion-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
    }

    .module-icon {
      font-size: 1.5rem;
      color: var(--primary-color);
    }

    .module-name {
      flex: 1;
      font-weight: 500;
    }

    /* Permission list - Mobile */
    .permission-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .permission-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid var(--surface-border);
      min-height: 56px; /* Comfortable touch target */
      gap: 1rem;
    }

    .permission-item:last-child {
      border-bottom: none;
    }

    .permission-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
    }

    .permission-info i {
      font-size: 1.25rem;
      min-width: 24px;
    }

    .permission-details {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .permission-name {
      font-weight: 500;
      font-size: 0.95rem;
    }

    .permission-description {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    /* Permission grid - Desktop */
    .permission-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .category-section {
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .category-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--surface-50);
      border-bottom: 1px solid var(--surface-border);
    }

    .category-header h3 {
      flex: 1;
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .permission-list-desktop {
      padding: 0.5rem;
    }

    .permission-item-desktop {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 6px;
      transition: background-color 0.2s;
    }

    .permission-item-desktop:hover {
      background: var(--surface-50);
    }

    .permission-item-desktop i {
      font-size: 1.25rem;
      margin-top: 0.25rem;
    }

    .permission-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    /* Scope chips */
    :host ::ng-deep {
      .scope-own {
        background: var(--blue-100);
        color: var(--blue-900);
      }

      .scope-facility {
        background: var(--purple-100);
        color: var(--purple-900);
      }

      .scope-all {
        background: var(--green-100);
        color: var(--green-900);
      }
    }

    /* Footer */
    .card-footer {
      padding: 1rem;
      border-top: 1px solid var(--surface-border);
    }

    /* Responsive card class */
    :host ::ng-deep {
      .mobile-card {
        margin: 0;
        border-radius: 0;
      }

      .desktop-card {
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
    }
  `],
})
export class PermissionDiscoveryCardComponent {
  protected readonly responsive = inject(ResponsiveService);

  @Input({ required: true }) permissions: Permission[] = [];
  @Input() title = 'I Miei Permessi';

  // Computed signals
  protected readonly totalPermissions = computed(() => this.permissions.length);

  protected readonly cardClass = computed(() =>
    this.responsive.isMobile() ? 'mobile-card' : 'desktop-card'
  );

  protected readonly permissionCategories = computed(() => {
    const permissions = this.permissions;
    const grouped = permissions.reduce((acc, permission) => {
      const [module] = permission.resource.split(':');
      if (!acc[module]) {
        acc[module] = {
          module,
          label: this.getModuleLabel(module),
          icon: this.getModuleIcon(module),
          permissions: [],
        };
      }
      acc[module].permissions.push(permission);
      return acc;
    }, {} as Record<string, { module: string; label: string; icon: string; permissions: Permission[] }>);

    return Object.values(grouped);
  });

  // Helper methods
  protected getModuleLabel(module: string): string {
    const labels: Record<string, string> = {
      fir: 'Formulari (FIR)',
      facility: 'Impianti',
      report: 'Report',
      user: 'Gestione Utenti',
      registry: 'Anagrafica',
      analytics: 'Analitiche',
    };
    return labels[module] || module;
  }

  protected getModuleIcon(module: string): string {
    const icons: Record<string, string> = {
      fir: 'pi pi-file',
      facility: 'pi pi-building',
      report: 'pi pi-chart-bar',
      user: 'pi pi-users',
      registry: 'pi pi-database',
      analytics: 'pi pi-chart-line',
    };
    return icons[module] || 'pi pi-circle';
  }

  protected getActionIcon(action: string): string {
    const icons: Record<string, string> = {
      create: 'pi pi-plus-circle',
      read: 'pi pi-eye',
      update: 'pi pi-pencil',
      delete: 'pi pi-trash',
      approve: 'pi pi-check',
      sign: 'pi pi-verified',
    };
    return icons[action] || 'pi pi-circle';
  }

  protected getSensitivityColor(sensitivity: string): string {
    const colors: Record<string, string> = {
      LOW: '#10b981',
      MEDIUM: '#f59e0b',
      HIGH: '#ef4444',
    };
    return colors[sensitivity] || '#6b7280';
  }

  protected getScopeClass(scope: string): string {
    return `scope-${scope.toLowerCase()}`;
  }

  protected formatPermissionName(permission: Permission): string {
    return `${this.capitalizeFirst(permission.action)} ${this.getResourceLabel(permission.resource)}`;
  }

  private getResourceLabel(resource: string): string {
    // Implementation...
    return resource;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  protected onRequestTempPermission(): void {
    // Emit event or open dialog
  }
}
```

---

## 5. PrimeNG Component Integration

### 5.1 Role Management Table (Virtual Scrolling)

**File**: `features/permissions/components/role-list.component.ts`

```typescript
import { Component, Output, EventEmitter, Input, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { Role } from '../stores/role.store';

/**
 * Role list table with virtual scrolling
 *
 * Features:
 * - Virtual scrolling for 1000+ roles (enterprise clients)
 * - Column sorting and filtering
 * - Inline actions (edit, delete, preview)
 * - System role protection (cannot delete/edit)
 * - Mobile-responsive columns
 *
 * Performance:
 * - OnPush change detection
 * - Virtual scrolling with 50px row height
 * - trackBy function for efficient rendering
 */
@Component({
  selector: 'app-role-list',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    BadgeModule,
    InputTextModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-table
      [value]="roles"
      [scrollable]="true"
      [virtualScroll]="enableVirtualScroll"
      [virtualScrollItemSize]="50"
      [rows]="20"
      [globalFilterFields]="['name', 'description']"
      [loading]="isLoading"
      responsiveLayout="scroll"
      styleClass="p-datatable-sm"
      [rowTrackBy]="trackByRoleId"
    >
      <!-- Header -->
      <ng-template pTemplate="caption">
        <div class="table-header">
          <span class="p-input-icon-left">
            <i class="pi pi-search"></i>
            <input
              pInputText
              type="text"
              [(ngModel)]="globalFilter"
              placeholder="Cerca ruolo..."
              (input)="onGlobalFilter($event)"
            />
          </span>

          <p-button
            label="Nuovo Ruolo"
            icon="pi pi-plus"
            (onClick)="onCreate.emit()"
          />
        </div>
      </ng-template>

      <!-- Columns -->
      <ng-template pTemplate="header">
        <tr>
          <th pSortableColumn="name">
            Nome
            <p-sortIcon field="name" />
          </th>
          <th pSortableColumn="description" class="hidden-mobile">
            Descrizione
          </th>
          <th pSortableColumn="isSystemRole">
            Tipo
            <p-sortIcon field="isSystemRole" />
          </th>
          <th class="text-center">
            Permessi
          </th>
          <th class="text-center hidden-mobile">
            Utenti
          </th>
          <th class="text-right">
            Azioni
          </th>
        </tr>
      </ng-template>

      <!-- Body -->
      <ng-template pTemplate="body" let-role>
        <tr>
          <td>
            <div class="role-name-cell">
              <strong>{{ role.name }}</strong>
              @if (role.isSystemRole) {
                <i
                  class="pi pi-lock text-sm ml-2"
                  pTooltip="Ruolo di sistema (non modificabile)"
                  tooltipPosition="top"
                ></i>
              }
            </div>
          </td>

          <td class="hidden-mobile">
            <span class="text-secondary">{{ role.description }}</span>
          </td>

          <td>
            <p-tag
              [value]="role.isSystemRole ? 'Sistema' : 'Personalizzato'"
              [severity]="role.isSystemRole ? 'info' : 'success'"
            />
          </td>

          <td class="text-center">
            <p-badge
              [value]="role.permissions.length"
              severity="info"
              [pTooltip]="role.permissions.length + ' permessi assegnati'"
            />
          </td>

          <td class="text-center hidden-mobile">
            <p-badge
              [value]="getUserCount(role.id)"
              severity="warning"
              [pTooltip]="getUserCount(role.id) + ' utenti con questo ruolo'"
            />
          </td>

          <td class="text-right">
            <div class="action-buttons">
              <p-button
                icon="pi pi-eye"
                [outlined]="true"
                severity="info"
                size="small"
                pTooltip="Anteprima permessi"
                (onClick)="onPreview.emit(role)"
              />

              <p-button
                icon="pi pi-pencil"
                [outlined]="true"
                size="small"
                pTooltip="Modifica"
                [disabled]="role.isSystemRole"
                (onClick)="onEdit.emit(role)"
              />

              <p-button
                icon="pi pi-trash"
                [outlined]="true"
                severity="danger"
                size="small"
                pTooltip="Elimina"
                [disabled]="role.isSystemRole || getUserCount(role.id) > 0"
                (onClick)="onDelete.emit(role)"
              />
            </div>
          </td>
        </tr>
      </ng-template>

      <!-- Empty state -->
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="6" class="text-center py-5">
            <i class="pi pi-inbox text-4xl text-gray-400 mb-3"></i>
            <p class="text-lg text-gray-600">Nessun ruolo trovato</p>
            <p-button
              label="Crea Primo Ruolo"
              icon="pi pi-plus"
              [outlined]="true"
              (onClick)="onCreate.emit()"
            />
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: [`
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .role-name-cell {
      display: flex;
      align-items: center;
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      .hidden-mobile {
        display: none !important;
      }

      .table-header {
        flex-direction: column;
        align-items: stretch;
      }

      .action-buttons {
        flex-direction: column;
      }
    }

    /* Virtual scroll optimization */
    :host ::ng-deep {
      .p-datatable-virtualscroll .p-datatable-tbody > tr {
        height: 50px;
      }
    }
  `],
})
export class RoleListComponent {
  @Input({ required: true }) roles: Role[] = [];
  @Input() isLoading = false;
  @Input() userCounts: Record<string, number> = {};
  @Input() enableVirtualScroll = false;

  @Output() onCreate = new EventEmitter<void>();
  @Output() onEdit = new EventEmitter<Role>();
  @Output() onDelete = new EventEmitter<Role>();
  @Output() onPreview = new EventEmitter<Role>();

  protected globalFilter = '';

  protected getUserCount(roleId: string): number {
    return this.userCounts[roleId] || 0;
  }

  protected onGlobalFilter(event: Event): void {
    // PrimeNG handles filtering via globalFilterFields
  }

  // TrackBy for efficient rendering
  protected trackByRoleId = (index: number, role: Role): string => role.id;
}
```

### 5.2 Permission Matrix Builder (Custom Role Creation)

**File**: `features/permissions/components/role-permission-matrix.component.ts`

```typescript
import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { Permission } from '../stores/permission.store';

/**
 * Permission matrix builder for custom role creation
 *
 * Layout:
 * - Rows: Resources (FIR, Facility, Report, etc.)
 * - Columns: Actions (Create, Read, Update, Delete, Approve, Sign)
 * - Cells: Checkboxes for permission selection
 * - Visual indicators: Sensitivity colors, scope badges
 *
 * Features:
 * - Bulk select (select all for resource/action)
 * - Conflict detection (warning for dangerous combinations)
 * - Permission count badge
 * - Mobile: Converts to accordion with action groups
 *
 * Performance:
 * - OnPush change detection
 * - Signals for reactive updates
 * - Computed permission counts
 */
@Component({
  selector: 'app-role-permission-matrix',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    CheckboxModule,
    FormsModule,
    TagModule,
    TooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-card>
      <ng-template pTemplate="header">
        <div class="matrix-header">
          <h3>Matrice Permessi</h3>
          <p-tag
            [value]="selectedCount() + ' / ' + availablePermissions.length"
            severity="info"
          />
        </div>
      </ng-template>

      <ng-template pTemplate="content">
        <div class="permission-matrix">
          <!-- Header row: Actions -->
          <div class="matrix-header-row">
            <div class="matrix-cell header-cell">Risorsa</div>
            @for (action of actions; track action) {
              <div class="matrix-cell header-cell action-header">
                <span>{{ action.label }}</span>
                <p-checkbox
                  [(ngModel)]="action.selectAll"
                  binary="true"
                  [inputId]="'select-all-' + action.name"
                  (onChange)="onSelectAllAction(action.name)"
                  pTooltip="Seleziona tutto"
                />
              </div>
            }
          </div>

          <!-- Body rows: Resources -->
          @for (resource of resources(); track resource.name) {
            <div class="matrix-row">
              <!-- Resource header cell -->
              <div class="matrix-cell resource-header">
                <div class="resource-info">
                  <i [class]="resource.icon"></i>
                  <span>{{ resource.label }}</span>
                  <p-badge [value]="resource.selectedCount" [severity]="resource.selectedCount > 0 ? 'success' : 'secondary'" />
                </div>
                <p-checkbox
                  [(ngModel)]="resource.selectAll"
                  binary="true"
                  [inputId]="'select-all-resource-' + resource.name"
                  (onChange)="onSelectAllResource(resource.name)"
                  pTooltip="Seleziona tutto"
                />
              </div>

              <!-- Permission checkboxes -->
              @for (action of actions; track action) {
                <div class="matrix-cell permission-cell">
                  @if (getPermission(resource.name, action.name); as permission) {
                    <p-checkbox
                      [(ngModel)]="permission.selected"
                      binary="true"
                      [inputId]="permission.id"
                      (onChange)="onPermissionChange()"
                      [pTooltip]="permission.description"
                    />

                    @if (permission.sensitivity === 'HIGH') {
                      <i
                        class="pi pi-exclamation-triangle text-orange-500 ml-1"
                        pTooltip="Permesso ad alta sensibilità"
                      ></i>
                    }
                  } @else {
                    <span class="text-gray-400">—</span>
                  }
                </div>
              }
            </div>
          }
        </div>

        <!-- Warning for high-sensitivity permissions -->
        @if (hasDangerousPermissions()) {
          <div class="mt-4 p-3 bg-orange-50 border-1 border-orange-300 border-round">
            <i class="pi pi-exclamation-triangle text-orange-600 mr-2"></i>
            <span class="text-orange-900">
              Attenzione: Questo ruolo include {{ dangerousPermissionCount() }} permessi ad alta sensibilità.
            </span>
          </div>
        }
      </ng-template>
    </p-card>
  `,
  styles: [`
    .matrix-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
    }

    .matrix-header h3 {
      margin: 0;
      font-size: 1.25rem;
    }

    .permission-matrix {
      display: grid;
      gap: 0;
      overflow-x: auto;
    }

    .matrix-header-row,
    .matrix-row {
      display: grid;
      grid-template-columns: 250px repeat(auto-fit, minmax(100px, 1fr));
      border-bottom: 1px solid var(--surface-border);
    }

    .matrix-header-row {
      position: sticky;
      top: 0;
      background: var(--surface-50);
      z-index: 10;
      font-weight: 600;
    }

    .matrix-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      border-right: 1px solid var(--surface-border);
      min-height: 56px; /* Touch target */
    }

    .header-cell {
      font-weight: 600;
      background: var(--surface-50);
    }

    .action-header {
      flex-direction: column;
      gap: 0.5rem;
    }

    .resource-header {
      justify-content: space-between;
      background: var(--surface-50);
      position: sticky;
      left: 0;
      z-index: 5;
    }

    .resource-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .resource-info i {
      color: var(--primary-color);
    }

    .permission-cell {
      transition: background-color 0.2s;
    }

    .permission-cell:hover {
      background: var(--surface-50);
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      .matrix-header-row,
      .matrix-row {
        grid-template-columns: 150px repeat(auto-fit, minmax(80px, 1fr));
      }

      .matrix-cell {
        padding: 0.75rem 0.5rem;
        font-size: 0.875rem;
      }
    }
  `],
})
export class RolePermissionMatrixComponent {
  @Input({ required: true }) availablePermissions: Permission[] = [];
  @Input() selectedPermissionIds: string[] = [];

  @Output() selectionChange = new EventEmitter<string[]>();

  // Actions configuration
  protected readonly actions = [
    { name: 'create', label: 'Crea', selectAll: false },
    { name: 'read', label: 'Leggi', selectAll: false },
    { name: 'update', label: 'Modifica', selectAll: false },
    { name: 'delete', label: 'Elimina', selectAll: false },
    { name: 'approve', label: 'Approva', selectAll: false },
    { name: 'sign', label: 'Firma', selectAll: false },
  ];

  // Permission matrix state
  private readonly permissionMap = signal(new Map<string, PermissionWithSelection>());

  // Computed resources with selection counts
  protected readonly resources = computed(() => {
    const permissions = Array.from(this.permissionMap().values());
    const resourceMap = permissions.reduce((acc, permission) => {
      const [resource] = permission.resource.split(':');
      if (!acc[resource]) {
        acc[resource] = {
          name: resource,
          label: this.getResourceLabel(resource),
          icon: this.getResourceIcon(resource),
          selectedCount: 0,
          selectAll: false,
        };
      }
      if (permission.selected) {
        acc[resource].selectedCount++;
      }
      return acc;
    }, {} as Record<string, ResourceInfo>);

    return Object.values(resourceMap);
  });

  // Computed counts
  protected readonly selectedCount = computed(() => {
    return Array.from(this.permissionMap().values()).filter(p => p.selected).length;
  });

  protected readonly dangerousPermissionCount = computed(() => {
    return Array.from(this.permissionMap().values())
      .filter(p => p.selected && p.sensitivity === 'HIGH')
      .length;
  });

  protected readonly hasDangerousPermissions = computed(() => {
    return this.dangerousPermissionCount() > 0;
  });

  ngOnInit(): void {
    this.buildPermissionMap();
  }

  ngOnChanges(): void {
    this.buildPermissionMap();
  }

  private buildPermissionMap(): void {
    const map = new Map<string, PermissionWithSelection>();

    this.availablePermissions.forEach(permission => {
      const key = `${permission.resource}:${permission.action}`;
      map.set(key, {
        ...permission,
        selected: this.selectedPermissionIds.includes(permission.id),
      });
    });

    this.permissionMap.set(map);
  }

  protected getPermission(resource: string, action: string): PermissionWithSelection | undefined {
    const key = `${resource}:${action}`;
    return this.permissionMap().get(key);
  }

  protected onPermissionChange(): void {
    const selectedIds = Array.from(this.permissionMap().values())
      .filter(p => p.selected)
      .map(p => p.id);

    this.selectionChange.emit(selectedIds);
  }

  protected onSelectAllAction(action: string): void {
    const map = this.permissionMap();
    const selectAll = this.actions.find(a => a.name === action)?.selectAll || false;

    map.forEach((permission, key) => {
      if (permission.action === action) {
        permission.selected = selectAll;
      }
    });

    this.permissionMap.set(new Map(map));
    this.onPermissionChange();
  }

  protected onSelectAllResource(resource: string): void {
    const map = this.permissionMap();
    const resourceInfo = this.resources().find(r => r.name === resource);
    const selectAll = resourceInfo?.selectAll || false;

    map.forEach((permission, key) => {
      const [permResource] = permission.resource.split(':');
      if (permResource === resource) {
        permission.selected = selectAll;
      }
    });

    this.permissionMap.set(new Map(map));
    this.onPermissionChange();
  }

  private getResourceLabel(resource: string): string {
    const labels: Record<string, string> = {
      fir: 'Formulari (FIR)',
      facility: 'Impianti',
      report: 'Report',
      user: 'Utenti',
      registry: 'Anagrafica',
      analytics: 'Analitiche',
    };
    return labels[resource] || resource;
  }

  private getResourceIcon(resource: string): string {
    const icons: Record<string, string> = {
      fir: 'pi pi-file',
      facility: 'pi pi-building',
      report: 'pi pi-chart-bar',
      user: 'pi pi-users',
      registry: 'pi pi-database',
      analytics: 'pi pi-chart-line',
    };
    return icons[resource] || 'pi pi-circle';
  }
}

interface PermissionWithSelection extends Permission {
  selected: boolean;
}

interface ResourceInfo {
  name: string;
  label: string;
  icon: string;
  selectedCount: number;
  selectAll: boolean;
}
```

---

## 6. Performance Optimization

### 6.1 OnPush Change Detection Strategy

**All presentational components MUST use `ChangeDetectionStrategy.OnPush`:**

```typescript
@Component({
  selector: 'app-role-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, // ✓ REQUIRED
  // ...
})
```

**Benefits:**
- Reduces change detection cycles by 80-90%
- Only checks when inputs change or events fire
- Works perfectly with signals (fine-grained reactivity)

### 6.2 TrackBy Functions for *ngFor

**All lists MUST use trackBy functions:**

```typescript
// Bad ✗
<div *ngFor="let role of roles">{{ role.name }}</div>

// Good ✓
<div *ngFor="let role of roles; trackBy: trackByRoleId">{{ role.name }}</div>

protected trackByRoleId = (index: number, role: Role): string => role.id;
```

**Benefits:**
- Prevents unnecessary DOM re-renders
- Essential for virtual scrolling performance
- Reduces memory churn

### 6.3 Virtual Scrolling for Large Lists

**Use PrimeNG VirtualScroller or Table virtualScroll for 100+ items:**

```typescript
<p-table
  [value]="roles"
  [scrollable]="true"
  [virtualScroll]="true"
  [virtualScrollItemSize]="50"  // Row height in pixels
  [rows]="20"                   // Visible rows
>
```

**Performance targets:**
- 1000 roles: <100ms render time
- Smooth 60fps scrolling
- Memory usage <50MB

### 6.4 Signal-Based Computed Values

**Use computed() for derived state (automatic memoization):**

```typescript
// Bad ✗ - Recomputes every change detection cycle
get filteredRoles() {
  return this.roles.filter(r => r.name.includes(this.filterText));
}

// Good ✓ - Only recomputes when dependencies change
protected readonly filteredRoles = computed(() => {
  const roles = this.roles();
  const filter = this.filterText();
  return roles.filter(r => r.name.includes(filter));
});
```

### 6.5 Lazy Loading & Code Splitting

**Feature module routes with lazy loading:**

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'permissions',
    loadChildren: () =>
      import('./features/permissions/permissions.routes').then(m => m.PERMISSION_ROUTES),
    canActivate: [AuthGuard, PermissionGuard],
    data: { requiredPermission: 'user:read:all' },
  },
];
```

### 6.6 Permission Cache Optimization

**Client-side caching strategy:**

```typescript
// Cache permission checks for 1 hour
private readonly CACHE_DURATION_MS = 60 * 60 * 1000;

// Use Map for O(1) lookup
private readonly permissionCache = new Map<string, {
  value: boolean;
  timestamp: number;
}>();

hasPermission(permission: string): boolean {
  const cached = this.permissionCache.get(permission);

  if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION_MS) {
    return cached.value; // Cache hit - instant return
  }

  // Cache miss - compute and store
  const result = this.computePermission(permission);
  this.permissionCache.set(permission, {
    value: result,
    timestamp: Date.now(),
  });

  return result;
}
```

### 6.7 Bundle Size Optimization

**Tree-shakeable imports:**

```typescript
// Bad ✗ - Imports entire library
import { PrimeNG } from 'primeng/primeng';

// Good ✓ - Only imports needed components
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
```

**Expected bundle sizes:**
- Permission feature module: <150KB gzipped
- Initial load: <300KB total
- Lazy-loaded routes: <100KB per route

---

## 7. Type Definitions

### 7.1 Core Types

**File**: `features/permissions/models/permission.types.ts`

```typescript
/**
 * Permission entity
 * Format: {resource}:{action}:{scope}
 * Example: "fir:create:all", "facility:read:own"
 */
export interface Permission {
  id: string;
  resource: PermissionResource;
  action: PermissionAction;
  scope: PermissionScope;
  sensitivity: PermissionSensitivity;
  description: string;
  requiresStepUp?: boolean; // Requires re-authentication
}

export type PermissionResource =
  | 'fir'
  | 'facility'
  | 'report'
  | 'user'
  | 'registry'
  | 'analytics'
  | 'audit'
  | 'tenant'
  | 'notification';

export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'approve'
  | 'sign'
  | 'export'
  | 'assign'
  | 'revoke';

export type PermissionScope =
  | 'own'       // User's own resources only
  | 'facility'  // Resources within assigned facilities
  | 'all';      // All resources in tenant

export type PermissionSensitivity =
  | 'LOW'       // View-only, low risk
  | 'MEDIUM'    // Modify data, moderate risk
  | 'HIGH';     // Delete, approve, high risk

/**
 * Role entity
 */
export interface Role {
  id: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  permissions: Permission[];
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/**
 * User-Role assignment
 */
export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  tenantId: string;
  facilityIds: string[] | null; // Facility-scoped role
  assignedBy: string;
  assignedAt: Date;
  expiresAt: Date | null;
  isDelegated: boolean;
  delegationReason?: string;
}

/**
 * Permission check context
 */
export interface PermissionContext {
  userId: string;
  tenantId: string;
  facilityId?: string;
  resourceId?: string;
  resourceOwnerId?: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Audit log entry
 */
export interface PermissionAuditLog {
  id: string;
  tenantId: string;
  userId: string;
  spidFiscalCode?: string;
  action: string;
  resource: string;
  resourceId?: string;
  decision: 'ALLOW' | 'DENY';
  evaluatedPolicies: string[];
  context: PermissionContext;
  timestamp: Date;
}

/**
 * Temporary permission grant
 */
export interface TempPermissionGrant {
  id: string;
  userId: string;
  permissions: string[];
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date;
  justification: string;
  autoRevoked: boolean;
}

/**
 * Permission request (temporary elevation)
 */
export interface TempPermissionRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  permissionsRequested: string[];
  justification: string;
  requestedDurationHours: number;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  reviewedBy?: string;
  reviewedAt?: Date;
  denyReason?: string;
  createdAt: Date;
}
```

---

## 8. Feature Module Structure

### 8.1 Routing Configuration

**File**: `features/permissions/permissions.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { PermissionGuard } from '../../core/guards/permission.guard';

export const PERMISSION_ROUTES: Routes = [
  {
    path: '',
    children: [
      {
        path: 'roles',
        loadComponent: () =>
          import('./pages/role-management-page.component').then(m => m.RoleManagementPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:read:all' },
      },
      {
        path: 'roles/new',
        loadComponent: () =>
          import('./pages/role-form-page.component').then(m => m.RoleFormPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:assign:all' },
      },
      {
        path: 'roles/:id',
        loadComponent: () =>
          import('./pages/role-form-page.component').then(m => m.RoleFormPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:update:all' },
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./pages/user-roles-page.component').then(m => m.UserRolesPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:read:all' },
      },
      {
        path: 'my-permissions',
        loadComponent: () =>
          import('./pages/my-permissions-page.component').then(m => m.MyPermissionsPageComponent),
      },
      {
        path: 'requests',
        loadComponent: () =>
          import('./pages/permission-requests-page.component').then(m => m.PermissionRequestsPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:assign:all' },
      },
      {
        path: 'view-as',
        loadComponent: () =>
          import('./pages/view-as-user-page.component').then(m => m.ViewAsUserPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'user:read:all' },
      },
      {
        path: 'audit',
        loadComponent: () =>
          import('./pages/permission-audit-page.component').then(m => m.PermissionAuditPageComponent),
        canActivate: [PermissionGuard],
        data: { requiredPermission: 'audit:read:all' },
      },
      {
        path: '',
        redirectTo: 'roles',
        pathMatch: 'full',
      },
    ],
  },
];
```

### 8.2 Shared Providers

**File**: `features/permissions/permissions.providers.ts`

```typescript
import { Provider } from '@angular/core';
import { PermissionStore } from './stores/permission.store';
import { RoleStore } from './stores/role.store';
import { TempPermissionStore } from './stores/temp-permission.store';
import { PermissionService } from './services/permission.service';
import { RoleService } from './services/role.service';
import { PermissionCacheService } from './services/permission-cache.service';

/**
 * Providers for permission feature
 * Import in app.config.ts for global availability
 */
export const PERMISSION_PROVIDERS: Provider[] = [
  PermissionStore,
  RoleStore,
  TempPermissionStore,
  PermissionService,
  RoleService,
  PermissionCacheService,
];
```

### 8.3 Feature Index (Public API)

**File**: `features/permissions/index.ts`

```typescript
// Stores
export { PermissionStore } from './stores/permission.store';
export { RoleStore } from './stores/role.store';
export { TempPermissionStore } from './stores/temp-permission.store';

// Services
export { PermissionService } from './services/permission.service';
export { RoleService } from './services/role.service';

// Directives
export { HasPermissionDirective } from './directives/has-permission.directive';
export { RequirePermissionDirective } from './directives/require-permission.directive';
export { PermissionTooltipDirective } from './directives/permission-tooltip.directive';

// Pipes
export { HasPermissionPipe } from './pipes/has-permission.pipe';
export { PermissionLabelPipe } from './pipes/permission-label.pipe';
export { RoleNamePipe } from './pipes/role-name.pipe';

// Guards
export { PermissionGuard } from './guards/permission.guard';
export { RoleGuard } from './guards/role.guard';

// Types
export * from './models/permission.types';

// Routes
export { PERMISSION_ROUTES } from './permissions.routes';

// Providers
export { PERMISSION_PROVIDERS } from './permissions.providers';
```

---

## Summary

This architecture provides:

1. **Standalone Components**: Full Angular 17+ standalone architecture with lazy loading
2. **NgRx SignalStore**: Three stores (Permission, Role, TempPermission) with fine-grained reactivity
3. **Permission Directives**: Structural (`*appHasPermission`) and attribute (`appRequirePermission`) directives
4. **Mobile-First**: Responsive service, touch targets, accordion/grid adaptive layouts
5. **PrimeNG Integration**: Virtual scrolling tables, permission matrix, mobile cards
6. **Performance**: OnPush, trackBy, signals, computed values, caching, code splitting

**Key Files to Create:**
- `features/permissions/stores/*.store.ts` (3 stores)
- `features/permissions/components/*.component.ts` (15+ components)
- `features/permissions/directives/*.directive.ts` (3 directives)
- `features/permissions/pipes/*.pipe.ts` (3 pipes)
- `features/permissions/services/*.service.ts` (5 services)
- `features/permissions/guards/*.guard.ts` (2 guards)
- `core/services/responsive.service.ts` (1 service)

**Performance Targets:**
- Permission check: <10ms (99th percentile)
- Component render: <100ms for 1000 items
- Bundle size: <150KB per feature module
- Change detection cycles: 80-90% reduction vs default
