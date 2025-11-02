import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, interval, switchMap, takeWhile, map } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * RENTRI Sync Service
 *
 * Handles RENTRI synchronization operations from Angular frontend.
 *
 * Features:
 * - Trigger single FIR sync
 * - Trigger batch FIR sync
 * - Poll job status
 * - Query sync logs
 * - Get queue metrics
 */
@Injectable({
  providedIn: 'root',
})
export class RENTRISyncService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/rentri/sync`;

  /**
   * Sync single FIR to RENTRI
   */
  syncFIR(
    firId: string,
    options?: {
      priority?: 'high' | 'normal' | 'low';
      delay?: number;
      correlationId?: string;
    }
  ): Observable<SyncFIRResponse> {
    return this.http.post<SyncFIRResponse>(
      `${this.baseUrl}/fir/${firId}`,
      {
        priority: options?.priority || 'normal',
        delay: options?.delay || 0,
        correlationId: options?.correlationId,
      }
    );
  }

  /**
   * Batch sync multiple FIRs to RENTRI
   */
  batchSync(
    firIds: string[],
    options?: {
      priority?: 'high' | 'normal' | 'low';
      correlationId?: string;
    }
  ): Observable<BatchSyncResponse> {
    return this.http.post<BatchSyncResponse>(
      `${this.baseUrl}/batch`,
      {
        firIds,
        priority: options?.priority || 'normal',
        correlationId: options?.correlationId,
      }
    );
  }

  /**
   * Get sync job status
   */
  getSyncStatus(jobId: string): Observable<SyncJobStatus> {
    return this.http.get<SyncJobStatus>(`${this.baseUrl}/status/${jobId}`);
  }

  /**
   * Poll sync job status until completion or failure
   *
   * Polls every 2 seconds and completes when job is done
   */
  pollSyncStatus(
    jobId: string,
    pollIntervalMs: number = 2000
  ): Observable<SyncJobStatus> {
    return interval(pollIntervalMs).pipe(
      switchMap(() => this.getSyncStatus(jobId)),
      takeWhile(
        (status) =>
          status.status === 'pending' ||
          status.status === 'delayed' ||
          status.status === 'processing',
        true // Include last emission
      )
    );
  }

  /**
   * Get sync audit logs with pagination and filters
   */
  getSyncLogs(params?: {
    firId?: string;
    status?: 'SUCCESS' | 'FAILURE' | 'PENDING';
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Observable<SyncLogsResponse> {
    let httpParams = new HttpParams();

    if (params?.firId) {
      httpParams = httpParams.set('firId', params.firId);
    }

    if (params?.status) {
      httpParams = httpParams.set('status', params.status);
    }

    if (params?.dateFrom) {
      httpParams = httpParams.set('dateFrom', params.dateFrom);
    }

    if (params?.dateTo) {
      httpParams = httpParams.set('dateTo', params.dateTo);
    }

    if (params?.page) {
      httpParams = httpParams.set('page', params.page.toString());
    }

    if (params?.limit) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    return this.http.get<SyncLogsResponse>(`${this.baseUrl}/logs`, {
      params: httpParams,
    });
  }

  /**
   * Get queue metrics
   */
  getQueueMetrics(): Observable<QueueMetrics> {
    return this.http.get<QueueMetrics>(`${this.baseUrl}/metrics`);
  }

  /**
   * Check if FIR sync is in progress
   */
  isSyncInProgress(jobId: string): Observable<boolean> {
    return this.getSyncStatus(jobId).pipe(
      map(
        (status) =>
          status.status === 'pending' ||
          status.status === 'delayed' ||
          status.status === 'processing'
      )
    );
  }

  /**
   * Check if FIR sync completed successfully
   */
  isSyncCompleted(jobId: string): Observable<boolean> {
    return this.getSyncStatus(jobId).pipe(
      map((status) => status.status === 'completed')
    );
  }

  /**
   * Check if FIR sync failed
   */
  isSyncFailed(jobId: string): Observable<boolean> {
    return this.getSyncStatus(jobId).pipe(
      map((status) => status.status === 'failed')
    );
  }
}

/**
 * Type Definitions
 */

export interface SyncFIRResponse {
  jobId: string;
  firId: string;
  message: string;
  estimatedStartTime?: string;
}

export interface BatchSyncResponse {
  batchJobId: string;
  queuedCount: number;
  skippedCount: number;
  message: string;
}

export interface SyncJobStatus {
  jobId: string;
  status: 'pending' | 'delayed' | 'processing' | 'completed' | 'failed';
  progress: number;
  data: any;
  result?: any;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: Date;
  finishedOn?: Date;
}

export interface SyncLogEntry {
  id: string;
  firId: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  attempt: number;
  errorMessage?: string;
  errorCode?: string;
  protocolNumber?: string;
  syncedAt?: Date;
  durationMs?: number;
  createdAt: Date;
}

export interface SyncLogsResponse {
  data: SyncLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface QueueMetrics {
  global: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  };
  tenant?: {
    waiting: number;
    active: number;
    failed: number;
  };
}
