import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'

import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  EventoAuditJob,
  HealthItem,
  HealthState,
  SystemHealth,
  SystemHealthService,
} from './system-health.service'

/** La pagina misura la piattaforma: stesso ruolo che il backend pretende. */
const RUOLI_AMMESSI = ['SUPER_ADMIN']

/** Etichetta di ogni stato. «Non misurabile» NON e' un sinonimo di «tutto bene». */
const ETICHETTA_STATO: Record<HealthState, string> = {
  ok: 'Funziona',
  warn: 'Degradato',
  error: 'Non funziona',
  off: 'Disattivato',
  info: 'Informazione',
  unknown: 'Non misurabile',
}

interface Sezione {
  titolo: string
  descrizione: string
  voci: HealthItem[]
}

/**
 * Pagina «Stato del sistema» (SUPER_ADMIN).
 *
 * DUE VINCOLI EREDITATI DAL BACKEND, VISIBILI QUI:
 *
 * 1. **Nessun polling.** L'aggiornamento e' un'azione esplicita («Aggiorna»),
 *    mai un `setInterval`: la pagina che deve dire se il sistema regge non
 *    deve essere essa stessa una fonte di carico. Il backend ha comunque una
 *    cache di 60 secondi, e la pagina dichiara sempre se sta mostrando dati
 *    dalla cache e di che eta'.
 *
 * 2. **Nessun pulsante che non fa nulla.** Il pulsante «Esegui ora» compare
 *    SOLO sulle voci che il backend ha marcato `actionable`. Le altre non
 *    hanno un bottone disabilitato senza spiegazione: non hanno bottone.
 */
