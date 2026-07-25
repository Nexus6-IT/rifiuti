import { computed, inject } from '@angular/core'
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals'
import { rxMethod } from '@ngrx/signals/rxjs-interop'
import { pipe, switchMap, tap, interval } from 'rxjs'
import { tapResponse } from '@ngrx/operators'
import { HttpClient } from '@angular/common/http'

/**
 * TempPermissionStore
 * NgRx SignalStore for managing temporary permission grants
 * Per plan.md FR-011: Temporary permission grants with business justification
 */

// Temporary permission grant entity
export interface TempPermissionGrant {
  id: string
  userId: string
  permissions: string[] // List of granted permissions
  startTime: string // ISO 8601 timestamp
  endTime: string // ISO 8601 timestamp
  grantedBy: string // User ID who granted
  grantedByName?: string // Display name
  businessJustification: string
  autoRevoked: boolean
  revokedAt: string | null
  isActive: boolean // Computed: not expired and not revoked
  remainingMinutes?: number // Computed: minutes until expiration
}

// State shape
interface TempPermissionState {
  grants: TempPermissionGrant[] // User's temporary permission grants
  isLoading: boolean
  error: string | null
  lastFetchedAt: number | null
}

// Initial state
const initialState: TempPermissionState = {
  grants: [],
  isLoading: false,
  error: null,
  lastFetchedAt: null,
}

