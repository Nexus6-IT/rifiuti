import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TimelineModule } from 'primeng/timeline';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DividerModule } from 'primeng/divider';
import { SignatureService, VerifySignaturesResponse } from '../../../core/services/signature.service';

/**
 * Public Signature Verification Component
 *
 * Public page for verifying FIR digital signatures.
 * No authentication required.
 *
 * Features:
 * - Verify all signatures cryptographically
 * - Display signature details (signer, timestamp, method)
 * - Show document hash
 * - Indicate verification status
 *
 * Used for:
 * - QR code verification from PDF
 * - Third-party validation
 * - Regulatory compliance checks
 *
 * Route: /verify/:firId
 */
@Component({
  selector: 'app-verify-signatures',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TagModule,
    TimelineModule,
    MessageModule,
    ProgressSpinnerModule,
    DividerModule,
  ],
  template: `
    <div class="verify-signatures-container">
      <!-- Header -->
      <div class="header text-center mb-5">
        <h1 class="verify-title mb-2">Verifica Firme Digitali FIR</h1>
        <p class="verify-subtitle">
          Sistema pubblico di verifica per conformità D.M. 59/2023
        </p>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading()" class="text-center py-6">
        <p-progressSpinner />
        <p class="mt-4 verify-subtitle">Verifica firme in corso...</p>
      </div>

      <!-- Error State -->
      <div *ngIf="error()" class="max-w-4xl mx-auto">
        <p-message
          severity="error"
          [text]="error() || 'Errore durante verifica firme'"
          styleClass="w-full"
        />
      </div>

      <!-- Verification Results -->
      <div *ngIf="verificationResult() && !isLoading()" class="max-w-4xl mx-auto">
        <!-- Overall Status -->
        <p-card styleClass="mb-4">
          <div class="flex align-items-center justify-content-between">
            <div>
              <h2 class="text-2xl font-semibold mb-2">
                {{ verificationResult()!.firNumber }}
              </h2>
              <p class="text-tertiary">FIR ID: {{ verificationResult()!.firId }}</p>
            </div>
            <p-tag
              [value]="verificationResult()!.allValid ? 'Firme Valide' : 'Firme Non Valide'"
              [severity]="verificationResult()!.allValid ? 'success' : 'danger'"
              [icon]="verificationResult()!.allValid ? 'pi pi-check-circle' : 'pi pi-times-circle'"
              styleClass="text-lg px-4 py-2"
            />
          </div>

          <p-divider />

          <div class="grid">
            <div class="col-12 md:col-6">
              <p class="text-sm text-tertiary mb-1">Firme presenti</p>
              <p class="text-xl font-semibold">
                {{ verificationResult()!.signatureCount }} / 3
              </p>
            </div>
            <div class="col-12 md:col-6">
              <p class="text-sm text-tertiary mb-1">Stato completamento</p>
              <p-tag
                [value]="verificationResult()!.isCompleted ? 'Completato' : 'Parziale'"
                [severity]="verificationResult()!.isCompleted ? 'success' : 'warning'"
                [icon]="verificationResult()!.isCompleted ? 'pi pi-check' : 'pi pi-clock'"
              />
            </div>
            <div class="col-12 mt-3">
              <p class="text-sm text-tertiary mb-1">Document Hash (SHA-256)</p>
              <code class="hash-block">
                {{ verificationResult()!.documentHash }}
              </code>
            </div>
            <div class="col-12 mt-3">
              <p class="text-sm text-tertiary">
                <i class="pi pi-clock mr-2"></i>
                Verificato il: {{ verificationResult()!.verifiedAt | date : 'dd/MM/yyyy HH:mm:ss' }}
              </p>
            </div>
          </div>
        </p-card>

        <!-- Signatures Timeline -->
        <p-card header="Dettaglio Firme Digitali">
          <p-timeline
            [value]="timelineEvents()"
            align="alternate"
            styleClass="signature-timeline"
          >
            <ng-template pTemplate="marker" let-event>
              <div
                class="timeline-marker"
                [class.valid]="event.signature?.isValid"
                [class.invalid]="event.signature && !event.signature.isValid"
                [class.pending]="!event.signature"
              >
                <i [class]="event.icon"></i>
              </div>
            </ng-template>

            <ng-template pTemplate="content" let-event>
              <div class="timeline-content">
                <!-- Role Header -->
                <div class="flex align-items-center justify-content-between mb-3">
                  <h3 class="m-0 text-xl">{{ event.roleLabel }}</h3>
                  <p-tag
                    *ngIf="event.signature"
                    [value]="event.signature.isValid ? 'Valida' : 'Non valida'"
                    [severity]="event.signature.isValid ? 'success' : 'danger'"
                    [icon]="event.signature.isValid ? 'pi pi-check-circle' : 'pi pi-times-circle'"
                  />
                  <p-tag
                    *ngIf="!event.signature"
                    value="Non presente"
                    severity="secondary"
                    icon="pi pi-minus-circle"
                  />
                </div>

                <!-- Signature Details -->
                <div *ngIf="event.signature" class="signature-details">
                  <div class="grid">
                    <div class="col-12 md:col-6 mb-2">
                      <p class="text-sm text-tertiary mb-1">Firmatario</p>
                      <p class="font-semibold">{{ event.signature.signerName }}</p>
                    </div>
                    <div class="col-12 md:col-6 mb-2">
                      <p class="text-sm text-tertiary mb-1">Codice Fiscale</p>
                      <p class="font-semibold">{{ event.signature.signerFiscalCode }}</p>
                    </div>
                    <div class="col-12 md:col-6 mb-2">
                      <p class="text-sm text-tertiary mb-1">Data e ora firma</p>
                      <p class="font-semibold">
                        {{ event.signature.signedAt | date : 'dd/MM/yyyy HH:mm:ss' }}
                      </p>
                    </div>
                    <div class="col-12 md:col-6 mb-2">
                      <p class="text-sm text-tertiary mb-1">Metodo firma</p>
                      <p class="font-semibold">{{ event.signature.signatureMethod }}</p>
                    </div>
                    <div class="col-12 mb-2">
                      <p class="text-sm text-tertiary mb-1">Certificate Hash (SHA-256)</p>
                      <code class="hash-block">
                        {{ event.signature.certificateHash }}
                      </code>
                    </div>
                    <div class="col-12 mb-2">
                      <p class="text-sm text-tertiary mb-1">Document Hash (SHA-256)</p>
                      <code class="hash-block">
                        {{ event.signature.documentHash }}
                      </code>
                    </div>
                    <div class="col-12 mt-2">
                      <p-tag
                        *ngIf="event.signature.hasTimestamp"
                        value="RFC 3161 Timestamp Token presente"
                        severity="info"
                        icon="pi pi-clock"
                        [rounded]="true"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </ng-template>
          </p-timeline>
        </p-card>

        <!-- Legal Notice -->
        <p-card styleClass="mt-4">
          <p-message
            severity="info"
            styleClass="w-full"
          >
            <ng-template pTemplate>
              <div class="flex flex-column">
                <span class="font-semibold mb-2">
                  <i class="pi pi-info-circle mr-2"></i>
                  Informazioni legali
                </span>
                <span class="text-sm">
                  Questa verifica è conforme al Decreto Ministeriale 59/2023 sul sistema RENTRI.
                  Le firme digitali hanno valore legale e sono verificate utilizzando ECDSA-SHA256
                  con timestamp RFC 3161 per garantire non-ripudio e integrità del documento.
                </span>
              </div>
            </ng-template>
          </p-message>
        </p-card>
      </div>
    </div>
  `,
  styles: [
    `
      .verify-signatures-container {
        padding: clamp(1.5rem, 4vw, 3rem) var(--spacing-lg);
        background:
          radial-gradient(120% 90% at 50% 0%, var(--brand-primary-50) 0%, transparent 55%),
          var(--surface-ground);
        min-height: 100vh;
      }

      .verify-title {
        font-family: var(--font-display);
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.02em;
        color: var(--text-primary);
        margin: 0;
      }
      .verify-subtitle {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        margin: 0;
      }

      .hash-block {
        display: block;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        background: var(--color-gray-100);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-base);
        padding: var(--spacing-sm);
        overflow-wrap: anywhere;
      }

      .timeline-marker {
        width: 3rem;
        height: 3rem;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        border: 3px solid;
      }

      .timeline-marker.valid {
        background-color: var(--color-success);
        border-color: var(--color-success);
        color: var(--text-inverse);
      }

      .timeline-marker.invalid {
        background-color: var(--color-danger);
        border-color: var(--color-danger);
        color: var(--text-inverse);
      }

      .timeline-marker.pending {
        background-color: var(--color-gray-100);
        border-color: var(--surface-border-strong);
        color: var(--text-tertiary);
      }

      .timeline-content {
        padding: var(--spacing-lg);
        background-color: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }

      .signature-details {
        background-color: var(--color-gray-50);
        padding: var(--spacing-base);
        border-radius: var(--radius-md);
        margin-top: var(--spacing-base);
      }
    `,
  ],
})
export class VerifySignaturesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly signatureService = inject(SignatureService);

  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly verificationResult = signal<VerifySignaturesResponse | null>(null);
  protected readonly timelineEvents = signal<any[]>([]);

  ngOnInit(): void {
    const firId = this.route.snapshot.paramMap.get('firId');

    if (!firId) {
      this.error.set('ID FIR non fornito');
      this.isLoading.set(false);
      return;
    }

    this.verifySignatures(firId);
  }

  /**
   * Verify signatures
   */
  private async verifySignatures(firId: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const result = await this.signatureService
        .verifySignatures(firId)
        .toPromise();

      if (!result) {
        throw new Error('No verification result received');
      }

      this.verificationResult.set(result);
      this.buildTimeline(result.signatures);
    } catch (err: any) {
      console.error('Verification failed:', err);
      this.error.set(
        err.error?.message ||
          err.message ||
          'Errore durante verifica firme digitali',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Build timeline from signatures
   */
  private buildTimeline(signatures: any[]): void {
    const roles: Array<'PRODUCER' | 'CARRIER' | 'RECEIVER'> = [
      'PRODUCER',
      'CARRIER',
      'RECEIVER',
    ];

    const events = roles.map((role) => {
      const signature = signatures.find((s) => s.role === role);

      return {
        role,
        roleLabel: this.getRoleLabel(role),
        signature,
        icon: this.getRoleIcon(role),
      };
    });

    this.timelineEvents.set(events);
  }

  /**
   * Get Italian label for role
   */
  private getRoleLabel(role: string): string {
    const labels = {
      PRODUCER: 'Produttore',
      CARRIER: 'Trasportatore',
      RECEIVER: 'Destinatario',
    };
    return labels[role as keyof typeof labels] || role;
  }

  /**
   * Get icon for role
   */
  private getRoleIcon(role: string): string {
    const icons = {
      PRODUCER: 'pi pi-building',
      CARRIER: 'pi pi-truck',
      RECEIVER: 'pi pi-inbox',
    };
    return icons[role as keyof typeof icons] || 'pi pi-user';
  }
}
