import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { puoVariarePrezzi } from '../listino/permessi-listino'
import { ImpostazioneFatturazione } from './legami.model'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'

const MESSAGGIO_VERSIONE =
  "L'impostazione è stata modificata da un altro utente: i dati sono stati ricaricati."

/** Numero dei movimenti toccati dal 409 `CONFERMA_RICHIESTA` (anche dentro `details`). */
function movimentiToccati(err: unknown): number | null {
  const corpo = (
    err as { error?: { movimentiToccati?: unknown; details?: { movimentiToccati?: unknown } } }
  )?.error
  const n = corpo?.movimentiToccati ?? corpo?.details?.movimentiToccati
  return typeof n === 'number' ? n : null
}

/**
 * Schermata «Fatturazione da»: la data dalla quale i movimenti entrano nella fatturazione.
 * Data vuota = fatturazione spenta. Solo ADMIN e SUPER_ADMIN modificano.
 */
@Component({
  selector: 'app-impostazioni-fatturazione',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, ConfirmDialogModule, InputTextModule],
  providers: [ConfirmationService],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Fatturazione da</h1>
          <p class="page-subtitle">
            Solo i movimenti con data uguale o successiva a quella indicata entrano nella
            fatturazione. Lasciando il campo vuoto la fatturazione resta spenta.
          </p>
        </div>
      </header>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="fatt-errore">
        {{ e }}
      </p>

      <section class="surface-card" aria-label="Data di inizio della fatturazione">
        <p
          *ngIf="!impostazione()?.fatturazioneDa"
          class="avviso-riquadro"
          data-testid="fatt-spenta"
        >
          Fatturazione spenta
        </p>
        <label for="fatt-da">Fatturazione da</label>
        <input
          pInputText
          id="fatt-da"
          name="fatturazioneDa"
          type="date"
          [(ngModel)]="data"
          [disabled]="!puoModificare()"
          data-testid="fatt-data"
        />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="!puoModificare() || inCorso()"
          [loading]="inCorso()"
          (onClick)="salva()"
          data-testid="fatt-salva"
        />
        <p *ngIf="!puoModificare()" class="nota-pagina">
          Solo gli amministratori possono modificare questa impostazione.
        </p>
      </section>
      <p-confirmDialog />
    </div>
  `,
})
export class ImpostazioniFatturazioneComponent implements OnInit {
  private readonly servizio = inject(ImpostazioneFatturazioneService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly impostazione = signal<ImpostazioneFatturazione | null>(null)
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  data = ''

  readonly puoModificare = () => puoVariarePrezzi(this.auth.currentUser()?.role)

  ngOnInit(): void {
    this.carica()
  }

  /** Rilegge l'impostazione; `messaggio` resta visibile dopo la rilettura (es. versione superata). */
  carica(messaggio: string | null = null): void {
    this.servizio.leggi().subscribe({
      next: i => {
        this.impostazione.set(i)
        this.data = i.fatturazioneDa ?? ''
        this.errore.set(messaggio)
      },
      error: err =>
        this.errore.set(
          leggiErroriAzione(err, "Impossibile caricare l'impostazione.").messaggi.join(' ')
        ),
    })
  }

  salva(confermaMovimenti?: number): void {
    const corrente = this.impostazione()
    if (!corrente || this.inCorso()) return
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio
      .salva({
        fatturazioneDa: this.data || null,
        versione: corrente.versione,
        ...(confermaMovimenti === undefined ? {} : { confermaMovimenti }),
      })
      .subscribe({
        next: i => {
          this.inCorso.set(false)
          this.impostazione.set(i)
          this.data = i.fatturazioneDa ?? ''
          this.toast.success('Impostazione salvata.', 'Fatturazione')
        },
        error: err => {
          this.inCorso.set(false)
          this.gestisciErrore(err)
        },
      })
  }

  private gestisciErrore(err: unknown): void {
    const e = leggiErroriAzione(err, "Impossibile salvare l'impostazione.")
    if (e.conflitto && e.codice === 'CONFERMA_RICHIESTA') {
      const n = movimentiToccati(err)
      if (n !== null) {
        this.conferma.confirm({
          header: 'Conferma il cambio di data',
          message: `Verranno toccati ${n} ${n === 1 ? 'movimento' : 'movimenti'}. Vuoi procedere?`,
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Conferma',
          rejectLabel: 'Annulla',
          accept: () => this.salva(n),
        })
        return
      }
    }
    if (e.conflitto && e.codice === 'VERSIONE_SUPERATA') {
      this.errore.set(MESSAGGIO_VERSIONE)
      this.carica(MESSAGGIO_VERSIONE)
      return
    }
    this.errore.set(e.messaggi.join(' '))
    if (e.rilettura) this.carica(this.errore())
  }
}