export const TempPermissionStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(store => ({
    /**
     * Get all active (non-expired, non-revoked) grants
     */
    activeGrants: computed(() => {
      const now = new Date()
      return store.grants().filter(grant => {
        if (grant.revokedAt) return false
        const endTime = new Date(grant.endTime)
        return endTime.getTime() > now.getTime()
      })
    }),

    /**
     * Get all expired or revoked grants
     */
    inactiveGrants: computed(() => {
      const now = new Date()
      return store.grants().filter(grant => {
        if (grant.revokedAt) return true
        const endTime = new Date(grant.endTime)
        return endTime.getTime() <= now.getTime()
      })
    }),

    /**
     * Get all currently effective temporary permissions
     */
    effectivePermissions: computed(() => {
      const active = store.grants().filter(grant => grant.isActive && !grant.revokedAt)

      const permissionSet = new Set<string>()
      active.forEach(grant => {
        grant.permissions.forEach(p => permissionSet.add(p))
      })

      return Array.from(permissionSet)
    }),

    /**
     * Check if user has specific temporary permission
     */
    hasTempPermission: computed(() => (permission: string): boolean => {
      const effective = store.effectivePermissions()
      return effective.includes(permission)
    }),

    /**
     * Get grants expiring soon (within 30 minutes)
     */
    grantExpiringSoon: computed(() => {
      const now = new Date()
      const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000)

      return store.activeGrants().filter(grant => {
        const endTime = new Date(grant.endTime)
        return endTime.getTime() <= thirtyMinutesFromNow.getTime()
      })
    }),

    /**
     * Count of active grants
     */
    activeGrantCount: computed(() => {
      return store.activeGrants().length
    }),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    /**
     * Load temporary permission grants for current user
     *
     * NOTA (corretto in P4, 2026-07-25): chiamava `GET /api/v1/temp-permissions/me`,
     * rotta che il backend non ha mai servito (TemporaryPermissionController è
     * montato su `/api/v1/permissions` con endpoint `my-grants`, non
     * `temp-permissions/me`) — 404 costante. La forma della risposta del
     * backend differisce inoltre da `TempPermissionGrant` (es. `justification`
     * invece di `businessJustification`, `approvedBy` invece di `grantedBy`,
     * nessun campo `autoRevoked`): qui si adatta la risposta reale al modello
     * di store esistente invece di inventare nuovi endpoint o cambiare la
     * shape lato backend.
     */
    loadGrants: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(() =>
          http
            .get<{
              success: boolean
              data: {
                grants: Array<{
                  id: string
                  permissions: string[]
                  startTime: string
                  endTime: string
                  justification: string
                  status: 'pending' | 'approved' | 'rejected' | 'revoked'
                  requestedAt: string
                  approvedBy?: string
                  approvedAt?: string
                  approvalReason?: string
                  isActive: boolean
                  isExpired: boolean
                }>
                total: number
              }
            }>('/api/v1/permissions/my-grants')
            .pipe(
              tapResponse({
                next: response => {
                  // Adatta la shape del backend (TemporaryPermissionController)
                  // al modello TempPermissionGrant usato dallo store/direttive.
                  const now = new Date()
                  const enrichedGrants: TempPermissionGrant[] = response.data.grants.map(grant => {
                    const endTime = new Date(grant.endTime)
                    const isActive = grant.status === 'approved' && !grant.isExpired
                    const remainingMinutes = isActive
                      ? Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 60000))
                      : 0

                    return {
                      id: grant.id,
                      userId: '', // non presente nella risposta di /my-grants (implicito: utente corrente)
                      permissions: grant.permissions,
                      startTime: grant.startTime,
                      endTime: grant.endTime,
                      grantedBy: grant.approvedBy || '',
                      businessJustification: grant.justification,
                      autoRevoked: grant.status === 'revoked',
                      revokedAt: grant.status === 'revoked' ? grant.approvedAt || null : null,
                      isActive,
                      remainingMinutes,
                    }
                  })

                  patchState(store, {
                    grants: enrichedGrants,
                    isLoading: false,
                    error: null,
                    lastFetchedAt: Date.now(),
                  })
                },
                error: (error: Error) => {
                  console.error('Failed to load temp permissions:', error)
                  patchState(store, {
                    isLoading: false,
                    error: error.message || 'Failed to load temp permissions',
                  })
                },
              })
            )
        )
      )
    ),

    /**
     * Request new temporary permission grant
     *
     * NOTA (diagnosi P4, 2026-07-25, NON corretto qui): chiama ancora
     * `/api/v1/temp-permissions/request`, rotta inesistente lato backend
     * (l'endpoint reale è `POST /api/v1/permissions/request`). Non ha
     * consumer nel codice attuale (nessun componente chiama
     * `store.requestGrant(...)` — verificato via grep), quindi non è
     * raggiungibile da nessuna pagina instradata: lasciato inalterato per
     * restare nel perimetro "cablaggio", ma segnalato perché se in futuro
     * qualcuno lo richiama si romperà. Il percorso corretto già funzionante è
     * `TemporaryPermissionApiService` (usato da `my-grants.component.ts`).
     */
    requestGrant: rxMethod<{
      permissions: string[]
      duration: number // minutes
      businessJustification: string
    }>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(request =>
          http
            .post<{ grant: TempPermissionGrant }>('/api/v1/temp-permissions/request', request)
            .pipe(
              tapResponse({
                next: response => {
                  // Add new grant to store
                  const current = store.grants()
                  const now = new Date()
                  const endTime = new Date(response.grant.endTime)

                  const enrichedGrant = {
                    ...response.grant,
                    isActive: endTime.getTime() > now.getTime(),
                    remainingMinutes: Math.floor((endTime.getTime() - now.getTime()) / 60000),
                  }

                  patchState(store, {
                    grants: [...current, enrichedGrant],
                    isLoading: false,
                    error: null,
                  })
                },
                error: (error: Error) => {
                  console.error('Failed to request temp permission:', error)
                  patchState(store, {
                    isLoading: false,
                    error: error.message || 'Failed to request temp permission',
                  })
                },
              })
            )
        )
      )
    ),

    /**
     * Revoke temporary permission grant
     */
    revokeGrant: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { isLoading: true, error: null })),
        switchMap(grantId =>
          http.delete(`/api/v1/temp-permissions/${grantId}`).pipe(
            tapResponse({
              next: () => {
                // Mark grant as revoked
                const current = store.grants()
                const updated = current.map(grant =>
                  grant.id === grantId
                    ? {
                        ...grant,
                        revokedAt: new Date().toISOString(),
                        isActive: false,
                      }
                    : grant
                )

                patchState(store, {
                  grants: updated,
                  isLoading: false,
                  error: null,
                })
              },
              error: (error: Error) => {
                console.error('Failed to revoke temp permission:', error)
                patchState(store, {
                  isLoading: false,
                  error: error.message || 'Failed to revoke temp permission',
                })
              },
            })
          )
        )
      )
    ),

    /**
     * Clear grants (e.g., on logout)
     */
    clearGrants(): void {
      patchState(store, initialState)
    },

    /**
     * Refresh grants from server
     */
    refreshGrants(): void {
      store.loadGrants()
    },

    /**
     * Start auto-refresh for grants (checks every minute)
     * Returns unsubscribe function
     */
    startAutoRefresh(): () => void {
      const subscription = interval(60000).subscribe(() => {
        store.loadGrants()
      })

      return () => subscription.unsubscribe()
    },
  }))
)
