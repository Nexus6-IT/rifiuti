import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  RentriDiagnosticaService,
  RentriDiagnostica,
  LivelloAvvisoCertificato,
} from './rentri-diagnostica.service'

/** Stessi ruoli con visibilità sull'area RENTRI già usati da
 * `RentriFormulariController`/`RentriSyncController` (coerente con R1). */
const RENTRI_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

/** Etichetta leggibile per ciascun livello di avviso sulla scadenza del
 * certificato — soglie 30/15/7 IDENTICHE a quelle di `DeadlineCheckerService`
 * per il MUD (v. `GetRentriDiagnosticaUseCase`, backend). */
const ETICHETTA_AVVISO_CERTIFICATO: Record<LivelloAvvisoCertificato, string> = {
  ok: 'Valido',
  avviso_30: 'In scadenza entro 30 giorni',
  avviso_15: 'In scadenza entro 15 giorni — verificare a breve',
  avviso_7: 'In scadenza entro 7 giorni — azione richiesta',
  scaduto: 'Scaduto',
}

const ETICHETTA_MOTIVO_ATTENZIONE: Record<string, string> = {
  PERMANENTLY_FAILED: 'Sincronizzazione fallita in modo permanente',
  ATTESA_CONFERMA_LEGAME: 'In attesa di conferma aggancio',
}

/**
 * Diagnostica RENTRI (R5 Task 3): mostra la salute del collegamento con
 * l'ente usando SOLO dati già raccolti localmente — certificato (parsing
 * X.509 lato backend), ultime trasmissioni, formulari che richiedono
 * attenzione, stato del limitatore preventivo (R5 Task 1).
 *
 * NESSUN POLLING: un aggiornamento è un'azione esplicita dell'utente (il
 * pulsante «Aggiorna»), mai un `setInterval`/`interval` verso il backend —
 * lo stesso vincolo che decide l'endpoint lato server si applica qui: la
 * pagina che dovrebbe rassicurare sul rischio di ban non deve essa stessa
 * generare traffico periodico.
 */
