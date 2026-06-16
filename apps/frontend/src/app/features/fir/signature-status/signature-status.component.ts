import { Component, Input, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimelineModule } from 'primeng/timeline';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DialogService } from 'primeng/dynamicdialog';
import { SignatureService, SignatureVerification } from '../../../core/services/signature.service';
import { SignatureDialogComponent } from '../signature-dialog/signature-dialog.component';

/**
 * Signature Status Component
 *
 * Displays digital signature status for FIR:
 * - Timeline of signatures (Producer → Carrier → Receiver)
 * - Status badges for each signature
 * - Sign buttons for authorized users
 * - Verification status
 *
 * Used in FIR detail view to show signature workflow progress.
 */
@Component({
  selector: 'app-signature-status',
  standalone: true,
  imports: [CommonModule, TimelineModule, CardModule, TagModule, ButtonModule],
  providers: [DialogService],
  template: `
    <p-card header="Firme Digitali" styleClass="signature-status-card">
      <ng-template pTemplate="subtitle">
        <div class="flex align-items-center gap-2">
          <p-tag
            [value]="statusBadge().label"
            [severity]="statusBadge().severity"
            [icon]="statusBadge().icon"
          />
          <span class="text-sm text-tertiary" *ngIf="verificationResult()">
            {{ verificationResult()?.allValid ? 'Firme valide' : 'Verifica firme fallita' }}
          </span>
        </div>
      </ng-template>

      <!-- Signature Timeline -->
      <p-timeline
        [value]="timelineEvents()"
        align="alternate"
        styleClass="signature-timeline"
      >
        <ng-template pTemplate="marker" let-event>
          <div
            class="timeline-marker"
            [class.completed]="event.completed"
            [class.pending]="!event.completed"
          >
            <i [class]="event.icon"></i>
          </div>
        </ng-template>

        <ng-template pTemplate="content" let-event>
          <div class="timeline-content">
            <!-- Role Header -->
            <div class="flex align-items-center justify-content-between mb-2">
              <h4 class="m-0">{{ event.roleLabel }}</h4>
              <p-tag
                *ngIf="event.completed"
                value="Firmato"
                severity="success"
                icon="pi pi-check"
              />
              <p-tag
                *ngIf="!event.completed"
                value="In attesa"
                severity="warning"
                icon="pi pi-clock"
              />
            </div>

            <!-- Signature Details -->
            <div *ngIf="event.signature" class="signature-details">
              <p class="text-sm mb-1">
                <i class="pi pi-user mr-2"></i>
                <strong>{{ event.signature.signerName }}</strong>
              </p>
              <p class="text-sm mb-1">
                <i class="pi pi-id-card mr-2"></i>
                {{ event.signature.signerFiscalCode }}
              </p>
              <p class="text-sm mb-1">
                <i class="pi pi-calendar mr-2"></i>
                {{ event.signature.signedAt | date : 'dd/MM/yyyy HH:mm' }}
              </p>
              <p class="text-sm mb-1">
                <i class="pi pi-shield mr-2"></i>
                {{ event.signature.signatureMethod }}
              </p>
              <div class="flex align-items-center gap-2 mt-2">
                <p-tag
                  *ngIf="event.signature.isValid"
                  value="Firma valida"
                  severity="success"
                  icon="pi pi-check-circle"
                  [rounded]="true"
                />
                <p-tag
                  *ngIf="!event.signature.isValid"
                  value="Firma non valida"
                  severity="danger"
                  icon="pi pi-times-circle"
                  [rounded]="true"
                />
                <p-tag
                  *ngIf="event.signature.hasTimestamp"
                  value="Timestamp RFC 3161"
                  severity="info"
                  icon="pi pi-clock"
                  [rounded]="true"
                />
              </div>
            </div>

            <!-- Sign Button -->
            <div *ngIf="!event.completed && canUserSign(event.role)" class="mt-3">
              <p-button
                [label]="'Firma come ' + event.roleLabel"
                icon="pi pi-pencil"
                (onClick)="openSignDialog(event.role)"
                [outlined]="true"
              />
            </div>
          </div>
        </ng-template>
      </p-timeline>

      <!-- Verification Link -->
      <div class="verification-link mt-4 pt-3">
        <p class="text-sm text-tertiary mb-2">
          <i class="pi pi-qrcode mr-2"></i>
          Verifica firme pubblicamente (QR code disponibile nel PDF)
        </p>
        <p-button
          label="Verifica Firme"
          icon="pi pi-external-link"
          [text]="true"
          (onClick)="openVerificationPage()"
        />
      </div>
    </p-card>
  `,
  styles: [
    `
      .signature-status-card {
        margin-bottom: var(--spacing-lg);
      }

      .signature-timeline {
        margin-top: var(--spacing-base);
      }

      .verification-link {
        border-top: 1px solid var(--surface-border);
      }

      .timeline-marker {
        width: 3rem;
        height: 3rem;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        border: 2px solid;
      }

      .timeline-marker.completed {
        background-color: var(--color-success);
        border-color: var(--color-success);
        color: var(--text-inverse);
      }

      .timeline-marker.pending {
        background-color: var(--color-gray-100);
        border-color: var(--surface-border-strong);
        color: var(--text-tertiary);
      }

      .timeline-content {
        padding: var(--spacing-base);
        background-color: var(--color-gray-50);
        border-radius: var(--radius-lg);
        border-left: 4px solid var(--surface-border);
      }

      .signature-details {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-md);
        background-color: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
      }
    `,
  ],
})
export class SignatureStatusComponent implements OnInit {
  private readonly signatureService = inject(SignatureService);
  private readonly dialogService = inject(DialogService);

