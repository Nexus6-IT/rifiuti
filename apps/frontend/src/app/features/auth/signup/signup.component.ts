/**
 * AccessRequestComponent — pagina pubblica "Richiedi accesso" (lead capture).
 *
 * Percorso: /richiedi-accesso (alias storico /signup) — pubblico.
 * Design system "B": slate + teal (#0d9488), IBM Plex, griglia 8pt, WCAG 2.1 AA.
 *
 * NON crea alcun account: raccoglie i dati di contatto dell'azienda e li invia
 * al backend (POST /auth/access-request). Un consulente ricontatta l'azienda per
 * attivare eventualmente una prova guidata (TRIAL). Nessun piano gratuito è
 * ottenibile in self-service.
 */

import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterModule } from '@angular/router'
import { MessageService } from 'primeng/api'
import { CardModule } from 'primeng/card'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { DividerModule } from 'primeng/divider'
import { ToastModule } from 'primeng/toast'
import { AccessRequestService, AccessRequestPayload } from './signup.service'

@Component({
  selector: 'app-access-request',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    CardModule,
    InputTextModule,
    InputTextareaModule,
    ButtonModule,
    CheckboxModule,
    DividerModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast position="top-right" />

    <div class="auth">
      <!-- ===== Pannello brand (sinistra) ===== -->
      <aside class="auth__brand" aria-hidden="true">
        <div class="auth__brand-inner">
          <div class="brand-mark">
            <span class="brand-mark__glyph"><i class="pi pi-sync"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <div class="brand-hero">
            <p class="brand-hero__eyebrow">Prova guidata</p>
            <h2 class="brand-hero__title">Scopri WasteFlow con un consulente dedicato.</h2>
            <p class="brand-hero__lede">
              Raccontaci della tua azienda: un nostro consulente ti ricontatta per configurare una
              prova guidata su misura, con affiancamento in ogni fase.
            </p>
          </div>

          <ul class="brand-list">
            <li class="brand-list__item">
              <i class="pi pi-user" aria-hidden="true"></i>
              <span>Affiancamento di un consulente dedicato</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-file-edit" aria-hidden="true"></i>
              <span>Formulari FIR, registri e anagrafiche</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-shield" aria-hidden="true"></i>
              <span>Dati isolati e protetti per la tua azienda</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-sync" aria-hidden="true"></i>
              <span>Conformità RENTRI e D.Lgs 152/2006</span>
            </li>
          </ul>

          <p class="brand-foot">Piattaforma per la gestione digitale dei rifiuti</p>
        </div>
      </aside>

      <!-- ===== Pannello form (destra) ===== -->
      <main class="auth__main" id="contenuto-richiesta">
        <!-- Schermata di successo -->
        <div
          *ngIf="requestComplete"
          class="auth__panel auth__success"
          role="status"
          aria-live="polite"
        >
          <div class="auth__logo-mobile">
            <span class="brand-mark__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <div class="success-icon" aria-hidden="true">
            <i class="pi pi-check"></i>
          </div>
          <h1 class="auth__title">Richiesta ricevuta</h1>
          <p class="auth__subtitle">
            Grazie <strong>{{ submittedName }}</strong
            >. Un nostro consulente ti contatterà a breve all'indirizzo
            <strong>{{ submittedEmail }}</strong> per attivare la prova guidata.
          </p>
          <p class="auth__hint">
            Hai bisogno di assistenza immediata?
            <a href="mailto:supporto@wasteflow.it" class="auth__help-link">Contatta il supporto</a>.
          </p>
          <a routerLink="/login" class="p-button p-button-outlined goto-login">
            Torna alla pagina di accesso
          </a>
        </div>

        <!-- Form di richiesta accesso -->
        <div *ngIf="!requestComplete" class="auth__panel">
          <!-- Logo mobile -->
          <div class="auth__logo-mobile">
            <span class="brand-mark__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <header class="auth__head">
            <h1 class="auth__title">Richiedi accesso</h1>
            <p class="auth__subtitle">
              Compila il modulo: un nostro consulente ti contatterà per attivare la prova guidata.
              Nessun addebito e nessuna carta richiesta.
            </p>
          </header>

          <form (ngSubmit)="onSubmit()" #accessForm="ngForm" novalidate>
            <!-- ─── Sezione azienda ─────────────────────────────────────── -->
            <section aria-labelledby="sec-azienda" class="form-section">
              <h2 id="sec-azienda" class="form-section__title">Dati azienda</h2>

              <div class="field">
                <label for="ragioneSociale" class="field__label">
                  Ragione sociale <span class="field__req" aria-hidden="true">*</span>
                </label>
                <input
                  pInputText
                  id="ragioneSociale"
                  name="ragioneSociale"
                  [(ngModel)]="model.ragioneSociale"
                  required
                  maxlength="255"
                  autocomplete="organization"
                  [class.p-invalid]="submitted && !model.ragioneSociale"
                  aria-required="true"
                  placeholder="Es. Alfa Ambiente Srl"
                  class="w-full"
                />
                <small *ngIf="submitted && !model.ragioneSociale" class="field__error" role="alert">
                  La ragione sociale è obbligatoria.
                </small>
              </div>

              <div class="field">
                <label for="partitaIva" class="field__label">Partita IVA</label>
                <input
                  pInputText
                  id="partitaIva"
                  name="partitaIva"
                  [(ngModel)]="model.partitaIva"
                  pattern="[0-9]{11}"
                  maxlength="11"
                  inputmode="numeric"
                  autocomplete="off"
                  [class.p-invalid]="submitted && !!model.partitaIva && !isValidPartitaIva"
                  placeholder="11 cifre (facoltativo)"
                  class="w-full"
                />
                <small
                  *ngIf="submitted && !!model.partitaIva && !isValidPartitaIva"
                  class="field__error"
                  role="alert"
                >
                  La partita IVA deve contenere esattamente 11 cifre.
                </small>
              </div>
            </section>

            <!-- ─── Sezione contatto ──────────────────────────────────────── -->
            <section aria-labelledby="sec-contatto" class="form-section">
              <h2 id="sec-contatto" class="form-section__title">Referente</h2>

              <div class="field-row">
                <div class="field">
                  <label for="firstName" class="field__label">
                    Nome <span class="field__req" aria-hidden="true">*</span>
                  </label>
                  <input
                    pInputText
                    id="firstName"
                    name="firstName"
                    [(ngModel)]="model.firstName"
                    required
                    maxlength="100"
                    autocomplete="given-name"
                    [class.p-invalid]="submitted && !model.firstName"
                    aria-required="true"
                    placeholder="Mario"
                    class="w-full"
                  />
                  <small *ngIf="submitted && !model.firstName" class="field__error" role="alert">
                    Il nome è obbligatorio.
                  </small>
                </div>

                <div class="field">
                  <label for="lastName" class="field__label">
                    Cognome <span class="field__req" aria-hidden="true">*</span>
                  </label>
                  <input
                    pInputText
                    id="lastName"
                    name="lastName"
                    [(ngModel)]="model.lastName"
                    required
                    maxlength="100"
                    autocomplete="family-name"
                    [class.p-invalid]="submitted && !model.lastName"
                    aria-required="true"
                    placeholder="Rossi"
                    class="w-full"
                  />
                  <small *ngIf="submitted && !model.lastName" class="field__error" role="alert">
                    Il cognome è obbligatorio.
                  </small>
                </div>
              </div>

              <div class="field">
                <label for="email" class="field__label">
                  Email <span class="field__req" aria-hidden="true">*</span>
                </label>
                <input
                  pInputText
                  id="email"
                  name="email"
                  type="email"
                  [(ngModel)]="model.email"
                  required
                  maxlength="255"
                  autocomplete="email"
                  [class.p-invalid]="submitted && (!model.email || !isValidEmail)"
                  aria-required="true"
                  placeholder="mario.rossi@azienda.it"
                  class="w-full"
                />
                <small *ngIf="submitted && !model.email" class="field__error" role="alert">
                  L'email è obbligatoria.
                </small>
                <small
                  *ngIf="submitted && model.email && !isValidEmail"
                  class="field__error"
                  role="alert"
                >
                  Inserisci un indirizzo email valido.
                </small>
              </div>

              <div class="field">
                <label for="phone" class="field__label">Telefono</label>
                <input
                  pInputText
                  id="phone"
                  name="phone"
                  [(ngModel)]="model.phone"
                  maxlength="30"
                  autocomplete="tel"
                  inputmode="tel"
                  placeholder="Numero per il ricontatto (facoltativo)"
                  class="w-full"
                />
              </div>

              <div class="field">
                <label for="message" class="field__label">Messaggio</label>
                <textarea
                  pInputTextarea
                  id="message"
                  name="message"
                  [(ngModel)]="model.message"
                  rows="3"
                  maxlength="2000"
                  placeholder="Raccontaci le tue esigenze (facoltativo)"
                  class="w-full"
                ></textarea>
              </div>
            </section>

            <!-- ─── Sezione consensi ───────────────────────────────────────── -->
            <section aria-labelledby="sec-consensi" class="form-section form-section--condensed">
              <h2 id="sec-consensi" class="form-section__title">Consenso</h2>

              <div
                class="consent-item"
                [class.consent-item--error]="submitted && !model.privacyAccepted"
              >
                <p-checkbox
                  [(ngModel)]="model.privacyAccepted"
                  name="privacyAccepted"
                  [binary]="true"
                  inputId="privacyAccepted"
                  ariaLabel="Accetto l'informativa privacy"
                />
                <label for="privacyAccepted" class="consent-item__label">
                  Ho letto e accetto la
                  <a
                    routerLink="/legal/privacy"
                    target="_blank"
                    rel="noopener"
                    class="consent-item__link"
                  >
                    Privacy Policy
                  </a>
                  e acconsento a essere ricontattato
                  <span class="field__req" aria-hidden="true"> *</span>
                </label>
              </div>
              <small *ngIf="submitted && !model.privacyAccepted" class="field__error" role="alert">
                Devi accettare il trattamento dei dati per procedere.
              </small>
            </section>

            <!-- ─── Submit ──────────────────────────────────────────────────── -->
            <p-button
              type="submit"
              label="Invia richiesta"
              icon="pi pi-send"
              [loading]="loading"
              styleClass="w-full submit-button"
              [attr.aria-busy]="loading"
            />
          </form>

          <p class="auth__help">
            Hai già un account?
            <a routerLink="/login" class="auth__help-link">Accedi</a>
          </p>
        </div>

        <footer class="auth__footer">
          <span>&copy; {{ currentYear }} WasteFlow</span>
          <span class="auth__footer-sep" aria-hidden="true">·</span>
          <a routerLink="/legal/privacy" target="_blank" rel="noopener" class="auth__footer-link"
            >Privacy</a
          >
          <span class="auth__footer-sep" aria-hidden="true">·</span>
          <a routerLink="/legal/termini" target="_blank" rel="noopener" class="auth__footer-link"
            >Termini di servizio</a
          >
        </footer>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .auth {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 1.05fr 1fr;
        background: var(--surface-ground);
      }

      /* ============ Pannello brand ============ */
      .auth__brand {
        position: relative;
        overflow: hidden;
        color: var(--text-inverse);
        background:
          radial-gradient(120% 90% at 12% 8%, rgba(255, 255, 255, 0.16) 0%, transparent 46%),
          radial-gradient(130% 120% at 92% 100%, rgba(0, 0, 0, 0.22) 0%, transparent 55%),
          linear-gradient(
            150deg,
            var(--brand-primary) 0%,
            var(--brand-primary-dark) 62%,
            var(--brand-accent-dark) 100%
          );
      }
      .auth__brand::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image: radial-gradient(
          circle at 78% 22%,
          rgba(255, 255, 255, 0.1) 0,
          transparent 42%
        );
        pointer-events: none;
      }
      .auth__brand-inner {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2xl);
        padding: clamp(2rem, 4vw, 4rem);
        max-width: 560px;
        margin-left: auto;
      }

      .brand-mark {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }
      .brand-mark__glyph {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: var(--radius-md);
        backdrop-filter: blur(8px);
      }
      .brand-mark__glyph i {
        font-size: 1.35rem;
        color: #fff;
      }
      .brand-mark__name {
        font-family: var(--font-display);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-xl);
        letter-spacing: -0.01em;
        color: #fff;
      }

      .brand-hero {
        margin-top: auto;
      }
      .brand-hero__eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: rgba(255, 255, 255, 0.82);
        margin: 0 0 var(--spacing-sm);
      }
      .brand-hero__title {
        font-family: var(--font-display);
        font-size: clamp(1.75rem, 3vw, 2.5rem);
        line-height: 1.15;
        font-weight: var(--font-weight-bold);
        color: #fff;
        margin: 0 0 var(--spacing-base);
        letter-spacing: -0.02em;
      }
      .brand-hero__lede {
        font-size: var(--font-size-lg);
        line-height: var(--line-height-relaxed);
        color: rgba(255, 255, 255, 0.9);
        margin: 0;
        max-width: 46ch;
      }

      .brand-list {
        list-style: none;
        display: grid;
        gap: var(--spacing-md);
      }
      .brand-list__item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: rgba(255, 255, 255, 0.95);
      }
      .brand-list__item i {
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: var(--radius-base);
        font-size: 1rem;
        color: #fff;
      }
      .brand-foot {
        margin: 0;
        font-size: var(--font-size-sm);
        color: rgba(255, 255, 255, 0.75);
      }

      /* ============ Pannello form ============ */
      .auth__main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: var(--spacing-xl);
        padding: clamp(1.5rem, 4vw, 3rem);
        overflow-y: auto;
      }
      .auth__panel {
        width: 100%;
        max-width: 480px;
        animation: fadeInUp var(--transition-base);
      }

      .auth__logo-mobile {
        display: none;
        align-items: center;
        gap: 0.6rem;
        justify-content: center;
        margin-bottom: var(--spacing-xl);
      }
      .auth__logo-mobile .brand-mark__glyph {
        background: var(--brand-primary-50);
        border-color: var(--brand-primary-100);
      }
      .auth__logo-mobile .brand-mark__glyph i {
        color: var(--brand-primary-dark);
      }
      .auth__logo-mobile .brand-mark__name {
        color: var(--text-primary);
      }

      .auth__head {
        margin-bottom: var(--spacing-xl);
      }
      .auth__title {
        font-family: var(--font-display);
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.02em;
        margin: 0 0 var(--spacing-sm);
        color: var(--text-primary);
      }
      .auth__subtitle {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
      }
      .auth__hint {
        margin: var(--spacing-base) 0 var(--spacing-xl);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-relaxed);
      }
      .auth__help {
        margin: var(--spacing-xl) 0 0;
        text-align: center;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .auth__help-link {
        font-weight: var(--font-weight-semibold);
      }
      .auth__footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .auth__footer-sep {
        color: var(--surface-border-strong);
      }
      .auth__footer-link {
        color: var(--text-tertiary);
        font-weight: var(--font-weight-medium);
      }
      .auth__footer-link:hover {
        color: var(--brand-primary-dark);
      }

      /* ============ Form sections ============ */
      .form-section {
        margin-bottom: var(--spacing-xl);
      }
      .form-section--condensed {
        margin-bottom: var(--spacing-lg);
      }
      .form-section__title {
        font-family: var(--font-display);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-tertiary);
        margin: 0 0 var(--spacing-base);
        padding-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--surface-border);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .field:last-child {
        margin-bottom: 0;
      }
      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-base);
      }
      .field__label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
      }
      .field__req {
        color: var(--color-danger);
      }
      .field__error {
        color: var(--color-danger);
        font-size: var(--font-size-xs);
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }

      /* ============ Consensi ============ */
      .consent-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) 0;
        border-radius: var(--radius-base);
      }
      .consent-item--error {
        border-color: var(--color-danger);
      }
      .consent-item__label {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: var(--line-height-relaxed);
        cursor: pointer;
      }
      .consent-item__link {
        /* Link come testo: teal-700 = 5.47:1 su bianco (AA). */
        color: var(--brand-primary-dark);
        font-weight: var(--font-weight-semibold);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .consent-item__link:hover {
        color: var(--brand-primary-dark);
      }

      /* ============ Successo ============ */
      .auth__success {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: var(--spacing-2xl) var(--spacing-xl);
      }
      .success-icon {
        width: 72px;
        height: 72px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--brand-primary-50);
        border: 2px solid var(--brand-primary-100);
        border-radius: 50%;
        margin-bottom: var(--spacing-xl);
      }
      .success-icon i {
        font-size: 2rem;
        color: var(--brand-primary);
      }
      .goto-login {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: var(--spacing-xl);
        padding: 0.75rem 1.5rem;
        border-radius: var(--radius-base);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        text-decoration: none;
        border: 1.5px solid var(--brand-primary-dark);
        color: var(--brand-primary-dark);
        transition: all var(--transition-fast);
      }
      .goto-login:hover {
        background: var(--brand-primary-50);
        color: var(--brand-primary-dark);
      }

      /* ============ Submit ============ */
      :host ::ng-deep .submit-button .p-button {
        min-height: 50px;
        justify-content: center;
        font-size: var(--font-size-base) !important;
      }

      /* ============ Responsive ============ */
      @media (max-width: 960px) {
        .auth {
          grid-template-columns: 1fr;
        }
        .auth__brand {
          display: none;
        }
        .auth__logo-mobile {
          display: flex;
        }
        .auth__main {
          min-height: 100vh;
          justify-content: flex-start;
        }
      }

      @media (max-width: 640px) {
        .field-row {
          grid-template-columns: 1fr;
        }
        .auth__main {
          padding: var(--spacing-lg) var(--spacing-base);
        }
        .auth__title {
          font-size: var(--font-size-2xl);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .auth__panel {
          animation: none;
        }
      }
    `,
  ],
})
export class AccessRequestComponent {
  model: AccessRequestPayload = {
    ragioneSociale: '',
    partitaIva: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    message: '',
    privacyAccepted: false,
  }

  loading = false
  submitted = false
  requestComplete = false
  submittedEmail = ''
  submittedName = ''
  readonly currentYear = new Date().getFullYear()

  constructor(
    private readonly accessRequestService: AccessRequestService,
    private readonly messageService: MessageService
  ) {}

  // ── Validazioni client-side ──────────────────────────────────────────────

  get isValidPartitaIva(): boolean {
    return /^[0-9]{11}$/.test(this.model.partitaIva ?? '')
  }

  get isValidEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.model.email ?? '')
  }

  private get isFormValid(): boolean {
    return (
      !!this.model.ragioneSociale &&
      (!this.model.partitaIva || this.isValidPartitaIva) &&
      !!this.model.firstName &&
      !!this.model.lastName &&
      this.isValidEmail &&
      this.model.privacyAccepted
    )
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  onSubmit(): void {
    this.submitted = true

    if (!this.isFormValid) {
      return
    }

    this.loading = true

    const payload: AccessRequestPayload = {
      ragioneSociale: this.model.ragioneSociale.trim(),
      firstName: this.model.firstName.trim(),
      lastName: this.model.lastName.trim(),
      email: this.model.email.toLowerCase().trim(),
      privacyAccepted: this.model.privacyAccepted,
      ...(this.model.partitaIva?.trim() ? { partitaIva: this.model.partitaIva.trim() } : {}),
      ...(this.model.phone?.trim() ? { phone: this.model.phone.trim() } : {}),
      ...(this.model.message?.trim() ? { message: this.model.message.trim() } : {}),
    }

    this.accessRequestService.submit(payload).subscribe({
      next: _res => {
        this.loading = false
        this.requestComplete = true
        this.submittedEmail = payload.email
        this.submittedName = payload.firstName
      },
      error: err => {
        this.loading = false
        const message: string =
          err.error?.message ?? 'Invio della richiesta non riuscito. Riprova più tardi.'
        this.messageService.add({
          severity: 'error',
          summary: "Errore nell'invio",
          detail: message,
          life: 8000,
        })
      },
    })
  }
}
