import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterModule } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  RentriModalitaLegameService,
  RentriModalitaLegameStatus,
  RentriModalitaLegame,
} from './rentri-modalita-legame.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/** Modalità mostrate in ordine, con la descrizione della conseguenza per l'utente. */
interface ModalitaOption {
  value: RentriModalitaLegame
  label: string
  description: string
}

const OPTIONS: ModalitaOption[] = [
  {
    value: 'AUTOMATICA',
    label: 'Automatica',
    description: 'I formulari emessi vengono trasmessi a RENTRI senza ulteriori passaggi.',
  },
  {
    value: 'IBRIDA',
    label: 'Ibrida',
    description:
      "La trasmissione a RENTRI parte da sola, ma l'aggancio al formulario ufficiale va confermato da te prima di essere considerato completo.",
  },
  {
    value: 'MANUALE',
    label: 'Manuale',
    description:
      'Nessun invio parte da solo: decidi tu quando trasmettere a RENTRI e colleghi tu a mano il formulario ufficiale.',
  },
]

/** Modalità che richiedono un certificato RENTRI valido già configurato. */
const RICHIEDONO_CERTIFICATO: RentriModalitaLegame[] = ['AUTOMATICA', 'IBRIDA']

/**
 * Pagina admin per scegliere la modalità con cui il tenant lega i FIR ai
 * formulari RENTRI. Il cambio non è retroattivo: non tocca i formulari già
 * trasmessi/agganciati, vale solo per quelli futuri. Automatica e Ibrida
 * sono mostrate ma non selezionabili finché il tenant non ha un certificato
 * RENTRI configurato (vedi pagina Certificato RENTRI).
 */
