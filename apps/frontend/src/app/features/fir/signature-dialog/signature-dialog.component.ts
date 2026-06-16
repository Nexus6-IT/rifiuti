import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { DividerModule } from 'primeng/divider';
import { TagModule } from 'primeng/tag';
import { SignatureService } from '../../../core/services/signature.service';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from 'primeng/api';

/**
 * Signature Dialog Component
 *
 * Modal dialog for applying digital signature to FIR.
 *
 * Features:
 * - Role selection (Producer, Carrier, Receiver)
 * - SPID level check (requires Level 2+)
 * - Authentication recency check (<15 minutes)
 * - Re-authentication prompt if expired
 * - Signature confirmation
 * - Success/error feedback
 *
 * Used in FIR detail view when user clicks "Firma" button.
 */
@Component({
  selector: 'app-signature-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    MessageModule,
    DividerModule,
    TagModule,
  ],
  template: `
    <div class="signature-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <h2>Firma Digitale FIR</h2>
        <p class="text-sm text-tertiary">
          {{ firNumber }}
        </p>
      </div>

      <p-divider />

      <!-- SPID Level Check -->
      <div class="spid-level-info mb-4">
        <p-message
          *ngIf="currentUser() && currentUser().spidLevel >= 2"
          severity="success"
          [text]="
            'SPID Level ' +
            currentUser().spidLevel +
            ' - Autorizzato per firme digitali'
          "
        />
        <p-message
          *ngIf="!currentUser() || currentUser().spidLevel < 2"
          severity="error"
          text="SPID Level 2 o superiore richiesto per firmare digitalmente"
        />
      </div>

      <!-- Authentication Recency Check -->
      <div class="auth-recency-info mb-4" *ngIf="authStatus()">
        <p-message
          *ngIf="authStatus().isRecent"
          severity="info"
          [text]="
            'Autenticato ' + authStatus().minutesAgo + ' minuti fa - Valido per firma'
          "
        />
        <p-message
          *ngIf="!authStatus().isRecent"
          severity="warn"
          text="Autenticazione scaduta (>15 minuti). Effettua nuovamente il login."
        />
      </div>

      <!-- Re-authentication Required -->
      <div class="re-auth-section mb-4" *ngIf="requiresReAuth()">
        <p-message
          severity="warn"
          text="Per motivi di sicurezza, devi effettuare nuovamente l'autenticazione SPID per firmare questo documento."
        />
        <p-button
          label="Ri-autentica con SPID"
          icon="pi pi-sign-in"
          [outlined]="true"
          (onClick)="reAuthenticate()"
          class="mt-3 w-full"
        />
      </div>

      <!-- Signature Role -->
      <div class="role-section mb-4" *ngIf="!requiresReAuth()">
        <label class="block mb-2 font-semibold">Ruolo di firma:</label>
        <p-tag
          [value]="getRoleLabel(role)"
          [severity]="getRoleSeverity(role)"
          [icon]="getRoleIcon(role)"
          styleClass="text-lg px-4 py-2"
        />
        <p class="text-sm text-tertiary mt-2">
          {{ getRoleDescription(role) }}
        </p>
      </div>

      <!-- Signature Method Info -->
      <div class="signature-method mb-4" *ngIf="!requiresReAuth()">
        <p class="text-sm text-tertiary">
          <i class="pi pi-shield mr-2"></i>
          Metodo di firma: <strong>ECDSA-SHA256</strong> (conformità D.M. 59/2023)
        </p>
        <p class="text-sm text-tertiary mt-1">
          <i class="pi pi-clock mr-2"></i>
          Timestamp token: <strong>RFC 3161</strong> (non ripudio)
        </p>
      </div>

      <!-- Warning -->
      <div class="warning-section mb-4" *ngIf="!requiresReAuth()">
        <p-message
          severity="warn"
          styleClass="w-full"
        >
          <ng-template pTemplate>
            <div class="flex flex-column">
              <span class="font-semibold mb-2">Attenzione</span>
              <span class="text-sm">
                Applicando la firma digitale, confermi la correttezza dei dati del FIR.
                La firma ha valore legale e non può essere revocata.
              </span>
            </div>
          </ng-template>
        </p-message>
      </div>

      <!-- Actions -->
      <div class="dialog-actions flex gap-2 justify-content-end">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="cancel()"
          [disabled]="isSigning()"
        />
        <p-button
          label="Firma Documento"
          icon="pi pi-check"
          (onClick)="sign()"
          [loading]="isSigning()"
          [disabled]="!canSign()"
        />
      </div>
    </div>
  `,
  styles: [
    `
      .signature-dialog {
        padding: var(--spacing-base);
        width: 100%;
        max-width: 540px;
      }

      .dialog-header h2 {
        margin: 0 0 var(--spacing-sm) 0;
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .dialog-actions {
        margin-top: var(--spacing-lg);
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }
    `,
  ],
})
export class SignatureDialogComponent implements OnInit {
  private readonly signatureService = inject(SignatureService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);
  public readonly config = inject(DynamicDialogConfig);
  public readonly ref = inject(DynamicDialogRef);

