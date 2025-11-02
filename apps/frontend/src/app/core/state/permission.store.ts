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
import { PermissionApiService } from '../../features/permissions/services/permission-api.service';

/**
 * PermissionStore
 * NgRx SignalStore for managing user permissions and authorization state
 * Per plan.md FR-001: Cache-first permission checking with <10ms P99
 *
 * T091: Connected to PermissionApiService for backend integration
 */

// State shape
interface PermissionState {
  permissions: string[]; // User's effective permissions (resource:action:scope format)
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  cacheTTL: number; // 5 minutes default
}

// Initial state
const initialState: PermissionState = {
  permissions: [],
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  cacheTTL: 5 * 60 * 1000, // 5 minutes in ms
};

export const PermissionStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    /**
     * Check if user has specific permission
     * Supports scope hierarchy: own < facility < all
     */
    hasPermission: computed(() => (requiredPermission: string): boolean => {
      const userPermissions = store.permissions();

      // Exact match
      if (userPermissions.includes(requiredPermission)) {
        return true;
      }

      // Parse permission: resource:action:scope
      const parts = requiredPermission.split(':');
      if (parts.length !== 3) {
        console.warn(
          `Invalid permission format: ${requiredPermission}. Expected format: resource:action:scope`,
        );
        return false;
      }

      const [reqResource, reqAction, reqScope] = parts;

      // Scope hierarchy: own < facility < all
      const scopeHierarchy = ['own', 'facility', 'all'];
      const reqScopeLevel = scopeHierarchy.indexOf(reqScope);

      // Check for broader scope permissions
      for (const userPerm of userPermissions) {
        const [userResource, userAction, userScope] = userPerm.split(':');

        // Must match resource and action
        if (userResource !== reqResource || userAction !== reqAction) {
          continue;
        }

        // Check if user scope is broader or equal
        const userScopeLevel = scopeHierarchy.indexOf(userScope);
        if (userScopeLevel >= reqScopeLevel) {
          return true;
        }
      }

      return false;
    }),

    /**
     * Check if cache is stale (older than TTL)
     */
    isCacheStale: computed(() => {
      const lastFetched = store.lastFetchedAt();
      const ttl = store.cacheTTL();

      if (!lastFetched) {
        return true; // Never fetched
      }

      return Date.now() - lastFetched > ttl;
    }),

    /**
     * Check if user has ANY of the specified permissions
     */
    hasAnyPermission: computed(
      () =>
        (requiredPermissions: string[]): boolean => {
          const checkPermission = store.hasPermission();
          return requiredPermissions.some((perm) => checkPermission(perm));
        },
    ),

    /**
     * Check if user has ALL of the specified permissions
     */
    hasAllPermissions: computed(
      () =>
        (requiredPermissions: string[]): boolean => {
          const checkPermission = store.hasPermission();
          return requiredPermissions.every((perm) => checkPermission(perm));
        },
    ),
  })),
  withMethods((store, permissionApi = inject(PermissionApiService)) => ({
    /**
     * Load permissions from backend API
     * Caches result for TTL duration
     * T091: Uses PermissionApiService for backend integration
     */
    loadPermissions: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          permissionApi.getMyPermissions(false).pipe(
            tapResponse({
              next: (response) => {
                patchState(store, {
                  permissions: response.permissions,
                  isLoading: false,
                  error: null,
                  lastFetchedAt: Date.now(),
                });
              },
              error: (error: Error) => {
                console.error('Failed to load permissions:', error);
                patchState(store, {
                  isLoading: false,
                  error: error.message || 'Failed to load permissions',
                });
              },
            }),
          ),
        ),
      ),
    ),

    /**
     * Reload permissions from server (bypasses cache)
     */
    refreshPermissions(): void {
      patchState(store, { lastFetchedAt: null });
      store.loadPermissions(undefined);
    },

    /**
     * Clear permissions (e.g., on logout)
     */
    clearPermissions(): void {
      patchState(store, initialState);
    },

    /**
     * Handle tenant context switch
     * Clears current permissions and reloads for new tenant
     * T118: Support consultant multi-tenant context switching
     */
    onTenantContextSwitch(): void {
      // Clear existing permissions
      patchState(store, {
        permissions: [],
        lastFetchedAt: null,
        error: null,
      });

      // Reload permissions for new tenant context
      store.loadPermissions(undefined);
    },

    /**
     * Optimistically add permissions to cache
     * Used after role assignment operations
     */
    addPermissions(newPermissions: string[]): void {
      const current = store.permissions();
      const updated = [...new Set([...current, ...newPermissions])];
      patchState(store, { permissions: updated });
    },

    /**
     * Optimistically remove permissions from cache
     * Used after role revocation operations
     */
    removePermissions(permissionsToRemove: string[]): void {
      const current = store.permissions();
      const updated = current.filter((p) => !permissionsToRemove.includes(p));
      patchState(store, { permissions: updated });
    },

    /**
     * Auto-fetch permissions if cache is stale
     */
    ensurePermissionsLoaded(): void {
      if (store.isCacheStale()) {
        store.loadPermissions(undefined);
      }
    },
  })),
);