@Component({
  selector: 'app-rentri-modalita-legame',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule],
  template: `
    <div class="page" style="max-width: 820px;">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Modalità di legame RENTRI</h1>
          <p class="page-subtitle">
            Come i formulari emessi vengono legati e trasmessi ai formulari RENTRI
          </p>
        </div>
        <a
          routerLink="/rentri/sedi"
          class="rentri-cross-link"
          data-testid="rentri-modalita-legame-sedi-link"
          >Sedi RENTRI</a
        >
      </header>

      <!-- Non-admin -->
      <section
        *ngIf="!isAdmin()"
        class="surface-card"
        data-testid="rentri-modalita-legame-non-admin"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori del tenant possono scegliere la modalità di legame RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <section class="surface-card" aria-label="Modalità di legame RENTRI">
          <div
            *ngIf="loading()"
            class="flex align-items-center gap-2 text-secondary"
            data-testid="rentri-modalita-legame-loading"
          >
            <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
            <span>Caricamento…</span>
          </div>

          <div
            *ngIf="!loading() && loadError()"
            class="empty-state"
            data-testid="rentri-modalita-legame-error"
          >
            <i
              class="pi pi-exclamation-triangle empty-state__icon"
              aria-hidden="true"
              style="color: var(--color-danger)"
            ></i>
            <span class="empty-state__title">Impossibile caricare la modalità di legame</span>
            <p>{{ loadError() }}</p>
            <p-button
              label="Riprova"
              icon="pi pi-refresh"
              [outlined]="true"
              (onClick)="loadStatus()"
              data-testid="rentri-modalita-legame-retry-button"
            ></p-button>
          </div>

          <div *ngIf="!loading() && !loadError()">
            <p
              *ngIf="!certificatoConfigurato()"
              class="rentri-cert-warning"
              data-testid="rentri-modalita-legame-cert-warning"
            >
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              Nessun certificato RENTRI configurato: puoi scegliere solo "Manuale" finché non ne
              carichi uno.
              <a routerLink="/rentri/certificato" data-testid="rentri-modalita-legame-cert-link"
                >Vai alla pagina del certificato</a
              >
            </p>

            <div
              class="rentri-mode-options"
              role="radiogroup"
              aria-label="Modalità di legame RENTRI"
            >
              <label
                *ngFor="let opt of options"
                class="rentri-mode-option"
                [class.rentri-mode-option--disabled]="isDisabled(opt.value)"
                [attr.data-testid]="'rentri-modalita-legame-option-' + opt.value"
              >
                <input
                  type="radio"
                  name="modalita"
                  [value]="opt.value"
                  [checked]="selected() === opt.value"
                  [disabled]="isDisabled(opt.value)"
                  (change)="onSelect(opt.value)"
                  [attr.data-testid]="'rentri-modalita-legame-radio-' + opt.value"
                />
                <span class="rentri-mode-option__body">
                  <span class="rentri-mode-option__title">{{ opt.label }}</span>
                  <span class="rentri-mode-option__desc">{{ opt.description }}</span>
                  <span *ngIf="isDisabled(opt.value)" class="rentri-mode-option__reason">
                    Richiede un certificato RENTRI configurato per il tenant.
                  </span>
                </span>
              </label>
            </div>

            <p-button
              label="Salva"
              icon="pi pi-save"
              [loading]="saving()"
              [disabled]="!canSave()"
              (onClick)="save()"
              styleClass="mt-3"
              ariaLabel="Salva la modalità di legame RENTRI"
              data-testid="rentri-modalita-legame-save-button"
            ></p-button>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .rentri-cross-link {
        align-self: center;
        font-size: var(--font-size-sm);
      }
      .rentri-cert-warning {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
        font-size: var(--font-size-sm);
        color: var(--color-warning-text, var(--text-primary));
        background: var(--color-warning-bg, var(--surface-section));
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin: 0 0 var(--spacing-base) 0;
      }
      .rentri-mode-options {
        display: grid;
        gap: var(--spacing-sm);
      }
      .rentri-mode-option {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-base);
        border: 1px solid var(--surface-border-strong);
        border-radius: var(--radius-md);
        cursor: pointer;
      }
      .rentri-mode-option input[type='radio'] {
        margin-top: 3px;
      }
      .rentri-mode-option__body {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .rentri-mode-option__title {
        font-weight: var(--font-weight-semibold);
      }
      .rentri-mode-option__desc {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .rentri-mode-option__reason {
        color: var(--text-tertiary);
        font-size: var(--font-size-xs);
        font-style: italic;
      }
      .rentri-mode-option--disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
      .mt-3 {
        margin-top: var(--spacing-base);
      }
    `,
  ],
})
export class RentriModalitaLegameComponent implements OnInit {
  private readonly modalitaLegameService = inject(RentriModalitaLegameService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly options = OPTIONS

  readonly status = signal<RentriModalitaLegameStatus | null>(null)
  readonly selected = signal<RentriModalitaLegame | null>(null)
  readonly loading = signal(false)
  readonly saving = signal(false)
  readonly loadError = signal<string | null>(null)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  readonly certificatoConfigurato = computed(() => this.status()?.certificatoConfigurato ?? false)

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadStatus()
    }
  }

  loadStatus(): void {
    this.loading.set(true)
    this.loadError.set(null)
    this.modalitaLegameService.getStatus().subscribe({
      next: s => {
        this.status.set(s)
        this.selected.set(s.modalitaLegame)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.loadError.set('Impossibile caricare la modalità di legame RENTRI del tenant.')
      },
    })
  }

  isDisabled(value: RentriModalitaLegame): boolean {
    return RICHIEDONO_CERTIFICATO.includes(value) && !this.certificatoConfigurato()
  }

  onSelect(value: RentriModalitaLegame): void {
    if (this.isDisabled(value)) return
    this.selected.set(value)
  }

  canSave(): boolean {
    const value = this.selected()
    if (!value) return false
    if (this.isDisabled(value)) return false
    return value !== this.status()?.modalitaLegame
  }

  save(): void {
    const value = this.selected()
    if (!value || !this.canSave()) return

    this.saving.set(true)
    this.modalitaLegameService.setModalita(value).subscribe({
      next: s => {
        this.saving.set(false)
        this.status.set(s)
        this.selected.set(s.modalitaLegame)
        this.toast.success('Modalità di legame RENTRI aggiornata')
      },
      error: err => {
        this.saving.set(false)
        this.toast.error(err?.error?.message || 'Errore nel salvataggio della modalità')
      },
    })
  }
}
