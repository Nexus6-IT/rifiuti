import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout'
import { DataViewModule } from 'primeng/dataview'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { TooltipModule } from 'primeng/tooltip'
import { BadgeModule } from 'primeng/badge'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ToastModule } from 'primeng/toast'
import { MessageService, ConfirmationService } from 'primeng/api'
import { interval, Subject } from 'rxjs'
import { takeUntil, switchMap } from 'rxjs/operators'
import {
  TaskAssignmentApiService,
  MyAssignment,
  MyAssignmentsResponse,
} from '../../../task-assignment/services/task-assignment-api.service'

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
    <div class="page my-assignments-page">
      <!-- Intestazione -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Le mie attività assegnate</h1>
          <p class="page-subtitle">{{ assignments()?.totalAssignments || 0 }} attività assegnate</p>
        </div>

        <!-- Stato GPS e aggiornamento -->
        <div class="page-actions controls">
          <span
            class="status-indicator"
            role="status"
            [class.online]="isOnline()"
            [class.offline]="!isOnline()"
            [pTooltip]="
              isOnline()
                ? 'Posizione GPS attiva'
                : 'Modalità offline - Ultima sincronizzazione: ' + (lastSyncTime() | date: 'short')
            "
          >
            <i
              class="pi"
              [ngClass]="isOnline() ? 'pi-circle-fill' : 'pi-exclamation-circle'"
              aria-hidden="true"
            ></i>
            {{ isOnline() ? 'GPS attivo' : 'Offline' }}
          </span>

          <button
            pButton
            icon="pi pi-refresh"
            [loading]="isLoading()"
            (click)="refreshAssignments()"
            class="p-button-rounded p-button-text"
            pTooltip="Aggiorna le attività"
            tooltipPosition="top"
            aria-label="Aggiorna le attività"
          ></button>
        </div>
      </header>

      <!-- Stato di caricamento -->
      <div *ngIf="isLoading() && !assignments()" class="surface-card">
        <div class="empty-state" role="status" aria-live="polite">
          <i class="pi pi-spin pi-spinner empty-state__icon" aria-hidden="true"></i>
          <p class="empty-state__title">Caricamento delle attività...</p>
        </div>
      </div>

      <!-- Stato di errore -->
      <div *ngIf="error()" class="surface-card error-state" role="alert">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <p>{{ error() }}</p>
        <button
          pButton
          label="Riprova"
          icon="pi pi-refresh"
          (click)="refreshAssignments()"
        ></button>
      </div>

      <!-- Riepilogo veicolo -->
      <div *ngIf="assignments() && !isLoading()" class="vehicle-info">
        <div class="stat-grid">
          <div class="stat-card">
            <span class="stat-card__label">Capacità veicolo</span>
            <span class="stat-card__value"
              >{{ assignments()?.vehicleInfo?.capacity || 0 }} <small>kg</small></span
            >
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Carico attuale</span>
            <span class="stat-card__value"
              >{{ assignments()?.vehicleInfo?.currentLoad || 0 }} <small>kg</small></span
            >
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Disponibile</span>
            <span class="stat-card__value"
              >{{ assignments()?.vehicleInfo?.availableCapacity || 0 }} <small>kg</small></span
            >
          </div>
          <div class="stat-card capacity-card">
            <span class="stat-card__label">Capacità utilizzata</span>
            <div
              class="progress-bar"
              role="progressbar"
              [attr.aria-valuenow]="getCapacityPercentage()"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-label]="'Capacità utilizzata: ' + getCapacityPercentage() + '%'"
            >
              <div class="progress-fill" [style.width.%]="getCapacityPercentage()"></div>
            </div>
            <span class="stat-card__hint">{{ getCapacityPercentage() }}%</span>
          </div>
        </div>
      </div>

      <!-- Stato vuoto -->
      <div
        *ngIf="assignments() && sortedAssignments().length === 0 && !isLoading()"
        class="surface-card"
      >
        <div class="empty-state">
          <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
          <p class="empty-state__title">Nessuna attività</p>
          <p>Al momento non hai attività FIR assegnate.</p>
        </div>
      </div>

      <!-- Elenco attività con DataView -->
      <p-dataView
        *ngIf="assignments() && sortedAssignments().length > 0 && !isLoading()"
        [value]="sortedAssignments()"
        [rows]="10"
        [paginator]="true"
        class="assignments-dataview"
      >
        <!-- Intestazione DataView con opzioni di ordinamento -->
        <ng-template pTemplate="header">
          <div class="dataview-header">
            <div class="sort-options">
              <label for="sort-select">Ordina per:</label>
              <select
                id="sort-select"
                class="sort-select"
                [(ngModel)]="sortBy"
                (change)="onSortChange()"
                data-testid="sort-select"
              >
                <option value="proximity">Vicinanza (più vicine prima)</option>
                <option value="transportDate">Data di trasporto</option>
                <option value="priority">Priorità</option>
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
                    [attr.data-testid]="'status-' + assignment.status"
                  ></p-tag>
                  <p-tag
                    [value]="getPriorityLabel(assignment.priority)"
                    [severity]="getPrioritySeverity(assignment.priority)"
                    class="priority-tag"
                  ></p-tag>
                </div>
              </div>

              <!-- Waste Info -->
              <div class="waste-section">
                <p class="waste-description">{{ assignment.wasteDescription }}</p>
                <div class="waste-details">
                  <span class="detail-item">
                    <i class="pi pi-box"></i>
                    {{ assignment.quantity }} {{ assignment.unit }}
                  </span>
                </div>
              </div>

              <!-- Posizioni con distanza -->
              <div class="location-section">
                <div class="location">
                  <div class="location-header">
                    <i class="pi pi-map-marker" aria-hidden="true"></i>
                    <span class="location-label">Ritiro</span>
                  </div>
                  <p class="location-address">{{ assignment.pickupLocation.address }}</p>
                  <div *ngIf="assignment.pickupLocation.distance" class="distance-info">
                    <i class="pi pi-arrow-right" aria-hidden="true"></i>
                    <span class="distance">{{
                      getFormattedDistance(assignment.pickupLocation.distance)
                    }}</span>
                  </div>
                </div>

                <div class="location">
                  <div class="location-header">
                    <i class="pi pi-flag" aria-hidden="true"></i>
                    <span class="location-label">Consegna</span>
                  </div>
                  <p class="location-address">{{ assignment.deliveryLocation.address }}</p>
                </div>
              </div>

              <!-- Data di trasporto e durata stimata -->
              <div class="timing-section">
                <div class="timing-item">
                  <i class="pi pi-calendar" aria-hidden="true"></i>
                  <span class="label">Data trasporto:</span>
                  <span class="value">{{ assignment.transportDate | date: 'short' }}</span>
                </div>
                <div *ngIf="assignment.estimatedDuration" class="timing-item">
                  <i class="pi pi-clock" aria-hidden="true"></i>
                  <span class="label">Durata stimata:</span>
                  <span class="value">{{ assignment.estimatedDuration }} min</span>
                </div>
              </div>

              <!-- Azioni -->
              <div class="card-actions">
                <button
                  pButton
                  label="Dettagli"
                  icon="pi pi-arrow-right"
                  class="p-button-primary p-button-sm action-button"
                  (click)="viewAssignmentDetails(assignment)"
                  [attr.data-testid]="'view-details-' + assignment.firId"
                  [attr.aria-label]="'Dettagli del FIR ' + assignment.firNumber"
                ></button>
                <button
                  pButton
                  label="Avvia ritiro"
                  icon="pi pi-play"
                  class="p-button-success p-button-sm action-button"
                  (click)="startPickup(assignment)"
                  [disabled]="assignment.status !== 'AWAITING_CARRIER'"
                  [attr.data-testid]="'start-pickup-' + assignment.firId"
                  [attr.aria-label]="'Avvia ritiro per il FIR ' + assignment.firNumber"
                ></button>
              </div>
            </p-card>
          </div>
        </ng-template>
      </p-dataView>

      <!-- Confirmation Dialog for Actions -->
      <p-confirmDialog
        [style]="{ width: '50vw' }"
        [breakpoints]="{ '960px': '75vw', '640px': '90vw' }"
      ></p-confirmDialog>

      <!-- Toast Notifications -->
      <p-toast position="top-right"></p-toast>
    </div>
  `,
  styles: `
    .my-assignments-page {
      max-width: 100%;
    }

    .controls {
      align-items: center;

      .status-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: 0.4rem 0.85rem;
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);

        i {
          font-size: 0.8rem;
          &.pi-circle-fill {
            color: var(--color-success);
          }
          &.pi-exclamation-circle {
            color: var(--color-warning);
          }
        }
        &.online {
          color: var(--color-success);
        }
        &.offline {
          color: var(--color-warning);
        }
      }
    }

    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-2xl) var(--spacing-base);
      text-align: center;
      color: var(--text-secondary);
      border-left: 4px solid var(--color-danger);
      background: var(--color-danger-bg);

      i {
        margin-bottom: var(--spacing-base);
        color: var(--color-danger);
        font-size: 2.5rem;
      }
      p {
        margin: var(--spacing-sm) 0;
      }
      button {
        margin-top: var(--spacing-base);
      }
    }

    .vehicle-info {
      margin-bottom: var(--spacing-lg);

      .stat-card__value small {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
      }

      .capacity-card {
        grid-column: 1 / -1;

        .progress-bar {
          width: 100%;
          height: 20px;
          background: var(--color-gray-200);
          border-radius: var(--radius-full);
          overflow: hidden;
          margin: var(--spacing-sm) 0;

          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--brand-primary), var(--brand-primary-light));
            transition: width var(--transition-base);
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
            padding: 0.55rem 0.75rem;
            border: 1px solid var(--surface-border-strong);
            border-radius: var(--radius-md);
            font-size: var(--font-size-sm);
            font-family: var(--font-family);
            min-width: 200px;
            min-height: var(--touch-target-min);
            background: var(--surface-section);
            color: var(--text-primary);
            cursor: pointer;

            &:focus-visible {
              outline: var(--focus-ring-width) solid var(--focus-ring-color);
              outline-offset: var(--focus-ring-offset);
              border-color: var(--brand-primary);
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
          font-size: var(--font-size-sm);
          color: var(--text-tertiary);
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
          font-size: var(--font-size-sm);
          color: var(--text-tertiary);

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
            color: var(--brand-primary);
          }

          .location-label {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-tertiary);
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
          font-size: var(--font-size-sm);
          color: var(--brand-primary-dark);
          font-weight: var(--font-weight-semibold);

          i {
            font-size: 0.8rem;
          }

          .distance {
            background: var(--brand-primary-50);
            padding: 0.2rem 0.65rem;
            border-radius: var(--radius-full);
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
          color: var(--brand-primary);
        }

        .label {
          color: var(--text-tertiary);
          font-weight: var(--font-weight-medium);
        }

        .value {
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
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
      .controls {
        width: 100%;

        .status-indicator {
          flex: 1;
          justify-content: center;
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
  private readonly taskAssignmentApi = inject(TaskAssignmentApiService)
  private readonly breakpointObserver = inject(BreakpointObserver)
  private readonly messageService = inject(MessageService)
  private readonly confirmationService = inject(ConfirmationService)
  private readonly destroy$ = new Subject<void>()

  // Signal state
  isLoading = signal(false)
  error = signal<string | null>(null)
  assignments = signal<MyAssignmentsResponse | null>(null)
  currentLocation = signal<{ latitude: number; longitude: number } | null>(null)
  isMobile = signal(false)
  isOnline = signal(navigator.onLine)
  lastSyncTime = signal<Date | null>(null)
  sortBy = signal<'proximity' | 'transportDate' | 'priority'>('proximity')

  // Computed derived state
  sortedAssignments = computed(() => {
    const assigns = this.assignments()?.assignments || []
    const sort = this.sortBy()

    if (sort === 'proximity') {
      return this.sortByProximity(assigns)
    } else if (sort === 'transportDate') {
      return [...assigns].sort(
        (a, b) => new Date(a.transportDate).getTime() - new Date(b.transportDate).getTime()
      )
    } else if (sort === 'priority') {
      const priorityMap = { urgent: 0, high: 1, normal: 2, low: 3 }
      return [...assigns].sort(
        (a, b) =>
          priorityMap[a.priority as keyof typeof priorityMap] -
          priorityMap[b.priority as keyof typeof priorityMap]
      )
    }

    return assigns
  })

  constructor() {
    // Setup responsive design
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntil(this.destroy$))
      .subscribe(result => {
        this.isMobile.set(result.matches)
      })

    // Setup online/offline detection
    window.addEventListener('online', () => this.isOnline.set(true))
    window.addEventListener('offline', () => this.isOnline.set(false))

    // Setup auto-refresh every 30 seconds (if online)
    effect(() => {
      if (this.isOnline()) {
        const refreshSubscription = interval(30000)
          .pipe(
            switchMap(() => {
              return this.taskAssignmentApi.getMyAssignments()
            }),
            takeUntil(this.destroy$)
          )
          .subscribe({
            next: response => {
              if (response.success && response.data) {
                this.assignments.set(response.data)
                this.lastSyncTime.set(new Date())
              }
            },
            error: err => {
              console.error('Auto-refresh failed:', err)
            },
          })

        return () => refreshSubscription.unsubscribe()
      }
      return () => {} // No-op cleanup when offline
    })
  }

  ngOnInit(): void {
    this.initializeGeolocation()
    this.refreshAssignments()
    this.loadFromIndexedDB()
  }

  /**
   * Initialize geolocation and watch for position changes
   * Uses GPS for proximity sorting
   */
  private initializeGeolocation(): void {
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        position => {
          this.currentLocation.set({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        },
        error => {
          console.warn('Geolocation error:', error)
          // Fallback to cached location if available
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000, // Cache position for 30 seconds
          timeout: 10000,
        }
      )
    }
  }

  /**
   * Refresh assignments from backend
   */
  refreshAssignments(): void {
    this.isLoading.set(true)
    this.error.set(null)

    this.taskAssignmentApi
      .getMyAssignments()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          if (response.success && response.data) {
            // Calculate distances for each assignment
            const dataWithDistances = this.addDistancesToAssignments(response.data)
            this.assignments.set(dataWithDistances)
            this.lastSyncTime.set(new Date())

            // Cache in IndexedDB for offline support
            this.saveToIndexedDB(dataWithDistances)

            this.messageService.add({
              severity: 'success',
              summary: 'Fatto',
              detail: 'Attività aggiornate',
              life: 2000,
            })
          }
          this.isLoading.set(false)
        },
        error: err => {
          console.error('Failed to load assignments:', err)
          this.error.set('Impossibile caricare le attività. Controlla la connessione.')
          this.isLoading.set(false)

          // Try to load from cache on error
          this.loadFromIndexedDB()
        },
      })
  }

  /**
   * Add calculated distances to assignments based on current location
   */
  private addDistancesToAssignments(data: MyAssignmentsResponse): MyAssignmentsResponse {
    if (!this.currentLocation()) {
      return data
    }

    const loc = this.currentLocation()!
    return {
      ...data,
      assignments: data.assignments.map(assignment => ({
        ...assignment,
        pickupLocation: {
          ...assignment.pickupLocation,
          distance: this.calculateDistance(
            loc.latitude,
            loc.longitude,
            assignment.pickupLocation.latitude,
            assignment.pickupLocation.longitude
          ),
        },
      })),
    }
  }

  /**
   * Haversine formula for calculating distance between two points
   * Returns distance in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000 // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  /**
   * Sort assignments by proximity (closest first)
   */
  private sortByProximity(assignments: MyAssignment[]): MyAssignment[] {
    return [...assignments].sort((a, b) => {
      const distA = a.pickupLocation.distance || Number.MAX_SAFE_INTEGER
      const distB = b.pickupLocation.distance || Number.MAX_SAFE_INTEGER
      return distA - distB
    })
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
      return `${Math.round(distanceInMeters)} m`
    }
    return `${(distanceInMeters / 1000).toFixed(1)} km`
  }

  /**
   * Get status label
   */
  getStatusLabel(status: string): string {
    const statusMap: Record<string, string> = {
      AWAITING_CARRIER: 'In attesa di ritiro',
      IN_TRANSIT: 'In transito',
      COMPLETED: 'Completata',
      FAILED: 'Fallita',
    }
    return statusMap[status] || status
  }

  /**
   * Get status severity for tag coloring
   */
  getStatusSeverity(
    status: string
  ): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    const severityMap: Record<
      string,
      'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined
    > = {
      AWAITING_CARRIER: 'warning',
      IN_TRANSIT: 'info',
      COMPLETED: 'success',
      FAILED: 'danger',
    }
    return severityMap[status] || 'info'
  }

  /**
   * Get localized priority label
   */
  getPriorityLabel(priority: string): string {
    const labelMap: Record<string, string> = {
      low: 'Bassa',
      normal: 'Normale',
      high: 'Alta',
      urgent: 'Urgente',
    }
    return labelMap[priority] || priority.toUpperCase()
  }

  /**
   * Get priority severity for tag coloring
   */
  getPrioritySeverity(
    priority: string
  ): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    const severityMap: Record<
      string,
      'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined
    > = {
      low: 'info',
      normal: 'secondary',
      high: 'warning',
      urgent: 'danger',
    }
    return severityMap[priority] || 'secondary'
  }

  /**
   * Get vehicle capacity usage percentage
   */
  getCapacityPercentage(): number {
    const info = this.assignments()?.vehicleInfo
    if (!info || info.capacity === 0) return 0
    return Math.round((info.currentLoad / info.capacity) * 100)
  }

  /**
   * View assignment details
   */
  viewAssignmentDetails(assignment: MyAssignment): void {
    // TODO: Navigate to assignment detail page
    console.log('View details for:', assignment.firId)
    this.messageService.add({
      severity: 'info',
      summary: 'Dettagli',
      detail: `Caricamento dei dettagli per il FIR ${assignment.firNumber}...`,
    })
  }

  /**
   * Start pickup for assignment
   */
  startPickup(assignment: MyAssignment): void {
    this.confirmationService.confirm({
      message: `Avviare il ritiro per il FIR ${assignment.firNumber}?`,
      header: 'Conferma ritiro',
      acceptLabel: 'Avvia',
      rejectLabel: 'Annulla',
      accept: () => {
        // TODO: Call API to start pickup
        this.messageService.add({
          severity: 'success',
          summary: 'Ritiro avviato',
          detail: `Ritiro del FIR ${assignment.firNumber} avviato`,
        })
      },
    })
  }

  /**
   * Save assignments to IndexedDB for offline support
   */
  private saveToIndexedDB(data: MyAssignmentsResponse): void {
    if (!('indexedDB' in window)) {
      console.warn('IndexedDB not available')
      return
    }

    const request = indexedDB.open('RifiutiDB', 1)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('assignments', 'readwrite')
      const store = tx.objectStore('assignments')
      store.put({
        id: 'my-assignments',
        data,
        timestamp: Date.now(),
      })
    }
    request.onerror = () => {
      console.warn('Failed to open IndexedDB')
    }
  }

  /**
   * Load assignments from IndexedDB for offline support
   */
  private loadFromIndexedDB(): void {
    if (!('indexedDB' in window)) {
      return
    }

    const request = indexedDB.open('RifiutiDB', 1)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('assignments', 'readonly')
      const store = tx.objectStore('assignments')
      const getRequest = store.get('my-assignments')

      getRequest.onsuccess = () => {
        const result = getRequest.result
        if (result) {
          const age = Date.now() - result.timestamp
          // Use cache if less than 24 hours old
          if (age < 24 * 60 * 60 * 1000) {
            this.assignments.set(result.data)
            this.lastSyncTime.set(new Date(result.timestamp))
          }
        }
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next()
    this.destroy$.complete()
  }
}
