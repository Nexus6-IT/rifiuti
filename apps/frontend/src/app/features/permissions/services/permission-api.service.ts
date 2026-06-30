import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'

/**
 * PermissionApiService
 * HTTP client for permission-related API endpoints
 * Per plan.md: Frontend service layer for permission operations
 */
@Injectable({
  providedIn: 'root',
})
export class PermissionApiService {
  private readonly baseUrl = '/api/v1/permissions'

  constructor(private http: HttpClient) {}

  /**
   * GET /api/v1/permissions/my-permissions
   * Fetch current user's effective permissions
   */
  getMyPermissions(includeTemp: boolean = false): Observable<PermissionsResponse> {
    const params = new HttpParams().set('includeTemp', includeTemp.toString())

    return this.http.get<PermissionsResponse>(`${this.baseUrl}/my-permissions`, {
      params,
    })
  }

  /**
   * GET /api/v1/permissions/me
   * Alias for getMyPermissions (backward compatibility)
   */
  getPermissionsMe(includeTemp: boolean = false): Observable<PermissionsResponse> {
    return this.getMyPermissions(includeTemp)
  }
}

/**
 * Response interfaces
 */
export interface PermissionsResponse {
  permissions: string[]
  facilityIds: string[]
  source: 'cache' | 'database'
  cachedAt: string
}
