import { Component, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms'
import { DynamicDialogRef } from 'primeng/dynamicdialog'
import { MessageService } from 'primeng/api'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { CalendarModule } from 'primeng/calendar'
import { MultiSelectModule } from 'primeng/multiselect'
import { MessageModule } from 'primeng/message'
import { TemporaryPermissionApiService } from '../../services/temporary-permission-api.service'

/**
 * PermissionRequestDialogComponent
 * T215: Dialog for User Story 7 - Request temporary permissions
 */
@Component({
  selector: 'app-permission-request-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextareaModule,
    CalendarModule,
    MultiSelectModule,
    MessageModule,
  ],
  template: `
    <div class="permission-request-dialog">
      <h2>Request Temporary Permissions</h2>
      <p class="subtitle">Request elevated permissions for a limited time period (max 7 days)</p>

      <form [formGroup]="requestForm" (ngSubmit)="onSubmit()">
        <!-- Permissions Selection -->
        <div class="form-field">
          <label for="permissions">Permissions Needed *</label>
          <p-multiSelect
            id="permissions"
            formControlName="permissions"
            [options]="availablePermissions"
            optionLabel="label"
            optionValue="value"
            placeholder="Select permissions (max 10)"
            [maxSelectedLabels]="3"
            [showToggleAll]="true"
            styleClass="w-full"
          ></p-multiSelect>
          @if (
            requestForm.get('permissions')?.hasError('required') &&
            requestForm.get('permissions')?.touched
          ) {
            <small class="p-error">At least 1 permission is required</small>
          }
          @if (requestForm.get('permissions')?.hasError('maxlength')) {
            <small class="p-error">Maximum 10 permissions allowed</small>
          }
        </div>

        <!-- Time Period -->
        <div class="form-row">
          <div class="form-field">
            <label for="startTime">Start Time *</label>
            <p-calendar
              id="startTime"
              formControlName="startTime"
              [showTime]="true"
              [minDate]="minDate"
              dateFormat="dd/mm/yy"
              placeholder="Select start date/time"
              styleClass="w-full"
            ></p-calendar>
            @if (requestForm.get('startTime')?.invalid && requestForm.get('startTime')?.touched) {
              <small class="p-error">Start time is required</small>
            }
          </div>

          <div class="form-field">
            <label for="endTime">End Time *</label>
            <p-calendar
              id="endTime"
              formControlName="endTime"
              [showTime]="true"
              [minDate]="minEndDate()"
              [maxDate]="maxEndDate()"
              dateFormat="dd/mm/yy"
              placeholder="Select end date/time"
              styleClass="w-full"
            ></p-calendar>
            @if (requestForm.get('endTime')?.invalid && requestForm.get('endTime')?.touched) {
              <small class="p-error">End time is required and must be after start time</small>
            }
          </div>
        </div>

        @if (durationError()) {
          <p-message severity="error" [text]="durationError()!"></p-message>
        }

        <!-- Justification -->
        <div class="form-field">
          <label for="justification">Justification *</label>
          <textarea
            pInputTextarea
            id="justification"
            formControlName="justification"
            rows="4"
            placeholder="Explain why you need these permissions and what you'll use them for..."
            [class.ng-invalid]="
              requestForm.get('justification')?.invalid && requestForm.get('justification')?.touched
            "
          ></textarea>
          @if (
            requestForm.get('justification')?.hasError('required') &&
            requestForm.get('justification')?.touched
          ) {
            <small class="p-error">Justification is required</small>
          }
          @if (requestForm.get('justification')?.hasError('minlength')) {
            <small class="p-error">Please provide at least 20 characters of justification</small>
          }
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <button
            pButton
            type="button"
            label="Cancel"
            icon="pi pi-times"
            class="p-button-outlined"
            (click)="onCancel()"
            [disabled]="isSubmitting()"
          ></button>

          <button
            pButton
            type="submit"
            label="Submit Request"
            icon="pi pi-send"
            [loading]="isSubmitting()"
            [disabled]="!requestForm.valid || isSubmitting()"
          ></button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .permission-request-dialog {
        padding: 1.5rem;
      }

      h2 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
      }

      .subtitle {
        margin: 0 0 1.5rem 0;
        color: var(--text-secondary);
      }

      .form-field {
        margin-bottom: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .form-field label {
        font-weight: 600;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        margin-top: 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--surface-border);
      }

      @media (max-width: 768px) {
        .form-row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PermissionRequestDialogComponent implements OnInit {
  requestForm: FormGroup
  isSubmitting = signal(false)
  durationError = signal<string | null>(null)

  minDate = new Date()

  availablePermissions = [
    { label: 'FIR Export (All)', value: 'fir:export:all' },
    { label: 'FIR Read (All)', value: 'fir:read:all' },
    { label: 'Report Export (All)', value: 'report:export:all' },
    { label: 'Audit Log View', value: 'audit:read:all' },
    { label: 'Company Read (All)', value: 'company:read:all' },
    { label: 'User Read (All)', value: 'user:read:all' },
    { label: 'Vehicle Read (All)', value: 'vehicle:read:all' },
    { label: 'MUD Export', value: 'mud:export:all' },
  ]

  constructor(
    private fb: FormBuilder,
    private ref: DynamicDialogRef,
    private apiService: TemporaryPermissionApiService,
    private messageService: MessageService
  ) {
    this.requestForm = this.fb.group({
      permissions: [[], [Validators.required]],
      startTime: [null, [Validators.required]],
      endTime: [null, [Validators.required]],
      justification: ['', [Validators.required, Validators.minLength(20)]],
    })
  }

  ngOnInit(): void {
    // Watch for time changes to validate duration
    this.requestForm.get('startTime')?.valueChanges.subscribe(() => this.validateDuration())
    this.requestForm.get('endTime')?.valueChanges.subscribe(() => this.validateDuration())
  }

  minEndDate(): Date {
    const start = this.requestForm.get('startTime')?.value
    return start ? new Date(start) : this.minDate
  }

  maxEndDate(): Date {
    const start = this.requestForm.get('startTime')?.value
    if (!start) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const maxEnd = new Date(start)
    maxEnd.setDate(maxEnd.getDate() + 7)
    return maxEnd
  }

  validateDuration(): void {
    const start = this.requestForm.get('startTime')?.value
    const end = this.requestForm.get('endTime')?.value

    if (!start || !end) {
      this.durationError.set(null)
      return
    }

    if (end <= start) {
      this.durationError.set('End time must be after start time')
      return
    }

    const durationMs = end.getTime() - start.getTime()
    const maxDurationMs = 7 * 24 * 60 * 60 * 1000 // 7 days

    if (durationMs > maxDurationMs) {
      this.durationError.set('Maximum duration is 7 days')
      return
    }

    this.durationError.set(null)
  }

  onSubmit(): void {
    if (!this.requestForm.valid || this.durationError()) {
      return
    }

    this.isSubmitting.set(true)

    const formValue = this.requestForm.value
    const data = {
      permissions: formValue.permissions,
      startTime: formValue.startTime.toISOString(),
      endTime: formValue.endTime.toISOString(),
      justification: formValue.justification,
    }

    this.apiService.requestPermission(data).subscribe({
      next: response => {
        this.messageService.add({
          severity: 'success',
          summary: 'Request Submitted',
          detail: response.message,
        })

        this.isSubmitting.set(false)
        this.ref.close({ success: true })
      },
      error: error => {
        this.messageService.add({
          severity: 'error',
          summary: 'Request Failed',
          detail: error.error?.message || error.message,
        })

        this.isSubmitting.set(false)
      },
    })
  }

  onCancel(): void {
    this.ref.close({ success: false })
  }
}