@Component({
  selector: 'app-rentri-diagnostica',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="page" style="max-width: 1000px;">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Diagnostica RENTRI</h1>
          <p class="page-subtitle">
            Stato del collegamento con l'ente, da dati già raccolti — nessuna interrogazione
            dell'ente generata da questa pagina
          </p>
        </div>
      </header>

      <section
        *ngIf="!isAutorizzato()"
        class="surface-card"
        data-testid="rentri-diagnostica-non-autorizzato"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato</span>
          <p>Il tuo ruolo non ha visibilità sulla diagnostica RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAutorizzato()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-diagnostica-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <ng-container *ngIf="!loading() && diagnostica() as d">
          <div class="rentri-diagnostica-toolbar">
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [loading]="aggiornando()"
              (onClick)="aggiorna()"
              data-testid="rentri-diagnostica-aggiorna-btn"
            ></p-button>
          </div>

          <section class="surface-card" data-testid="rentri-diagnostica-certificato-scadenza">
            <h2 class="rentri-section-title">Certificato</h2>
            <p *ngIf="!d.certificato.configurato">Nessun certificato RENTRI configurato.</p>
            <ng-container *ngIf="d.certificato.configurato">
              <p>
                Scadenza:
                <strong>{{ d.certificato.scadenza | date: 'dd/MM/yyyy' }}</strong>
                ({{ d.certificato.giorniAllaScadenza }} giorni) —
                <span [class]="'rentri-badge-' + d.certificato.livelloAvviso">{{
                  etichettaAvviso(d.certificato.livelloAvviso)
                }}</span>
              </p>
            </ng-container>
          </section>

          <section class="surface-card mt-4" data-testid="rentri-diagnostica-trasmissioni-recenti">
            <h2 class="rentri-section-title">Ultime trasmissioni</h2>
            <p
              *ngIf="d.trasmissioniRecenti.length === 0"
              data-testid="rentri-diagnostica-trasmissioni-vuote"
            >
              Nessuna trasmissione registrata.
            </p>
            <table
              *ngIf="d.trasmissioniRecenti.length > 0"
              class="rentri-diagnostica-tabella"
              aria-label="Ultime trasmissioni RENTRI"
            >
              <thead>
                <tr>
                  <th scope="col">FIR</th>
                  <th scope="col">Esito</th>
                  <th scope="col">Tentativo</th>
                  <th scope="col">Quando</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let t of d.trasmissioniRecenti"
                  [attr.data-testid]="'rentri-diagnostica-trasmissione-' + t.id"
                >
                  <td class="cell-mono">{{ t.firNumber || t.firId }}</td>
                  <td>
                    {{ t.status }}<span *ngIf="t.errorMessage"> — {{ t.errorMessage }}</span>
                  </td>
                  <td>{{ t.attempt }}</td>
                  <td>{{ t.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="surface-card mt-4" data-testid="rentri-diagnostica-formulari-attenzione">
            <h2 class="rentri-section-title">Formulari che richiedono attenzione</h2>
            <p
              *ngIf="d.formulariAttenzione.length === 0"
              data-testid="rentri-diagnostica-nessun-formulario-attenzione"
            >
              Nessun formulario richiede attenzione al momento.
            </p>
            <ul *ngIf="d.formulariAttenzione.length > 0">
              <li
                *ngFor="let f of d.formulariAttenzione"
                [attr.data-testid]="'rentri-diagnostica-formulario-attenzione-' + f.firId"
              >
                <strong>{{ f.firNumber }}</strong> — {{ etichettaMotivo(f.motivo) }}:
                {{ f.dettaglio }}
              </li>
            </ul>
          </section>

          <section class="surface-card mt-4" data-testid="rentri-diagnostica-limitatore-stato">
            <h2 class="rentri-section-title">Limitatore RENTRI</h2>
            <p *ngIf="d.limitatore.inAttesa" data-testid="rentri-diagnostica-limitatore-in-attesa">
              RENTRI sta ricevendo molte richieste in questo momento, l'automazione rallenta da
              sola.
            </p>
            <p *ngIf="!d.limitatore.inAttesa" data-testid="rentri-diagnostica-limitatore-normale">
              Nessun rallentamento in corso.
            </p>
          </section>
        </ng-container>
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
      .rentri-diagnostica-toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--spacing-base);
      }
      .rentri-diagnostica-tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .rentri-diagnostica-tabella th,
      .rentri-diagnostica-tabella td {
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
      .mt-4 {
        margin-top: var(--spacing-xl);
      }
    `,
  ],
})
export class RentriDiagnosticaComponent implements OnInit {
  private readonly service = inject(RentriDiagnosticaService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly diagnostica = signal<RentriDiagnostica | null>(null)
  readonly loading = signal(false)
  readonly aggiornando = signal(false)

  readonly isAutorizzato = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && RENTRI_ROLES.includes(role)
  })

  ngOnInit(): void {
    if (this.isAutorizzato()) {
      this.load()
    }
  }

  /**
   * Azione esplicita dell'utente: NON chiamato da un timer. Se in futuro
   * qualcuno fosse tentato di avvolgere `load()`/`aggiorna()` in un
   * `setInterval`, romperebbe il vincolo che decide questo componente — v.
   * il test dedicato in `rentri-diagnostica.component.spec.ts`.
   */
  aggiorna(): void {
    this.aggiornando.set(true)
    this.service.diagnostica().subscribe({
      next: diagnostica => {
        this.diagnostica.set(diagnostica)
        this.aggiornando.set(false)
      },
      error: () => {
        this.aggiornando.set(false)
        this.toast.error('Impossibile aggiornare la diagnostica RENTRI')
      },
    })
  }

  etichettaAvviso(livello: LivelloAvvisoCertificato): string {
    return ETICHETTA_AVVISO_CERTIFICATO[livello]
  }

  etichettaMotivo(motivo: string): string {
    return ETICHETTA_MOTIVO_ATTENZIONE[motivo] ?? motivo
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
        this.toast.error('Impossibile caricare la diagnostica RENTRI')
      },
    })
  }
}
