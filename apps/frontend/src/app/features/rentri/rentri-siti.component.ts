import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterModule } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriCredentialService } from './rentri-credential.service'
import { RentriSitiService, RentriSito } from './rentri-siti.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/**
 * Sezione «Unità locali» dell'area RENTRI (R4 Task 7 Step 1): le unità
 * locali dell'operatore così come RENTRI le restituisce, mai digitate qui.
 *
 * Distinta da `RentriUnitaLocaleComponent` (`/rentri/sedi`, CRUD manuale R2):
 * questa pagina non crea/modifica nulla, solo legge dalla cache locale e —
 * su richiesta esplicita — forza la rilettura dall'ente (`SincronizzaSitiUseCase`,
 * `RentriSitiController`). Le due pagine mostrano la STESSA tabella, popolata
 * a mano o dall'ente: un'unità locale inserita manualmente e una letta
 * dall'ente convivono, l'allineamento non cancella mai quelle inserite a
 * mano che l'ente non restituisce.
 */
@Component({
  selector: 'app-rentri-siti',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, TagModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Unità locali</h1>
          <p class="page-subtitle">
            Le unità locali dell'operatore, così come le restituisce RENTRI
          </p>
        </div>
        <a routerLink="/rentri/sedi" class="rentri-cross-link" data-testid="rentri-siti-sedi-link"
          >Gestisci sedi manualmente</a
        >
      </header>

      <!-- Non-admin -->
      <section *ngIf="!isAdmin()" class="surface-card" data-testid="rentri-siti-non-admin">
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori del tenant possono leggere le unità locali RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-siti-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <ng-container *ngIf="!loading()">
          <!-- numIscrOperatore non configurato: dire cosa fare, non una tabella vuota silenziosa -->
          <section
            *ngIf="!numIscrOperatoreConfigurato()"
            class="surface-card"
            data-testid="rentri-siti-non-configurato"
          >
            <div class="empty-state">
              <i class="pi pi-exclamation-circle empty-state__icon" aria-hidden="true"></i>
              <span class="empty-state__title">Numero di iscrizione RENTRI non configurato</span>
              <p>
                Configura il numero di iscrizione RENTRI della tua azienda prima di leggere le unità
                locali dall'ente.
              </p>
              <a routerLink="/rentri/certificato" data-testid="rentri-siti-configura-link">
                Vai al certificato RENTRI
              </a>
            </div>
          </section>

          <section *ngIf="numIscrOperatoreConfigurato()" class="surface-card">
            <div class="rentri-siti-toolbar">
              <h2 class="rentri-section-title">
                {{
                  sedi().length === 0
                    ? 'Nessuna unità locale'
                    : 'Unità locali (' + sedi().length + ')'
                }}
              </h2>
              <p-button
                label="Aggiorna dall'ente"
                icon="pi pi-refresh"
                [text]="true"
                [loading]="aggiornando()"
                (onClick)="aggiornaDaEnte()"
                data-testid="rentri-siti-aggiorna-btn"
              ></p-button>
            </div>

            <div
              *ngIf="sedi().length === 0"
              class="empty-state"
              data-testid="rentri-siti-empty-state"
            >
              <i class="pi pi-map-marker empty-state__icon" aria-hidden="true"></i>
              <p>Nessuna unità locale letta finora. Usa "Aggiorna dall'ente" per leggerle ora.</p>
            </div>

            <table
              *ngIf="sedi().length > 0"
              class="rentri-siti-tabella"
              aria-label="Unità locali RENTRI del tenant"
              data-testid="rentri-siti-tabella"
            >
              <thead>
                <tr>
                  <th scope="col">Numero iscrizione</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Stato</th>
                  <th scope="col">Ultimo aggiornamento</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let sede of sedi()" [attr.data-testid]="'rentri-siti-row-' + sede.id">
                  <td class="cell-mono">{{ sede.numIscrSito }}</td>
                  <td>{{ sede.denominazione }}</td>
                  <td>
                    <p-tag
                      [severity]="sede.attiva ? 'success' : 'danger'"
                      [value]="sede.attiva ? 'Attiva' : 'Cessata'"
                    ></p-tag>
                  </td>
                  <td>{{ sede.updatedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </ng-container>
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
      .rentri-siti-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-base);
        gap: var(--spacing-sm);
      }
      .rentri-siti-tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .rentri-siti-tabella th,
      .rentri-siti-tabella td {
        text-align: left;
        padding: var(--spacing-sm) var(--spacing-xs);
        border-bottom: 1px solid var(--surface-border-strong);
      }
      .cell-mono {
        font-family: var(--font-family-mono);
      }
      .text-secondary {
        color: var(--text-secondary);
      }
    `,
  ],
})
export class RentriSitiComponent implements OnInit {
  private readonly sitiService = inject(RentriSitiService)
  private readonly credentialService = inject(RentriCredentialService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly sedi = signal<RentriSito[]>([])
  readonly loading = signal(false)
  readonly aggiornando = signal(false)
  readonly numIscrOperatoreConfigurato = signal(false)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.load()
    }
  }

  private load(): void {
    this.loading.set(true)
    this.credentialService.getStatus().subscribe({
      next: status => {
        const configurato = !!status.numIscrOperatore
        this.numIscrOperatoreConfigurato.set(configurato)
        if (!configurato) {
          this.loading.set(false)
          return
        }
        this.sitiService.list().subscribe({
          next: sedi => {
            this.sedi.set(sedi)
            this.loading.set(false)
          },
          error: () => {
            this.loading.set(false)
            this.toast.error('Impossibile caricare le unità locali RENTRI')
          },
        })
      },
      error: () => {
        this.loading.set(false)
        this.toast.error('Impossibile verificare la configurazione RENTRI del tenant')
      },
    })
  }

  aggiornaDaEnte(): void {
    this.aggiornando.set(true)
    this.sitiService.aggiorna().subscribe({
      next: sedi => {
        this.sedi.set(sedi)
        this.aggiornando.set(false)
        this.toast.success('Unità locali aggiornate dall’ente')
      },
      error: err => {
        this.aggiornando.set(false)
        this.toast.error(err?.error?.message || 'Errore nell’aggiornamento dall’ente')
      },
    })
  }
}
