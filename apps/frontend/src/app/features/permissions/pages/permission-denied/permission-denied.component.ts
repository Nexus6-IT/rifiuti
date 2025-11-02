import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { PermissionStore } from '../../../../core/state/permission.store';

/**
 * PermissionDeniedComponent
 * Full-page error component shown when user lacks required permissions
 * Per plan.md FR-009: Contextual error messages for permission denials
 *
 * Features:
 * - Clear explanation of why access was denied
 * - Display required permission vs user's current role
 * - Visual feedback with icons and colors
 * - Actionable next steps (contact admin, go back)
 * - Support email and help documentation links
 * - Show user's current permissions for transparency
 *
 * T094: Styled permission denied error page
 */
@Component({
  selector: 'app-permission-denied',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    MessageModule,
  ],
  template: `
    <div class="permission-denied-page">
      <div class="error-container">
        <!-- Error Icon and Title -->
        <div class="error-header">
          <div class="error-icon-wrapper">
            <i class="pi pi-lock error-icon"></i>
          </div>
          <h1 class="error-title">Access Denied</h1>
          <p class="error-subtitle">
            You don't have permission to access this resource
          </p>
        </div>

        <!-- Error Details Card -->
        <p-card styleClass="error-details-card">
          <div class="error-details">
            <p-message
              severity="warn"
              [text]="getErrorMessage()"
              styleClass="w-full">
            </p-message>

            <!-- Required Permission -->
            <div class="info-section" *ngIf="requiredPermission">
              <h3 class="section-title">
                <i class="pi pi-shield"></i>
                Required Permission
              </h3>
              <div class="permission-code">
                <code>{{ requiredPermission }}</code>
              </div>
              <div class="permission-breakdown">
                <div class="breakdown-item">
                  <span class="label">Resource:</span>
                  <span class="value">{{ getResource() }}</span>
                </div>
                <div class="breakdown-item">
                  <span class="label">Action:</span>
                  <span class="value">{{ getAction() }}</span>
                </div>
                <div class="breakdown-item">
                  <span class="label">Scope:</span>
                  <span class="value">{{ getScope() }}</span>
                </div>
              </div>
            </div>

            <!-- Current Role -->
            <div class="info-section" *ngIf="currentRole">
              <h3 class="section-title">
                <i class="pi pi-user"></i>
                Your Current Role
              </h3>
              <div class="role-badge">
                {{ currentRole }}
              </div>
            </div>

            <!-- User's Permissions -->
            <div class="info-section" *ngIf="showUserPermissions">
              <h3 class="section-title">
                <i class="pi pi-list"></i>
                Your Current Permissions
              </h3>
              <div class="permissions-list">
                <div
                  *ngFor="let permission of getUserPermissions()"
                  class="permission-item">
                  <i class="pi pi-check-circle"></i>
                  <code>{{ permission }}</code>
                </div>
                <div
                  *ngIf="getUserPermissions().length === 0"
                  class="no-permissions">
                  <i class="pi pi-info-circle"></i>
                  <span>No permissions assigned</span>
                </div>
              </div>
            </div>

            <!-- Next Steps -->
            <div class="info-section next-steps">
              <h3 class="section-title">
                <i class="pi pi-compass"></i>
                What can I do?
              </h3>
              <ul class="steps-list">
                <li>
                  <i class="pi pi-envelope"></i>
                  Contact your administrator at
                  <a [href]="'mailto:' + supportEmail">{{ supportEmail }}</a>
                  to request access
                </li>
                <li>
                  <i class="pi pi-book"></i>
                  Review the
                  <a href="/docs/permissions" target="_blank">
                    permissions documentation
                  </a>
                  to understand access requirements
                </li>
                <li>
                  <i class="pi pi-arrow-left"></i>
                  Navigate back to a page you have access to
                </li>
              </ul>
            </div>
          </div>
        </p-card>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <button
            pButton
            label="Go Back"
            icon="pi pi-arrow-left"
            class="p-button-lg touch-target"
            (click)="goBack()"
            data-testid="go-back-button">
          </button>
          <button
            pButton
            label="Request Access"
            icon="pi pi-user-plus"
            class="p-button-lg p-button-success touch-target"
            (click)="requestAccess()"
            data-testid="request-access-button">
          </button>
          <button
            pButton
            label="Go to Dashboard"
            icon="pi pi-home"
            class="p-button-lg p-button-outlined touch-target"
            (click)="goToDashboard()">
          </button>
        </div>

        <!-- Additional Help -->
        <div class="additional-help">
          <p class="help-text">
            <i class="pi pi-question-circle"></i>
            Need immediate assistance? Call support at
            <strong>{{ supportPhone }}</strong>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .permission-denied-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 2rem;
    }

    .error-container {
      max-width: 800px;
      width: 100%;
    }

    .error-header {
      text-align: center;
      margin-bottom: 2rem;
      color: white;
    }

    .error-icon-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 120px;
      height: 120px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      margin-bottom: 1.5rem;
      backdrop-filter: blur(10px);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.9;
      }
    }

    .error-icon {
      font-size: 4rem;
      color: white;
    }

    .error-title {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .error-subtitle {
      font-size: 1.25rem;
      opacity: 0.9;
      margin: 0;
    }

    .error-details-card {
      margin-bottom: 2rem;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }

    .error-details {
      padding: 1rem;
    }

    .info-section {
      margin: 2rem 0;
      padding: 1.5rem;
      background: #f8f9fa;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .info-section.next-steps {
      border-left-color: #4caf50;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.125rem;
      font-weight: 600;
      color: #2c3e50;
      margin: 0 0 1rem;
    }

    .section-title i {
      color: #667eea;
    }

    .permission-code {
      background: #2c3e50;
      color: #00ff00;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
      font-family: 'Courier New', monospace;
    }

    .permission-code code {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .permission-breakdown {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
    }

    .breakdown-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .breakdown-item .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #6c757d;
      font-weight: 600;
    }

    .breakdown-item .value {
      font-size: 1rem;
      color: #2c3e50;
      font-weight: 600;
      background: white;
      padding: 0.5rem;
      border-radius: 4px;
    }

    .role-badge {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      font-size: 1.125rem;
      font-weight: 600;
    }

    .permissions-list {
      max-height: 300px;
      overflow-y: auto;
      background: white;
      padding: 1rem;
      border-radius: 4px;
    }

    .permission-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-bottom: 1px solid #e9ecef;
      font-family: 'Courier New', monospace;
    }

    .permission-item:last-child {
      border-bottom: none;
    }

    .permission-item i {
      color: #4caf50;
    }

    .no-permissions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #6c757d;
      font-style: italic;
      padding: 1rem;
    }

    .steps-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .steps-list li {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem;
      background: white;
      margin-bottom: 0.75rem;
      border-radius: 4px;
      line-height: 1.6;
    }

    .steps-list li:last-child {
      margin-bottom: 0;
    }

    .steps-list i {
      color: #667eea;
      font-size: 1.25rem;
      margin-top: 0.125rem;
      flex-shrink: 0;
    }

    .steps-list a {
      color: #667eea;
      font-weight: 600;
      text-decoration: none;
    }

    .steps-list a:hover {
      text-decoration: underline;
    }

    .action-buttons {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }

    /* Touch targets - T130: 56px minimum per plan.md */
    .touch-target {
      min-height: 56px;
      min-width: 56px;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
    }

    @media (max-width: 768px) {
      .touch-target {
        width: 100%;
        min-height: 64px; /* Larger on mobile for easier tapping */
        padding: 1rem 1.5rem;
        font-size: 1.125rem;
      }
    }

    .additional-help {
      text-align: center;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      backdrop-filter: blur(10px);
    }

    .help-text {
      color: white;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 1rem;
    }

    .help-text i {
      font-size: 1.25rem;
    }

    /* Responsive design */
    @media (max-width: 768px) {
      .permission-denied-page {
        padding: 1rem;
      }

      .error-title {
        font-size: 2rem;
      }

      .error-subtitle {
        font-size: 1rem;
      }

      .error-icon-wrapper {
        width: 80px;
        height: 80px;
      }

      .error-icon {
        font-size: 2.5rem;
      }

      .action-buttons {
        flex-direction: column;
      }

      .action-buttons button {
        width: 100%;
      }

      .permission-breakdown {
        grid-template-columns: 1fr;
      }
    }

    /* PrimeNG overrides */
    :host ::ng-deep .error-details-card .p-card-body {
      padding: 0;
    }

    :host ::ng-deep .p-message {
      margin-bottom: 1rem;
    }
  `]
})
export class PermissionDeniedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly permissionStore = inject(PermissionStore);

  // Error details from query params
  requiredPermission: string = '';
  currentRole: string = '';
  resourceName: string = '';
  showUserPermissions: boolean = true;

  // Support contact info
  supportEmail: string = 'support@wasteflow.it';
  supportPhone: string = '+39 02 1234 5678';

  ngOnInit(): void {
    // Read error details from route query params
    this.route.queryParams.subscribe((params) => {
      this.requiredPermission = params['permission'] || '';
      this.currentRole = params['role'] || 'Unknown';
      this.resourceName = params['resource'] || 'this resource';
      this.showUserPermissions = params['showPermissions'] !== 'false';
    });

    // Trigger haptic feedback on page load (mobile devices only)
    // T130: Haptic feedback for permission denied
    this.triggerHapticFeedback();
  }

  /**
   * Trigger haptic feedback on mobile devices
   * T130: Mobile-first UX with haptic feedback
   */
  private triggerHapticFeedback(): void {
    // Check if vibration API is supported
    if ('vibrate' in navigator) {
      // Pattern: short vibration for error (200ms)
      navigator.vibrate(200);
    }
  }

  /**
   * Get contextual error message
   */
  getErrorMessage(): string {
    if (this.requiredPermission) {
      return `To access ${this.resourceName}, you need the "${this.requiredPermission}" permission. Your current role "${this.currentRole}" does not include this permission.`;
    }
    return 'You do not have sufficient permissions to access this resource.';
  }

  /**
   * Extract resource from permission string
   */
  getResource(): string {
    const parts = this.requiredPermission.split(':');
    return parts[0] || 'unknown';
  }

  /**
   * Extract action from permission string
   */
  getAction(): string {
    const parts = this.requiredPermission.split(':');
    return parts[1] || 'unknown';
  }

  /**
   * Extract scope from permission string
   */
  getScope(): string {
    const parts = this.requiredPermission.split(':');
    return parts[2] || 'unknown';
  }

  /**
   * Get user's current permissions
   */
  getUserPermissions(): string[] {
    return this.permissionStore.permissions();
  }

  /**
   * Navigate back to previous page
   */
  goBack(): void {
    window.history.back();
  }

  /**
   * Navigate to dashboard
   */
  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  /**
   * Navigate to permission request form (T131: US7 integration point)
   * This connects to User Story 7: Self-service permission request workflow
   */
  requestAccess(): void {
    this.router.navigate(['/permissions/request'], {
      queryParams: {
        permission: this.requiredPermission,
        reason: 'Access denied - requesting permission',
        returnUrl: this.router.url,
      },
    });
  }

  /**
   * Open email to contact support
   */
  contactSupport(): void {
    const subject = encodeURIComponent('Access Request - Permission Denied');
    const body = encodeURIComponent(
      `Hello,\n\nI am requesting access to the following resource:\n\nRequired Permission: ${this.requiredPermission}\nCurrent Role: ${this.currentRole}\n\nPlease grant me access or provide guidance.\n\nThank you.`
    );
    window.location.href = `mailto:${this.supportEmail}?subject=${subject}&body=${body}`;
  }
}

/**
 * Usage in routing:
 *
 * {
 *   path: 'permission-denied',
 *   component: PermissionDeniedComponent,
 * }
 *
 * Redirect with error details:
 *
 * this.router.navigate(['/permission-denied'], {
 *   queryParams: {
 *     permission: 'fir:delete:facility',
 *     role: 'OPERATOR',
 *     resource: 'FIR document deletion',
 *   }
 * });
 *
 * Usage in PermissionGuard:
 *
 * if (!hasPermission) {
 *   this.router.navigate(['/permission-denied'], {
 *     queryParams: {
 *       permission: requiredPermission,
 *       role: user.primaryRole,
 *       resource: route.data['resource'] || 'this resource',
 *     }
 *   });
 *   return false;
 * }
 */
