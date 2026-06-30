import { Injectable } from '@angular/core'
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals'
import { openDB, DBSchema, IDBPDatabase } from 'idb'

/**
 * Offline Permission Store
 *
 * Implements spec.md FR-040: Local permission caching with IndexedDB
 * - Caches user permissions locally for 24-hour offline access
 * - Shows "Last synced" indicator
 * - Syncs immediately on reconnect
 *
 * IndexedDB Schema:
 * - Store: 'permissions'
 * - Key: userId
 * - Value: { permissions: string[], lastSynced: number, expiresAt: number }
 */

interface PermissionCacheDB extends DBSchema {
  permissions: {
    key: string // userId
    value: {
      userId: string
      tenantId: string
      permissions: string[]
      roles: string[]
      lastSynced: number // timestamp
      expiresAt: number // timestamp (lastSynced + 24 hours)
    }
  }
}

interface OfflinePermissionState {
  permissions: string[]
  roles: string[]
  lastSynced: number | null
  isOnline: boolean
  isSyncing: boolean
  hasExpired: boolean
}

const initialState: OfflinePermissionState = {
  permissions: [],
  roles: [],
  lastSynced: null,
  isOnline: navigator.onLine,
  isSyncing: false,
  hasExpired: false,
}

export const OfflinePermissionStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods(store => {
    let db: IDBPDatabase<PermissionCacheDB> | null = null

    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

    /**
     * Initialize IndexedDB
     */
    const initDB = async (): Promise<IDBPDatabase<PermissionCacheDB>> => {
      if (db) return db

      db = await openDB<PermissionCacheDB>('WasteFlowOfflineCache', 1, {
        upgrade(database) {
          // Create permissions store if it doesn't exist
          if (!database.objectStoreNames.contains('permissions')) {
            database.createObjectStore('permissions', { keyPath: 'userId' })
          }
        },
      })

      return db
    }

    /**
     * Save permissions to IndexedDB cache
     * per spec.md FR-040: 24-hour local cache
     */
    const cachePermissions = async (
      userId: string,
      tenantId: string,
      permissions: string[],
      roles: string[]
    ): Promise<void> => {
      try {
        const database = await initDB()
        const now = Date.now()

        await database.put('permissions', {
          userId,
          tenantId,
          permissions,
          roles,
          lastSynced: now,
          expiresAt: now + CACHE_DURATION_MS, // 24 hours from now
        })

        patchState(store, {
          permissions,
          roles,
          lastSynced: now,
          hasExpired: false,
        })
      } catch (error) {
        console.error('[OfflinePermissionStore] Failed to cache permissions:', error)
      }
    }

    /**
     * Load permissions from IndexedDB cache
     */
    const loadCachedPermissions = async (userId: string): Promise<void> => {
      try {
        const database = await initDB()
        const cached = await database.get('permissions', userId)

        if (!cached) {
          patchState(store, {
            permissions: [],
            roles: [],
            lastSynced: null,
            hasExpired: false,
          })
          return
        }

        const now = Date.now()
        const hasExpired = now > cached.expiresAt

        patchState(store, {
          permissions: cached.permissions,
          roles: cached.roles,
          lastSynced: cached.lastSynced,
          hasExpired,
        })

        if (hasExpired) {
          console.warn('[OfflinePermissionStore] Cached permissions have expired (>24 hours old)')
        }
      } catch (error) {
        console.error('[OfflinePermissionStore] Failed to load cached permissions:', error)
      }
    }

    /**
     * Clear cached permissions
     */
    const clearCache = async (userId: string): Promise<void> => {
      try {
        const database = await initDB()
        await database.delete('permissions', userId)

        patchState(store, {
          permissions: [],
          roles: [],
          lastSynced: null,
          hasExpired: false,
        })
      } catch (error) {
        console.error('[OfflinePermissionStore] Failed to clear cache:', error)
      }
    }

    /**
     * Update online status
     */
    const setOnlineStatus = (isOnline: boolean): void => {
      patchState(store, { isOnline })
    }

    /**
     * Set syncing status
     */
    const setSyncingStatus = (isSyncing: boolean): void => {
      patchState(store, { isSyncing })
    }

    /**
     * Check if permissions have expired (>24 hours old)
     */
    const checkExpiration = (): boolean => {
      const { lastSynced } = store
      if (!lastSynced()) return true

      const now = Date.now()
      const elapsed = now - lastSynced()!
      const hasExpired = elapsed > CACHE_DURATION_MS

      if (hasExpired !== store.hasExpired()) {
        patchState(store, { hasExpired })
      }

      return hasExpired
    }

    /**
     * Get formatted "Last synced" timestamp for UI display
     * per spec.md FR-040
     */
    const getLastSyncedFormatted = (): string => {
      const { lastSynced } = store
      if (!lastSynced()) return 'Mai sincronizzato'

      const now = Date.now()
      const elapsed = now - lastSynced()!

      // Less than 1 minute
      if (elapsed < 60 * 1000) {
        return 'Appena sincronizzato'
      }

      // Less than 1 hour
      if (elapsed < 60 * 60 * 1000) {
        const minutes = Math.floor(elapsed / (60 * 1000))
        return `${minutes} minuti fa`
      }

      // Less than 24 hours
      if (elapsed < 24 * 60 * 60 * 1000) {
        const hours = Math.floor(elapsed / (60 * 60 * 1000))
        return `${hours} ore fa`
      }

      // More than 24 hours (expired)
      const days = Math.floor(elapsed / (24 * 60 * 60 * 1000))
      return `${days} giorni fa (scaduto)`
    }

    /**
     * Check if a specific permission exists in cache
     */
    const hasPermission = (permission: string): boolean => {
      const { permissions } = store
      return permissions().includes(permission)
    }

    /**
     * Check if user has any of the specified roles
     */
    const hasAnyRole = (roles: string[]): boolean => {
      const { roles: userRoles } = store
      return roles.some(role => userRoles().includes(role))
    }

    return {
      // Lifecycle methods
      initDB,
      cachePermissions,
      loadCachedPermissions,
      clearCache,

      // Status methods
      setOnlineStatus,
      setSyncingStatus,
      checkExpiration,
      getLastSyncedFormatted,

      // Permission checks
      hasPermission,
      hasAnyRole,
    }
  })
)

/**
 * Injectable wrapper for use in components
 */
@Injectable({ providedIn: 'root' })
export class OfflinePermissionService {
  constructor(private store: typeof OfflinePermissionStore) {}

  get permissions$() {
    return this.store.permissions
  }

  get lastSynced$() {
    return this.store.lastSynced
  }

  get isOnline$() {
    return this.store.isOnline
  }

  get hasExpired$() {
    return this.store.hasExpired
  }

  async cachePermissions(userId: string, tenantId: string, permissions: string[], roles: string[]) {
    return this.store.cachePermissions(userId, tenantId, permissions, roles)
  }

  async loadCachedPermissions(userId: string) {
    return this.store.loadCachedPermissions(userId)
  }

  async clearCache(userId: string) {
    return this.store.clearCache(userId)
  }

  setOnlineStatus(isOnline: boolean) {
    this.store.setOnlineStatus(isOnline)
  }

  setSyncingStatus(isSyncing: boolean) {
    this.store.setSyncingStatus(isSyncing)
  }

  checkExpiration(): boolean {
    return this.store.checkExpiration()
  }

  getLastSyncedFormatted(): string {
    return this.store.getLastSyncedFormatted()
  }

  hasPermission(permission: string): boolean {
    return this.store.hasPermission(permission)
  }

  hasAnyRole(roles: string[]): boolean {
    return this.store.hasAnyRole(roles)
  }
}
