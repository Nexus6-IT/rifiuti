import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Skeleton Loader Component
 *
 * A reusable component for displaying loading placeholders with animations.
 * Supports multiple variants and custom sizing.
 *
 * @example
 * <!-- Card skeleton -->
 * <app-skeleton-loader variant="card" [repeat]="3" />
 *
 * <!-- Table skeleton -->
 * <app-skeleton-loader variant="table" [rows]="5" />
 *
 * <!-- Custom text skeleton -->
 * <app-skeleton-loader variant="text" width="200px" height="20px" />
 */
@Component({
  selector: 'app-skeleton-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="skeleton-container" [attr.aria-busy]="true" role="status" aria-label="Caricamento in corso">
      <!-- Text Skeleton -->
      <ng-container *ngIf="variant === 'text'">
        <div *ngFor="let _ of repeatArray" class="skeleton skeleton-text"
             [style.width]="width"
             [style.height]="height">
        </div>
      </ng-container>

      <!-- Circle Skeleton (for avatars, icons) -->
      <ng-container *ngIf="variant === 'circle'">
        <div *ngFor="let _ of repeatArray" class="skeleton skeleton-circle"
             [style.width]="width || '48px'"
             [style.height]="width || '48px'">
        </div>
      </ng-container>

      <!-- Rectangle Skeleton (for images) -->
      <ng-container *ngIf="variant === 'rectangle'">
        <div *ngFor="let _ of repeatArray" class="skeleton skeleton-rectangle"
             [style.width]="width"
             [style.height]="height || '200px'">
        </div>
      </ng-container>

      <!-- Card Skeleton -->
      <ng-container *ngIf="variant === 'card'">
        <div *ngFor="let _ of repeatArray" class="skeleton-card">
          <div class="skeleton skeleton-rectangle" style="width: 100%; height: 120px; margin-bottom: 1rem;"></div>
          <div class="skeleton skeleton-text" style="width: 80%; height: 20px; margin-bottom: 0.5rem;"></div>
          <div class="skeleton skeleton-text" style="width: 60%; height: 16px; margin-bottom: 0.5rem;"></div>
          <div class="skeleton skeleton-text" style="width: 40%; height: 16px;"></div>
        </div>
      </ng-container>

      <!-- Table Skeleton -->
      <ng-container *ngIf="variant === 'table'">
        <div class="skeleton-table">
          <!-- Header -->
          <div class="skeleton-table-header">
            <div class="skeleton skeleton-text" style="width: 20%; height: 16px;"></div>
            <div class="skeleton skeleton-text" style="width: 25%; height: 16px;"></div>
            <div class="skeleton skeleton-text" style="width: 20%; height: 16px;"></div>
            <div class="skeleton skeleton-text" style="width: 15%; height: 16px;"></div>
            <div class="skeleton skeleton-text" style="width: 10%; height: 16px;"></div>
          </div>
          <!-- Rows -->
          <div *ngFor="let _ of rowsArray" class="skeleton-table-row">
            <div class="skeleton skeleton-text" style="width: 20%; height: 14px;"></div>
            <div class="skeleton skeleton-text" style="width: 25%; height: 14px;"></div>
            <div class="skeleton skeleton-text" style="width: 20%; height: 14px;"></div>
            <div class="skeleton skeleton-text" style="width: 15%; height: 14px;"></div>
            <div class="skeleton skeleton-text" style="width: 10%; height: 14px;"></div>
          </div>
        </div>
      </ng-container>

      <!-- List Skeleton -->
      <ng-container *ngIf="variant === 'list'">
        <div *ngFor="let _ of rowsArray" class="skeleton-list-item">
          <div class="skeleton skeleton-circle" style="width: 48px; height: 48px;"></div>
          <div style="flex: 1;">
            <div class="skeleton skeleton-text" style="width: 70%; height: 16px; margin-bottom: 0.5rem;"></div>
            <div class="skeleton skeleton-text" style="width: 40%; height: 14px;"></div>
          </div>
        </div>
      </ng-container>

      <!-- Stats Card Skeleton -->
      <ng-container *ngIf="variant === 'stats'">
        <div *ngFor="let _ of repeatArray" class="skeleton-stats-card">
          <div style="flex: 1;">
            <div class="skeleton skeleton-text" style="width: 60%; height: 14px; margin-bottom: 0.5rem;"></div>
            <div class="skeleton skeleton-text" style="width: 40%; height: 24px;"></div>
          </div>
          <div class="skeleton skeleton-circle" style="width: 56px; height: 56px;"></div>
        </div>
      </ng-container>

      <span class="sr-only">Caricamento in corso...</span>
    </div>
  `,
  styles: [`
    .skeleton-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 1rem);
    }

    .skeleton {
      background: linear-gradient(
        90deg,
        var(--gray-200, #e5e7eb) 25%,
        var(--gray-100, #f3f4f6) 50%,
        var(--gray-200, #e5e7eb) 75%
      );
      background-size: 200% 100%;
      animation: loading 1.5s ease-in-out infinite;
      border-radius: var(--border-radius-sm, 4px);
    }

    .skeleton-text {
      height: 16px;
      width: 100%;
    }

    .skeleton-circle {
      border-radius: 50%;
    }

    .skeleton-rectangle {
      width: 100%;
    }

    .skeleton-card {
      background: var(--surface-card, white);
      padding: var(--spacing-lg, 1.5rem);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid var(--gray-200, #e5e7eb);
    }

    .skeleton-table {
      background: var(--surface-card, white);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid var(--gray-200, #e5e7eb);
      overflow: hidden;
    }

    .skeleton-table-header {
      display: flex;
      gap: var(--spacing-md, 1rem);
      padding: var(--spacing-md, 1rem);
      background: var(--gray-50, #f9fafb);
      border-bottom: 1px solid var(--gray-200, #e5e7eb);
    }

    .skeleton-table-row {
      display: flex;
      gap: var(--spacing-md, 1rem);
      padding: var(--spacing-md, 1rem);
      border-bottom: 1px solid var(--gray-100, #f3f4f6);
    }

    .skeleton-table-row:last-child {
      border-bottom: none;
    }

    .skeleton-list-item {
      display: flex;
      gap: var(--spacing-md, 1rem);
      padding: var(--spacing-md, 1rem);
      background: var(--surface-card, white);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid var(--gray-200, #e5e7eb);
    }

    .skeleton-stats-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--spacing-md, 1rem);
      padding: var(--spacing-lg, 1.5rem);
      background: var(--surface-card, white);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid var(--gray-200, #e5e7eb);
    }

    @keyframes loading {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .skeleton {
        animation: none;
        background: var(--gray-200, #e5e7eb);
      }
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
  `]
})
export class SkeletonLoaderComponent {
  /**
   * Variant of skeleton to display
   * - text: Single line of text
   * - circle: Circular shape (avatars, icons)
   * - rectangle: Rectangular shape (images)
   * - card: Full card layout with image and text
   * - table: Table layout with header and rows
   * - list: List item with avatar and text
   * - stats: Statistics card with icon
   */
  @Input() variant: 'text' | 'circle' | 'rectangle' | 'card' | 'table' | 'list' | 'stats' = 'text';

  /** Number of times to repeat the skeleton (for text, circle, rectangle, card, stats) */
  @Input() repeat = 1;

  /** Number of rows (for table and list variants) */
  @Input() rows = 5;

  /** Custom width */
  @Input() width?: string;

  /** Custom height */
  @Input() height?: string;

  get repeatArray(): number[] {
    return Array(this.repeat).fill(0);
  }

  get rowsArray(): number[] {
    return Array(this.rows).fill(0);
  }
}
