import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  RentriCodificheDiagnosticaService,
  DiagnosticaCodifiche,
} from './rentri-codifiche-diagnostica.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/**
 * Sezione «Codifiche» dell'area RENTRI (R4 Task 7 Step 2): SOLO diagnostica,
 * nessuna azione manuale sui singoli codici. Mostra quando è avvenuto
 * l'ultimo allineamento riuscito, quante codifiche ha aggiornato, e quali
 * CER l'ente ha smesso di confermare (un amministratore potrebbe doverli
 * rivedere su un FIR ancora in bozza).
 *
 * Il pulsante «Allinea ora» non è esposto a chiunque abbia accesso alla
 * pagina: `RentriCodificheController` accetta solo SUPER_ADMIN/ADMIN su
 * ENTRAMBI gli endpoint (diagnostica e allineamento), quindi l'intera
 * sezione — non solo il pulsante — è dietro lo stesso gate: un pulsante che
 * comparirebbe e poi darebbe 403 è un difetto, non una protezione.
 */
@Component({
  selector: 'app-rentri-codifiche-diagnostica',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Codifiche RENTRI</h1>
          <p class="page-subtitle">
            Diagnostica dell'ultimo allineamento delle codifiche dall'ente
          </p>
        </div>
      </header>

      <section *ngIf="!isAdmin()" class="surface-card" data-testid="rentri-codifiche-non-admin">
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>
            Solo gli amministratori del tenant possono vedere la diagnostica delle codifiche RENTRI.
          </p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-codifiche-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <section *ngIf="!loading()" class="surface-card" data-testid="rentri-codifiche-diagnostica">
          <div class="rentri-codifiche-toolbar">
            <h2 class="rentri-section-title">Ultimo allineamento</h2>
            <p-button
              label="Allinea ora"
              icon="pi pi-sync"
              [loading]="allineando()"
              (onClick)="allineaOra()"
              data-testid="rentri-codifiche-allinea-btn"
            ></p-button>
          </div>

          <p
            *ngIf="diagnostica()?.ultimoAllineamento as quando"
            data-testid="rentri-codifiche-ultimo-allineamento"
          >
            Ultimo allineamento riuscito in questo processo:
            <strong>{{ quando | date: 'dd/MM/yyyy HH:mm' }}</strong>
            — {{ diagnostica()?.codiciAggiornati }} codifiche aggiornate.
          </p>
          <p
            *ngIf="!diagnostica()?.ultimoAllineamento"
            data-testid="rentri-codifiche-mai-allineato"
          >
            Nessun allineamento risulta concluso da quando il servizio è stato riavviato l'ultima
            volta. Il cron mensile può comunque averne già eseguito uno prima del riavvio.
          </p>

          <h3 class="rentri-section-title mt-4">Codici non più presenti in RENTRI</h3>
          <p
            *ngIf="codiciNonPresenti().length === 0"
            data-testid="rentri-codifiche-nessun-non-presente"
          >
            Nessun codice CER risulta marcato come non più confermato dall'ente.
          </p>
          <table
            *ngIf="codiciNonPresenti().length > 0"
            class="rentri-codifiche-tabella"
            aria-label="Codici CER non più presenti in RENTRI"
            data-testid="rentri-codifiche-non-presenti-tabella"
          >
            <thead>
              <tr>
                <th scope="col">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col">Non più confermato dal</th>
              </tr>
            </thead>
            <tbody>
              <tr
                *ngFor="let c of codiciNonPresenti()"
                [attr.data-testid]="'rentri-codifiche-non-presente-' + c.code"
              >
                <td class="cell-mono">{{ c.code }}</td>
                <td>{{ c.description }}</td>
                <td>{{ c.rimossoDaRentriAl | date: 'dd/MM/yyyy' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="text-tertiary mt-2">
            Un codice storico resta valido e invariato sui FIR già emessi: non è più proponibile
            solo per un FIR nuovo. Un FIR in bozza che lo referenzia va rivisto manualmente.
          </p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .rentri-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .rentri-codifiche-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--spacing-base);
        gap: var(--spacing-sm);
      }
      .rentri-codifiche-tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .rentri-codifiche-tabella th,
      .rentri-codifiche-tabella td {
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
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .mt-2 {
        margin-top: var(--spacing-sm);
      }
      .mt-4 {
        margin-top: var(--spacing-xl);
      }
    `,
  ],
})
export class RentriCodificheDiagnosticaComponent implements OnInit {
  private readonly service = inject(RentriCodificheDiagnosticaService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly diagnostica = signal<DiagnosticaCodifiche | null>(null)
  readonly loading = signal(false)
  readonly allineando = signal(false)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  readonly codiciNonPresenti = computed(() => this.diagnostica()?.codiciNonPresenti ?? [])

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.load()
    }
  }

  private load(): void {
    this.loading.set(true)
    this.service.diagnostica().subscribe({
      next: diagnostica => {
        this.diagnostica.set(diagnostica)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.toast.error('Impossibile caricare la diagnostica delle codifiche RENTRI')
      },
    })
  }

  allineaOra(): void {
    this.allineando.set(true)
    this.service.allinea().subscribe({
      next: () => {
        this.allineando.set(false)
        this.toast.success('Allineamento delle codifiche RENTRI completato')
        this.load()
      },
      error: err => {
        this.allineando.set(false)
        // 409: un allineamento è già in corso (schedulato o avviato da un
        // altro amministratore) — messaggio comprensibile con severità
        // "warn" (giallo), non un errore rosso generico: non è un guasto,
        // è uno stato normale di concorrenza.
        if (err?.status === 409) {
          this.toast.warn(
            err?.error?.message ||
              'Un allineamento delle codifiche RENTRI è già in corso: riprova tra qualche minuto.'
          )
          return
        }
        this.toast.error(
          err?.error?.message || "Errore durante l'allineamento delle codifiche RENTRI"
        )
      },
    })
  }
}
