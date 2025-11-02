import { Component, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';

/**
 * AuditFiltersComponent
 * Filter controls for audit trail viewer
 * T160: Audit filters component per User Story 4
 *
 * Purpose: Provide filtering controls for audit log queries
 *
 * Requirements from spec.md FR-018:
 * - Filter by user ID
 * - Filter by date range (start/end)
 * - Filter by decision (ALLOW/DENY)
 * - Filter by resource type
 * - Filter by action attempted
 *
 * Requirements from plan.md:
 * - Mobile-friendly responsive design
 * - Clear visual feedback
 * - Easy reset functionality
 */
@Component({
  selector: 'app-audit-filters',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    CalendarModule,
    DropdownModule,
  ],
  template: `
    <div class="audit-filters">
      <div class="filter-header">
        <h3>
          <i class="pi pi-filter"></i>
          Filters
        </h3>
        <button
          pButton
          type="button"
          label="Reset"
          icon="pi pi-refresh"
          class="p-button-text p-button-sm"
          (click)="resetFilters()"
        ></button>
      </div>

      <div class="filter-grid">
        <!-- User ID -->
        <div class="filter-field">
          <label for="userId">User ID</label>
          <input
            pInputText
            id="userId"
            [(ngModel)]="userId"
            placeholder="Enter user ID"
            (input)="onFilterChange()"
          />
        </div>

        <!-- Decision -->
        <div class="filter-field">
          <label for="decision">Decision</label>
          <p-dropdown
            id="decision"
            [(ngModel)]="decision"
            [options]="decisionOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="All decisions"
            (onChange)="onFilterChange()"
            [showClear]="true"
          ></p-dropdown>
        </div>

        <!-- Resource Type -->
        <div class="filter-field">
          <label for="resourceType">Resource Type</label>
          <input
            pInputText
            id="resourceType"
            [(ngModel)]="resourceType"
            placeholder="e.g., fir, company"
            (input)="onFilterChange()"
          />
        </div>

        <!-- Action Attempted -->
        <div class="filter-field">
          <label for="actionAttempted">Action</label>
          <input
            pInputText
            id="actionAttempted"
            [(ngModel)]="actionAttempted"
            placeholder="e.g., fir:create:all"
            (input)="onFilterChange()"
          />
        </div>

        <!-- Start Date -->
        <div class="filter-field">
          <label for="startDate">Start Date</label>
          <p-calendar
            id="startDate"
            [(ngModel)]="startDate"
            [showTime]="true"
            [showSeconds]="true"
            dateFormat="yy-mm-dd"
            placeholder="From date"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            [showClear]="true"
          ></p-calendar>
        </div>

        <!-- End Date -->
        <div class="filter-field">
          <label for="endDate">End Date</label>
          <p-calendar
            id="endDate"
            [(ngModel)]="endDate"
            [showTime]="true"
            [showSeconds]="true"
            dateFormat="yy-mm-dd"
            placeholder="To date"
            (onSelect)="onFilterChange()"
            (onClearClick)="onFilterChange()"
            [showClear]="true"
          ></p-calendar>
        </div>
      </div>

      <div class="filter-actions">
        <button
          pButton
          type="button"
          label="Apply Filters"
          icon="pi pi-search"
          (click)="applyFilters()"
          [disabled]="!hasFilters()"
        ></button>
      </div>

      @if (hasFilters()) {
        <div class="active-filters">
          <span class="active-filters-label">Active filters:</span>
          @if (userId) {
            <span class="filter-chip">
              User: {{ userId }}
              <i class="pi pi-times" (click)="clearFilter('userId')"></i>
            </span>
          }
          @if (decision) {
            <span class="filter-chip">
              Decision: {{ decision }}
              <i class="pi pi-times" (click)="clearFilter('decision')"></i>
            </span>
          }
          @if (resourceType) {
            <span class="filter-chip">
              Resource: {{ resourceType }}
              <i class="pi pi-times" (click)="clearFilter('resourceType')"></i>
            </span>
          }
          @if (actionAttempted) {
            <span class="filter-chip">
              Action: {{ actionAttempted }}
              <i class="pi pi-times" (click)="clearFilter('actionAttempted')"></i>
            </span>
          }
          @if (startDate) {
            <span class="filter-chip">
              From: {{ startDate | date: 'short' }}
              <i class="pi pi-times" (click)="clearFilter('startDate')"></i>
            </span>
          }
          @if (endDate) {
            <span class="filter-chip">
              To: {{ endDate | date: 'short' }}
              <i class="pi pi-times" (click)="clearFilter('endDate')"></i>
            </span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .audit-filters {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .filter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .filter-header h3 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .filter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .filter-field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .filter-field label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-color);
    }

    .filter-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
    }

    .active-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
    }

    .active-filters-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-color-secondary);
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.75rem;
      background: var(--primary-100);
      color: var(--primary-700);
      border-radius: 16px;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .filter-chip i {
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s ease;
    }

    .filter-chip i:hover {
      opacity: 1;
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .audit-filters {
        padding: 1rem;
      }

      .filter-grid {
        grid-template-columns: 1fr;
      }

      .filter-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }

      .filter-actions {
        justify-content: stretch;
      }

      .filter-actions button {
        width: 100%;
      }
    }
  `],
})
export class AuditFiltersComponent {
  @Output() filtersChanged = new EventEmitter<{
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    decision?: 'ALLOW' | 'DENY';
    resourceType?: string;
    actionAttempted?: string;
  }>();

  // Filter values
  userId = '';
  startDate: Date | null = null;
  endDate: Date | null = null;
  decision: 'ALLOW' | 'DENY' | null = null;
  resourceType = '';
  actionAttempted = '';

  // Dropdown options
  decisionOptions = [
    { label: 'Allow', value: 'ALLOW' },
    { label: 'Deny', value: 'DENY' },
  ];

  onFilterChange(): void {
    // Emit filters on change (for real-time filtering)
    // Can be debounced for performance
  }

  applyFilters(): void {
    const filters: any = {};

    if (this.userId) filters.userId = this.userId;
    if (this.startDate) filters.startDate = this.startDate;
    if (this.endDate) filters.endDate = this.endDate;
    if (this.decision) filters.decision = this.decision;
    if (this.resourceType) filters.resourceType = this.resourceType;
    if (this.actionAttempted) filters.actionAttempted = this.actionAttempted;

    this.filtersChanged.emit(filters);
  }

  resetFilters(): void {
    this.userId = '';
    this.startDate = null;
    this.endDate = null;
    this.decision = null;
    this.resourceType = '';
    this.actionAttempted = '';

    this.filtersChanged.emit({});
  }

  clearFilter(filterName: string): void {
    switch (filterName) {
      case 'userId':
        this.userId = '';
        break;
      case 'startDate':
        this.startDate = null;
        break;
      case 'endDate':
        this.endDate = null;
        break;
      case 'decision':
        this.decision = null;
        break;
      case 'resourceType':
        this.resourceType = '';
        break;
      case 'actionAttempted':
        this.actionAttempted = '';
        break;
    }

    this.applyFilters();
  }

  hasFilters(): boolean {
    return !!(
      this.userId ||
      this.startDate ||
      this.endDate ||
      this.decision ||
      this.resourceType ||
      this.actionAttempted
    );
  }
}