  // Component state
  protected readonly isSigning = signal(false);
  protected readonly currentUser = this.authService.currentUser;

  // Dialog data
  protected firId: string = '';
  protected firNumber: string = '';
  protected role: 'PRODUCER' | 'CARRIER' | 'RECEIVER' = 'PRODUCER';

  // Computed authentication status
  protected readonly authStatus = computed(() => {
    const user = this.currentUser();
    if (!user || !user.authenticatedAt) {
      return null;
    }

    const authenticatedAt = new Date(user.authenticatedAt);
    const minutesAgo = Math.floor(
      (Date.now() - authenticatedAt.getTime()) / 1000 / 60,
    );
    const isRecent = minutesAgo <= 15;

    return { minutesAgo, isRecent };
  });

  // Computed re-auth requirement
  protected readonly requiresReAuth = computed(() => {
    const user = this.currentUser();
    if (!user) return true;

    const status = this.authStatus();
    return !status || !status.isRecent || user.spidLevel < 2;
  });

  // Computed can sign
  protected readonly canSign = computed(() => {
    return !this.requiresReAuth() && !this.isSigning();
  });

  ngOnInit(): void {
    // Get dialog data
    this.firId = this.config.data?.firId;
    this.firNumber = this.config.data?.firNumber;
    this.role = this.config.data?.role || 'PRODUCER';
  }

  /**
   * Apply digital signature
   */
  protected async sign(): Promise<void> {
    this.isSigning.set(true);

    try {
      const result = await this.signatureService
        .applySignature(this.firId, this.role)
        .toPromise();

      this.messageService.add({
        severity: 'success',
        summary: 'Firma Applicata',
        detail: result?.message || 'Firma digitale applicata con successo',
        life: 5000,
      });

      // Close dialog with success result
      this.ref.close({ success: true, result });
    } catch (error: any) {
      console.error('Signature error:', error);

      const errorMessage =
        error.error?.message ||
        error.message ||
        'Errore durante applicazione firma';

      this.messageService.add({
        severity: 'error',
        summary: 'Errore Firma',
        detail: errorMessage,
        life: 8000,
      });
    } finally {
      this.isSigning.set(false);
    }
  }

  /**
   * Cancel signature
   */
  protected cancel(): void {
    this.ref.close({ success: false });
  }

  /**
   * Re-authenticate with SPID
   */
  protected reAuthenticate(): void {
    // Save return URL with signature intent
    const returnUrl = `/fir/${this.firId}?sign=${this.role}`;
    this.authService.loginWithSPID(returnUrl);
  }

  /**
   * Get Italian label for role
   */
  protected getRoleLabel(role: string): string {
    return this.signatureService.getRoleLabel(role as any);
  }

  /**
   * Get severity color for role tag
   */
  protected getRoleSeverity(
    role: string,
  ): 'success' | 'info' | 'warning' | 'danger' {
    const severities = {
      PRODUCER: 'info' as const,
      CARRIER: 'warning' as const,
      RECEIVER: 'success' as const,
    };
    return severities[role as keyof typeof severities] || 'info';
  }

  /**
   * Get icon for role
   */
  protected getRoleIcon(role: string): string {
    const icons = {
      PRODUCER: 'pi pi-building',
      CARRIER: 'pi pi-truck',
      RECEIVER: 'pi pi-inbox',
    };
    return icons[role as keyof typeof icons] || 'pi pi-user';
  }

  /**
   * Get description for role
   */
  protected getRoleDescription(role: string): string {
    const descriptions = {
      PRODUCER:
        'Firma del produttore al momento della produzione e conferimento del rifiuto',
      CARRIER: 'Firma del trasportatore al momento del ritiro del rifiuto',
      RECEIVER:
        'Firma del destinatario al momento della ricezione del rifiuto',
    };
    return descriptions[role as keyof typeof descriptions] || '';
  }
}
