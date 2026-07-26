import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterModule } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { CheckboxModule } from 'primeng/checkbox'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriUnitaLocaleService, RentriUnitaLocale } from './rentri-unita-locale.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/**
 * Pagina admin per gestire le unità locali RENTRI del tenant (R2 multi-sede).
 *
 * Chi ha una sola sede non deve scegliere nulla: la creazione della prima
 * sede la rende principale in automatico e l'interfaccia non mostra alcun
 * selettore "quale sede" finché non ne esiste una seconda. Il costo della
 * funzionalità (scegliere quale sede è quella di default) lo paga solo chi
 * ne ha bisogno.
 */
@Component({
  selector: 'app-rentri-unita-locale',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    CheckboxModule,
    TagModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page" style="max-width: 900px;">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Sedi RENTRI</h1>
          <p class="page-subtitle">Unità locali del tenant iscritte a RENTRI</p>
        </div>
        <a
          routerLink="/rentri/certificato"
          class="rentri-cross-link"
          data-testid="rentri-unita-locale-certificato-link"
          >Certificato RENTRI</a
        >
      </header>

      <!-- Non-admin -->
      <section *ngIf="!isAdmin()" class="surface-card" data-testid="rentri-unita-locale-non-admin">
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori del tenant possono gestire le sedi RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-unita-locale-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <div *ngIf="!loading()">
          <!-- Nessuna sede: stato vuoto + form della PRIMA sede (diventa principale da sola) -->
          <section
            *ngIf="sedi().length === 0"
            class="surface-card mb-4"
            data-testid="rentri-unita-locale-empty-state"
          >
            <div class="empty-state">
              <i class="pi pi-map-marker empty-state__icon" aria-hidden="true"></i>
              <span class="empty-state__title">Nessuna sede configurata</span>
              <p>
                Aggiungi la prima unità locale RENTRI del tenant: diventa la sede principale in
                automatico, non c'è nulla da scegliere.
              </p>
            </div>
          </section>

          <!-- Elenco sedi (mostrato anche con una sola, ma senza selettore "principale") -->
          <section
            *ngIf="sedi().length > 0"
            class="surface-card mb-4"
            aria-label="Sedi RENTRI del tenant"
            data-testid="rentri-unita-locale-list"
          >
            <h2 class="rentri-section-title mb-3">
              {{ sedi().length === 1 ? 'Sede' : 'Sedi (' + sedi().length + ')' }}
            </h2>

            <div
              *ngFor="let sede of sedi()"
              class="rentri-sede-row"
              [attr.data-testid]="'rentri-unita-locale-row-' + sede.id"
            >
              <div class="rentri-sede-row__main">
                <span class="rentri-sede-row__nome">{{ sede.denominazione }}</span>
                <span class="rentri-sede-row__codice">{{ sede.numIscrSito }}</span>
              </div>
              <div class="rentri-sede-row__badges">
                <p-tag
                  *ngIf="sede.principale"
                  severity="info"
                  value="Principale"
                  data-testid="rentri-unita-locale-badge-principale"
                ></p-tag>
                <p-tag
                  [severity]="sede.attiva ? 'success' : 'danger'"
                  [value]="sede.attiva ? 'Attiva' : 'Cessata'"
                ></p-tag>
              </div>
              <div class="rentri-sede-row__actions">
                <!-- Il selettore "rendi principale" compare SOLO da due sedi in su:
                     con una sola sede non c'è nulla da scegliere. -->
                <p-button
                  *ngIf="sedi().length > 1 && !sede.principale"
                  label="Rendi principale"
                  icon="pi pi-star"
                  [text]="true"
                  size="small"
                  (onClick)="setPrincipale(sede)"
                  [attr.data-testid]="'rentri-unita-locale-set-principale-' + sede.id"
                ></p-button>
                <p-button
                  [label]="sede.attiva ? 'Segna cessata' : 'Riattiva'"
                  [icon]="sede.attiva ? 'pi pi-ban' : 'pi pi-refresh'"
                  [text]="true"
                  size="small"
                  (onClick)="toggleAttiva(sede)"
                  [attr.data-testid]="'rentri-unita-locale-toggle-attiva-' + sede.id"
                ></p-button>
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  size="small"
                  ariaLabel="Elimina sede"
                  (onClick)="confirmRemove(sede)"
                  [attr.data-testid]="'rentri-unita-locale-remove-' + sede.id"
                ></p-button>
              </div>
            </div>
          </section>

          <!-- Form di aggiunta sede -->
          <section class="surface-card" aria-label="Aggiungi sede RENTRI">
            <h2 class="rentri-section-title mb-2">Aggiungi sede</h2>

            <div class="field mb-3">
              <label for="ul-denominazione" class="block mb-2">Denominazione *</label>
              <input
                id="ul-denominazione"
                pInputText
                [(ngModel)]="denominazione"
                class="w-full"
                placeholder="es. Sede di Milano"
                data-testid="rentri-unita-locale-input-denominazione"
              />
            </div>

            <div class="field mb-3">
              <label for="ul-num-iscr-sito" class="block mb-2">Numero di iscrizione *</label>
              <input
                id="ul-num-iscr-sito"
                pInputText
                [(ngModel)]="numIscrSito"
                class="w-full"
                placeholder="es. OP1234ABC123456-RM1234"
                data-testid="rentri-unita-locale-input-num-iscr-sito"
                aria-describedby="ul-num-iscr-sito-hint"
              />
              <small id="ul-num-iscr-sito-hint" class="block mt-1 text-tertiary">
                Lo trovi sul certificato di iscrizione dell'unità locale.
              </small>
            </div>

            <!-- Checkbox "principale" mostrata solo se esiste già almeno una sede:
                 per la primissima non c'è nulla da scegliere, diventa principale da sola. -->
            <div class="field mb-4" *ngIf="sedi().length > 0">
              <p-checkbox
                [(ngModel)]="nuovaSedePrincipale"
                [binary]="true"
                inputId="ul-principale"
                data-testid="rentri-unita-locale-input-principale"
              ></p-checkbox>
              <label for="ul-principale" class="ml-2">Rendi questa la sede principale</label>
            </div>

            <p-button
              label="Aggiungi sede"
              icon="pi pi-plus"
              [loading]="saving()"
              [disabled]="!canSubmit()"
              (onClick)="create()"
              data-testid="rentri-unita-locale-submit-button"
            ></p-button>
          </section>
        </div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .rentri-cross-link {
        align-self: center;
        font-size: var(--font-size-sm);
      }
      .rentri-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .rentri-sede-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        padding: var(--spacing-base) 0;
        border-bottom: 1px solid var(--surface-border-strong);
      }
      .rentri-sede-row:last-child {
        border-bottom: none;
      }
      .rentri-sede-row__main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 200px;
        flex: 1;
      }
      .rentri-sede-row__nome {
        font-weight: var(--font-weight-semibold);
      }
      .rentri-sede-row__codice {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .rentri-sede-row__badges {
        display: flex;
        gap: var(--spacing-xs);
      }
      .rentri-sede-row__actions {
        display: flex;
        gap: var(--spacing-xs);
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
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
      .ml-2 {
        margin-left: var(--spacing-sm);
      }
      .field {
        margin-bottom: 0;
      }
    `,
  ],
})
export class RentriUnitaLocaleComponent implements OnInit {
  private readonly unitaLocaleService = inject(RentriUnitaLocaleService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly confirm = inject(ConfirmationService)

  readonly sedi = signal<RentriUnitaLocale[]>([])
  readonly loading = signal(false)
  readonly saving = signal(false)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  // Form aggiunta sede
  denominazione = ''
  numIscrSito = ''
  nuovaSedePrincipale = false

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadSedi()
    }
  }

  private loadSedi(): void {
    this.loading.set(true)
    this.unitaLocaleService.list().subscribe({
      next: sedi => {
        this.sedi.set(sedi)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.toast.error('Impossibile caricare le sedi RENTRI del tenant')
      },
    })
  }

  canSubmit(): boolean {
    return !!this.denominazione.trim() && !!this.numIscrSito.trim()
  }

  create(): void {
    if (!this.canSubmit()) return
    this.saving.set(true)

    const haAlmenoUnaSede = this.sedi().length > 0
    this.unitaLocaleService
      .create({
        denominazione: this.denominazione.trim(),
        numIscrSito: this.numIscrSito.trim(),
        // Ignorato dal backend per la primissima sede: forzata a true comunque.
        ...(haAlmenoUnaSede ? { principale: this.nuovaSedePrincipale } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false)
          this.toast.success('Sede RENTRI aggiunta')
          this.resetForm()
          this.loadSedi()
        },
        error: err => {
          this.saving.set(false)
          this.toast.error(err?.error?.message || 'Errore nel salvataggio della sede')
        },
      })
  }

  setPrincipale(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.setPrincipale(sede.id).subscribe({
      next: () => {
        this.toast.success(`"${sede.denominazione}" è ora la sede principale`)
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'impostare la sede principale")
      },
    })
  }

  toggleAttiva(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.update(sede.id, { attiva: !sede.attiva }).subscribe({
      next: () => {
        this.toast.success(sede.attiva ? 'Sede segnata come cessata' : 'Sede riattivata')
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'aggiornare la sede")
      },
    })
  }

  confirmRemove(sede: RentriUnitaLocale): void {
    this.confirm.confirm({
      message: `Eliminare la sede "${sede.denominazione}"? L'operazione non è reversibile.`,
      header: 'Conferma eliminazione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.remove(sede),
    })
  }

  private remove(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.remove(sede.id).subscribe({
      next: () => {
        this.toast.success('Sede eliminata')
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'eliminare la sede")
      },
    })
  }

  private resetForm(): void {
    this.denominazione = ''
    this.numIscrSito = ''
    this.nuovaSedePrincipale = false
  }
}
