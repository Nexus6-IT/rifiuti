/**
 * BillingApiService
 *
 * Client HTTP per le API /billing del backend WasteFlow.
 * Fornisce:
 *  - getStatus(): stato abbonamento corrente del tenant
 *  - createCheckout(): avvia il flusso Stripe Checkout per upgrade piano
 *  - createPortal(): accede al Stripe Billing Portal per gestione self-service
 *
 * In modalità no-op (STRIPE_SECRET_KEY non impostata lato backend), i metodi
 * checkout/portal restituiscono url=null con testMode=true e un messaggio
 * descrittivo — l'app non crasha e mostra un avviso informativo.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type SubscriptionTier = 'TRIAL' | 'PROFESSIONAL' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

export interface BillingStatus {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  subscriptionEnd: string | null;
  firLimitPerMonth: number;
  userLimitTotal: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface CheckoutResponse {
  url: string | null;
  testMode: boolean;
  message?: string;
}

export interface PortalResponse {
  url: string | null;
  testMode: boolean;
}

@Injectable({ providedIn: 'root' })
export class BillingApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/billing`;

  getStatus(): Observable<BillingStatus> {
    return this.http.get<BillingStatus>(`${this.apiUrl}/status`);
  }

  createCheckout(plan: 'PROFESSIONAL' | 'ENTERPRISE'): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.apiUrl}/checkout`, { plan });
  }

  createPortal(): Observable<PortalResponse> {
    return this.http.post<PortalResponse>(`${this.apiUrl}/portal`, {});
  }
}
