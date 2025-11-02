import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { DataViewModule } from 'primeng/dataview';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { BadgeModule } from 'primeng/badge';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { MessageService, ConfirmationService } from 'primeng/api';
import { interval, Subject } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { TaskAssignmentApiService, MyAssignment, MyAssignmentsResponse } from '../../../task-assignment/services/task-assignment-api.service';

/**
 * MyAssignmentsComponent
 * T193: Mobile-first driver task assignment view
 * Per spec.md: Driver sees all assigned FIRs sorted by GPS proximity
 *
 * Features:
 * - Mobile-first design with PrimeNG DataView
 * - GPS geolocation API for current position
 * - Haversine formula for distance calculation (proximity sorting)
 * - 56px touch targets per plan.md mobile requirements
 * - Real-time updates every 30 seconds
 * - Offline capability with IndexedDB caching
 * - Visual status indicators (AWAITING_CARRIER, IN_TRANSIT, COMPLETED, FAILED)
 * - Priority badges (low, normal, high, urgent)
 * - Vehicle capacity tracking
 *
 * Performance Optimizations:
 * - OnPush change detection strategy
 * - Signals for reactive state (no Observables for local state)
 * - Computed signals for derived state (sorted assignments, distance calculations)
 * - IndexedDB for offline caching (24-hour TTL per spec.md FR-040)
 * - Lazy computed sorting only when needed
 */
