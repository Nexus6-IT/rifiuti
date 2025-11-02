import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { RoleApiService } from '../../features/permissions/services/role-api.service';

/**
 * RoleStore
 * NgRx SignalStore for managing role definitions and assignments
 * Per plan.md: Caches role data for 1 hour (roles change less frequently than permissions)
 *
 * T092: Connected to RoleApiService for backend integration
 */

// Role entity for store (extended from backend response)
export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: string[]; // List of permission strings - populated from getRoleById
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

// User role assignment - extended from backend response
export interface UserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  roleName: string; // Enriched from roles when loading
  assignedAt: string;
  assignedBy: string;
  expiresAt: string | null;
  facilityIds: string[] | null;
  isDelegated: boolean;
  isActive?: boolean; // Backend includes this
}

// State shape
interface RoleState {
  roles: Role[]; // All available roles for current tenant
  userRoles: UserRoleAssignment[]; // Current user's role assignments
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  cacheTTL: number; // 1 hour default (roles change less frequently)
}

// Initial state
const initialState: RoleState = {
  roles: [],
  userRoles: [],
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  cacheTTL: 60 * 60 * 1000, // 1 hour in ms
};

export const RoleStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    /**
     * Get role by ID
     */
    getRoleById: computed(
      () =>
        (roleId: string): Role | undefined => {
          return store.roles().find((r) => r.id === roleId);
        },
    ),

    /**
     * Get role by name
     */
    getRoleByName: computed(
      () =>
        (roleName: string): Role | undefined => {
          return store
            .roles()
            .find((r) => r.name.toLowerCase() === roleName.toLowerCase());
        },
    ),

    /**
     * Get system roles only
     */
    systemRoles: computed(() => {
      return store.roles().filter((r) => r.isSystemRole);
    }),

    /**
     * Get custom roles only
     */
    customRoles: computed(() => {
      return store.roles().filter((r) => !r.isSystemRole);
    }),

    /**
     * Check if current user has specific role
     */
    hasRole: computed(
      () =>
        (roleName: string): boolean => {
          return store
            .userRoles()
            .some((ur) => ur.roleName?.toLowerCase() === roleName.toLowerCase());
        },
    ),

    /**
     * Get current user's primary role (first non-expired role)
     */
    primaryRole: computed(() => {
      const now = new Date();
      const activeRoles = store
        .userRoles()
        .filter(
          (ur) => !ur.expiresAt || new Date(ur.expiresAt).getTime() > now.getTime(),
        );

      return activeRoles.length > 0 ? activeRoles[0].roleName ?? null : null;
    }),

    /**
     * Check if cache is stale
     */
    isCacheStale: computed(() => {
      const lastFetched = store.lastFetchedAt();
      const ttl = store.cacheTTL();

      if (!lastFetched) {
        return true;
      }

      return Date.now() - lastFetched > ttl;
    }),

    /**
     * Get all permissions from user's roles (aggregated)
     */
    aggregatedPermissions: computed(() => {
      const userRoleIds = store.userRoles().map((ur) => ur.roleId);
      const roles = store.roles();

      const permissionSet = new Set<string>();

      for (const roleId of userRoleIds) {
        const role = roles.find((r) => r.id === roleId);
        if (role && role.permissions) {
          role.permissions.forEach((p) => permissionSet.add(p));
        }
      }

      return Array.from(permissionSet);
    }),
  })),
  withMethods((store, roleApi = inject(RoleApiService)) => ({
    /**
     * Load all available roles for current tenant
     * T092: Uses RoleApiService for backend integration
     */
    loadRoles: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          roleApi.listRoles().pipe(
            tapResponse({
              next: (response) => {
                // Map backend roles to store roles (add empty permissions array)
                const roles: Role[] = response.roles.map(role => ({
                  ...role,
                  permissions: [] // Will be loaded separately via getRoleById when needed
                }));

                patchState(store, {
                  roles,
                  isLoading: false,
                  error: null,
                  lastFetchedAt: Date.now(),
                });
              },
              error: (error: Error) => {
                console.error('Failed to load roles:', error);
                patchState(store, {
                  isLoading: false,
                  error: error.message || 'Failed to load roles',
                });
              },
            }),
          ),
        ),
      ),
    ),

    /**
     * Load current user's role assignments
     * T092: Uses RoleApiService for backend integration
     * Note: This requires userId - should be called with current user's ID
     */
    loadUserRoles: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap((userId: string) =>
          roleApi.getUserRoles(userId).pipe(
            tapResponse({
              next: (response) => {
                // Enrich with roleName from roles cache
                const roles = store.roles();
                const enrichedUserRoles: UserRoleAssignment[] = response.userRoles.map(ur => {
                  const role = roles.find(r => r.id === ur.roleId);
                  return {
                    ...ur,
                    roleName: role?.name || 'Unknown Role',
                  };
                });

                patchState(store, {
                  userRoles: enrichedUserRoles,
                  isLoading: false,
                  error: null,
                });
              },
              error: (error: Error) => {
                console.error('Failed to load user roles:', error);
                patchState(store, {
                  isLoading: false,
                  error: error.message || 'Failed to load user roles',
                });
              },
            }),
          ),
        ),
      ),
    ),

    /**
     * Refresh both roles and user role assignments
     * Note: Requires userId parameter for loadUserRoles
     */
    refreshAll(userId: string): void {
      patchState(store, { lastFetchedAt: null });
      store.loadRoles(undefined);
      store.loadUserRoles(userId);
    },

    /**
     * Clear role data (e.g., on logout)
     */
    clearRoles(): void {
      patchState(store, initialState);
    },

    /**
     * Auto-fetch roles if cache is stale
     * Note: Requires userId parameter for loadUserRoles
     */
    ensureRolesLoaded(userId: string): void {
      if (store.isCacheStale()) {
        store.loadRoles(undefined);
        store.loadUserRoles(userId);
      }
    },

    /**
     * Optimistically add user role assignment after successful API call
     */
    addUserRole(assignment: UserRoleAssignment): void {
      const current = store.userRoles();
      patchState(store, {
        userRoles: [...current, assignment],
      });
    },

    /**
     * Optimistically remove user role assignment after successful API call
     */
    removeUserRole(assignmentId: string): void {
      const current = store.userRoles();
      patchState(store, {
        userRoles: current.filter((ur) => ur.id !== assignmentId),
      });
    },
  })),
);
