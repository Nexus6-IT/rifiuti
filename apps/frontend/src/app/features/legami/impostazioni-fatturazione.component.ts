import { CommonModule } from '@angular/common'
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Subscription } from 'rxjs'
import { FormsModule } from '@angular/forms'
import { ConfirmationService, SharedModule } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputSwitchModule } from 'primeng/inputswitch'
import { CalendarModule } from 'primeng/calendar'
import { TabViewModule } from 'primeng/tabview'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { puoImpostareFatturazione } from './permessi-legami'
import { ImpostazioneFatturazione } from './legami.model'
import { catturaFocus } from '../../shared/utils/ripristina-focus'
import { dataLocale, isoLocale } from '../fatturazione/impostazioni/numerazione-scheda.component'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { CedenteSchedaComponent } from '../fatturazione/impostazioni/cedente-scheda.component'
import { ImpostazioniFatturazione44Service } from '../fatturazione/impostazioni/impostazioni-fatturazione-4-4.service'
import { ERRORI_HTTP_VOCI } from '../fatturazione/vocabolario-fatturazione'
import { NumerazioneSchedaComponent } from '../fatturazione/impostazioni/numerazione-scheda.component'

const AVVISO_DEFINITIVE =
  "Accendi le definitive solo dopo la conferma del commercialista su TD24, documenti misti e nature soggette a bollo. Dopo l'accensione le fatture ricevono un numero definitivo."

const MESSAGGIO_VERSIONE =
  "L'impostazione è stata modificata da un altro utente: i dati sono stati ricaricati."

/** Numero dei movimenti toccati dal 409 `CONFERMA_RICHIESTA`: il filtro inoltra `details`. */
function movimentiToccati(err: unknown): number | null {
  const n = (err as { error?: { details?: { movimentiToccati?: unknown } } })?.error?.details
    ?.movimentiToccati
  return typeof n === 'number' ? n : null
}

/**
 * Impostazioni di fatturazione, in tre schede: «Fatturazione da» (la data dalla quale i
 * movimenti entrano nella fatturazione; data vuota = fatturazione spenta), «Dati del cedente» e
 * «Numerazione» (4.4a). Solo ADMIN e SUPER_ADMIN modificano.
 */
