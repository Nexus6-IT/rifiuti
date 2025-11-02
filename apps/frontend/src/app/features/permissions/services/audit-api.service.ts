import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * AuditApiService
 * HTTP client for audit trail API endpoints
 * T159: Audit API service per User Story 4
 *
 * Purpose: Provide typed API access to audit trail endpoints
 *
 * Requirements from spec.md:
 * - Query audit logs with filters
 * - Export to CSV
 * - Get role changes
 * - Reconstruct historical permissions
 * - Get statistics
 * - Validate chain integrity
 */
@Injectable({
  providedIn: 'root',
})
export class AuditApiService {
  private readonly baseUrl = '/api/v1/audit';

  constructor(private readonly http: HttpClient) {}

  /**
   * Get audit trail with filters
   */
  getAuditTrail(filters: {
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    decision?: 'ALLOW' | 'DENY';
    resourceType?: string;
    resourceId?: string;
    actionAttempted?: string;
    page?: number;
    pageSize?: number;
  }): Observable<{
    success: boolean;
    data: {
      logs: Array<{
        id: string;
        userId: string;
        tenantId: string;
        actionAttempted: string;
        resourceType?: string;
        resourceId?: string;
        decision: 'ALLOW' | 'DENY';
        reason?: string;
        spidFiscalCode?: string;
        sessionId?: string;
        ipAddress?: string;
        userAgent?: string;
        timestamp: string;
        hash?: string;
        previousHash: string;
      }>;
      pagination: {
        total: number;
        page?: number;
        pageSize?: number;
        totalPages: number;
      };
      performanceMetrics?: {
        queryTimeMs: number;
        exceededTarget: boolean;
      };
    };
  }> {
    let params = new HttpParams();

    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.startDate) params = params.set('startDate', filters.startDate.toISOString());
    if (filters.endDate) params = params.set('endDate', filters.endDate.toISOString());
    if (filters.decision) params = params.set('decision', filters.decision);
    if (filters.resourceType) params = params.set('resourceType', filters.resourceType);
    if (filters.resourceId) params = params.set('resourceId', filters.resourceId);
    if (filters.actionAttempted) params = params.set('actionAttempted', filters.actionAttempted);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.pageSize) params = params.set('pageSize', filters.pageSize.toString());

    return this.http.get<any>(`${this.baseUrl}/permissions`, { params });
  }

  /**
   * Export audit trail to CSV
   */
  exportAuditTrail(filters: {
    userId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Observable<Blob> {
    let params = new HttpParams();

    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.startDate) params = params.set('startDate', filters.startDate.toISOString());
    if (filters.endDate) params = params.set('endDate', filters.endDate.toISOString());

    return this.http.get(`${this.baseUrl}/permissions/export`, {
      params,
      responseType: 'blob',
    });
  }

  /**
   * Get role changes
   */
  getRoleChanges(filters: {
    userId?: string;
    roleId?: string;
    changedBy?: string;
    startDate?: Date;
    endDate?: Date;
    changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION';
    page?: number;
    pageSize?: number;
  }): Observable<{
    success: boolean;
    data: {
      changes: Array<{
        id: string;
        userId: string;
        tenantId: string;
        oldRoleId?: string;
        newRoleId?: string;
        changedBy: string;
        reason: string;
        timestamp: string;
        effectiveDate: string;
      }>;
      pagination: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    };
  }> {
    let params = new HttpParams();

    if (filters.userId) params = params.set('userId', filters.userId);
    if (filters.roleId) params = params.set('roleId', filters.roleId);
    if (filters.changedBy) params = params.set('changedBy', filters.changedBy);
    if (filters.startDate) params = params.set('startDate', filters.startDate.toISOString());
    if (filters.endDate) params = params.set('endDate', filters.endDate.toISOString());
    if (filters.changeType) params = params.set('changeType', filters.changeType);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.pageSize) params = params.set('pageSize', filters.pageSize.toString());

    return this.http.get<any>(`${this.baseUrl}/role-changes`, { params });
  }

  /**
   * Reconstruct historical permissions
   */
  reconstructHistoricalPermissions(
    userId: string,
    timestamp: Date,
  ): Observable<{
    success: boolean;
    data: {
      userId: string;
      tenantId: string;
      timestamp: string;
      roleId?: string;
      roleName?: string;
      permissions: string[];
      hadAccess: boolean;
      reconstructionMetadata: {
        queryTimeMs: number;
        roleChangeFound: boolean;
        roleFound: boolean;
      };
    };
  }> {
    return this.http.post<any>(`${this.baseUrl}/reconstruct`, {
      userId,
      timestamp: timestamp.toISOString(),
    });
  }

  /**
   * Get audit statistics
   */
  getStatistics(filters?: {
    startDate?: Date;
    endDate?: Date;
  }): Observable<{
    success: boolean;
    data: {
      totalLogs: number;
      allowedCount: number;
      deniedCount: number;
      uniqueUsers: number;
      topDeniedActions: Array<{ action: string; count: number }>;
    };
  }> {
    let params = new HttpParams();

    if (filters?.startDate) params = params.set('startDate', filters.startDate.toISOString());
    if (filters?.endDate) params = params.set('endDate', filters.endDate.toISOString());

    return this.http.get<any>(`${this.baseUrl}/stats`, { params });
  }

  /**
   * Validate chain integrity
   */
  validateChainIntegrity(filters?: {
    startDate?: Date;
    endDate?: Date;
  }): Observable<{
    success: boolean;
    data: {
      isValid: boolean;
      totalLogs: number;
      firstInvalidLogId?: string;
      error?: string;
    };
  }> {
    return this.http.post<any>(`${this.baseUrl}/validate-chain`, {
      startDate: filters?.startDate?.toISOString(),
      endDate: filters?.endDate?.toISOString(),
    });
  }
}
