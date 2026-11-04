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
import { puoImpostareFatturazione } from './permessi-legami'
import { ImpostazioneFatturazione } from './legami.model'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'

const MESSAGGIO_VERSIONE =
  "L'impostazione è stata modificata da un altro utente: i dati sono stati ricaricati."

/** Numero dei movimenti toccati dal 409 `CONFERMA_RICHIESTA`: il filtro inoltra `details`. */
function movimentiToccati(err: unknown): number | null {
  const n = (err as { error?: { details?: { movimentiToccati?: unknown } } })?.error?.details
    ?.movimentiToccati
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

      <section
        *ngIf="!impostazione() && !errore()"
        class="surface-card"
        data-testid="fatt-caricamento"
      >
        <p role="status">Caricamento in corso...</p>
      </section>
      <p-button
        *ngIf="!impostazione() && errore()"
        label="Riprova"
        icon="pi pi-refresh"
        [outlined]="true"
        (onClick)="carica()"
        data-testid="fatt-riprova"
      />

      <section
        *ngIf="impostazione()"
        class="surface-card"
        aria-label="Data di inizio della fatturazione"
      >
        <p
          *ngIf="!impostazione()?.fatturazioneDa"
          class="avviso-riquadro"
          role="status"
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
          aria-describedby="fatt-nota"
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
        <p-button
          *ngIf="impostazione()?.fatturazioneDa"
          label="Spegni la fatturazione"
          icon="pi pi-power-off"
          [outlined]="true"
          [disabled]="!puoModificare() || inCorso()"
          (onClick)="spegni()"
          data-testid="fatt-spegni"
        />
        <p id="fatt-nota" class="nota-pagina">
          {{
            puoModificare()
              ? 'Per spegnere la fatturazione usa il pulsante «Spegni la fatturazione».'
              : 'Solo gli amministratori possono modificare questa impostazione.'
          }}
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

  readonly puoModificare = () => puoImpostareFatturazione(this.auth.currentUser()?.role)

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

  /** Spegne la fatturazione (data null): scelta esplicita, mai dedotta da un campo vuoto. */
  spegni(): void {
    this.invia(null)
  }

  salva(): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data)) {
      this.errore.set('Data non valida: inserisci una data completa o spegni la fatturazione.')
      return
    }
    this.invia(this.data)
  }

  private invia(fatturazioneDa: string | null, confermaMovimenti?: number): void {
    const corrente = this.impostazione()
    if (!corrente || this.inCorso()) return
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio
      .salva({
        fatturazioneDa,
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
          this.gestisciErrore(err, fatturazioneDa)
        },
      })
  }

  private gestisciErrore(err: unknown, fatturazioneDa: string | null): void {
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
          accept: () => this.invia(fatturazioneDa, n),
        })
        return
      }
    }
    if (e.conflitto && e.rilettura) {
      this.errore.set(MESSAGGIO_VERSIONE)
      this.carica(MESSAGGIO_VERSIONE)
      return
    }
    this.errore.set(e.messaggi.join(' '))
    if (e.rilettura) this.carica(this.errore())
  }
}
