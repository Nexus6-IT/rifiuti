import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * TemporaryPermissionApiService
 * T214: API service for User Story 7 - Temporary Permission Requests
 */

export interface PermissionGrant {
  id: string;
  userId?: string;
  permissions: string[];
  startTime: string;
  endTime: string;
  justification: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  requestedAt: string;
  requestedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalReason?: string;
  revokedBy?: string;
  revokedAt?: string;
  isActive?: boolean;
  isExpired?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class TemporaryPermissionApiService {
  private readonly baseUrl = `${environment.apiUrl}/api/v1/permissions`;

  constructor(private http: HttpClient) {}

  /**
   * Submit temporary permission request
   */
  requestPermission(data: {
    permissions: string[];
    startTime: string;
    endTime: string;
    justification: string;
  }): Observable<{ success: boolean; data: any; message: string }> {
    return this.http.post<any>(`${this.baseUrl}/request`, data);
  }

  /**
   * List pending permission requests (admin only)
   */
  listPending(): Observable<{
    success: boolean;
    data: { grants: PermissionGrant[]; total: number };
    message: string;
  }> {
    return this.http.get<any>(`${this.baseUrl}/pending`);
  }

  /**
   * Approve permission request
   */
  approve(
    grantId: string,
    reason: string,
  ): Observable<{ success: boolean; data: any; message: string }> {
    return this.http.post<any>(`${this.baseUrl}/${grantId}/approve`, { reason });
  }

  /**
   * Reject permission request
   */
  reject(
    grantId: string,
    reason: string,
  ): Observable<{ success: boolean; data: any; message: string }> {
    return this.http.post<any>(`${this.baseUrl}/${grantId}/reject`, { reason });
  }

  /**
   * Revoke active permission grant
   */
  revoke(
    grantId: string,
    reason: string,
  ): Observable<{ success: boolean; data: any; message: string }> {
    return this.http.post<any>(`${this.baseUrl}/${grantId}/revoke`, { reason });
  }

  /**
   * List current user's permission grants
   */
  listMyGrants(): Observable<{
    success: boolean;
    data: { grants: PermissionGrant[]; total: number };
    message: string;
  }> {
    return this.http.get<any>(`${this.baseUrl}/my-grants`);
  }
}
