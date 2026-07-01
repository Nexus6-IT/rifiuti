/**
 * BillingPageComponent — Pagina abbonamento SaaS (/abbonamento)
 *
 * Mostra:
 *  - Piano attivo (TRIAL / PROFESSIONAL / ENTERPRISE) con badge di stato
 *  - Avviso se l'abbonamento è SUSPENDED o EXPIRED
 *  - Confronto dei tre piani con prezzi e feature principali
 *  - Bottoni upgrade (→ Stripe Checkout) e gestione (→ Stripe Billing Portal)
 *  - Modalità informativa quando Stripe non è ancora configurato (testMode)
 *
 * Design: sistema B "Operativo Compatto" (slate + teal), WCAG 2.1 AA.
 * Lingua: italiano (tutti i testi, messaggi, etichette).
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core'
import { CommonModule, DatePipe } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { MessageModule } from 'primeng/message'
import {
  BillingApiService,
  BillingStatus,
  SubscriptionTier,
} from '../../core/services/billing-api.service'

interface PianoInfo {
  tier: SubscriptionTier
  nome: string
  prezzo: string
  periodicita: string
  firMese: string
  utenti: string
  feature: string[]
  evidenziato: boolean
}

const PIANI: PianoInfo[] = [
  {
    tier: 'TRIAL',
    nome: 'Trial',
    prezzo: '€0',
    periodicita: '30 giorni',
    firMese: '10 FIR/mese',
    utenti: '2 utenti',
    feature: ['Creazione e firma FIR', 'Catalogo CER', 'Dashboard operativa', 'Supporto via email'],
    evidenziato: false,
  },
  {
    tier: 'PROFESSIONAL',
    nome: 'Professional',
    prezzo: '€79',
    periodicita: 'mese',
    firMese: '200 FIR/mese',
    utenti: '5 utenti',
    feature: [
      'Tutto del Trial',
      'Registro C/S (art. 190)',
      'Anagrafiche produttori/trasportatori',
      'Export MUD',
      'Giacenze magazzino',
      'Contratti',
      'ESG / CO2',
      'Rilevamento anomalie',
      'Integrazione RENTRI (beta)',
    ],
    evidenziato: true,
  },
  {
    tier: 'ENTERPRISE',
    nome: 'Enterprise',
    prezzo: '€199',
    periodicita: 'mese',
    firMese: 'FIR illimitati',
    utenti: 'Utenti illimitati',
    feature: [
      'Tutto del Professional',
      'FIR e utenti illimitati',
      'Integrazione RENTRI completa',
      'Dati di riferimento ISTAT/ATECO',
      'SLA prioritario',
      'Onboarding dedicato',
    ],
    evidenziato: false,
  },
]

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, ProgressSpinnerModule, MessageModule, DatePipe],
  template: `
    <div class="page">
      <!-- Intestazione -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Abbonamento</h1>
          <p class="page-subtitle">Gestisci il piano WasteFlow del tuo tenant</p>
        </div>
      </header>

      <!-- Caricamento -->
      @if (loading()) {
        <div
          class="center-spinner"
          role="status"
          aria-live="polite"
          aria-label="Caricamento stato abbonamento"
        >
          <p-progressSpinner styleClass="spinner-md" />
        </div>
      }

      <!-- Errore -->
      @if (errorMsg()) {
        <p-message severity="error" [text]="errorMsg()!" styleClass="mb-4 w-full" />
      }

      @if (!loading() && billingStatus()) {
        <!-- ===== Avviso: abbonamento SOSPESO ===== -->
        @if (billingStatus()!.status === 'SUSPENDED') {
          <div class="alert alert--danger mb-4" role="alert">
            <i class="pi pi-ban alert__icon" aria-hidden="true"></i>
            <div class="alert__body">
              <strong class="alert__title">Account sospeso</strong>
              <p class="alert__text">
                Il pagamento dell'abbonamento non è andato a buon fine. Le operazioni di scrittura
                (creazione FIR, anagrafiche, movimenti) sono temporaneamente bloccate. Aggiorna il
                metodo di pagamento per ripristinare l'accesso.
              </p>
              @if (billingStatus()!.stripeSubscriptionId) {
                <button
                  pButton
                  type="button"
                  label="Gestisci pagamento"
                  icon="pi pi-credit-card"
                  class="p-button-danger p-button-sm mt-3"
                  [loading]="portalLoading()"
                  (click)="apriPortale()"
                ></button>
              }
            </div>
          </div>
        }

        <!-- ===== Avviso: abbonamento SCADUTO ===== -->
        @if (billingStatus()!.status === 'EXPIRED') {
          <div class="alert alert--warning mb-4" role="alert">
            <i class="pi pi-clock alert__icon" aria-hidden="true"></i>
            <div class="alert__body">
              <strong class="alert__title">Abbonamento scaduto</strong>
              <p class="alert__text">
                Il tuo abbonamento è scaduto. Rinnova il piano per continuare a usare tutte le
                funzionalità operative di WasteFlow.
              </p>
            </div>
          </div>
        }

        <!-- ===== Avviso modalità test (Stripe non configurato) ===== -->
        @if (testMode()) {
          <div class="alert alert--info mb-4" role="note">
            <i class="pi pi-info-circle alert__icon" aria-hidden="true"></i>
            <div class="alert__body">
              <strong class="alert__title">Modalità di configurazione</strong>
              <p class="alert__text">
                Il sistema di pagamento Stripe non è ancora attivo su questo ambiente. I pulsanti di
                acquisto sono visibili ma non reindirizzano a Stripe. Configura
                <code>STRIPE_SECRET_KEY</code> nel file <code>.env</code> del backend per attivare i
                pagamenti.
              </p>
            </div>
          </div>
        }

        <!-- ===== Scheda piano corrente ===== -->
        <section class="current-plan-card mb-5" aria-label="Piano corrente">
          <div class="current-plan-card__header">
            <div>
              <h2 class="current-plan-card__title">Piano attivo</h2>
              <p class="current-plan-card__tier">{{ tierLabel() }}</p>
            </div>
            <span
              class="status-badge"
              [class.status-badge--active]="
                billingStatus()!.status === 'ACTIVE' || billingStatus()!.status === 'TRIAL'
              "
              [class.status-badge--warning]="billingStatus()!.status === 'SUSPENDED'"
              [class.status-badge--danger]="billingStatus()!.status === 'EXPIRED'"
              [attr.aria-label]="'Stato abbonamento: ' + statusLabel()"
            >
              {{ statusLabel() }}
            </span>
          </div>

          <dl class="current-plan-card__stats">
            <div class="stat-item">
              <dt class="stat-item__label">FIR / mese</dt>
              <dd class="stat-item__value">
                {{
                  billingStatus()!.firLimitPerMonth === 0
                    ? 'Illimitati'
                    : billingStatus()!.firLimitPerMonth
                }}
              </dd>
            </div>
            <div class="stat-item">
              <dt class="stat-item__label">Utenti totali</dt>
              <dd class="stat-item__value">
                {{
                  billingStatus()!.userLimitTotal === 0
                    ? 'Illimitati'
                    : billingStatus()!.userLimitTotal
                }}
              </dd>
            </div>
            @if (billingStatus()!.subscriptionEnd) {
              <div class="stat-item">
                <dt class="stat-item__label">Scadenza</dt>
                <dd class="stat-item__value">
                  {{ billingStatus()!.subscriptionEnd | date: 'dd/MM/yyyy' }}
                </dd>
              </div>
            }
          </dl>

          <!-- Bottone portale Billing (se ha già un abbonamento Stripe) -->
          @if (billingStatus()!.stripeSubscriptionId) {
            <div class="current-plan-card__actions">
              <button
                pButton
                type="button"
                label="Gestisci abbonamento"
                icon="pi pi-external-link"
                class="p-button-outlined p-button-sm"
                [loading]="portalLoading()"
                (click)="apriPortale()"
                aria-label="Apri il Billing Portal Stripe per gestire il tuo abbonamento"
              ></button>
            </div>
          }
        </section>

        <!-- ===== Confronto piani ===== -->
        <section aria-label="Piani disponibili">
          <h2 class="section-title mb-4">Scegli il piano</h2>
          <div class="piani-grid">
            @for (piano of piani; track piano.tier) {
              <article
                class="piano-card"
                [class.piano-card--evidenziato]="piano.evidenziato"
                [class.piano-card--corrente]="billingStatus()!.tier === piano.tier"
                [attr.aria-label]="'Piano ' + piano.nome"
              >
                @if (piano.evidenziato) {
                  <div class="piano-card__ribbon" aria-label="Più popolare">Più popolare</div>
                }
                @if (billingStatus()!.tier === piano.tier) {
                  <div class="piano-card__current-badge" aria-label="Piano attivo">
                    Piano attivo
                  </div>
                }

                <div class="piano-card__header">
                  <h3 class="piano-card__nome">{{ piano.nome }}</h3>
                  <div class="piano-card__prezzo">
                    <span class="piano-card__importo">{{ piano.prezzo }}</span>
                    @if (piano.periodicita !== '30 giorni') {
                      <span class="piano-card__periodicita">/ {{ piano.periodicita }}</span>
                    } @else {
                      <span class="piano-card__periodicita">{{ piano.periodicita }}</span>
                    }
                  </div>
                </div>

                <ul class="piano-card__limiti" aria-label="Limiti del piano">
                  <li class="limit-item">
                    <i class="pi pi-file limit-item__icon" aria-hidden="true"></i>
                    <span>{{ piano.firMese }}</span>
                  </li>
                  <li class="limit-item">
                    <i class="pi pi-users limit-item__icon" aria-hidden="true"></i>
                    <span>{{ piano.utenti }}</span>
                  </li>
                </ul>

                <ul class="piano-card__feature-list" aria-label="Funzionalità incluse">
                  @for (f of piano.feature; track f) {
                    <li class="feature-item">
                      <i class="pi pi-check feature-item__icon" aria-hidden="true"></i>
                      <span>{{ f }}</span>
                    </li>
                  }
                </ul>

                <!-- Bottone azione -->
                <div class="piano-card__footer">
                  @if (billingStatus()!.tier === piano.tier) {
                    <button
                      pButton
                      type="button"
                      label="Piano attivo"
                      icon="pi pi-check"
                      class="p-button-outlined p-button-secondary w-full"
                      disabled
                      aria-disabled="true"
                    ></button>
                  } @else if (piano.tier === 'TRIAL') {
                    <!-- Non si torna al trial manualmente -->
                    <button
                      pButton
                      type="button"
                      label="Non disponibile"
                      class="p-button-text p-button-secondary w-full"
                      disabled
                      aria-disabled="true"
                      pTooltip="Il piano Trial è disponibile solo all'iscrizione"
                      tooltipPosition="top"
                    ></button>
                  } @else {
                    <button
                      pButton
                      type="button"
                      [label]="piano.evidenziato ? 'Passa a ' + piano.nome : 'Scegli ' + piano.nome"
                      icon="pi pi-arrow-up-right"
                      [class]="
                        piano.evidenziato ? 'p-button-primary w-full' : 'p-button-outlined w-full'
                      "
                      [loading]="checkoutLoading() === piano.tier"
                      [disabled]="billingStatus()!.status === 'SUSPENDED'"
                      (click)="avviaCheckout(piano.tier)"
                      [attr.aria-label]="
                        'Esegui upgrade al piano ' +
                        piano.nome +
                        ' a ' +
                        piano.prezzo +
                        ' / ' +
                        piano.periodicita
                      "
                    ></button>
                  }
                </div>
              </article>
            }
          </div>
        </section>

        <!-- ===== Nota legale ===== -->
        <footer class="billing-footer mt-5">
          <p class="billing-footer__text">
            I prezzi sono IVA esclusa. I pagamenti sono gestiti da
            <a
              href="https://stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              class="billing-footer__link"
              >Stripe</a
            >
            in modo sicuro. Puoi disdire in qualsiasi momento dal Billing Portal. Per assistenza
            scrivi a
            <a href="mailto:supporto&#64;wasteflow.it" class="billing-footer__link"
              >supporto&#64;wasteflow.it</a
            >.
          </p>
        </footer>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .page {
        padding: 0;
      }

      /* ── Intestazione pagina ────────────────────────────────────── */
      .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .page-title {
        font-family: var(--font-display);
        font-size: var(--font-size-2xl, 1.5rem);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 0.25rem;
      }
      .page-subtitle {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin: 0;
      }

      .center-spinner {
        display: flex;
        justify-content: center;
        padding: 3rem 0;
      }

      /* ── Avvisi ─────────────────────────────────────────────────── */
      .alert {
        display: flex;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-radius: var(--radius-md, 0.5rem);
        border-left: 4px solid transparent;
      }
      .alert--danger {
        background: var(--color-danger-bg);
        border-left-color: var(--color-danger);
        color: var(--color-danger);
      }
      .alert--warning {
        background: var(--color-warning-bg);
        border-left-color: var(--color-warning);
        color: var(--color-warning);
      }
      .alert--info {
        background: var(--color-info-bg);
        border-left-color: var(--color-info);
        color: var(--color-info);
      }
      .alert__icon {
        font-size: 1.25rem;
        flex-shrink: 0;
        margin-top: 0.1rem;
      }
      .alert__body {
        flex: 1;
        min-width: 0;
      }
      .alert__title {
        display: block;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        margin-bottom: 0.25rem;
        color: inherit;
      }
      .alert__text {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
      }

      /* ── Scheda piano corrente ──────────────────────────────────── */
      .current-plan-card {
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-lg, 0.75rem);
        padding: 1.5rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      }
      .current-plan-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }
      .current-plan-card__title {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--text-tertiary);
        margin: 0 0 0.25rem;
      }
      .current-plan-card__tier {
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0;
      }

      /* Badge stato abbonamento */
      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        border-radius: var(--radius-full, 9999px);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        line-height: 1;
      }
      .status-badge--active {
        background: var(--color-success-bg);
        color: var(--color-success);
      }
      .status-badge--warning {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }
      .status-badge--danger {
        background: var(--color-danger-bg);
        color: var(--color-danger);
      }

      /* Statistiche piano */
      .current-plan-card__stats {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5rem;
        margin: 0 0 1rem;
        padding: 0;
      }
      .stat-item {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .stat-item__label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .stat-item__value {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .current-plan-card__actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      /* ── Griglia piani ──────────────────────────────────────────── */
      .section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
      }

      .piani-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 1.25rem;
        align-items: start;
      }

      /* Carta piano */
      .piano-card {
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--surface-card);
        border: 1.5px solid var(--surface-border);
        border-radius: var(--radius-lg, 0.75rem);
        padding: 1.5rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        transition:
          border-color 0.15s,
          box-shadow 0.15s;
      }
      .piano-card:hover {
        border-color: var(--brand-primary-light);
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.1);
      }
      .piano-card--evidenziato {
        border-color: var(--brand-primary);
        box-shadow: 0 4px 16px rgba(13, 148, 136, 0.15);
      }
      .piano-card--corrente {
        border-color: var(--brand-primary-dark);
      }

      /* Ribbon "Più popolare" */
      .piano-card__ribbon {
        position: absolute;
        top: -1px;
        right: 1.5rem;
        /* teal-700 su bianco = 5.47:1 col testo bianco (era teal-600 = 3.74:1 = fail AA). */
        background: var(--brand-primary-dark);
        color: var(--text-inverse);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: 0 0 var(--radius-md, 0.5rem) var(--radius-md, 0.5rem);
      }
      /* Badge "Piano attivo" */
      .piano-card__current-badge {
        display: inline-flex;
        align-items: center;
        margin-bottom: 0.75rem;
        padding: 0.2rem 0.5rem;
        background: var(--color-success-bg);
        color: var(--color-success);
        border-radius: var(--radius-full, 9999px);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        width: fit-content;
      }

      .piano-card__header {
        margin-bottom: 1rem;
      }
      .piano-card__nome {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 0.5rem;
      }
      .piano-card__prezzo {
        display: flex;
        align-items: baseline;
        gap: 0.25rem;
      }
      .piano-card__importo {
        font-family: var(--font-display);
        font-size: 2rem;
        font-weight: var(--font-weight-bold);
        color: var(--brand-primary-dark);
        line-height: 1;
      }
      .piano-card__periodicita {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
      }

      /* Limiti */
      .piano-card__limiti {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        list-style: none;
        margin: 0 0 1rem;
        padding: 0.75rem;
        background: var(--surface-ground);
        border-radius: var(--radius-md, 0.5rem);
      }
      .limit-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }
      .limit-item__icon {
        color: var(--brand-primary);
        font-size: 0.875rem;
        flex-shrink: 0;
      }

      /* Feature list */
      .piano-card__feature-list {
        list-style: none;
        margin: 0 0 1.5rem;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }
      .feature-item {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.4;
      }
      .feature-item__icon {
        color: var(--color-success);
        font-size: 0.875rem;
        flex-shrink: 0;
        margin-top: 0.1rem;
      }

      .piano-card__footer {
        margin-top: auto;
      }

      /* ── Nota legale ─────────────────────────────────────────────── */
      .billing-footer {
        padding-top: 1.5rem;
        border-top: 1px solid var(--surface-border);
      }
      .billing-footer__text {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        margin: 0;
        line-height: 1.6;
      }
      .billing-footer__link {
        /* Link come testo: teal-700 = 5.47:1 su bianco (teal-600 = 3.74:1 = fail AA). */
        color: var(--brand-primary-dark);
        text-decoration: none;
      }
      .billing-footer__link:hover {
        text-decoration: underline;
      }

      /* ── Utility ─────────────────────────────────────────────────── */
      .mb-4 {
        margin-bottom: 1rem;
      }
      .mb-5 {
        margin-bottom: 1.25rem;
      }
      .mt-3 {
        margin-top: 0.75rem;
      }
      .mt-5 {
        margin-top: 1.25rem;
      }
      .w-full {
        width: 100%;
      }

      /* ── Responsive ─────────────────────────────────────────────── */
      @media (max-width: 767.98px) {
        .piani-grid {
          grid-template-columns: 1fr;
        }
        .current-plan-card__header {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class BillingPageComponent implements OnInit {
  private readonly billingApi = inject(BillingApiService)

  readonly loading = signal(true)
  readonly errorMsg = signal<string | null>(null)
  readonly billingStatus = signal<BillingStatus | null>(null)
  readonly testMode = signal(false)
  readonly checkoutLoading = signal<'PROFESSIONAL' | 'ENTERPRISE' | null>(null)
  readonly portalLoading = signal(false)

  readonly piani = PIANI

  readonly tierLabel = computed(() => {
    const t = this.billingStatus()?.tier
    if (!t) return ''
    const map: Record<string, string> = {
      TRIAL: 'Trial',
      PROFESSIONAL: 'Professional',
      ENTERPRISE: 'Enterprise',
    }
    return map[t] ?? t
  })

  readonly statusLabel = computed(() => {
    const s = this.billingStatus()?.status
    if (!s) return ''
    const map: Record<string, string> = {
      TRIAL: 'Periodo di prova',
      ACTIVE: 'Attivo',
      EXPIRED: 'Scaduto',
      SUSPENDED: 'Sospeso',
    }
    return map[s] ?? s
  })

  ngOnInit(): void {
    this.caricaStato()
  }

  private caricaStato(): void {
    this.loading.set(true)
    this.errorMsg.set(null)

    this.billingApi.getStatus().subscribe({
      next: status => {
        this.billingStatus.set(status)
        this.loading.set(false)
      },
      error: err => {
        this.errorMsg.set(
          "Impossibile caricare lo stato dell'abbonamento. Riprova tra qualche istante."
        )
        this.loading.set(false)
        console.error('[BillingPage] Errore caricamento stato:', err)
      },
    })
  }

  avviaCheckout(tier: 'PROFESSIONAL' | 'ENTERPRISE'): void {
    this.checkoutLoading.set(tier)

    this.billingApi.createCheckout(tier).subscribe({
      next: res => {
        this.checkoutLoading.set(null)
        if (res.testMode) {
          this.testMode.set(true)
          return
        }
        if (res.url) {
          window.location.href = res.url
        }
      },
      error: err => {
        this.checkoutLoading.set(null)
        this.errorMsg.set('Impossibile avviare il checkout. Riprova o contatta il supporto.')
        console.error('[BillingPage] Errore checkout:', err)
      },
    })
  }

  apriPortale(): void {
    this.portalLoading.set(true)

    this.billingApi.createPortal().subscribe({
      next: res => {
        this.portalLoading.set(false)
        if (res.testMode) {
          this.testMode.set(true)
          return
        }
        if (res.url) {
          window.location.href = res.url
        }
      },
      error: err => {
        this.portalLoading.set(false)
        this.errorMsg.set(
          'Impossibile aprire il portale di gestione. Riprova o contatta il supporto.'
        )
        console.error('[BillingPage] Errore portale:', err)
      },
    })
  }
}