@Component({
  selector: 'app-impostazioni-fatturazione',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputSwitchModule,
    CalendarModule,
    TabViewModule,
    SharedModule,
    CedenteSchedaComponent,
    NumerazioneSchedaComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Impostazioni di fatturazione</h1>
        </div>
      </header>

      <p-tabView [scrollable]="true">
        <p-tabPanel header="Fatturazione da">
          <p class="page-subtitle">
            Solo i movimenti con data uguale o successiva a quella indicata entrano nella
            fatturazione. Lasciando il campo vuoto la fatturazione resta spenta.
          </p>

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
            <div class="riga-data">
              <label for="fatt-da">Fatturazione da</label>
              <p-calendar
                inputId="fatt-da"
                name="fatturazioneDa"
                dateFormat="dd/mm/yy"
                placeholder="gg/mm/aaaa"
                [showIcon]="true"
                #calendario
                [(ngModel)]="dataCalendario"
                [disabled]="!puoModificare()"
                data-testid="fatt-data"
              />
              <p-button
                label="Salva"
                icon="pi pi-check"
                styleClass="wf-primario"
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
            </div>
            <p id="fatt-nota" class="nota-pagina">
              {{
                puoModificare()
                  ? 'Per spegnere la fatturazione usa il pulsante «Spegni la fatturazione».'
                  : 'Solo gli amministratori possono modificare questa impostazione.'
              }}
            </p>
            <div class="riga-definitive">
              <p-inputSwitch
                inputId="fatt-definitive-input"
                [(ngModel)]="definitiveUi"
                [disabled]="!puoModificare() || inCorso()"
                (onChange)="cambiaDefinitive($event.checked)"
                data-testid="fatt-definitive"
              />
              <label for="fatt-definitive-input">Definitive attive</label>
            </div>
            <p class="nota-pagina">
              {{
                impostazione()?.definitiveAttive
                  ? 'Le fatture definitive sono attive per questa azienda.'
                  : 'Le fatture definitive sono spente: restano disponibili anteprime ed esportazione CSV.'
              }}
            </p>
          </section>
        </p-tabPanel>
        <p-tabPanel header="Dati del cedente">
          <ng-template pTemplate="content"><app-cedente-scheda /></ng-template>
        </p-tabPanel>
        <p-tabPanel header="Numerazione">
          <ng-template pTemplate="content"><app-numerazione-scheda /></ng-template>
        </p-tabPanel>
      </p-tabView>
      <p-confirmDialog
        [style]="{ width: '32rem', maxWidth: '96vw' }"
        (onHide)="ripristinaFocus()"
      />
    </div>
  `,
  styles: [
    `
      .riga-definitive {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin: var(--spacing-md) 0 var(--spacing-xs);
      }

      /* Etichetta, data e pulsanti sulla stessa riga, con spazio fra loro e stessa altezza. */
      .riga-data {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-sm);
      }
    `,
  ],
})
export class ImpostazioniFatturazioneComponent implements OnInit {
  private readonly servizio = inject(ImpostazioneFatturazioneService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  /** Riporta il focus a chi ha aperto la conferma (PrimeNG non lo fa); sostituito a ogni apertura. */
  ripristinaFocus: () => void = () => undefined
  private readonly servizio44 = inject(ImpostazioniFatturazione44Service)
  private readonly destroyRef = inject(DestroyRef)
  private lettura: Subscription | null = null

  readonly impostazione = signal<ImpostazioneFatturazione | null>(null)
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  /** Valore mostrato dall'interruttore; si riallinea a `impostazione()` dopo ogni esito. */
  definitiveUi = false

  /**
   * Data in `AAAA-MM-GG` (vuota = nessuna data valida). Il `Date` per il calendario si conserva a
   * parte: un getter che ne crea uno nuovo a ogni lettura farebbe riscrivere il valore a `ngModel`
   * a ogni ciclo di rilevamento, senza fine.
   */
  private dataIso = ''
  private dataDate: Date | null = null
  get data(): string {
    return this.dataIso
  }
  set data(v: string) {
    this.dataIso = v
    this.dataDate = dataLocale(v)
  }

  /**
   * Valore del calendario: `Date` locale (mai UTC). Un testo che non e' una data (PrimeNG passa la
   * stringa digitata) azzera `data`, cosi' «Salva» risponde «Data non valida».
   */
  get dataCalendario(): Date | null {
    return this.dataDate
  }
  set dataCalendario(v: Date | string | null) {
    const valida = v instanceof Date && !Number.isNaN(v.getTime())
    this.dataDate = valida ? v : null
    this.dataIso = valida ? isoLocale(v) : ''
  }

  /**
   * `p-calendar` 17.18 non ha `ariaDescribedBy`: la nota (che per chi non puo' modificare dice
   * perche') si collega all'input interno appena il calendario compare.
   */
  @ViewChild('calendario', { read: ElementRef })
  set calendario(el: ElementRef<HTMLElement> | undefined) {
    el?.nativeElement.querySelector('#fatt-da')?.setAttribute('aria-describedby', 'fatt-nota')
  }

  readonly puoModificare = () => puoImpostareFatturazione(this.auth.currentUser()?.role)

  ngOnInit(): void {
    this.carica()
  }

  /** Rilegge l'impostazione; `messaggio` resta visibile dopo la rilettura (es. versione superata). */
  carica(messaggio: string | null = null): void {
    this.lettura?.unsubscribe()
    this.lettura = this.servizio
      .leggi()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: i => {
          this.impostazione.set(i)
          this.data = i.fatturazioneDa ?? ''
          this.definitiveUi = i.definitiveAttive === true
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
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: i => {
          this.inCorso.set(false)
          this.impostazione.set(i)
          this.data = i.fatturazioneDa ?? ''
          this.definitiveUi = i.definitiveAttive === true
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
        this.ripristinaFocus = catturaFocus('fatt-salva')
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

  /** Accensione con avviso e conferma; spegnimento diretto. Il rifiuto riporta l'interruttore a prima. */
  cambiaDefinitive(attive: boolean): void {
    const corrente = this.impostazione()
    if (!corrente || this.inCorso() || !this.puoModificare()) {
      this.definitiveUi = corrente?.definitiveAttive === true
      return
    }
    if (!attive) {
      this.inviaDefinitive(false)
      return
    }
    this.ripristinaFocus = catturaFocus('fatt-definitive')
    this.conferma.confirm({
      header: 'Attiva le definitive',
      message: AVVISO_DEFINITIVE,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Attiva',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      // «Annulla» senza riempimento, «Attiva» pieno: la scelta sicura non deve pesare come quella che cambia le cose.
      rejectButtonStyleClass: 'p-button-text',
      accept: () => this.inviaDefinitive(true),
      reject: () => (this.definitiveUi = false),
    })
  }

  private inviaDefinitive(attive: boolean): void {
    const corrente = this.impostazione()
    if (!corrente) return
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio44
      .impostaDefinitive(attive, corrente.versione)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          // La versione è unica per la riga: la riprendiamo anche per la parte «Fatturazione da».
          this.impostazione.set({
            ...corrente,
            definitiveAttive: r.definitiveAttive,
            versione: r.versione,
          })
          this.definitiveUi = r.definitiveAttive
          this.toast.success(attive ? 'Definitive attivate.' : 'Definitive spente.', 'Fatturazione')
        },
        error: err => {
          this.inCorso.set(false)
          this.definitiveUi = corrente.definitiveAttive === true
          const e = leggiErroriAzione(err, 'Impossibile salvare le definitive.')
          if (e.conflitto && e.rilettura) {
            this.errore.set(MESSAGGIO_VERSIONE)
            this.carica(MESSAGGIO_VERSIONE)
            return
          }
          const voce =
            e.codice && Object.prototype.hasOwnProperty.call(ERRORI_HTTP_VOCI, e.codice)
              ? ERRORI_HTTP_VOCI[e.codice as keyof typeof ERRORI_HTTP_VOCI].etichetta
              : null
          this.errore.set(voce ?? e.messaggi.join(' '))
        },
      })
  }
}
