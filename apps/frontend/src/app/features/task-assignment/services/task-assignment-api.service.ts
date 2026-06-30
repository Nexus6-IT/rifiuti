import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../../environments/environment'

/**
 * TaskAssignmentApiService
 * T193: API service for User Story 6 - Task Assignment Automation
 *
 * Purpose: Communicate with backend task assignment endpoints
 */

export interface QualifiedDriver {
  userId: string
  vehicleId: string
  certifications: string[]
  zone: string
  capacity: number
  currentWorkload: number
  availableCapacity: number
  score: number
}

export interface AssignmentResult {
  assignedDriverId: string
  assignmentMethod: 'automatic' | 'manual'
  warnings?: string[]
}

export interface ReassignmentResult {
  previousDriverId: string
  newDriverId: string
  reason: string
  warnings?: string[]
}

export interface PickupLocation {
  address: string
  latitude: number
  longitude: number
  distance?: number // meters from driver's current location
}

export interface DeliveryLocation {
  address: string
  latitude: number
  longitude: number
}

export interface MyAssignment {
  firId: string
  firNumber: string
  cerCode: string
  wasteDescription: string
  quantity: number
  unit: string
  transportDate: string // ISO 8601 datetime
  pickupLocation: PickupLocation
  deliveryLocation: DeliveryLocation
  status: 'AWAITING_CARRIER' | 'IN_TRANSIT' | 'COMPLETED' | 'FAILED'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  estimatedDuration?: number // minutes
}

export interface MyAssignmentsResponse {
  driverId: string
  assignments: MyAssignment[]
  totalAssignments: number
  vehicleInfo: {
    capacity: number
    currentLoad: number
    availableCapacity: number
  }
}

@Injectable({
  providedIn: 'root',
})
export class TaskAssignmentApiService {
  private readonly baseUrl = `${environment.apiUrl}/api/v1/tasks`

  constructor(private http: HttpClient) {}

  /**
   * Get list of qualified drivers for a FIR
   */
  getQualifiedDrivers(firId: string): Observable<{
    success: boolean
    data: {
      firId: string
      qualifiedDrivers: QualifiedDriver[]
      totalQualified: number
    }
    message: string
  }> {
    return this.http.get<any>(`${this.baseUrl}/${firId}/qualified-drivers`)
  }

  /**
   * Assign task automatically (find best qualified driver)
   */
  autoAssignTask(firId: string): Observable<{
    success: boolean
    data: AssignmentResult
    message: string
  }> {
    return this.http.post<any>(`${this.baseUrl}/${firId}/assign`, {})
  }

  /**
   * Manually assign task to specific driver
   */
  manualAssignTask(
    firId: string,
    driverId: string,
    reason?: string
  ): Observable<{
    success: boolean
    data: AssignmentResult
    message: string
  }> {
    return this.http.post<any>(`${this.baseUrl}/${firId}/assign`, {
      driverId,
      reason,
    })
  }

  /**
   * Reassign task to different driver
   */
  reassignTask(
    firId: string,
    newDriverId: string,
    reason: string
  ): Observable<{
    success: boolean
    data: ReassignmentResult
    message: string
  }> {
    return this.http.put<any>(`${this.baseUrl}/${firId}/reassign`, {
      newDriverId,
      reason,
    })
  }

  /**
   * T193: Get my assignments (driver view)
   * Returns all assigned FIRs for the current driver
   * Driver can sort by proximity using GPS
   */
  getMyAssignments(): Observable<{
    success: boolean
    data: MyAssignmentsResponse
    message: string
  }> {
    return this.http.get<any>(`${this.baseUrl}/my-assignments`)
  }
}
