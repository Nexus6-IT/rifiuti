import { Component, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms'
import { Router, ActivatedRoute } from '@angular/router'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { MessageModule } from 'primeng/message'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { DialogModule } from 'primeng/dialog'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ToastModule } from 'primeng/toast'
import { ConfirmationService, MessageService } from 'primeng/api'
import { PermissionMatrixComponent } from '../../components/permission-matrix/permission-matrix.component'
import { RoleApiService } from '../../services/role-api.service'

/**
 * CustomRoleBuilderComponent
 * Page for creating and editing custom roles
 * T175: Custom role builder page per User Story 5
 *
 * Purpose: Provide UI for enterprise clients to create custom roles
 *
 * Requirements from spec.md FR-011:
 * - Create/edit custom roles with name, description, permissions
 * - Visual permission matrix for selection
 * - Preview permissions before saving
 * - Validate role before creation
 *
 * Requirements from plan.md:
 * - Support creating roles with up to 100 permissions
 * - Real-time validation feedback
 * - Prevent using system role names
 */
@Component({
  selector: 'app-custom-role-builder',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    MessageModule,
    ProgressSpinnerModule,
    DialogModule,
    ConfirmDialogModule,
    ToastModule,
    PermissionMatrixComponent,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="page custom-role-builder">
      <!-- Intestazione -->
      <header class="page-header">
        <div class="page-header__titles header-with-back">
          <button
            pButton
            type="button"
            icon="pi pi-arrow-left"
            class="p-button-text p-button-rounded"
            (click)="goBack()"
            aria-label="Torna indietro"
          ></button>
          <div>
            <h1 class="page-title">
              {{ isEditMode() ? 'Modifica ruolo personalizzato' : 'Crea ruolo personalizzato' }}
            </h1>
            <p class="page-subtitle">
              {{
                isEditMode()
                  ? 'Modifica le proprietà e i permessi del ruolo'
                  : 'Definisci un ruolo personalizzato con permessi specifici per la tua organizzazione'
              }}
            </p>
          </div>
        </div>
      </header>

      <!-- Stato di caricamento -->
      @if (isLoading()) {
        <div class="surface-card">
          <div class="loading-container" role="status" aria-live="polite">
            <p-progressSpinner ariaLabel="Caricamento"></p-progressSpinner>
            <p>Caricamento del ruolo...</p>
          </div>
        </div>
      }

      <!-- Stato di errore -->
      @if (error()) {
        <p-message severity="error" [text]="error()!" styleClass="w-full"></p-message>
      }

      <!-- Form -->
      @if (!isLoading()) {
        <form [formGroup]="roleForm" (ngSubmit)="onSubmit()" class="builder-form">
          <!-- Informazioni di base -->
          <section class="surface-card form-section" aria-label="Informazioni di base">
            <h2 class="section-title">Informazioni di base</h2>
            <div class="form-grid">
              <div class="form-field">
                <label for="name">Nome ruolo *</label>
                <input
                  pInputText
                  id="name"
                  formControlName="name"
                  placeholder="es. Responsabile regionale"
                  [class.ng-invalid]="
                    roleForm.get('name')?.invalid && roleForm.get('name')?.touched
                  "
                  [attr.aria-invalid]="
                    roleForm.get('name')?.invalid && roleForm.get('name')?.touched
                  "
                  aria-describedby="name-error"
                />
                <div id="name-error" role="alert">
                  @if (
                    roleForm.get('name')?.hasError('required') && roleForm.get('name')?.touched
                  ) {
                    <small class="p-error">Il nome del ruolo è obbligatorio</small>
                  }
                  @if (roleForm.get('name')?.hasError('maxlength')) {
                    <small class="p-error"
                      >Il nome del ruolo deve avere al massimo 100 caratteri</small
                    >
                  }
                  @if (roleForm.get('name')?.hasError('systemRole')) {
                    <small class="p-error"
                      >Non puoi usare i nomi dei ruoli di sistema (ADMIN, OPERATOR, ecc.)</small
                    >
                  }
                </div>
              </div>

              <div class="form-field full-width">
                <label for="description">Descrizione</label>
                <textarea
                  pInputTextarea
                  id="description"
                  formControlName="description"
                  rows="3"
                  placeholder="Descrivi lo scopo e le responsabilità di questo ruolo..."
                  [class.ng-invalid]="
                    roleForm.get('description')?.invalid && roleForm.get('description')?.touched
                  "
                  aria-describedby="description-error"
                ></textarea>
                <div id="description-error" role="alert">
                  @if (roleForm.get('description')?.hasError('maxlength')) {
                    <small class="p-error"
                      >La descrizione deve avere al massimo 500 caratteri</small
                    >
                  }
                </div>
              </div>
            </div>
          </section>

          <!-- Selezione permessi -->
          <section class="surface-card form-section" aria-label="Permessi">
            <h2 class="section-title">Permessi</h2>
            <div class="permissions-header">
              <p>
                Seleziona i permessi per questo ruolo. È richiesto almeno 1 permesso, massimo 100.
              </p>
              <div class="permission-count">
                <span
                  [class.error]="
                    selectedPermissions().length === 0 || selectedPermissions().length > 100
                  "
                >
                  {{ selectedPermissions().length }} / 100 selezionati
                </span>
              </div>
            </div>

            @if (selectedPermissions().length === 0) {
              <p-message severity="warn" text="È richiesto almeno 1 permesso"></p-message>
            }

            @if (selectedPermissions().length > 100) {
              <p-message
                severity="error"
                text="Sono consentiti al massimo 100 permessi"
              ></p-message>
            }

            <app-permission-matrix
              [availablePermissions]="availablePermissions()"
              [selectedPermissions]="selectedPermissions()"
              (permissionsChanged)="onPermissionsChanged($event)"
            ></app-permission-matrix>
          </section>

          <!-- Anteprima -->
          @if (showPreview()) {
            <section class="surface-card form-section" aria-label="Anteprima">
              <h2 class="section-title">Anteprima</h2>
              <div class="preview-content">
                <div class="preview-row">
                  <strong>Nome ruolo:</strong>
                  <span>{{ roleForm.get('name')?.value || '(non impostato)' }}</span>
                </div>

                <div class="preview-row">
                  <strong>Descrizione:</strong>
                  <span>{{ roleForm.get('description')?.value || '(non impostata)' }}</span>
                </div>

                <div class="preview-row">
                  <strong>Permessi:</strong>
                  <span>{{ selectedPermissions().length }} selezionati</span>
                </div>

                <div class="preview-permissions">
                  @for (permission of selectedPermissions(); track permission) {
                    <code class="permission-tag">{{ permission }}</code>
                  }
                </div>
              </div>
            </section>
          }

          <!-- Azioni -->
          <div class="form-actions">
            <button
              pButton
              type="button"
              label="Annulla"
              icon="pi pi-times"
              class="p-button-outlined"
              (click)="onCancel()"
            ></button>

            <button
              pButton
              type="button"
              label="{{ showPreview() ? 'Nascondi anteprima' : 'Anteprima' }}"
              icon="pi pi-eye"
              class="p-button-outlined"
              (click)="togglePreview()"
              [disabled]="!isFormValid()"
            ></button>

            <button
              pButton
              type="submit"
              [label]="isEditMode() ? 'Aggiorna ruolo' : 'Crea ruolo'"
              icon="pi pi-check"
              [loading]="isSaving()"
              [disabled]="!isFormValid() || isSaving()"
            ></button>
          </div>
        </form>
      }
    </div>

    <!-- Dialog di conferma -->
    <p-confirmDialog></p-confirmDialog>
    <p-toast></p-toast>
  `,
  styles: [
    `
      .section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        margin: 0 0 var(--spacing-base);
      }

      .header-with-back {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-2xl);
        gap: var(--spacing-base);
        color: var(--text-secondary);
      }

      .builder-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--spacing-lg);
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .form-field.full-width {
        grid-column: 1 / -1;
      }
      .form-field label {
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .p-error {
        color: var(--color-danger);
        font-size: var(--font-size-sm);
      }

      .permissions-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-base);
        flex-wrap: wrap;
        gap: var(--spacing-base);
      }
      .permissions-header p {
        margin: 0;
      }

      .permission-count {
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-lg);
        white-space: nowrap;
      }
      .permission-count .error {
        color: var(--color-danger);
      }

      .preview-content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .preview-row {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: var(--spacing-base);
      }
      .preview-permissions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
      }
      .permission-tag {
        display: inline-block;
        padding: 0.2rem 0.65rem;
        background: var(--brand-primary-50);
        color: var(--brand-primary-dark);
        border-radius: var(--radius-full);
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--spacing-base);
      }

      @media (max-width: 768px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
        .preview-row {
          grid-template-columns: 1fr;
          gap: var(--spacing-xs);
        }
        .form-actions {
          flex-direction: column;
        }
        .form-actions button {
          width: 100%;
        }
      }
    `,
  ],
})
export class CustomRoleBuilderComponent implements OnInit {
  roleForm: FormGroup

  // Signals
  isLoading = signal(false)
  isSaving = signal(false)
  error = signal<string | null>(null)
  isEditMode = signal(false)
  showPreview = signal(false)
  availablePermissions = signal<string[]>([])
  selectedPermissions = signal<string[]>([])

  // System role names (cannot be used)
  private readonly SYSTEM_ROLE_NAMES = [
    'ADMIN',
    'OPERATOR',
    'DRIVER',
    'COMPLIANCE_OFFICER',
    'CONSULTANT',
    'FLEET_MANAGER',
  ]

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private roleApiService: RoleApiService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService
  ) {
    this.roleForm = this.fb.group({
      name: [
        '',
        [Validators.required, Validators.maxLength(100), this.systemRoleValidator.bind(this)],
      ],
      description: ['', [Validators.maxLength(500)]],
    })
  }

  ngOnInit(): void {
    // Load available permissions
    this.loadAvailablePermissions()

    // Check if editing existing role
    const roleId = this.route.snapshot.paramMap.get('id')
    if (roleId) {
      this.isEditMode.set(true)
      this.loadRole(roleId)
    }
  }

  loadAvailablePermissions(): void {
    // TODO: Fetch from API
    // For now, generate common permissions
    const resources = ['fir', 'company', 'user', 'vehicle', 'mud', 'audit', 'role']
    const actions = ['create', 'read', 'update', 'delete', 'export']
    const scopes = ['own', 'facility', 'all']

    const permissions: string[] = []
    for (const resource of resources) {
      for (const action of actions) {
        for (const scope of scopes) {
          permissions.push(`${resource}:${action}:${scope}`)
        }
      }
    }

    this.availablePermissions.set(permissions)
  }

  loadRole(roleId: string): void {
    this.isLoading.set(true)
    this.error.set(null)

    this.roleApiService.getRole(roleId).subscribe({
      next: response => {
        this.roleForm.patchValue({
          name: response.name,
          description: response.description,
        })

        this.selectedPermissions.set((response.permissions || []).map(p => p.permission))
        this.isLoading.set(false)
      },
      error: error => {
        this.error.set(`Impossibile caricare il ruolo: ${error.message}`)
        this.isLoading.set(false)
      },
    })
  }

  onPermissionsChanged(permissions: string[]): void {
    this.selectedPermissions.set(permissions)
  }

  togglePreview(): void {
    this.showPreview.set(!this.showPreview())
  }

  isFormValid(): boolean {
    return (
      this.roleForm.valid &&
      this.selectedPermissions().length > 0 &&
      this.selectedPermissions().length <= 100
    )
  }

  systemRoleValidator(control: any): { [key: string]: any } | null {
    if (control.value && this.SYSTEM_ROLE_NAMES.includes(control.value.toUpperCase())) {
      return { systemRole: true }
    }
    return null
  }

  onSubmit(): void {
    if (!this.isFormValid()) {
      return
    }

    this.isSaving.set(true)

    const roleData = {
      name: this.roleForm.get('name')?.value,
      description: this.roleForm.get('description')?.value,
      permissions: this.selectedPermissions(),
    }

    const apiCall = this.isEditMode()
      ? this.roleApiService.updateRole(this.route.snapshot.paramMap.get('id')!, roleData)
      : this.roleApiService.createRole(roleData)

    apiCall.subscribe({
      next: _response => {
        this.messageService.add({
          severity: 'success',
          summary: 'Fatto',
          detail: `Ruolo ${this.isEditMode() ? 'aggiornato' : 'creato'} con successo`,
        })

        this.isSaving.set(false)
        this.router.navigate(['/permissions/roles'])
      },
      error: error => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: `Impossibile ${this.isEditMode() ? 'aggiornare' : 'creare'} il ruolo: ${error.message}`,
        })

        this.isSaving.set(false)
      },
    })
  }

  onCancel(): void {
    if (this.roleForm.dirty || this.selectedPermissions().length > 0) {
      this.confirmationService.confirm({
        message: 'Ci sono modifiche non salvate. Vuoi davvero annullare?',
        header: 'Conferma annullamento',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sì, annulla',
        rejectLabel: 'Continua a modificare',
        accept: () => {
          this.goBack()
        },
      })
    } else {
      this.goBack()
    }
  }

  goBack(): void {
    this.router.navigate(['/permissions/roles'])
  }
}