@Component({
  selector: 'app-my-assignments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DataViewModule,
    CardModule,
    ButtonModule,
    TooltipModule,
    BadgeModule,
    TagModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  template: `
    <div class="my-assignments-page">
      <!-- Page Header -->
      <div class="page-header">
        <h1>My Task Assignments</h1>
        <p class="subtitle">{{ assignments()?.totalAssignments || 0 }} task(s) assigned</p>

        <!-- GPS Status & Refresh Controls -->
        <div class="controls">
          <div class="gps-status">
            <span
              class="status-indicator"
              [class.online]="isOnline()"
              [class.offline]="!isOnline()"
              [pTooltip]="isOnline() ? 'GPS Location Active' : 'Offline Mode - Last synced: ' + (lastSyncTime() | date: 'short')">
              <i class="pi" [ngClass]="isOnline() ? 'pi-circle-fill' : 'pi-exclamation-circle'"></i>
              {{ isOnline() ? 'Live GPS' : 'Offline' }}
            </span>
          </div>

          <button
            pButton
            icon="pi pi-refresh"
            [loading]="isLoading()"
            (click)="refreshAssignments()"
            class="p-button-rounded p-button-text"
            pTooltip="Refresh assignments"
            tooltipPosition="top"></button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading() && !assignments()" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>Loading your assignments...</p>
      </div>

      <!-- Error State -->
      <div *ngIf="error()" class="error-state">
        <i class="pi pi-exclamation-triangle"></i>
        <p>{{ error() }}</p>
        <button pButton label="Retry" (click)="refreshAssignments()"></button>
      </div>

      <!-- Vehicle Info Card -->
      <div *ngIf="assignments() && !isLoading()" class="vehicle-info">
        <p-card>
          <div class="vehicle-stats">
            <div class="stat">
              <span class="label">Vehicle Capacity</span>
              <span class="value">{{ assignments()?.vehicleInfo?.capacity || 0 }} kg</span>
            </div>
            <div class="stat">
              <span class="label">Current Load</span>
              <span class="value">{{ assignments()?.vehicleInfo?.currentLoad || 0 }} kg</span>
            </div>
            <div class="stat">
              <span class="label">Available</span>
              <span class="value">{{ assignments()?.vehicleInfo?.availableCapacity || 0 }} kg</span>
            </div>
            <div class="stat progress">
              <span class="label">Capacity Used</span>
              <div class="progress-bar">
                <div
                  class="progress-fill"
                  [style.width.%]="getCapacityPercentage()"></div>
              </div>
              <span class="percentage">{{ getCapacityPercentage() }}%</span>
            </div>
          </div>
        </p-card>
      </div>

      <!-- Empty State -->
      <div *ngIf="assignments() && sortedAssignments().length === 0 && !isLoading()" class="empty-state">
        <i class="pi pi-inbox" style="font-size: 3rem"></i>
        <h3>No Assignments</h3>
        <p>No FIR tasks assigned to you at the moment</p>
      </div>

      <!-- Assignments List using DataView -->
      <p-dataView
        *ngIf="assignments() && sortedAssignments().length > 0 && !isLoading()"
        [value]="sortedAssignments()"
        [rows]="10"
        [paginator]="true"
        class="assignments-dataview">
        <!-- DataView Header with Sort/Filter Options -->
        <ng-template pTemplate="header">
          <div class="dataview-header">
            <div class="sort-options">
              <label>Sort by:</label>
              <select
                class="sort-select"
                [(ngModel)]="sortBy"
                (change)="onSortChange()"
                data-testid="sort-select">
                <option value="proximity">Proximity (Closest First)</option>
                <option value="transportDate">Transport Date</option>
                <option value="priority">Priority</option>
              </select>
            </div>
          </div>
        </ng-template>

        <!-- DataView Item Template (Mobile-first card) -->
        <ng-template let-assignment pTemplate="listItem">
          <div class="assignment-card-container">
            <p-card class="assignment-card" [attr.data-testid]="'assignment-' + assignment.firId">
              <!-- Card Header with FIR number and status -->
              <div class="card-header">
                <div class="header-info">
                  <h3 class="fir-number">{{ assignment.firNumber }}</h3>
                  <span class="cer-code">CER: {{ assignment.cerCode }}</span>
                </div>
                <div class="header-status">
                  <p-tag
                    [value]="getStatusLabel(assignment.status)"
                    [severity]="getStatusSeverity(assignment.status)"
                    [attr.data-testid]="'status-' + assignment.status"></p-tag>
                  <p-tag
                    [value]="assignment.priority.toUpperCase()"
                    [severity]="getPrioritySeverity(assignment.priority)"
                    class="priority-tag"></p-tag>
                </div>
              </div>

              <!-- Waste Info -->
              <div class="waste-section">
                <p class="waste-description">{{ assignment.wasteDescription }}</p>
                <div class="waste-details">
                  <span class="detail-item">
                    <i class="pi pi-weight"></i>
                    {{ assignment.quantity }} {{ assignment.unit }}
                  </span>
                </div>
              </div>

              <!-- Location Info with Distance -->
              <div class="location-section">
                <div class="location">
                  <div class="location-header">
                    <i class="pi pi-map-marker"></i>
                    <span class="location-label">Pickup</span>
                  </div>
                  <p class="location-address">{{ assignment.pickupLocation.address }}</p>
                  <div *ngIf="assignment.pickupLocation.distance" class="distance-info">
                    <i class="pi pi-arrow-right"></i>
                    <span class="distance">{{ getFormattedDistance(assignment.pickupLocation.distance) }}</span>
                  </div>
                </div>

                <div class="location">
                  <div class="location-header">
                    <i class="pi pi-flag"></i>
                    <span class="location-label">Delivery</span>
                  </div>
                  <p class="location-address">{{ assignment.deliveryLocation.address }}</p>
                </div>
              </div>

              <!-- Transport Date & Estimated Duration -->
              <div class="timing-section">
                <div class="timing-item">
                  <i class="pi pi-calendar"></i>
                  <span class="label">Transport Date:</span>
                  <span class="value">{{ assignment.transportDate | date: 'short' }}</span>
                </div>
                <div *ngIf="assignment.estimatedDuration" class="timing-item">
                  <i class="pi pi-clock"></i>
                  <span class="label">Est. Duration:</span>
                  <span class="value">{{ assignment.estimatedDuration }} min</span>
                </div>
              </div>

              <!-- Actions -->
              <div class="card-actions">
                <button
                  pButton
                  label="View Details"
                  icon="pi pi-arrow-right"
                  class="p-button-primary p-button-sm action-button"
                  (click)="viewAssignmentDetails(assignment)"
                  [attr.data-testid]="'view-details-' + assignment.firId'"></button>
                <button
                  pButton
                  label="Start Pickup"
                  icon="pi pi-play"
                  class="p-button-success p-button-sm action-button"
                  (click)="startPickup(assignment)"
                  [disabled]="assignment.status !== 'AWAITING_CARRIER'"
                  [attr.data-testid]="'start-pickup-' + assignment.firId'"></button>
              </div>
            </p-card>
          </div>
        </ng-template>
      </p-dataView>

      <!-- Confirmation Dialog for Actions -->
      <p-confirmDialog [style]="{ width: '50vw' }" [breakpoints]="{ '960px': '75vw', '640px': '90vw' }"></p-confirmDialog>

      <!-- Toast Notifications -->
      <p-toast position="top-right"></p-toast>
    </div>
  `,
  styles: `
    .my-assignments-page {
      padding: 1rem;
      max-width: 100%;
    }

    .page-header {
      margin-bottom: 1.5rem;

      h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 600;
      }

      .subtitle {
        margin: 0 0 1rem 0;
        color: var(--text-color-secondary);
        font-size: 0.9rem;
      }

      .controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;

        .gps-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--surface-card);
          border-radius: 0.5rem;
          font-size: 0.9rem;

          .status-indicator {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 500;

            i {
              font-size: 0.8rem;
              animation: none;

              &.pi-circle-fill {
                color: var(--green-500);
              }

              &.pi-exclamation-circle {
                color: var(--orange-500);
              }
            }

            &.online {
              color: var(--green-600);
            }

            &.offline {
              color: var(--orange-600);
            }
          }
        }
      }
    }

    .loading-state,
    .error-state,
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      text-align: center;
      color: var(--text-color-secondary);

      i {
        margin-bottom: 1rem;
        color: var(--text-color-secondary);
      }

      p {
        margin: 0.5rem 0;
        font-size: 1rem;
      }

      button {
        margin-top: 1rem;
      }
    }

    .error-state {
      background-color: rgba(var(--red-500), 0.1);
      border-radius: 0.5rem;
      border-left: 4px solid var(--red-500);

      i {
        color: var(--red-500);
      }
    }

    .vehicle-info {
      margin-bottom: 1.5rem;

      .vehicle-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;

        .stat {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;

          .label {
            font-size: 0.85rem;
            color: var(--text-color-secondary);
            font-weight: 500;
          }

          .value {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--primary-color);
          }

          &.progress {
            grid-column: 1 / -1;

            .progress-bar {
              width: 100%;
              height: 24px;
              background: var(--surface-border);
              border-radius: 0.25rem;
              overflow: hidden;
              margin: 0.5rem 0;

              .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--green-500), var(--blue-500));
                transition: width 0.3s ease;
              }
            }

            .percentage {
              font-size: 0.9rem;
              color: var(--text-color-secondary);
            }
          }
        }
      }
    }

    .assignments-dataview {
      ::ng-deep {
        .p-dataview-header {
          background: transparent;
          border: none;
          padding: 0 0 1rem 0;
        }
      }

      .dataview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;

        .sort-options {
          display: flex;
          align-items: center;
          gap: 0.5rem;

          label {
            font-size: 0.9rem;
            font-weight: 500;
          }

          .sort-select {
            padding: 0.5rem;
            border: 1px solid var(--surface-border);
            border-radius: 0.25rem;
            font-size: 0.9rem;
            min-width: 180px;
            cursor: pointer;

            &:focus {
              outline: none;
              border-color: var(--primary-color);
            }
          }
        }
      }
    }

    .assignment-card-container {
      margin-bottom: 1rem;

      .assignment-card {
        min-height: 300px;
        display: flex;
        flex-direction: column;

        ::ng-deep .p-card-body {
          padding: 1.25rem;
          flex: 1;
        }
      }
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
      gap: 1rem;

      .header-info {
        flex: 1;

        .fir-number {
          margin: 0 0 0.25rem 0;
          font-size: 1.1rem;
          font-weight: 600;
        }

        .cer-code {
          font-size: 0.85rem;
          color: var(--text-color-secondary);
        }
      }

      .header-status {
        display: flex;
        gap: 0.5rem;
        flex-direction: column;

        .priority-tag {
          text-align: right;
        }
      }
    }

    .waste-section {
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--surface-border);

      .waste-description {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 500;
      }

      .waste-details {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;

        .detail-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--text-color-secondary);

          i {
            font-size: 1.1rem;
          }
        }
      }
    }

    .location-section {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--surface-border);

      .location {
        .location-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;

          i {
            font-size: 1.1rem;
            color: var(--primary-color);
          }

          .location-label {
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-color-secondary);
          }
        }

        .location-address {
          margin: 0 0 0.5rem 0;
          font-size: 0.95rem;
          line-height: 1.4;
        }

        .distance-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: var(--primary-color);
          font-weight: 500;

          i {
            font-size: 0.8rem;
          }

          .distance {
            background: rgba(var(--primary-500), 0.1);
            padding: 0.25rem 0.75rem;
            border-radius: 0.25rem;
          }
        }
      }
    }

    .timing-section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--surface-border);

      .timing-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.9rem;

        i {
          color: var(--primary-color);
        }

        .label {
          color: var(--text-color-secondary);
          font-weight: 500;
        }

        .value {
          font-weight: 600;
          color: var(--text-color);
        }
      }
    }

    .card-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: auto;

      .action-button {
        flex: 1;
        min-height: 56px;

        @media (max-width: 640px) {
          font-size: 0.85rem;
        }
      }
    }

    @media (max-width: 640px) {
      .my-assignments-page {
        padding: 0.75rem;
      }

      .page-header {
        h1 {
          font-size: 1.25rem;
        }

        .controls {
          flex-direction: column;
          align-items: stretch;

          .gps-status {
            justify-content: center;
          }
        }
      }

      .card-header {
        flex-direction: column;

        .header-status {
          flex-direction: row;
          justify-content: space-between;
        }
      }

      .location-section {
        .location:first-child {
          margin-bottom: 0;
        }
      }

      .card-actions {
        flex-direction: column;

        .action-button {
          width: 100%;
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyAssignmentsComponent implements OnInit {
  private readonly taskAssignmentApi = inject(TaskAssignmentApiService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroy$ = new Subject<void>();

  // Signal state
  isLoading = signal(false);
  error = signal<string | null>(null);
  assignments = signal<MyAssignmentsResponse | null>(null);
  currentLocation = signal<{ latitude: number; longitude: number } | null>(null);
  isMobile = signal(false);
  isOnline = signal(navigator.onLine);
  lastSyncTime = signal<Date | null>(null);
  sortBy = signal<'proximity' | 'transportDate' | 'priority'>('proximity');

  // Computed derived state
  sortedAssignments = computed(() => {
    const assigns = this.assignments()?.assignments || [];
    const sort = this.sortBy();

    if (sort === 'proximity') {
      return this.sortByProximity(assigns);
    } else if (sort === 'transportDate') {
      return [...assigns].sort(
        (a, b) =>
          new Date(a.transportDate).getTime() - new Date(b.transportDate).getTime(),
      );
    } else if (sort === 'priority') {
      const priorityMap = { urgent: 0, high: 1, normal: 2, low: 3 };
      return [...assigns].sort(
        (a, b) =>
          priorityMap[a.priority as keyof typeof priorityMap] -
          priorityMap[b.priority as keyof typeof priorityMap],
      );
    }

    return assigns;
  });

  constructor() {
    // Setup responsive design
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        this.isMobile.set(result.matches);
      });

    // Setup online/offline detection
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));

    // Setup auto-refresh every 30 seconds (if online)
    effect(() => {
      if (this.isOnline()) {
        const refreshSubscription = interval(30000)
          .pipe(
            switchMap(() => {
              return this.taskAssignmentApi.getMyAssignments();
            }),
            takeUntil(this.destroy$),
          )
          .subscribe({
            next: (response) => {
              if (response.success && response.data) {
                this.assignments.set(response.data);
                this.lastSyncTime.set(new Date());
              }
            },
            error: (err) => {
              console.error('Auto-refresh failed:', err);
            },
          });

        return () => refreshSubscription.unsubscribe();
      }
    });
  }

  ngOnInit(): void {
    this.initializeGeolocation();
    this.refreshAssignments();
    this.loadFromIndexedDB();
  }

  /**
   * Initialize geolocation and watch for position changes
   * Uses GPS for proximity sorting
   */
  private initializeGeolocation(): void {
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        (position) => {
          this.currentLocation.set({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          console.warn('Geolocation error:', error);
          // Fallback to cached location if available
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000, // Cache position for 30 seconds
          timeout: 10000,
        },
      );
    }
  }

  /**
   * Refresh assignments from backend
   */
  refreshAssignments(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.taskAssignmentApi
      .getMyAssignments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            // Calculate distances for each assignment
            const dataWithDistances = this.addDistancesToAssignments(response.data);
            this.assignments.set(dataWithDistances);
            this.lastSyncTime.set(new Date());

            // Cache in IndexedDB for offline support
            this.saveToIndexedDB(dataWithDistances);

            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Assignments updated',
              life: 2000,
            });
          }
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load assignments:', err);
          this.error.set('Failed to load assignments. Check your connection.');
          this.isLoading.set(false);

          // Try to load from cache on error
          this.loadFromIndexedDB();
        },
      });
  }

  /**
   * Add calculated distances to assignments based on current location
   */
  private addDistancesToAssignments(
    data: MyAssignmentsResponse,
  ): MyAssignmentsResponse {
    if (!this.currentLocation()) {
      return data;
    }

    const loc = this.currentLocation()!;
    return {
      ...data,
      assignments: data.assignments.map((assignment) => ({
        ...assignment,
        pickupLocation: {
          ...assignment.pickupLocation,
          distance: this.calculateDistance(
            loc.latitude,
            loc.longitude,
            assignment.pickupLocation.latitude,
            assignment.pickupLocation.longitude,
          ),
        },
      })),
    };
  }

  /**
   * Haversine formula for calculating distance between two points
   * Returns distance in meters
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) *
        Math.cos(φ2) *
        Math.sin(Δλ / 2) *
        Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Sort assignments by proximity (closest first)
   */
  private sortByProximity(assignments: MyAssignment[]): MyAssignment[] {
    return [...assignments].sort((a, b) => {
      const distA = a.pickupLocation.distance || Number.MAX_SAFE_INTEGER;
      const distB = b.pickupLocation.distance || Number.MAX_SAFE_INTEGER;
      return distA - distB;
    });
  }

  /**
   * Handle sort option change
   */
  onSortChange(): void {
    // Triggers recomputation of sortedAssignments computed signal
  }

  /**
   * Get formatted distance string
   */
  getFormattedDistance(distanceInMeters: number): string {
    if (distanceInMeters < 1000) {
      return `${Math.round(distanceInMeters)} m`;
    }
    return `${(distanceInMeters / 1000).toFixed(1)} km`;
  }

  /**
   * Get status label
   */
  getStatusLabel(status: string): string {
    const statusMap: Record<string, string> = {
      AWAITING_CARRIER: 'Awaiting Pickup',
      IN_TRANSIT: 'In Transit',
      COMPLETED: 'Completed',
      FAILED: 'Failed',
    };
    return statusMap[status] || status;
  }

  /**
   * Get status severity for tag coloring
   */
  getStatusSeverity(status: string): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    const severityMap: Record<string, 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined> = {
      AWAITING_CARRIER: 'warning',
      IN_TRANSIT: 'info',
      COMPLETED: 'success',
      FAILED: 'danger',
    };
    return severityMap[status] || 'info';
  }

  /**
   * Get priority severity for tag coloring
   */
  getPrioritySeverity(priority: string): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    const severityMap: Record<string, 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined> = {
      low: 'info',
      normal: 'secondary',
      high: 'warning',
      urgent: 'danger',
    };
    return severityMap[priority] || 'secondary';
  }

  /**
   * Get vehicle capacity usage percentage
   */
  getCapacityPercentage(): number {
    const info = this.assignments()?.vehicleInfo;
    if (!info || info.capacity === 0) return 0;
    return Math.round((info.currentLoad / info.capacity) * 100);
  }

  /**
   * View assignment details
   */
  viewAssignmentDetails(assignment: MyAssignment): void {
    // TODO: Navigate to assignment detail page
    console.log('View details for:', assignment.firId);
    this.messageService.add({
      severity: 'info',
      summary: 'View Details',
      detail: `Loading details for FIR ${assignment.firNumber}...`,
    });
  }

  /**
   * Start pickup for assignment
   */
  startPickup(assignment: MyAssignment): void {
    this.confirmationService.confirm({
      message: `Start pickup for FIR ${assignment.firNumber}?`,
      accept: () => {
        // TODO: Call API to start pickup
        this.messageService.add({
          severity: 'success',
          summary: 'Pickup Started',
          detail: `FIR ${assignment.firNumber} pickup initiated`,
        });
      },
    });
  }

  /**
   * Save assignments to IndexedDB for offline support
   */
  private saveToIndexedDB(data: MyAssignmentsResponse): void {
    if (!('indexedDB' in window)) {
      console.warn('IndexedDB not available');
      return;
    }

    const request = indexedDB.open('RifiutiDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('assignments', 'readwrite');
      const store = tx.objectStore('assignments');
      store.put({
        id: 'my-assignments',
        data,
        timestamp: Date.now(),
      });
    };
    request.onerror = () => {
      console.warn('Failed to open IndexedDB');
    };
  }

  /**
   * Load assignments from IndexedDB for offline support
   */
  private loadFromIndexedDB(): void {
    if (!('indexedDB' in window)) {
      return;
    }

    const request = indexedDB.open('RifiutiDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('assignments', 'readonly');
      const store = tx.objectStore('assignments');
      const getRequest = store.get('my-assignments');

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result) {
          const age = Date.now() - result.timestamp;
          // Use cache if less than 24 hours old
          if (age < 24 * 60 * 60 * 1000) {
            this.assignments.set(result.data);
            this.lastSyncTime.set(new Date(result.timestamp));
          }
        }
      };
    };
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
