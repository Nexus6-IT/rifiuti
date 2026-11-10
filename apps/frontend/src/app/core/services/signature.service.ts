import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Signature Service
 *
 * Handles FIR digital signature operations:
 * - Apply signature (Producer, Carrier, Receiver)
 * - Verify signatures (public endpoint)
 * - Get verification URL for QR codes
 *
 * Integrates with SPID authentication for signature authorization.
 */
@Injectable({
  providedIn: 'root',
})
export class SignatureService {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = `${environment.apiUrl}/fir`

  /**
   * Verify all signatures on FIR
   *
   * Public endpoint - no authentication required.
   * Returns cryptographic verification results.
   *
   * @param firId - FIR identifier
   * @returns Verification results
   */
  verifySignatures(firId: string): Observable<VerifySignaturesResponse> {
    return this.http.get<VerifySignaturesResponse>(`${this.apiUrl}/${firId}/verify`)
  }

  /**
   * Get public verification URL for QR code
   *
   * Returns URL that can be embedded in QR code for mobile verification.
   *
   * @param firId - FIR identifier
   * @returns Verification URL
   */
  getVerificationUrl(firId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.apiUrl}/${firId}/verify-url`)
  }

  /**
   * Check if user can sign FIR with specific role
   *
   * Validates:
   * - SPID level (must be 2+)
   * - Authentication recency (<15 minutes)
   * - User authorization for role
   *
   * @param role - Signature role to check
   * @param user - Current user
   * @returns Whether user can sign
   */
  canUserSign(
    role: 'PRODUCER' | 'CARRIER' | 'RECEIVER',
    user: any
  ): {
    canSign: boolean
    reason?: string
  } {
    // Check SPID level
    if (!user || user.spidLevel < 2) {
      return {
        canSign: false,
        reason: 'SPID Level 2 o superiore richiesto per firmare documenti digitalmente',
      }
    }

    // Check authentication recency
    const authenticatedAt = new Date(user.authenticatedAt)
    const ageMinutes = (Date.now() - authenticatedAt.getTime()) / 1000 / 60

    if (ageMinutes > 15) {
      return {
        canSign: false,
        reason: 'Autenticazione scaduta. Effettua nuovamente il login per firmare (max 15 minuti)',
      }
    }

    // Check role authorization
    // In production, check user's role assignments for tenant
    const canSignRole = this.checkRoleAuthorization(role, user)
    if (!canSignRole) {
      return {
        canSign: false,
        reason: `Non sei autorizzato a firmare come ${this.getRoleLabel(role)}`,
      }
    }

    return { canSign: true }
  }

  /**
   * Get signature status badge data
   *
   * Returns badge configuration for signature status display.
   *
   * @param signatureCount - Number of signatures
   * @param isCompleted - Whether all signatures present
   * @returns Badge configuration
   */
  getSignatureStatusBadge(
    signatureCount: number,
    isCompleted: boolean
  ): {
    label: string
    severity: 'success' | 'info' | 'warning' | 'danger'
    icon: string
  } {
    if (isCompleted) {
      return {
        label: 'Completato (3/3)',
        severity: 'success',
        icon: 'pi pi-check-circle',
      }
    }

    if (signatureCount === 2) {
      return {
        label: 'In transito (2/3)',
        severity: 'info',
        icon: 'pi pi-truck',
      }
    }

    if (signatureCount === 1) {
      return {
        label: 'Firmato produttore (1/3)',
        severity: 'info',
        icon: 'pi pi-pencil',
      }
    }

    return {
      label: 'Non firmato (0/3)',
      severity: 'warning',
      icon: 'pi pi-exclamation-circle',
    }
  }

  /**
   * Get Italian label for signature role
   */
  getRoleLabel(role: 'PRODUCER' | 'CARRIER' | 'RECEIVER'): string {
    const labels = {
      PRODUCER: 'Produttore',
      CARRIER: 'Trasportatore',
      RECEIVER: 'Destinatario',
    }
    return labels[role] || role
  }

  /**
   * Check role authorization (placeholder)
   *
   * In production, check user's role assignments in tenant context.
   */
  private checkRoleAuthorization(_role: 'PRODUCER' | 'CARRIER' | 'RECEIVER', _user: any): boolean {
    // Placeholder - in production, check user's assigned roles
    return true
  }
}

/**
 * Type Definitions
 */

export interface VerifySignaturesResponse {
  firId: string
  firNumber: string
  allValid: boolean
  isCompleted: boolean
  signatureCount: number
  signatures: SignatureVerification[]
  documentHash: string
  verifiedAt: Date
}

export interface SignatureVerification {
  role: 'PRODUCER' | 'CARRIER' | 'RECEIVER'
  signerFiscalCode: string
  signerName: string
  signedAt: Date
  signatureMethod: string
  certificateHash: string
  documentHash: string
  hasTimestamp: boolean
  isValid: boolean
  verifiedAt: Date
}