@Component({
  selector: 'app-system-health',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Stato del sistema</h1>
          <p class="page-subtitle">
            Cosa funziona, da quando, e la prova. «Non misurabile» significa che il dato non esiste
            — non che vada tutto bene.
          </p>
        </div>
      </header>

      <section
        *ngIf="!autorizzato()"
        class="surface-card"
        data-testid="system-health-non-autorizzato"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato</span>
          <p>
            Questa pagina mostra dati aggregati di tutte le aziende: e riservata al SUPER_ADMIN.
          </p>
        </div>
      </section>

      <ng-container *ngIf="autorizzato()">
        <div
          *ngIf="caricamento() && !stato()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="system-health-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <p *ngIf="errore()" class="sh-errore" data-testid="system-health-errore">{{ errore() }}</p>

        <ng-container *ngIf="stato() as s">
          <div class="sh-toolbar">
            <span class="sh-generato" data-testid="system-health-generato">
              Rilevato il {{ s.generatedAt | date: 'dd/MM/yyyy HH:mm:ss' }} —
              <ng-container *ngIf="s.cached; else fresco">
                dalla cache ({{ s.cacheAgeSeconds }} s fa)
              </ng-container>
              <ng-template #fresco>misurato adesso</ng-template>
            </span>
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [loading]="caricamento()"
              (onClick)="carica()"
              data-testid="system-health-aggiorna-btn"
            ></p-button>
          </div>

          <section
            *ngFor="let sezione of sezioni()"
            class="surface-card mt-4"
            [attr.data-testid]="'system-health-sezione-' + sezione.titolo"
          >
            <h2 class="sh-section-title">{{ sezione.titolo }}</h2>
            <p class="sh-section-desc">{{ sezione.descrizione }}</p>

            <ul class="sh-lista">
              <li
                *ngFor="let voce of sezione.voci"
                class="sh-voce"
                [attr.data-testid]="'system-health-voce-' + voce.key"
              >
                <span
                  class="sh-pallino"
                  [class]="'sh-pallino--' + voce.state"
                  aria-hidden="true"
                ></span>
                <div class="sh-voce__testo">
                  <div class="sh-voce__intestazione">
                    <strong>{{ voce.label }}</strong>
                    <span class="sh-stato" [class]="'sh-stato--' + voce.state">
                      {{ etichettaStato(voce.state) }}
                    </span>
                  </div>
                  <p class="sh-voce__prova">{{ voce.detail }}</p>
                  <p *ngIf="voce.since" class="sh-voce__quando">
                    Ultimo evento: {{ voce.since | date: 'dd/MM/yyyy HH:mm' }}
                  </p>
                </div>
                <p-button
                  *ngIf="voce.actionable"
                  label="Esegui ora"
                  icon="pi pi-play"
                  severity="secondary"
                  [loading]="inAvvio().includes(chiaveAzione(voce))"
                  (onClick)="esegui(voce)"
                  [attr.data-testid]="'system-health-esegui-' + voce.key"
                ></p-button>
              </li>
            </ul>
          </section>

          <section class="surface-card mt-4" data-testid="system-health-storico">
            <h2 class="sh-section-title">Rilanci manuali recenti</h2>
            <p *ngIf="storico().length === 0" data-testid="system-health-storico-vuoto">
              Nessun rilancio manuale registrato.
            </p>
            <table *ngIf="storico().length > 0" class="sh-tabella" aria-label="Rilanci manuali">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Esito</th>
                  <th scope="col">Chi</th>
                  <th scope="col">Quando</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let evento of storico()">
                  <td>{{ evento.jobKey }}</td>
                  <td>{{ evento.esito }}</td>
                  <td>{{ evento.utente || '—' }}</td>
                  <td>{{ evento.al | date: 'dd/MM/yyyy HH:mm' }}</td>
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
      .sh-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .sh-section-desc {
        color: var(--text-color-secondary);
        margin: var(--spacing-xs) 0 var(--spacing-base);
      }
      .sh-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-base);
        margin-bottom: var(--spacing-base);
      }
      .sh-generato {
        color: var(--text-color-secondary);
      }
      .sh-errore {
        color: var(--color-danger);
      }
      .sh-lista {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .sh-voce {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--surface-border-strong);
      }
      .sh-voce:last-child {
        border-bottom: none;
      }
      .sh-voce__testo {
        flex: 1;
        min-width: 0;
      }
      .sh-voce__intestazione {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .sh-voce__prova,
      .sh-voce__quando {
        margin: var(--spacing-xs) 0 0;
        color: var(--text-color-secondary);
      }
      .sh-pallino {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        margin-top: 0.35rem;
        flex: 0 0 auto;
      }
      /* Il colore non e' l'unico portatore dell'informazione: accanto c'e'
         sempre l'etichetta testuale dello stato (requisito di accessibilita'
         e, qui, anche di chiarezza: «non misurabile» non ha un colore ovvio). */
      .sh-pallino--ok {
        background: var(--stato-ok-ink);
      }
      .sh-pallino--warn {
        background: var(--stato-warn-ink);
      }
      .sh-pallino--error {
        background: var(--stato-err-segno);
      }
      .sh-pallino--off {
        background: var(--surface-400);
      }
      .sh-pallino--info {
        background: var(--blue-400);
      }
      .sh-pallino--unknown {
        background: repeating-linear-gradient(
          45deg,
          var(--surface-400),
          var(--surface-400) 2px,
          transparent 2px,
          transparent 4px
        );
        border: 1px solid var(--surface-400);
      }
      .sh-stato {
        font-size: var(--font-size-sm);
        color: var(--text-color-secondary);
      }
      .sh-tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .sh-tabella th,
      .sh-tabella td {
        text-align: left;
        padding: var(--spacing-sm) var(--spacing-xs);
        border-bottom: 1px solid var(--surface-border-strong);
      }
    `,
  ],
})
export class SystemHealthComponent implements OnInit {
  private readonly api = inject(SystemHealthService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly stato = signal<SystemHealth | null>(null)
  readonly storico = signal<EventoAuditJob[]>([])
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly inAvvio = signal<string[]>([])

  readonly autorizzato = computed(() => RUOLI_AMMESSI.includes(this.auth.currentUser()?.role ?? ''))

  readonly sezioni = computed<Sezione[]>(() => {
    const s = this.stato()
    if (!s) return []

    return [
      {
        titolo: 'Infrastruttura',
        descrizione: 'Contatto reale con ogni dipendenza, non lettura della configurazione.',
        voci: s.infrastructure,
      },
      {
        titolo: 'Code',
        descrizione:
          'La domanda non e quanti job ci sono in coda, ma se qualcuno li consuma: una coda senza consumatori resta vuota e sembra sana.',
        voci: s.queues,
      },
      {
        titolo: 'Job schedulati',
        descrizione:
          'Registrati davvero nello scheduler di questo processo, e con quale ultimo effetto osservabile.',
        voci: s.scheduledJobs,
      },
      {
        titolo: 'Freschezza dei dati',
        descrizione:
          'Valutata solo dove esiste una cadenza attesa; altrove e un numero descrittivo, non un giudizio.',
        voci: s.freshness,
      },
      {
        titolo: 'Credenziali',
        descrizione: 'Certificati RENTRI delle aziende attive: mostrato lo stato peggiore trovato.',
        voci: s.credentials,
      },
      {
        titolo: 'Modalita e flag',
        descrizione: 'Cosa e acceso in questo ambiente, e cosa non dovrebbe esserlo in produzione.',
        voci: s.flags,
      },
    ]
  })

  ngOnInit(): void {
    if (this.autorizzato()) {
      this.carica()
    }
  }

  etichettaStato(stato: HealthState): string {
    return ETICHETTA_STATO[stato]
  }

  chiaveAzione(voce: HealthItem): string {
    return voce.actionKey ?? voce.key
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)

    this.api.stato().subscribe({
      next: stato => {
        this.stato.set(stato)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(
          err?.error?.message ?? 'Impossibile leggere lo stato del sistema in questo momento.'
        )
      },
    })

    this.api.storico().subscribe({
      next: eventi => this.storico.set(eventi),
      // Lo storico e' un complemento: se non arriva, la pagina resta utile.
      error: () => this.storico.set([]),
    })
  }

  esegui(voce: HealthItem): void {
    const chiave = this.chiaveAzione(voce)
    this.inAvvio.update(chiavi => [...chiavi, chiave])

    this.api.avviaJob(chiave).subscribe({
      next: esito => {
        this.inAvvio.update(chiavi => chiavi.filter(k => k !== chiave))
        // «Avviato», mai «completato»: il backend risponde 202 e il giro puo'
        // durare minuti. Dichiararlo finito qui sarebbe una bugia comoda.
        this.toast.info(esito.messaggio, 'Job avviato')
        this.carica()
      },
      error: err => {
        this.inAvvio.update(chiavi => chiavi.filter(k => k !== chiave))
        this.toast.error(
          err?.error?.message ?? 'Avvio non riuscito.',
          err?.status === 409 ? 'Job gia in corso' : 'Avvio non riuscito'
        )
      },
    })
  }
}
