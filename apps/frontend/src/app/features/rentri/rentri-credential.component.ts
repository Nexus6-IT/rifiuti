import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { DropdownModule } from 'primeng/dropdown'
import { TagModule } from 'primeng/tag'
import { SelectButtonModule } from 'primeng/selectbutton'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriCredentialService, RentriCredentialStatus } from './rentri-credential.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/**
 * Pagina admin per la gestione del certificato di interoperabilità RENTRI del
 * tenant: stato, caricamento (PKCS#12 .p12/.pfx oppure PEM), rimozione.
 * La chiave privata non viene mai mostrata né rinviata dal backend.
 */
@Component({
  selector: 'app-rentri-credential',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    TagModule,
    SelectButtonModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page" style="max-width: 820px;">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Certificato RENTRI</h1>
          <p class="page-subtitle">
            Certificato di interoperabilità per la trasmissione RENTRI del tenant
          </p>
        </div>
      </header>

      <!-- Non-admin -->
      <section *ngIf="!isAdmin()" class="surface-card">
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori del tenant possono gestire il certificato RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <!-- Stato attuale -->
        <section class="surface-card mb-4" aria-label="Stato del certificato">
          <h2 class="rentri-section-title mb-3">Stato</h2>

          <div *ngIf="loading()" class="flex align-items-center gap-2 text-secondary">
            <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
            <span>Caricamento…</span>
          </div>

          <div *ngIf="!loading() && status() as s">
            <p-tag
              [severity]="s.configured ? 'success' : 'danger'"
              [value]="s.configured ? 'Configurato' : 'Non configurato'"
              [icon]="s.configured ? 'pi pi-check-circle' : 'pi pi-times-circle'"
            ></p-tag>

            <dl *ngIf="s.configured" class="rentri-meta mt-3">
              <div class="rentri-meta__row">
                <dt>Client ID</dt>
                <dd>{{ s.clientId }}</dd>
              </div>
              <div class="rentri-meta__row">
                <dt>Ambiente</dt>
                <dd>{{ s.environment }}</dd>
              </div>
            </dl>

            <p-button
              *ngIf="s.configured"
              label="Rimuovi certificato"
              icon="pi pi-trash"
              severity="danger"
              [outlined]="true"
              styleClass="mt-3"
              (onClick)="confirmRemove()"
              ariaLabel="Rimuovi il certificato RENTRI del tenant"
            ></p-button>
          </div>
        </section>

        <!-- Caricamento -->
        <section class="surface-card" aria-label="Caricamento certificato">
          <h2 class="rentri-section-title mb-2">
            {{ status()?.configured ? 'Sostituisci' : 'Carica' }} certificato
          </h2>
          <p class="rentri-security-note mb-4">
            <i class="pi pi-shield" aria-hidden="true"></i>
            La chiave privata è cifrata e conservata in modo sicuro: non viene mai mostrata né
            restituita dal sistema.
          </p>

          <div class="field mb-3">
            <label for="r-client-id" class="block mb-2"
              >Client ID (identificativo operatore) *</label
            >
            <input
              id="r-client-id"
              pInputText
              [(ngModel)]="clientId"
              class="w-full"
              placeholder="es. codice operatore RENTRI"
              autocomplete="off"
            />
          </div>

          <div class="grid formgrid mb-3">
            <div class="field col-12 md:col-6">
              <label for="r-env" class="block mb-2">Ambiente</label>
              <p-dropdown
                inputId="r-env"
                [options]="envOptions"
                [(ngModel)]="environment"
                styleClass="w-full"
                ariaLabel="Ambiente RENTRI"
              ></p-dropdown>
            </div>
            <div class="field col-12 md:col-6">
              <label for="r-algo" class="block mb-2">Algoritmo</label>
              <p-dropdown
                inputId="r-algo"
                [options]="algoOptions"
                [(ngModel)]="algorithm"
                styleClass="w-full"
                ariaLabel="Algoritmo di firma"
              ></p-dropdown>
            </div>
          </div>

          <div class="field mb-4">
            <label id="r-mode-label" class="block mb-2">Modalità</label>
            <p-selectButton
              [options]="modeOptions"
              [(ngModel)]="mode"
              optionLabel="label"
              optionValue="value"
              ariaLabelledBy="r-mode-label"
            ></p-selectButton>
          </div>

          <!-- PKCS#12 -->
          <div *ngIf="mode === 'pkcs12'">
            <div class="field mb-3">
              <label for="r-p12-file" class="block mb-2">File certificato (.p12 / .pfx) *</label>
              <input
                id="r-p12-file"
                type="file"
                accept=".p12,.pfx"
                (change)="onFileSelected($event)"
                class="rentri-file"
                aria-describedby="r-p12-hint"
              />
              <small id="r-p12-hint" class="block mt-1 text-tertiary">
                {{
                  pkcs12FileName()
                    ? 'Selezionato: ' + pkcs12FileName()
                    : 'Seleziona il file PKCS#12 che contiene certificato e chiave privata.'
                }}
              </small>
            </div>
            <div class="field mb-3">
              <label for="r-p12-pass" class="block mb-2">Passphrase *</label>
              <input
                id="r-p12-pass"
                pInputText
                type="password"
                [(ngModel)]="pkcs12Passphrase"
                class="w-full"
                autocomplete="new-password"
              />
            </div>
          </div>

          <!-- PEM -->
          <div *ngIf="mode === 'pem'">
            <div class="field mb-3">
              <label for="r-pem-cert" class="block mb-2">Certificato (PEM) *</label>
              <textarea
                id="r-pem-cert"
                pInputTextarea
                [(ngModel)]="certificatePem"
                class="w-full"
                rows="4"
                placeholder="-----BEGIN CERTIFICATE-----"
              ></textarea>
            </div>
            <div class="field mb-3">
              <label for="r-pem-key" class="block mb-2">Chiave privata (PEM) *</label>
              <textarea
                id="r-pem-key"
                pInputTextarea
                [(ngModel)]="privateKeyPem"
                class="w-full"
                rows="4"
                placeholder="-----BEGIN PRIVATE KEY-----"
                autocomplete="off"
              ></textarea>
            </div>
          </div>

          <p-button
            label="Salva certificato"
            icon="pi pi-save"
            [loading]="saving()"
            [disabled]="!canSubmit()"
            (onClick)="save()"
            ariaLabel="Salva il certificato RENTRI"
          ></p-button>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .rentri-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .rentri-security-note {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--color-info);
        background: var(--color-info-bg);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin: 0;
      }
      .rentri-security-note .pi {
        margin-top: 2px;
      }
      .rentri-meta {
        margin: 0;
        display: grid;
        gap: var(--spacing-xs);
      }
      .rentri-meta__row {
        display: flex;
        gap: var(--spacing-sm);
      }
      .rentri-meta dt {
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        min-width: 96px;
      }
      .rentri-meta dd {
        margin: 0;
        color: var(--text-primary);
      }
      .rentri-file {
        display: block;
        width: 100%;
        padding: var(--spacing-sm);
        border: 1px dashed var(--surface-border-strong);
        border-radius: var(--radius-md);
        background: var(--surface-section);
        font-size: var(--font-size-sm);
      }
      .rentri-file:focus-visible {
        outline: var(--focus-ring-width) solid var(--focus-ring-color);
        outline-offset: var(--focus-ring-offset);
      }
      .text-secondary {
        color: var(--text-secondary);
      }
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mt-3 {
        margin-top: var(--spacing-base);
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
      .field {
        margin-bottom: 0;
      }
    `,
  ],
})
export class RentriCredentialComponent implements OnInit {
  private readonly credentialService = inject(RentriCredentialService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly confirm = inject(ConfirmationService)

  readonly status = signal<RentriCredentialStatus | null>(null)
  readonly loading = signal(false)
  readonly saving = signal(false)
  readonly pkcs12FileName = signal<string | null>(null)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  // Form state
  clientId = ''
  environment = 'demo'
  algorithm: 'RS256' | 'ES256' = 'RS256'
  mode: 'pkcs12' | 'pem' = 'pkcs12'
  pkcs12Base64 = ''
  pkcs12Passphrase = ''
  certificatePem = ''
  privateKeyPem = ''

  readonly envOptions = [
    { label: 'Demo', value: 'demo' },
    { label: 'Produzione', value: 'live' },
  ]
  readonly algoOptions = [
    { label: 'RS256 (certificato RSA)', value: 'RS256' },
    { label: 'ES256 (certificato EC)', value: 'ES256' },
  ]
  readonly modeOptions = [
    { label: 'File PKCS#12 (.p12/.pfx)', value: 'pkcs12' },
    { label: 'PEM (incolla)', value: 'pem' },
  ]

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadStatus()
    }
  }

  private loadStatus(): void {
    this.loading.set(true)
    this.credentialService.getStatus().subscribe({
      next: s => {
        this.status.set(s)
        if (s.clientId) this.clientId = s.clientId
        if (s.environment) this.environment = s.environment
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.toast.error('Impossibile caricare lo stato del certificato')
      },
    })
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    this.pkcs12FileName.set(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      // result è "data:...;base64,XXXX": teniamo solo la parte base64.
      const result = reader.result as string
      this.pkcs12Base64 = result.includes(',') ? result.split(',')[1] : result
    }
    reader.readAsDataURL(file)
  }

  canSubmit(): boolean {
    if (!this.clientId.trim()) return false
    if (this.mode === 'pkcs12') return !!this.pkcs12Base64 && !!this.pkcs12Passphrase
    return !!this.certificatePem.trim() && !!this.privateKeyPem.trim()
  }

  save(): void {
    if (!this.canSubmit()) return
    this.saving.set(true)

    const base = {
      clientId: this.clientId.trim(),
      algorithm: this.algorithm,
      environment: this.environment,
    }
    const payload =
      this.mode === 'pkcs12'
        ? { ...base, pkcs12Base64: this.pkcs12Base64, pkcs12Passphrase: this.pkcs12Passphrase }
        : {
            ...base,
            certificatePem: this.certificatePem.trim(),
            privateKeyPem: this.privateKeyPem.trim(),
          }

    this.credentialService.setCredential(payload).subscribe({
      next: () => {
        this.saving.set(false)
        this.toast.success('Certificato RENTRI salvato')
        this.resetSecrets()
        this.loadStatus()
      },
      error: err => {
        this.saving.set(false)
        this.toast.error(err?.error?.message || 'Errore nel salvataggio del certificato')
      },
    })
  }

  confirmRemove(): void {
    this.confirm.confirm({
      message:
        'Rimuovere il certificato RENTRI del tenant? Le trasmissioni live non funzioneranno finché non ne carichi uno nuovo.',
      header: 'Conferma rimozione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.remove(),
    })
  }

  private remove(): void {
    this.credentialService.remove().subscribe({
      next: () => {
        this.toast.success('Certificato rimosso')
        this.resetSecrets()
        this.loadStatus()
      },
      error: () => this.toast.error('Errore nella rimozione del certificato'),
    })
  }

  private resetSecrets(): void {
    this.pkcs12Base64 = ''
    this.pkcs12Passphrase = ''
    this.certificatePem = ''
    this.privateKeyPem = ''
    this.pkcs12FileName.set(null)
  }
}
