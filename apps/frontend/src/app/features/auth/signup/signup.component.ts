/**
 * SignupComponent — pagina di registrazione self-service (WS-G).
 *
 * Percorso: /signup (pubblico, non richiede autenticazione)
 * Design system "B": slate + teal (#0d9488), IBM Plex, griglia 8pt, WCAG 2.1 AA.
 *
 * Flusso:
 *  1. Utente compila form (ragione sociale, P.IVA, nome/cognome, email, CF, ToS/privacy)
 *  2. POST /api/v1/auth/signup
 *  3. Successo → schermata di conferma "controlla la tua email"
 *  4. Errore → toast PrimeNG con messaggio dal backend
 *
 * Dopo la verifica email (click link Keycloak), l'utente può fare login
 * tramite il pulsante "Accedi" sulla pagina /login.
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MessageService } from 'primeng/api';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DividerModule } from 'primeng/divider';
import { ToastModule } from 'primeng/toast';
import { SignupService, SignupPayload } from './signup.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    CardModule,
    InputTextModule,
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
            <p class="brand-hero__eyebrow">Registrazione azienda</p>
            <h2 class="brand-hero__title">Inizia con WasteFlow in pochi minuti.</h2>
            <p class="brand-hero__lede">
              Attiva il tuo account gratuito e accedi subito a formulari FIR,
              anagrafiche e conformità normativa in un'unica piattaforma.
            </p>
          </div>

          <ul class="brand-list">
            <li class="brand-list__item">
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              <span>Piano TRIAL gratuito, nessuna carta richiesta</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-shield" aria-hidden="true"></i>
              <span>Dati isolati e protetti per la tua azienda</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-file-edit" aria-hidden="true"></i>
              <span>FIR, CER e anagrafiche disponibili subito</span>
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
      <main class="auth__main" id="contenuto-signup">

        <!-- Schermata di successo -->
        <div *ngIf="registrationComplete" class="auth__panel auth__success" role="status" aria-live="polite">
          <div class="auth__logo-mobile">
            <span class="brand-mark__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <div class="success-icon" aria-hidden="true">
            <i class="pi pi-envelope"></i>
          </div>
          <h1 class="auth__title">Controlla la tua email</h1>
          <p class="auth__subtitle">
            Abbiamo inviato un link di verifica a <strong>{{ submittedEmail }}</strong>.
            Clicca il link per attivare il tuo account e accedere a WasteFlow.
          </p>
          <p class="auth__hint">
            Non ricevi l'email? Controlla la cartella spam o
            <a href="mailto:supporto@wasteflow.it" class="auth__help-link">contatta il supporto</a>.
          </p>
          <a routerLink="/login" class="p-button p-button-outlined goto-login">
            Vai alla pagina di accesso
          </a>
        </div>

        <!-- Form di registrazione -->
        <div *ngIf="!registrationComplete" class="auth__panel">
          <!-- Logo mobile -->
          <div class="auth__logo-mobile">
            <span class="brand-mark__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <header class="auth__head">
            <h1 class="auth__title">Registra la tua azienda</h1>
            <p class="auth__subtitle">
              Crea un account TRIAL gratuito per iniziare a usare WasteFlow.
            </p>
          </header>

          <form (ngSubmit)="onSubmit()" #signupForm="ngForm" novalidate>

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
                <label for="partitaIva" class="field__label">
                  Partita IVA <span class="field__req" aria-hidden="true">*</span>
                </label>
                <input
                  pInputText
                  id="partitaIva"
                  name="partitaIva"
                  [(ngModel)]="model.partitaIva"
                  required
                  pattern="[0-9]{11}"
                  maxlength="11"
                  inputmode="numeric"
                  autocomplete="off"
                  [class.p-invalid]="submitted && (!model.partitaIva || !isValidPartitaIva)"
                  aria-required="true"
                  placeholder="11 cifre senza spazi"
                  class="w-full"
                />
                <small *ngIf="submitted && !model.partitaIva" class="field__error" role="alert">
                  La partita IVA è obbligatoria.
                </small>
                <small *ngIf="submitted && model.partitaIva && !isValidPartitaIva" class="field__error" role="alert">
                  La partita IVA deve contenere esattamente 11 cifre.
                </small>
              </div>
            </section>

            <!-- ─── Sezione responsabile ──────────────────────────────────── -->
            <section aria-labelledby="sec-resp" class="form-section">
              <h2 id="sec-resp" class="form-section__title">Responsabile account</h2>

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
                <small *ngIf="submitted && model.email && !isValidEmail" class="field__error" role="alert">
                  Inserisci un indirizzo email valido.
                </small>
                <p class="field__hint">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  Riceverai qui il link di verifica per attivare l'account.
                </p>
              </div>

              <div class="field">
                <label for="fiscalCode" class="field__label">
                  Codice fiscale <span class="field__req" aria-hidden="true">*</span>
                </label>
                <input
                  pInputText
                  id="fiscalCode"
                  name="fiscalCode"
                  [(ngModel)]="model.fiscalCode"
                  required
                  maxlength="16"
                  autocomplete="off"
                  [class.p-invalid]="submitted && (!model.fiscalCode || !isValidFiscalCode)"
                  aria-required="true"
                  placeholder="RSSMRA80A01H501U"
                  class="w-full"
                  style="text-transform: uppercase"
                />
                <small *ngIf="submitted && !model.fiscalCode" class="field__error" role="alert">
                  Il codice fiscale è obbligatorio.
                </small>
                <small *ngIf="submitted && model.fiscalCode && !isValidFiscalCode" class="field__error" role="alert">
                  Il codice fiscale deve essere di 16 caratteri alfanumerici.
                </small>
                <p class="field__hint">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  Utilizzato come identificativo di accesso (codice fiscale personale).
                </p>
              </div>
            </section>

            <!-- ─── Sezione consensi ───────────────────────────────────────── -->
            <section aria-labelledby="sec-consensi" class="form-section form-section--condensed">
              <h2 id="sec-consensi" class="form-section__title">Consensi</h2>

              <div class="consent-item" [class.consent-item--error]="submitted && !model.tosAccepted">
                <p-checkbox
                  [(ngModel)]="model.tosAccepted"
                  name="tosAccepted"
                  [binary]="true"
                  inputId="tosAccepted"
                  ariaLabel="Accetto i Termini di Servizio"
                />
                <label for="tosAccepted" class="consent-item__label">
                  Ho letto e accetto i
                  <a href="/docs/legal/tos.pdf" target="_blank" rel="noopener" class="consent-item__link">
                    Termini di Servizio
                  </a>
                  <span class="field__req" aria-hidden="true"> *</span>
                </label>
              </div>
              <small *ngIf="submitted && !model.tosAccepted" class="field__error" role="alert">
                Devi accettare i Termini di Servizio per procedere.
              </small>

              <div class="consent-item" [class.consent-item--error]="submitted && !model.privacyAccepted">
                <p-checkbox
                  [(ngModel)]="model.privacyAccepted"
                  name="privacyAccepted"
                  [binary]="true"
                  inputId="privacyAccepted"
                  ariaLabel="Accetto la Privacy Policy"
                />
                <label for="privacyAccepted" class="consent-item__label">
                  Ho letto e accetto la
                  <a href="/docs/legal/privacy.pdf" target="_blank" rel="noopener" class="consent-item__link">
                    Privacy Policy
                  </a>
                  e il
                  <a href="/docs/legal/dpa.pdf" target="_blank" rel="noopener" class="consent-item__link">
                    DPA
                  </a>
                  <span class="field__req" aria-hidden="true"> *</span>
                </label>
              </div>
              <small *ngIf="submitted && !model.privacyAccepted" class="field__error" role="alert">
                Devi accettare la Privacy Policy per procedere.
              </small>
            </section>

            <!-- ─── Submit ──────────────────────────────────────────────────── -->
            <p-button
              type="submit"
              label="Registra la tua azienda"
              icon="pi pi-user-plus"
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
          <a href="/docs/legal/privacy.pdf" class="auth__footer-link" target="_blank" rel="noopener">Privacy</a>
          <span class="auth__footer-sep" aria-hidden="true">·</span>
          <a href="/docs/legal/tos.pdf" class="auth__footer-link" target="_blank" rel="noopener">Termini di servizio</a>
        </footer>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; }

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
        radial-gradient(120% 90% at 12% 8%, rgba(255,255,255,0.16) 0%, transparent 46%),
        radial-gradient(130% 120% at 92% 100%, rgba(0,0,0,0.22) 0%, transparent 55%),
        linear-gradient(150deg, var(--brand-primary) 0%, var(--brand-primary-dark) 62%, var(--brand-accent-dark) 100%);
    }
    .auth__brand::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle at 78% 22%, rgba(255,255,255,0.10) 0, transparent 42%);
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

    .brand-mark { display: flex; align-items: center; gap: 0.7rem; }
    .brand-mark__glyph {
      width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: var(--radius-md);
      backdrop-filter: blur(8px);
    }
    .brand-mark__glyph i { font-size: 1.35rem; color: #fff; }
    .brand-mark__name {
      font-family: var(--font-display);
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-xl);
      letter-spacing: -0.01em;
      color: #fff;
    }

    .brand-hero { margin-top: auto; }
    .brand-hero__eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: rgba(255,255,255,0.82);
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
      color: rgba(255,255,255,0.90);
      margin: 0;
      max-width: 46ch;
    }

    .brand-list { list-style: none; display: grid; gap: var(--spacing-md); }
    .brand-list__item {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      color: rgba(255,255,255,0.95);
    }
    .brand-list__item i {
      width: 34px; height: 34px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: var(--radius-base);
      font-size: 1rem; color: #fff;
    }
    .brand-foot {
      margin: 0;
      font-size: var(--font-size-sm);
      color: rgba(255,255,255,0.75);
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
    .auth__logo-mobile .brand-mark__glyph i { color: var(--brand-primary-dark); }
    .auth__logo-mobile .brand-mark__name { color: var(--text-primary); }

    .auth__head { margin-bottom: var(--spacing-xl); }
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
    .auth__help-link { font-weight: var(--font-weight-semibold); }
    .auth__footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
    }
    .auth__footer-sep { color: var(--surface-border-strong); }
    .auth__footer-link { color: var(--text-tertiary); font-weight: var(--font-weight-medium); }
    .auth__footer-link:hover { color: var(--brand-primary-dark); }

    /* ============ Form sections ============ */
    .form-section {
      margin-bottom: var(--spacing-xl);
    }
    .form-section--condensed { margin-bottom: var(--spacing-lg); }
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

    .field { display: flex; flex-direction: column; gap: var(--spacing-sm); margin-bottom: var(--spacing-base); }
    .field:last-child { margin-bottom: 0; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-base); }
    .field__label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--text-secondary);
    }
    .field__req { color: var(--color-danger); }
    .field__error {
      color: var(--color-danger);
      font-size: var(--font-size-xs);
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .field__hint {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      margin: 0;
      font-size: var(--font-size-xs);
      color: var(--text-tertiary);
      line-height: 1.45;
    }
    .field__hint i { margin-top: 1px; color: var(--color-info); }

    /* ============ Consensi ============ */
    .consent-item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) 0;
      border-radius: var(--radius-base);
    }
    .consent-item--error { border-color: var(--color-danger); }
    .consent-item__label {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      line-height: var(--line-height-relaxed);
      cursor: pointer;
    }
    .consent-item__link {
      color: var(--brand-primary);
      font-weight: var(--font-weight-semibold);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .consent-item__link:hover { color: var(--brand-primary-dark); }

    /* ============ Successo ============ */
    .auth__success {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: var(--spacing-2xl) var(--spacing-xl);
    }
    .success-icon {
      width: 72px; height: 72px;
      display: flex; align-items: center; justify-content: center;
      background: var(--brand-primary-50);
      border: 2px solid var(--brand-primary-100);
      border-radius: 50%;
      margin-bottom: var(--spacing-xl);
    }
    .success-icon i { font-size: 2rem; color: var(--brand-primary); }
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
      border: 1.5px solid var(--brand-primary);
      color: var(--brand-primary);
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
      .auth { grid-template-columns: 1fr; }
      .auth__brand { display: none; }
      .auth__logo-mobile { display: flex; }
      .auth__main { min-height: 100vh; justify-content: flex-start; }
    }

    @media (max-width: 640px) {
      .field-row { grid-template-columns: 1fr; }
      .auth__main { padding: var(--spacing-lg) var(--spacing-base); }
      .auth__title { font-size: var(--font-size-2xl); }
    }

    @media (prefers-reduced-motion: reduce) {
      .auth__panel { animation: none; }
    }
  `],
})
export class SignupComponent {
  model: SignupPayload = {
    ragioneSociale: '',
    partitaIva: '',
    firstName: '',
    lastName: '',
    email: '',
    fiscalCode: '',
    tosAccepted: false,
    privacyAccepted: false,
  };

  loading = false;
  submitted = false;
  registrationComplete = false;
  submittedEmail = '';
  readonly currentYear = new Date().getFullYear();

  constructor(
    private readonly signupService: SignupService,
    private readonly messageService: MessageService,
  ) {}

  // ── Validazioni client-side ──────────────────────────────────────────────

  get isValidPartitaIva(): boolean {
    return /^[0-9]{11}$/.test(this.model.partitaIva ?? '');
  }

  get isValidEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.model.email ?? '');
  }

  get isValidFiscalCode(): boolean {
    const cf = (this.model.fiscalCode ?? '').trim().toUpperCase();
    return cf.length === 16;
  }

  private get isFormValid(): boolean {
    return (
      !!this.model.ragioneSociale &&
      this.isValidPartitaIva &&
      !!this.model.firstName &&
      !!this.model.lastName &&
      this.isValidEmail &&
      this.isValidFiscalCode &&
      this.model.tosAccepted &&
      this.model.privacyAccepted
    );
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  onSubmit(): void {
    this.submitted = true;

    if (!this.isFormValid) {
      return;
    }

    this.loading = true;

    const payload: SignupPayload = {
      ...this.model,
      fiscalCode: this.model.fiscalCode.toUpperCase().trim(),
      email: this.model.email.toLowerCase().trim(),
    };

    this.signupService.register(payload).subscribe({
      next: (res) => {
        this.loading = false;
        this.registrationComplete = true;
        this.submittedEmail = payload.email;
      },
      error: (err) => {
        this.loading = false;
        const status: number = err.status ?? 0;
        const message: string =
          err.error?.message ??
          (status === 409
            ? 'Partita IVA, email o codice fiscale già registrati.'
            : 'Registrazione non completata. Riprova più tardi.');
        this.messageService.add({
          severity: 'error',
          summary: 'Errore nella registrazione',
          detail: message,
          life: 8000,
        });
      },
    });
  }
}
