import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, from, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ConnectionMonitorService } from './connection-monitor.service';
import { OfflinePermissionService } from '../state/offline-permission.store';

/**
 * Permission Sync Queue Service
 *
 * Implements spec.md FR-042: Queue permission changes made offline and sync on reconnect
 * - Stores permission-related operations in IndexedDB while offline
 * - Automatically syncs when connection is restored
 * - Retries failed operations with exponential backoff
 * - Resolves conflicts (server wins strategy)
 *
 * Queued Operations:
 * - Role assignments
 * - Permission grants
 * - Temporary permission requests
 * - Custom role creation/modification
 */

interface SyncQueueDB extends DBSchema {
  queue: {
    key: number; // auto-increment ID
    value: QueuedOperation;
    indexes: { timestamp: number; status: string };
  };
}

interface QueuedOperation {
  id?: number; // auto-generated
  type: 'ASSIGN_ROLE' | 'REQUEST_PERMISSION' | 'CREATE_CUSTOM_ROLE' | 'UPDATE_ROLE';
  payload: any;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  timestamp: number;
  retryCount: number;
  status: 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PermissionSyncQueueService {
  private db: IDBPDatabase<SyncQueueDB> | null = null;
  private readonly syncProgress$ = new Subject<{
    total: number;
    completed: number;
    failed: number;
  }>();

  private readonly MAX_RETRIES = 3;
  private readonly BASE_RETRY_DELAY_MS = 1000; // 1 second
  private isSyncing = false;

  constructor(
    private http: HttpClient,
    private connectionMonitor: ConnectionMonitorService,
    private offlinePermissionService: OfflinePermissionService,
  ) {
    this.initDB();
    this.setupAutoSync();
  }

  /**
   * Initialize IndexedDB for sync queue
   */
  private async initDB(): Promise<void> {
    this.db = await openDB<SyncQueueDB>('WasteFlowSyncQueue', 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('queue')) {
          const store = database.createObjectStore('queue', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('status', 'status');
        }
      },
    });
  }

  /**
   * Setup automatic sync when connection is restored
   * per spec.md FR-042
   */
  private setupAutoSync(): void {
    this.connectionMonitor.onReconnect$.subscribe(() => {
      console.log('[SyncQueue] Connection restored, triggering auto-sync...');
      this.syncAll();
    });
  }

  /**
   * Add operation to sync queue (called when offline)
   */
  async queueOperation(
    type: QueuedOperation['type'],
    endpoint: string,
    method: QueuedOperation['method'],
    payload: any,
  ): Promise<void> {
    if (!this.db) await this.initDB();

    const operation: QueuedOperation = {
      type,
      payload,
      endpoint,
      method,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'PENDING',
    };

    await this.db!.add('queue', operation);
    console.log(`[SyncQueue] Queued ${type} operation for later sync`);
  }

  /**
   * Get all pending operations
   */
  async getPendingOperations(): Promise<QueuedOperation[]> {
    if (!this.db) await this.initDB();

    const all = await this.db!.getAll('queue');
    return all.filter((op) => op.status === 'PENDING' || op.status === 'FAILED');
  }

  /**
   * Sync all queued operations
   * Returns number of successfully synced operations
   */
  async syncAll(): Promise<{ completed: number; failed: number; total: number }> {
    if (this.isSyncing) {
      console.warn('[SyncQueue] Sync already in progress, skipping...');
      return { completed: 0, failed: 0, total: 0 };
    }

    if (!this.connectionMonitor.isOnline()) {
      console.warn('[SyncQueue] Cannot sync while offline');
      return { completed: 0, failed: 0, total: 0 };
    }

    this.isSyncing = true;
    this.offlinePermissionService.setSyncingStatus(true);

    const pending = await this.getPendingOperations();
    let completed = 0;
    let failed = 0;

    console.log(`[SyncQueue] Starting sync of ${pending.length} operations...`);

    for (const operation of pending) {
      try {
        await this.syncOperation(operation);
        completed++;
        this.syncProgress$.next({ total: pending.length, completed, failed });
      } catch (error) {
        failed++;
        console.error(`[SyncQueue] Failed to sync operation ${operation.id}:`, error);
        this.syncProgress$.next({ total: pending.length, completed, failed });
      }
    }

    this.isSyncing = false;
    this.offlinePermissionService.setSyncingStatus(false);

    console.log(`[SyncQueue] Sync complete: ${completed} succeeded, ${failed} failed`);

    return { completed, failed, total: pending.length };
  }

  /**
   * Sync a single operation
   */
  private async syncOperation(operation: QueuedOperation): Promise<void> {
    if (!this.db) await this.initDB();

    // Mark as syncing
    operation.status = 'SYNCING';
    await this.db!.put('queue', operation);

    try {
      // Execute HTTP request
      const result = await this.executeRequest(operation).toPromise();

      // Mark as completed
      operation.status = 'COMPLETED';
      await this.db!.put('queue', operation);

      // Clean up completed operations after 7 days
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (operation.timestamp < sevenDaysAgo) {
        await this.db!.delete('queue', operation.id!);
      }
    } catch (error: any) {
      operation.retryCount++;

      if (operation.retryCount >= this.MAX_RETRIES) {
        // Max retries exceeded, mark as failed
        operation.status = 'FAILED';
        operation.error = error.message || 'Unknown error';
        await this.db!.put('queue', operation);
        throw error;
      } else {
        // Retry with exponential backoff
        const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, operation.retryCount);
        console.log(`[SyncQueue] Retrying operation ${operation.id} in ${delay}ms (attempt ${operation.retryCount}/${this.MAX_RETRIES})`);

        await new Promise((resolve) => setTimeout(resolve, delay));

        // Retry
        operation.status = 'PENDING';
        await this.db!.put('queue', operation);
        return this.syncOperation(operation);
      }
    }
  }

  /**
   * Execute HTTP request for queued operation
   */
  private executeRequest(operation: QueuedOperation): Observable<any> {
    const { endpoint, method, payload } = operation;

    switch (method) {
      case 'POST':
        return this.http.post(endpoint, payload);
      case 'PUT':
        return this.http.put(endpoint, payload);
      case 'DELETE':
        return this.http.delete(endpoint);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  /**
   * Get sync progress observable
   * Emits { total, completed, failed } during sync
   */
  getSyncProgress(): Observable<{ total: number; completed: number; failed: number }> {
    return this.syncProgress$.asObservable();
  }

  /**
   * Clear all completed operations from queue
   */
  async clearCompleted(): Promise<void> {
    if (!this.db) await this.initDB();

    const all = await this.db!.getAll('queue');
    const completed = all.filter((op) => op.status === 'COMPLETED');

    for (const op of completed) {
      await this.db!.delete('queue', op.id!);
    }

    console.log(`[SyncQueue] Cleared ${completed.length} completed operations`);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    syncing: number;
    completed: number;
    failed: number;
  }> {
    if (!this.db) await this.initDB();

    const all = await this.db!.getAll('queue');

    return {
      pending: all.filter((op) => op.status === 'PENDING').length,
      syncing: all.filter((op) => op.status === 'SYNCING').length,
      completed: all.filter((op) => op.status === 'COMPLETED').length,
      failed: all.filter((op) => op.status === 'FAILED').length,
    };
  }

  /**
   * Retry all failed operations
   */
  async retryFailed(): Promise<void> {
    if (!this.db) await this.initDB();

    const failed = await this.db!.index('status').getAll('FAILED');

    for (const operation of failed) {
      operation.status = 'PENDING';
      operation.retryCount = 0; // Reset retry count
      operation.error = undefined;
      await this.db!.put('queue', operation);
    }

    console.log(`[SyncQueue] Reset ${failed.length} failed operations for retry`);

    // Trigger sync
    await this.syncAll();
  }
}
