import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TooltipModule } from 'primeng/tooltip';
import {
  TaskAssignmentApiService,
  QualifiedDriver,
} from '../../services/task-assignment-api.service';

/**
 * DriverAssignmentDialogComponent
 * T194: Dialog component for User Story 6 - Task Assignment Automation
 *
 * Purpose: Allow fleet managers to assign/reassign tasks to drivers
 *
 * Requirements from spec.md FR-029-032:
 * - Show list of qualified drivers with certifications, capacity, workload
 * - Allow automatic assignment (select best driver)
 * - Allow manual assignment (select specific driver)
 * - Display warnings if driver lacks qualifications
 * - Show driver ranking scores
 */
@Component({
  selector: 'app-driver-assignment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    InputTextareaModule,
    RadioButtonModule,
    TooltipModule,
  ],
  template: `
    <div class="driver-assignment-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <h2>{{ isReassignment() ? 'Reassign Task' : 'Assign Task' }}</h2>
        <p class="header-subtitle">
          {{ isReassignment()
            ? 'Select a new driver for this pickup task'
            : 'Select the best driver or let the system choose automatically'
          }}
        </p>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="loading-container">
          <p-progressSpinner></p-progressSpinner>
          <p>Loading qualified drivers...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <p-message severity="error" [text]="error()!"></p-message>
      }

      <!-- No Qualified Drivers -->
      @if (!isLoading() && qualifiedDrivers().length === 0) {
        <p-message
          severity="warn"
          text="No qualified drivers available for this task. Check certifications and zone assignments."
        ></p-message>
      }

      <!-- Qualified Drivers Table -->
      @if (!isLoading() && qualifiedDrivers().length > 0) {
        <div class="drivers-section">
          <div class="section-header">
            <h3>Qualified Drivers ({{ qualifiedDrivers().length }})</h3>

            @if (!isReassignment()) {
              <button
                pButton
                type="button"
                label="Auto-Assign Best Driver"
                icon="pi pi-bolt"
                class="p-button-success"
                (click)="autoAssign()"
                [loading]="isAssigning()"
                [disabled]="isAssigning()"
              ></button>
            }
          </div>

          <p-table
            [value]="qualifiedDrivers()"
            [scrollable]="true"
            scrollHeight="400px"
            styleClass="p-datatable-sm p-datatable-striped"
          >
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 50px"></th>
                <th>Driver</th>
                <th>Certifications</th>
                <th>Zone</th>
                <th>Capacity</th>
                <th>Current Load</th>
                <th>Available</th>
                <th>Score</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-driver let-rowIndex="rowIndex">
              <tr
                [class.selected-row]="selectedDriver() === driver.userId"
                (click)="selectDriver(driver)"
                style="cursor: pointer;"
              >
                <td>
                  <p-radioButton
                    [value]="driver.userId"
                    [(ngModel)]="selectedDriverId"
                    [inputId]="'driver-' + rowIndex"
                  ></p-radioButton>
                </td>

                <td>
                  <div class="driver-cell">
                    <strong>{{ driver.userId }}</strong>
                    @if (rowIndex === 0) {
                      <p-tag value="Recommended" severity="success" styleClass="ml-2"></p-tag>
                    }
                  </div>
                </td>

                <td>
                  <div class="certifications-cell">
                    @for (cert of driver.certifications; track cert) {
                      <p-tag [value]="cert" severity="info"></p-tag>
                    }
                    @if (driver.certifications.length === 0) {
                      <span class="text-muted">No certifications</span>
                    }
                  </div>
                </td>

                <td>
                  <p-tag [value]="driver.zone" severity="warning"></p-tag>
                </td>

                <td>
                  <strong>{{ driver.capacity }} kg</strong>
                </td>

                <td>
                  <span [class.text-danger]="driver.currentWorkload > driver.capacity * 0.8">
                    {{ driver.currentWorkload }} kg
                  </span>
                </td>

                <td>
                  <span [class.text-success]="driver.availableCapacity > driver.capacity * 0.5">
                    {{ driver.availableCapacity }} kg
                  </span>
                </td>

                <td>
                  <div class="score-cell">
                    <strong>{{ driver.score.toFixed(0) }}</strong>
                    <i
                      class="pi pi-info-circle ml-2"
                      pTooltip="Higher score = better match based on certifications, workload, and capacity"
                    ></i>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      }

      <!-- Reason Input (for reassignment) -->
      @if (isReassignment() && selectedDriver()) {
        <div class="reason-section">
          <label for="reason">Reason for Reassignment *</label>
          <textarea
            pInputTextarea
            id="reason"
            [(ngModel)]="reassignmentReason"
            rows="3"
            placeholder="Explain why this task is being reassigned..."
            [class.ng-invalid]="!reassignmentReason"
          ></textarea>
          @if (!reassignmentReason) {
            <small class="p-error">Reason is required for reassignment</small>
          }
        </div>
      }

      <!-- Actions -->
      <div class="dialog-actions">
        <button
          pButton
          type="button"
          label="Cancel"
          icon="pi pi-times"
          class="p-button-outlined"
          (click)="cancel()"
          [disabled]="isAssigning()"
        ></button>

        <button
          pButton
          type="button"
          [label]="isReassignment() ? 'Reassign' : 'Assign Selected Driver'"
          icon="pi pi-check"
          (click)="manualAssign()"
          [disabled]="!selectedDriver() || isAssigning() || (isReassignment() && !reassignmentReason)"
          [loading]="isAssigning()"
        ></button>
      </div>
    </div>
  `,
  styles: [`
    .driver-assignment-dialog {
      padding: 1rem;
    }

    .dialog-header h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.5rem;
      font-weight: 700;
    }

    .header-subtitle {
      margin: 0 0 1.5rem 0;
      color: var(--text-color-secondary);
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      gap: 1rem;
    }

    .drivers-section {
      margin: 1.5rem 0;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .section-header h3 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
    }

    .selected-row {
      background: var(--primary-50) !important;
    }

    .driver-cell {
      display: flex;
      align-items: center;
    }

    .certifications-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .score-cell {
      display: flex;
      align-items: center;
    }

    .text-muted {
      color: var(--text-color-secondary);
      font-style: italic;
    }

    .text-danger {
      color: var(--red-500);
      font-weight: 600;
    }

    .text-success {
      color: var(--green-500);
      font-weight: 600;
    }

    .reason-section {
      margin: 1.5rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .reason-section label {
      font-weight: 600;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--surface-border);
    }
  `],
})
export class DriverAssignmentDialogComponent implements OnInit {
  // Signals
  isLoading = signal(false);
  isAssigning = signal(false);
  error = signal<string | null>(null);
  qualifiedDrivers = signal<QualifiedDriver[]>([]);
  selectedDriver = signal<string | null>(null);