  @Input() firId!: string;
  @Input() firNumber!: string;
  @Input() signatureCount: number = 0;
  @Input() isCompleted: boolean = false;

  protected readonly verificationResult = signal<any>(null);
  protected readonly timelineEvents = signal<any[]>([]);

  protected readonly statusBadge = signal({
    label: 'Non firmato (0/3)',
    severity: 'warning' as const,
    icon: 'pi pi-exclamation-circle',
  });

  ngOnInit(): void {
    this.loadSignatureVerification();
    this.updateStatusBadge();
  }

  /**
   * Load signature verification from server
   */
  private async loadSignatureVerification(): Promise<void> {
    try {
      const result = await this.signatureService
        .verifySignatures(this.firId)
        .toPromise();

      this.verificationResult.set(result);
      this.buildTimeline(result?.signatures || []);
    } catch (error) {
      console.error('Failed to verify signatures:', error);
    }
  }

  /**
   * Build timeline events from signatures
   */
  private buildTimeline(signatures: SignatureVerification[]): void {
    const roles: Array<'PRODUCER' | 'CARRIER' | 'RECEIVER'> = [
      'PRODUCER',
      'CARRIER',
      'RECEIVER',
    ];

    const events = roles.map((role) => {
      const signature = signatures.find((s) => s.role === role);

      return {
        role,
        roleLabel: this.signatureService.getRoleLabel(role),
        completed: !!signature,
        signature,
        icon: this.getRoleIcon(role),
      };
    });

    this.timelineEvents.set(events);
  }

  /**
   * Update status badge
   */
  private updateStatusBadge(): void {
    const badge = this.signatureService.getSignatureStatusBadge(
      this.signatureCount,
      this.isCompleted,
    );
    this.statusBadge.set(badge);
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

  /**
   * Check if user can sign with role
   */
  protected canUserSign(role: 'PRODUCER' | 'CARRIER' | 'RECEIVER'): boolean {
    // Placeholder - in production, check user authorization
    return true;
  }

  /**
   * Open signature dialog
   */
  protected openSignDialog(role: 'PRODUCER' | 'CARRIER' | 'RECEIVER'): void {
    const ref = this.dialogService.open(SignatureDialogComponent, {
      header: 'Firma Digitale FIR',
      width: '600px',
      data: {
        firId: this.firId,
        firNumber: this.firNumber,
        role,
      },
    });

    ref.onClose.subscribe((result) => {
      if (result?.success) {
        // Reload signatures
        this.loadSignatureVerification();
        this.signatureCount++;
        this.isCompleted = this.signatureCount === 3;
        this.updateStatusBadge();
      }
    });
  }

  /**
   * Open public verification page
   */
  protected async openVerificationPage(): Promise<void> {
    const urlResult = await this.signatureService
      .getVerificationUrl(this.firId)
      .toPromise();

    if (urlResult?.url) {
      window.open(urlResult.url, '_blank');
    }
  }
}
