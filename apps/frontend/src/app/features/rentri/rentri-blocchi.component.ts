import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { MessageModule } from 'primeng/message'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriBlocchiService, RentriBlocco, RentriScorta } from './rentri-blocchi.service'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

/** Ruoli con visibilità sulla pagina (stessi di diagnostica/formulari RENTRI). */
const RENTRI_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']
/** Ruoli abilitati alle azioni di scrittura (predefinito, vidimazione). */
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN']

/**
 * Pagina "Blocchi e vidimazione RENTRI".
 *
 * I blocchi virtuali si creano ESCLUSIVAMENTE sul portale dell'ente — non
 * esiste un'API di creazione e non deve comparire qui un pulsante che
 * finga di poterli creare. Questa pagina mostra la scorta di numeri già
 * vidimati (il dato che serve ogni giorno), l'elenco dei blocchi letti
 * dall'ente, e le due azioni realmente disponibili da un gestionale:
 * impostare il blocco predefinito dell'unità locale e avviare la
 * vidimazione di un lotto (asincrona: i numeri compaiono in scorta quando
 * l'ente risponde, non alla richiesta).
 */
@Component({
  selector: 'app-rentri-blocchi',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputNumberModule,
    NumeroItalianoDirective,
    MessageModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Blocchi e vidimazione RENTRI</h1>
          <p class="page-subtitle">
            Scorta di numeri pronti all'uso e blocchi virtuali letti dall'ente
          </p>
        </div>
      </header>

      <section
        *ngIf="!isAutorizzato()"
        class="surface-card"
        data-testid="rentri-blocchi-non-autorizzato"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato</span>
          <p>Il tuo ruolo non ha visibilità sui blocchi RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAutorizzato()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-blocchi-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <ng-container *ngIf="!loading()">
          <!-- Nota permanente: dove si creano i blocchi. Non è solo nello stato
               vuoto — deve restare visibile anche quando i blocchi già esistono,
               perché prima o poi ne servirà uno nuovo (nuovo mezzo, nuova sede). -->
          <p-message
            severity="info"
            styleClass="w-full mb-4"
            data-testid="rentri-blocchi-nota-portale"
            [text]="notaPortaleTesto"
          ></p-message>

          <!-- Scorta in evidenza: è il dato che serve ogni giorno. -->
          <section class="surface-card mb-4" data-testid="rentri-blocchi-scorta">
            <h2 class="rentri-section-title mb-3">Scorta di numeri pronti all'uso</h2>
            <div class="rentri-scorta-totale" data-testid="rentri-blocchi-scorta-totale">
              <span class="rentri-scorta-totale__numero">{{
                scorta()?.totaleDisponibili ?? 0
              }}</span>
              <span class="rentri-scorta-totale__etichetta"
                >numeri disponibili in totale, su tutte le sedi</span
              >
            </div>
            <ul class="rentri-scorta-per-blocco" *ngIf="(scorta()?.perBlocco?.length ?? 0) > 0">
              <li
                *ngFor="let s of scorta()!.perBlocco"
                [attr.data-testid]="'rentri-blocchi-scorta-blocco-' + s.codiceBlocco"
              >
                <strong>{{ s.descrizione }}</strong>
                <span class="text-secondary"> ({{ s.codiceBlocco }} · {{ s.numIscrSito }})</span>:
                {{ s.disponibili }} disponibili
              </li>
            </ul>
          </section>

          <!-- Nessun blocco attivo: stato vuoto che spiega il problema, non una tabella vuota. -->
          <section
            *ngIf="bloccheAttivi().length === 0"
            class="surface-card mb-4"
            data-testid="rentri-blocchi-empty-state"
          >
            <div class="empty-state">
              <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
              <span class="empty-state__title">Nessun blocco attivo</span>
              <p>
                Senza un blocco virtuale attivo l'ente non può vidimare numeri e non è possibile
                emettere FIR. Crea un blocco sul portale RENTRI (area "Operatori" → Interoperabilità
                → Gestione blocchi virtuali dei FIR, ad es. "un blocco per mezzo di trasporto"), poi
                torna qui per vidimare un lotto di numeri.
              </p>
            </div>
          </section>

          <!-- Blocchi attivi -->
          <section
            *ngIf="bloccheAttivi().length > 0"
            class="surface-card mb-4"
            aria-label="Blocchi RENTRI attivi"
            data-testid="rentri-blocchi-list-attivi"
          >
            <h2 class="rentri-section-title mb-3">Blocchi attivi</h2>
            <div
              *ngFor="let b of bloccheAttivi()"
              class="rentri-blocco-row"
              [attr.data-testid]="'rentri-blocchi-row-' + b.codiceBlocco"
            >
              <div class="rentri-blocco-row__main">
                <span class="rentri-blocco-row__descrizione">{{ b.descrizione }}</span>
                <span class="rentri-blocco-row__codice"
                  >{{ b.codiceBlocco }} · {{ b.numIscrSito }}</span
                >
                <span class="text-secondary">
                  {{ b.numeroFirVidimati }} FIR vidimati ·
                  {{
                    b.dataUltimoUtilizzo
                      ? 'ultimo utilizzo ' + (b.dataUltimoUtilizzo | date: 'dd/MM/yyyy')
                      : 'mai utilizzato'
                  }}
                </span>
              </div>
              <div class="rentri-blocco-row__badges">
                <p-tag
                  *ngIf="b.predefinito"
                  severity="info"
                  value="Predefinito"
                  data-testid="rentri-blocchi-badge-predefinito"
                ></p-tag>
              </div>
              <div class="rentri-blocco-row__actions" *ngIf="isAdmin()">
                <p-button
                  *ngIf="!b.predefinito"
                  label="Imposta come predefinito"
                  icon="pi pi-star"
                  [text]="true"
                  size="small"
                  (onClick)="impostaPredefinito(b)"
                  [attr.data-testid]="'rentri-blocchi-set-predefinito-' + b.codiceBlocco"
                ></p-button>
                <p-button
                  label="Vidima un lotto"
                  icon="pi pi-verified"
                  [text]="true"
                  size="small"
                  (onClick)="apriVidimazione(b)"
                  [attr.data-testid]="'rentri-blocchi-vidima-' + b.codiceBlocco"
                ></p-button>
              </div>
            </div>
          </section>

          <!-- Blocchi disattivati: distinti ma NON nascosti (storico). -->
          <section
            *ngIf="bloccheDisattivati().length > 0"
            class="surface-card rentri-blocchi-disattivati"
            aria-label="Blocchi RENTRI disattivati"
            data-testid="rentri-blocchi-list-disattivati"
          >
            <h2 class="rentri-section-title mb-3">Blocchi disattivati</h2>
            <div
              *ngFor="let b of bloccheDisattivati()"
              class="rentri-blocco-row rentri-blocco-row--disattivato"
              [attr.data-testid]="'rentri-blocchi-row-' + b.codiceBlocco"
            >
              <div class="rentri-blocco-row__main">
                <span class="rentri-blocco-row__descrizione">{{ b.descrizione }}</span>
                <span class="rentri-blocco-row__codice"
                  >{{ b.codiceBlocco }} · {{ b.numIscrSito }}</span
                >
                <span class="text-secondary">
                  {{ b.numeroFirVidimati }} FIR vidimati ·
                  {{
                    b.dataUltimoUtilizzo
                      ? 'ultimo utilizzo ' + (b.dataUltimoUtilizzo | date: 'dd/MM/yyyy')
                      : 'mai utilizzato'
                  }}
                </span>
              </div>
              <p-tag severity="danger" value="Disattivato"></p-tag>
            </div>
          </section>
        </ng-container>
      </ng-container>

      <!-- Dialog vidimazione lotto -->
      <p-dialog
        [(visible)]="displayVidimaDialog"
        [modal]="true"
        [style]="{ width: '28rem' }"
        header="Vidima un lotto di numeri"
        closeAriaLabel="Chiudi la finestra Vidima un lotto"
        data-testid="rentri-blocchi-vidima-dialog"
      >
        <p *ngIf="bloccoSelezionato as bs">
          Blocco: <strong>{{ bs.descrizione }}</strong> ({{ bs.codiceBlocco }})
        </p>
        <div class="field mb-3">
          <label for="vidima-quantita" class="block mb-2">Quantità di numeri da vidimare *</label>
          <p-inputNumber
            appNumeroIt
            locale="it-IT"
            [useGrouping]="false"
            soloIntero
            [maxFractionDigits]="0"
            inputId="vidima-quantita"
            [(ngModel)]="quantitaVidimazione"
            [min]="1"
            [max]="quantitaVidimazioneMassima"
            [showButtons]="false"
            styleClass="w-full"
            data-testid="rentri-blocchi-vidima-input-quantita"
          ></p-inputNumber>
        </div>
        <p class="text-secondary">
          La vidimazione non è immediata: i numeri compariranno nella scorta quando l'ente risponde.
        </p>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="displayVidimaDialog = false"
          ></p-button>
          <p-button
            label="Avvia vidimazione"
            icon="pi pi-check"
            [loading]="vidimando()"
            [disabled]="
              !quantitaVidimazione ||
              quantitaVidimazione < 1 ||
              quantitaVidimazione > quantitaVidimazioneMassima
            "
            (onClick)="confermaVidimazione()"
            data-testid="rentri-blocchi-vidima-conferma"
          ></p-button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      .rentri-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .rentri-scorta-totale {
        display: flex;
        align-items: baseline;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }
      .rentri-scorta-totale__numero {
        font-size: 2.5rem;
        font-weight: var(--font-weight-semibold);
        font-family: var(--font-display);
      }
      .rentri-scorta-totale__etichetta {
        color: var(--text-secondary);
      }
      .rentri-scorta-per-blocco {
        margin: 0;
        padding-left: var(--spacing-lg);
      }
      .rentri-blocco-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        padding: var(--spacing-base) 0;
        border-bottom: 1px solid var(--surface-border-strong);
      }
      .rentri-blocco-row:last-child {
        border-bottom: none;
      }
      .rentri-blocco-row--disattivato {
        opacity: 0.65;
      }
      .rentri-blocco-row__main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 220px;
        flex: 1;
      }
      .rentri-blocco-row__descrizione {
        font-weight: var(--font-weight-semibold);
      }
      .rentri-blocco-row__codice {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-family: var(--font-family-mono);
      }
      .rentri-blocco-row__badges {
        display: flex;
        gap: var(--spacing-xs);
      }
      .rentri-blocco-row__actions {
        display: flex;
        gap: var(--spacing-xs);
      }
      .text-secondary {
        color: var(--text-secondary);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .field {
        margin-bottom: 0;
      }
    `,
  ],
})
export class RentriBlocchiComponent implements OnInit {
  private readonly service = inject(RentriBlocchiService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly blocchi = signal<RentriBlocco[]>([])
  readonly scorta = signal<RentriScorta | null>(null)
  readonly loading = signal(false)
  readonly vidimando = signal(false)

  readonly bloccheAttivi = computed(() => this.blocchi().filter(b => !b.disattivo))
  readonly bloccheDisattivati = computed(() => this.blocchi().filter(b => b.disattivo))

  readonly isAutorizzato = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && RENTRI_ROLES.includes(role)
  })
  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  displayVidimaDialog = false
  bloccoSelezionato: RentriBlocco | null = null
  quantitaVidimazione: number | null = null

  /**
   * Tetto della quantità vidimabile in un lotto, allineato a `@Max(100)` di
   * `VidimaScortaRentriDto` (backend): senza questo limite anche nel campo,
   * chi digita 250 scopre il rifiuto solo dopo l'invio, con un messaggio in
   * inglese di class-validator — su un ramo che fa della normalizzazione
   * preventiva il suo criterio.
   */
  readonly quantitaVidimazioneMassima = 100

  /** Dove si creano i blocchi: SOLO sul portale dell'ente, mai da qui. */
  readonly notaPortaleTesto =
    'I blocchi virtuali si creano solo sul portale RENTRI: area riservata "Operatori" → ' +
    'Interoperabilità → Gestione blocchi virtuali dei FIR. Da qui puoi solo leggerli e vidimare ' +
    'numeri per quelli già esistenti.'

  ngOnInit(): void {
    if (this.isAutorizzato()) {
      this.load()
    }
  }

  private load(): void {
    this.loading.set(true)
    let pending = 2
    const done = () => {
      pending -= 1
      if (pending === 0) this.loading.set(false)
    }
    this.service.blocchi().subscribe({
      next: blocchi => {
        this.blocchi.set(blocchi)
        done()
      },
      error: () => {
        this.toast.error('Impossibile caricare i blocchi RENTRI')
        done()
      },
    })
    this.service.scorta().subscribe({
      next: scorta => {
        this.scorta.set(scorta)
        done()
      },
      error: () => {
        this.toast.error('Impossibile caricare la scorta RENTRI')
        done()
      },
    })
  }

  impostaPredefinito(b: RentriBlocco): void {
    this.service.setPredefinito(b.codiceBlocco).subscribe({
      next: () => {
        const etichetta = b.descrizione ? `"${b.descrizione}"` : `il blocco ${b.codiceBlocco}`
        this.toast.success(`${etichetta} è ora il blocco predefinito`)
        this.load()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'impostare il blocco predefinito")
      },
    })
  }

  apriVidimazione(b: RentriBlocco): void {
    this.bloccoSelezionato = b
    this.quantitaVidimazione = null
    this.displayVidimaDialog = true
  }

  confermaVidimazione(): void {
    if (
      !this.bloccoSelezionato ||
      !this.quantitaVidimazione ||
      this.quantitaVidimazione < 1 ||
      this.quantitaVidimazione > this.quantitaVidimazioneMassima
    )
      return
    this.vidimando.set(true)
    this.service.vidima(this.bloccoSelezionato.codiceBlocco, this.quantitaVidimazione).subscribe({
      next: () => {
        this.vidimando.set(false)
        this.displayVidimaDialog = false
        this.toast.success(
          "Vidimazione avviata: non è immediata, i numeri compariranno nella scorta quando l'ente risponde."
        )
      },
      error: err => {
        this.vidimando.set(false)
        this.toast.error(err?.error?.message || "Errore nell'avviare la vidimazione")
      },
    })
  }
}