  // Form data
  selectedDriverId: string | null = null;
  reassignmentReason = '';

  // Config
  firId: string;
  isReassignment = signal(false);

  constructor(
    private config: DynamicDialogConfig,
    private ref: DynamicDialogRef,
    private taskAssignmentService: TaskAssignmentApiService,
    private messageService: MessageService,
  ) {
    this.firId = this.config.data.firId;
    this.isReassignment.set(this.config.data.isReassignment || false);
  }

  ngOnInit(): void {
    this.loadQualifiedDrivers();
  }

  loadQualifiedDrivers(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.taskAssignmentService.getQualifiedDrivers(this.firId).subscribe({
      next: (response) => {
        this.qualifiedDrivers.set(response.data.qualifiedDrivers);
        this.isLoading.set(false);

        if (response.data.totalQualified === 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'No Qualified Drivers',
            detail: response.message,
          });
        }
      },
      error: (error) => {
        this.error.set(`Failed to load qualified drivers: ${error.message}`);
        this.isLoading.set(false);
      },
    });
  }

  selectDriver(driver: QualifiedDriver): void {
    this.selectedDriver.set(driver.userId);
    this.selectedDriverId = driver.userId;
  }

  autoAssign(): void {
    this.isAssigning.set(true);

    this.taskAssignmentService.autoAssignTask(this.firId).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Task Assigned',
          detail: response.message,
        });

        this.isAssigning.set(false);
        this.ref.close({ success: true, data: response.data });
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Assignment Failed',
          detail: error.error?.message || error.message,
        });

        this.isAssigning.set(false);
      },
    });
  }

  manualAssign(): void {
    if (!this.selectedDriver()) {
      return;
    }

    if (this.isReassignment() && !this.reassignmentReason) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Reason Required',
        detail: 'Please provide a reason for reassignment',
      });
      return;
    }

    this.isAssigning.set(true);

    const assignCall = this.isReassignment()
      ? this.taskAssignmentService.reassignTask(
          this.firId,
          this.selectedDriver()!,
          this.reassignmentReason,
        )
      : this.taskAssignmentService.manualAssignTask(
          this.firId,
          this.selectedDriver()!,
        );

    assignCall.subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: this.isReassignment() ? 'Task Reassigned' : 'Task Assigned',
          detail: response.message,
        });

        // Show warnings if any
        if (response.data.warnings && response.data.warnings.length > 0) {
          response.data.warnings.forEach((warning) => {
            this.messageService.add({
              severity: 'warn',
              summary: 'Warning',
              detail: warning,
              life: 5000,
            });
          });
        }

        this.isAssigning.set(false);
        this.ref.close({ success: true, data: response.data });
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: this.isReassignment()
            ? 'Reassignment Failed'
            : 'Assignment Failed',
          detail: error.error?.message || error.message,
        });

        this.isAssigning.set(false);
      },
    });
  }

  cancel(): void {
    this.ref.close({ success: false });
  }
}
