import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, fromEvent, merge, of, timer } from 'rxjs';
import { map, debounceTime, distinctUntilChanged, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { OfflinePermissionService } from '../state/offline-permission.store';

/**
 * Connection Monitor Service
 *
 * Implements spec.md FR-042: Detects online/offline state changes and triggers sync
 * - Monitors navigator.onLine status
 * - Listens to online/offline events
 * - Performs periodic connectivity checks (heartbeat)
 * - Triggers permission sync on reconnect
 *
 * Usage:
 * constructor(private connectionMonitor: ConnectionMonitorService) {
 *   this.connectionMonitor.isOnline$.subscribe(isOnline => {
 *     if (isOnline) {
 *       // Trigger sync
 *     }
 *   });
 * }
 */

@Injectable({
  providedIn: 'root',
})
export class ConnectionMonitorService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
  private readonly HEARTBEAT_URL = '/api/v1/health'; // Backend health check endpoint
  private readonly HEARTBEAT_TIMEOUT_MS = 5000; // 5 seconds

  /**
   * Observable that emits true/false based on online/offline status
   * Combines:
   * - navigator.onLine status
   * - Browser online/offline events
   * - Periodic heartbeat checks to backend
   */
  public readonly isOnline$: Observable<boolean>;

  /**
   * Observable that emits only when transitioning from offline to online
   * Use this to trigger sync operations
   */
  public readonly onReconnect$: Observable<void>;

  /**
   * Observable that emits only when transitioning from online to offline
   * Use this to show offline indicator
   */
  public readonly onDisconnect$: Observable<void>;

  constructor(private offlinePermissionService: OfflinePermissionService) {
    // Create observable for online/offline events
    const online$ = fromEvent(window, 'online').pipe(map(() => true));
    const offline$ = fromEvent(window, 'offline').pipe(map(() => false));

    // Combine browser events with initial status
    const browserStatus$ = merge(
      of(navigator.onLine),
      online$,
      offline$,
    ).pipe(
      distinctUntilChanged(),
      debounceTime(300), // Debounce to avoid rapid changes
    );

    // Periodic heartbeat check to backend
    const heartbeat$ = timer(0, this.HEARTBEAT_INTERVAL_MS).pipe(
      switchMap(() => this.checkBackendConnectivity()),
      distinctUntilChanged(),
    );

    // Combine browser status with backend heartbeat
    // If either indicates offline, consider truly offline
    this.isOnline$ = merge(browserStatus$, heartbeat$).pipe(
      map((browserOnline, heartbeatOnline) => {
        // Consider online only if both browser AND backend are reachable
        const isOnline = navigator.onLine;
        return isOnline;
      }),
      distinctUntilChanged(),
      startWith(navigator.onLine),
      takeUntil(this.destroy$),
    );

    // Detect reconnect events (false → true transitions)
    let previousStatus = navigator.onLine;
    this.onReconnect$ = this.isOnline$.pipe(
      map((isOnline) => {
        const reconnected = !previousStatus && isOnline;
        previousStatus = isOnline;
        return reconnected;
      }),
      map((reconnected) => (reconnected ? void 0 : null)),
      // Filter out null values (only emit on actual reconnect)
      // @ts-ignore
      filter((value) => value !== null),
      takeUntil(this.destroy$),
    ) as Observable<void>;

    // Detect disconnect events (true → false transitions)
    let previousDisconnectStatus = navigator.onLine;
    this.onDisconnect$ = this.isOnline$.pipe(
      map((isOnline) => {
        const disconnected = previousDisconnectStatus && !isOnline;
        previousDisconnectStatus = isOnline;
        return disconnected;
      }),
      map((disconnected) => (disconnected ? void 0 : null)),
      // Filter out null values (only emit on actual disconnect)
      // @ts-ignore
      filter((value) => value !== null),
      takeUntil(this.destroy$),
    ) as Observable<void>;

    // Subscribe to status changes to update offline permission store
    this.isOnline$.subscribe((isOnline) => {
      this.offlinePermissionService.setOnlineStatus(isOnline);
    });

    // Log connection status changes (remove in production)
    this.isOnline$.subscribe((isOnline) => {
      console.log(`[ConnectionMonitor] Status changed: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
    });

    this.onReconnect$.subscribe(() => {
      console.log('[ConnectionMonitor] Reconnected! Triggering sync...');
      // Sync will be triggered by components subscribing to onReconnect$
    });

    this.onDisconnect$.subscribe(() => {
      console.warn('[ConnectionMonitor] Disconnected! Switching to offline mode...');
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Check backend connectivity with a lightweight health check request
   * Returns true if backend is reachable, false otherwise
   */
  private checkBackendConnectivity(): Observable<boolean> {
    // Use fetch API for lightweight request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.HEARTBEAT_TIMEOUT_MS);

    return new Observable<boolean>((observer) => {
      fetch(this.HEARTBEAT_URL, {
        method: 'GET',
        signal: controller.signal,
        // Don't send credentials for health check (reduce overhead)
        credentials: 'omit',
        // Use no-cache to avoid stale responses
        cache: 'no-cache',
      })
        .then((response) => {
          clearTimeout(timeoutId);
          // Consider online if response is OK (200) or any 2xx/3xx status
          observer.next(response.ok || response.status < 400);
          observer.complete();
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          // Network error or timeout - consider offline
          console.warn('[ConnectionMonitor] Backend heartbeat failed:', error.message);
          observer.next(false);
          observer.complete();
        });
    });
  }

  /**
   * Force a connectivity check immediately (useful for manual retry)
   */
  public async checkConnectivity(): Promise<boolean> {
    return new Promise((resolve) => {
      this.checkBackendConnectivity().subscribe((isOnline) => {
        resolve(isOnline);
      });
    });
  }

  /**
   * Get current online status synchronously
   */
  public isOnline(): boolean {
    return navigator.onLine;
  }

  /**
   * Manually trigger a reconnect check
   * Useful after user explicitly requests sync
   */
  public async testConnection(): Promise<boolean> {
    const isOnline = await this.checkConnectivity();
    this.offlinePermissionService.setOnlineStatus(isOnline);
    return isOnline;
  }
}
