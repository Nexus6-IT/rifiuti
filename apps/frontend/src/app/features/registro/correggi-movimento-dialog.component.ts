/**
 * Rettifica e annullamento di un movimento del registro (Fase 2 pezzo 3).
 *
 * Il registro non si modifica: ogni correzione scrive una annotazione NUOVA collegata alla
 * corretta. Questo dialog raccoglie i dati e il motivo, chiede le conferme esplicite (MUD già
 * presentato, ricopia di un FIR) e invia la richiesta; l'arbitro resta il backend.
 */

import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { CommonModule } from '@angular/common'
import { EMPTY, Subject, Subscription, merge, of } from 'rxjs'
import { catchError, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators'
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { ToastService } from '../../core/services/toast.service'
import { AuthService } from '../../core/services/auth.service'
import {
  BloccoFatturazioneComponent,
  DatiMovimentoLegame,
  SceltaLegame,
  StatoBlocco,
} from '../legami/blocco-fatturazione.component'
import { STATI_MODIFICABILI } from '../legami/legame-dialog.component'
import {
  AvvisoLegame,
  DatiLegameRegistrazione,
  FatturazioneCorrezione,
  LegameVista,
} from '../legami/legami.model'
import { LegamiService } from '../legami/legami.service'
import { permessiLegami } from '../legami/permessi-legami'
import { etichettaAvviso } from '../legami/vocabolario-legami'
import { CerSelectComponent } from '../cer/cer-select.component'
import {
  EsitoCorrezioneMovimento,
  Movimento,
  RegistroService,
  TipoMovimento,
} from './registro.service'
import { UNITA_GIACENZA, etichettaUnita } from './giacenze-iniziali-dialog.component'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import {
  MESSAGGIO_CAUSALE_NON_VALIDA,
  causaleSelezionabile,
  dataDaGiorno,
  giornoLocale,
  normalizzaStatoFisico,
  opzioniCausali,
  opzioniStatoFisico,
  opzioniUnita,
} from './registro-opzioni'
import { numeroAnnotazione } from './registro-correzioni'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

export type ModoCorrezione = 'rettifica' | 'annullamento'

/** Codice con cui il backend chiede la conferma per un anno il cui MUD risulta già presentato. */
export const ERRORE_ANNO_MUD_PRESENTATO = 'REGISTRO_ANNO_MUD_PRESENTATO'

/** Testo della conferma prima di annullare la registrazione nata da una ricopia di FIR. */
export const TESTO_CONFERMA_FIR =
  'Questa registrazione viene dalla ricopia di un FIR: dopo l’annullamento il FIR non si potrà ' +
  'ricopiare di nuovo nel registro. Se va corretta, usa la rettifica invece dell’annullamento.'

interface Conferma {
  tipo: 'FIR' | 'MUD'
  testo: string
}

const nonVuoto = (c: { value: unknown }) =>
  typeof c.value === 'string' && c.value.trim() === '' ? { vuoto: true } : null

/** Messaggio del backend (anche in forma di elenco) o uno generico. */
export function messaggioErroreCorrezione(err: any): string {
  const m = err?.error?.message ?? err?.message
  if (Array.isArray(m)) return m.join(' · ')
  return typeof m === 'string' && m ? m : 'Errore durante la correzione del movimento'
}

@Component({
  selector: 'app-correggi-movimento-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CalendarModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    NumeroItalianoDirective,
    InputTextModule,
    InputTextareaModule,
    CerSelectComponent,
    BloccoFatturazioneComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [header]="titolo"
      [modal]="true"
      [closable]="!invio()"
      [closeOnEscape]="!invio()"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra di correzione"
    >
      <ng-container *ngIf="movimento as m">
        <!-- Conferma esplicita (MUD già presentato / ricopia di FIR) -->
        <div
          *ngIf="conferma() as c"
          class="conferma"
          role="alert"
          [attr.data-testid]="'correzione-conferma-' + c.tipo.toLowerCase()"
        >
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <p class="conferma__testo">{{ c.testo }}</p>
        </div>

        <ng-container *ngIf="!conferma()">
          <!-- Riepilogo dell'annotazione corretta -->
          <section class="riepilogo" data-testid="correzione-riepilogo" aria-label="Movimento">
            <strong>Movimento {{ numero(m) }}</strong>
            · {{ m.type === 'CARICO' ? 'Carico' : 'Scarico' }} ·
            <span class="mono">{{ m.cerCode }}</span> · {{ m.quantity | number: '1.0-2' }}
            {{ unitaLeggibile(m.unit) }} · {{ causaleLabel(m) }}
            <span *ngIf="m.counterpartName"> · {{ m.counterpartName }}</span>
          </section>

          <p *ngIf="modo === 'annullamento'" class="nota">
            L’annullamento scrive una nuova annotazione che copia i dati del movimento e ne toglie
            gli effetti sulla giacenza. Il movimento resta nel registro, segnato come annullato.
          </p>
          <p *ngIf="modo === 'rettifica'" class="nota">
            La rettifica scrive una nuova annotazione con i dati completi qui sotto. Tipo e registro
            non si cambiano. Il movimento corretto resta nel registro, segnato come rettificato.
          </p>

          <p
            *ngIf="fatturato()"
            class="avviso-legame"
            role="status"
            data-testid="correzione-avviso-fatturato"
          >
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>
              {{ testoFatturato }}.
              {{
                modo === 'annullamento'
                  ? 'Puoi annullarlo comunque: il legame resta e segnala lo scostamento.'
                  : 'La rettifica è consentita: il legame resta e segnala lo scostamento.'
              }}
            </span>
          </p>
          <p
            *ngIf="modo === 'rettifica' && cerCambiato()"
            class="avviso-legame"
            role="status"
            data-testid="correzione-cer-cambiato"
          >
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>
              Il codice CER è cambiato: serve una nuova conferma del legame col listino. I prezzi
              congelati vengono ricalcolati sul nuovo codice.
            </span>
          </p>

          <form [formGroup]="form" class="corr-form" (ngSubmit)="invia()">
            <ng-container *ngIf="modo === 'rettifica'">
              <div class="riga">
                <div class="field">
                  <label for="corr-tipo">Tipo movimento</label>
                  <input
                    pInputText
                    id="corr-tipo"
                    class="w-full"
                    data-testid="correzione-tipo"
                    [value]="m.type === 'CARICO' ? 'Carico' : 'Scarico'"
                    disabled
                    aria-readonly="true"
                  />
                </div>
                <div class="field">
                  <label for="corr-causale"
                    >Causale <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-dropdown
                    formControlName="causale"
                    [options]="causaliOptions()"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Seleziona causale"
                    inputId="corr-causale"
                    styleClass="w-full"
                    data-testid="correzione-causale"
                    [attr.aria-invalid]="errore('causale') ? true : null"
                  ></p-dropdown>
                  <small *ngIf="errore('causale')" class="field-error" role="alert"
                    >Seleziona una causale.</small
                  >
                  <small
                    *ngIf="messaggioCausale() as msg"
                    class="field-hint"
                    role="status"
                    data-testid="correzione-causale-messaggio"
                    >{{ msg }}</small
                  >
                </div>
              </div>

              <div class="riga">
                <div class="field">
                  <label for="corr-data"
                    >Data operazione <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-calendar
                    formControlName="movementDate"
                    [showIcon]="true"
                    dateFormat="dd/mm/yy"
                    [maxDate]="oggi"
                    inputId="corr-data"
                    styleClass="w-full"
                  ></p-calendar>
                  <small *ngIf="errore('movementDate')" class="field-error" role="alert"
                    >Indica la data dell’operazione.</small
                  >
                </div>
                <div class="field">
                  <label for="corr-cer"
                    >Codice CER <span class="req" aria-hidden="true">*</span></label
                  >
                  <app-cer-select
                    inputId="corr-cer"
                    formControlName="cerCode"
                    ariaLabel="Codice CER del rifiuto"
                    placeholder="Cerca per codice o descrizione…"
                    [required]="true"
                    [invalid]="errore('cerCode')"
                  />
                  <small *ngIf="errore('cerCode')" class="field-error" role="alert"
                    >Il codice CER è obbligatorio.</small
                  >
                </div>
              </div>

              <div class="riga">
                <div class="field">
                  <label for="corr-quantita"
                    >Quantità <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-inputNumber
                    appNumeroIt
                    [useGrouping]="false"
                    formControlName="quantity"
                    inputId="corr-quantita"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="2"
                    [min]="0.01"
                    mode="decimal"
                    locale="it-IT"
                    styleClass="w-full"
                  ></p-inputNumber>
                  <small *ngIf="errore('quantity')" class="field-error" role="alert"
                    >Indica una quantità maggiore di zero.</small
                  >
                </div>
                <div class="field">
                  <label for="corr-unita">Unità</label>
                  <p-dropdown
                    formControlName="unit"
                    [options]="unitaOptions()"
                    optionLabel="label"
                    optionValue="value"
                    inputId="corr-unita"
                    styleClass="w-full"
                    data-testid="correzione-unita"
                  ></p-dropdown>
                </div>
              </div>

              <div class="field">
                <label for="corr-descrizione">Descrizione rifiuto</label>
                <input
                  pInputText
                  formControlName="wasteDescription"
                  id="corr-descrizione"
                  class="w-full"
                />
              </div>

              <div class="riga">
                <div class="field">
                  <label for="corr-stato-fisico">Stato fisico</label>
                  <p-dropdown
                    formControlName="wastePhysicalState"
                    [options]="statiFisiciOptions()"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Seleziona stato"
                    inputId="corr-stato-fisico"
                    styleClass="w-full"
                    [showClear]="true"
                  ></p-dropdown>
                </div>
                <div class="field">
                  <label for="corr-hp">Classi pericolo HP</label>
                  <input
                    pInputText
                    formControlName="wasteHazardClasses"
                    id="corr-hp"
                    class="w-full"
                    placeholder="es. HP4,HP14"
                  />
                </div>
                <div class="field">
                  <label for="corr-operazione">Codice operazione R/D</label>
                  <input
                    pInputText
                    formControlName="operationCode"
                    id="corr-operazione"
                    class="w-full"
                    placeholder="es. R1, D13"
                  />
                </div>
              </div>

              <div class="riga">
                <div class="field">
                  <label for="corr-controparte">{{
                    m.type === 'CARICO' ? 'Cedente / Produttore' : 'Destinatario'
                  }}</label>
                  <input
                    pInputText
                    formControlName="counterpartName"
                    id="corr-controparte"
                    class="w-full"
                  />
                </div>
                <div class="field">
                  <label for="corr-indirizzo">Indirizzo impianto / sede</label>
                  <input
                    pInputText
                    formControlName="counterpartAddress"
                    id="corr-indirizzo"
                    class="w-full"
                  />
                </div>
              </div>

              <div class="field">
                <label for="corr-note">Note</label>
                <textarea
                  pInputTextarea
                  formControlName="notes"
                  id="corr-note"
                  rows="2"
                  class="w-full"
                ></textarea>
              </div>
            </ng-container>

            <!-- Blocco «Fatturazione»: legame nuovo (righe ritoccabili) o esistente (solo scelte) -->
            <app-blocco-fatturazione
              *ngIf="modo === 'rettifica'"
              [datiMovimento]="datiLegame()"
              [righeModificabili]="!legameEsistente()"
              [(scelta)]="sceltaLegame"
              (legameChange)="legame = $event"
              (validoChange)="bloccoValido = $event"
              (inAttesaChange)="bloccoInAttesa = $event"
              (statoChange)="bloccoStato = $event"
            ></app-blocco-fatturazione>

            <div class="field">
              <label for="corr-motivo"
                >Motivo della correzione <span class="req" aria-hidden="true">*</span></label
              >
              <textarea
                pInputTextarea
                formControlName="motivo"
                id="corr-motivo"
                rows="3"
                maxlength="500"
                class="w-full"
                data-testid="correzione-motivo"
                placeholder="Perché si corregge questa registrazione"
                aria-required="true"
                [class.p-invalid]="errore('motivo')"
                [attr.aria-invalid]="errore('motivo') ? true : null"
              ></textarea>
              <small
                *ngIf="errore('motivo')"
                class="field-error"
                role="alert"
                data-testid="correzione-motivo-errore"
                >Scrivi il motivo (massimo 500 caratteri).</small
              >
            </div>
          </form>
        </ng-container>
      </ng-container>

      <ng-template pTemplate="footer">
        <ng-container *ngIf="conferma(); else azioni">
          <p-button
            label="Torna indietro"
            [text]="true"
            [disabled]="invio()"
            data-testid="correzione-conferma-indietro"
            (onClick)="annullaConferma()"
          ></p-button>
          <p-button
            label="Conferma e procedi"
            icon="pi pi-check"
            severity="danger"
            [loading]="invio()"
            data-testid="correzione-conferma-ok"
            (onClick)="confermaEProcedi()"
          ></p-button>
        </ng-container>
        <ng-template #azioni>
          <p-button
            label="Chiudi"
            [text]="true"
            [disabled]="invio()"
            data-testid="correzione-chiudi"
            (onClick)="chiudi()"
          ></p-button>
          <p-button
            *ngIf="modo === 'rettifica' && bloccoStato.visibile"
            label="Rettifica e conferma legame"
            icon="pi pi-check"
            [loading]="invio()"
            [disabled]="!bloccoStato.confermabile"
            data-testid="correzione-invia-conferma"
            ariaLabel="Rettifica il movimento e conferma il legame col listino"
            (onClick)="invia('CONFERMA')"
          ></p-button>
          <p-button
            [outlined]="modo === 'rettifica' && bloccoStato.visibile"
            [disabled]="modo === 'rettifica' && bloccoInAttesa"
            [label]="modo === 'rettifica' ? 'Rettifica' : 'Annulla il movimento'"
            icon="pi pi-check"
            [severity]="modo === 'annullamento' ? 'danger' : 'primary'"
            [loading]="invio()"
            data-testid="correzione-invia"
            (onClick)="invia('PROPOSTA')"
          ></p-button>
        </ng-template>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .riepilogo {
        padding: var(--spacing-sm) var(--spacing-base);
        background: var(--brand-primary-50);
        border: 1px solid var(--brand-primary-100);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        margin-bottom: var(--spacing-base);
      }
      .mono {
        font-family: var(--font-family-mono);
      }
      .nota {
        margin: 0 0 var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .corr-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .riga {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
      }
      .riga > .field {
        flex: 1 1 180px;
        min-width: 0;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .field > label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .req {
        color: var(--color-danger);
        font-weight: var(--font-weight-bold);
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
      }
      .w-full {
        width: 100%;
      }
      .conferma {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;
        padding: var(--spacing-base);
        background: var(--color-warning-bg);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        color: var(--text-primary);
      }
      .conferma i {
        margin-top: 3px;
        color: var(--color-warning);
      }
      .avviso-legame {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;
        margin: 0 0 var(--spacing-base);
        padding: var(--spacing-sm) var(--spacing-base);
        background: var(--color-warning-bg);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        line-height: 1.5;
      }
      .avviso-legame i {
        margin-top: 3px;
        color: var(--color-warning);
      }
      .conferma__testo {
        margin: 0;
        line-height: 1.5;
      }
    `,
  ],
})
export class CorreggiMovimentoDialogComponent implements OnChanges {
  private readonly servizio = inject(RegistroService)
  private readonly toast = inject(ToastService)
  private readonly fb = inject(FormBuilder)
  private readonly causali = inject(CausaliRegistroService)
  private readonly destroyRef = inject(DestroyRef)
  private readonly legami = inject(LegamiService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Input() modo: ModoCorrezione = 'rettifica'
  @Input() movimento: Movimento | null = null
  /** Emesso dopo una correzione riuscita (il chiamante ricarica l'elenco). */
  @Output() corretto = new EventEmitter<EsitoCorrezioneMovimento>()

  readonly testoFatturato =
    'Il movimento risulta già fatturato: la correzione non cambia la fattura'
  readonly oggi = new Date()
  readonly invio = signal(false)
  readonly conferma = signal<Conferma | null>(null)
  private readonly tipo = signal<TipoMovimento>('CARICO')
  private readonly unitaCorrente = signal<string | null>(null)
  private readonly statoCorrente = signal<string | null>(null)
  /** La conferma FIR è già stata data: non va richiesta di nuovo dopo un 409 MUD. */
  private firConfermata = false

  // ─── Legame col listino (fase 4.3) ─────────────────────────────────────────

  /** Legame già esistente della catena (null: nessuno o 404). */
  readonly legameEsistente = signal<LegameVista | null>(null)
  /** La lettura del legame è finita (anche con 404): prima non si chiede nessuna proposta. */
  private readonly legameCaricato = signal(false)
  private readonly datiForm = signal<DatiMovimentoLegame | null>(null)
  private readonly cerOriginale = signal('')
  private readonly cerCorrente = signal('')
  private sottoscrizioneLegame: Subscription | null = null
  private sottoscrizioneForm: Subscription | null = null
  /** Scelte, `legame` e stato emessi dal blocco «Fatturazione». */
  sceltaLegame: SceltaLegame | null = null
  legame: DatiLegameRegistrazione | null = null
  bloccoValido = true
  bloccoInAttesa = false
  bloccoStato: StatoBlocco = { visibile: false, confermabile: false }
  /** Azione scelta con il pulsante: serve anche al reinvio dopo la conferma MUD. */
  private azioneScelta: 'PROPOSTA' | 'CONFERMA' = 'PROPOSTA'

  private readonly puoScrivereLegami = computed(
    () => permessiLegami(this.auth.currentUser()?.role).scrive
  )

  /** Il legame è già fatturato (o importato come fatturato): la correzione si può fare, non lo cambia. */
  readonly fatturato = computed(() => {
    const l = this.legameEsistente()
    return !!l && (l.stato === 'FATTURATO' || l.stato === 'IMPORTATO_FATTURATO')
  })

  /** CER diverso da quello dell'annotazione corretta, su un legame che il backend rifà da zero. */
  readonly cerCambiato = computed(() => {
    const l = this.legameEsistente()
    return (
      !!l &&
      STATI_MODIFICABILI.includes(l.stato) &&
      this.cerCorrente().trim() !== this.cerOriginale().trim()
    )
  })

  form: FormGroup = this.creaForm()

  get titolo(): string {
    return this.modo === 'rettifica' ? 'Rettifica movimento' : 'Annulla movimento'
  }
  /** Opzioni dall'API per il tipo della testa e la data del form (vuote finché non arrivano). */
  private readonly opzioniApi = signal<OpzioneCausaleApi[]>([])
  /** Causale attuale dell'annotazione: resta selezionabile anche se disattivata o scaduta. */
  private readonly causaleAttuale = signal<{ codice: string; descrizione?: string } | null>(null)
  readonly messaggioCausale = signal<string | null>(null)
  private readonly ricaricaOpzioni = new Subject<string>()
  private sottoscrizioneOpzioni: Subscription | null = null

  /**
   * Dati per il blocco «Fatturazione»: null finché il legame non è letto, se l'utente non scrive,
   * se il legame non si può più cambiare (fatturato, escluso, annullato) o se l'API dice che la
   * causale scelta non è fatturabile. Cambiando il CER la proposta si rifà sul codice nuovo.
   */
  readonly datiLegame = computed<DatiMovimentoLegame | null>(() => {
    const dati = this.datiForm()
    if (!dati || !this.legameCaricato() || !this.puoScrivereLegami()) return null
    const l = this.legameEsistente()
    if (l && !STATI_MODIFICABILI.includes(l.stato)) return null
    const causale = this.opzioniApi().find(c => c.codice === dati.causale)
    return causale?.fatturabile === false ? null : dati
  })

  readonly causaliOptions = computed(() => opzioniCausali(this.opzioniApi(), this.causaleAttuale()))
  readonly unitaOptions = computed(() => opzioniUnita(this.unitaCorrente()))
  readonly statiFisiciOptions = computed(() => opzioniStatoFisico(this.statoCorrente()))

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['visible'] || changes['movimento'] || changes['modo']) && this.visible) {
      this.inizializza()
    }
  }

  numero(m: Movimento): string {
    return numeroAnnotazione(m)
  }

  causaleLabel(m: Pick<Movimento, 'causale' | 'causaleDescrizione'>): string {
    return m.causaleDescrizione || m.causale
  }

  unitaLeggibile(u: string): string {
    return etichettaUnita(u)
  }

  errore(nome: string): boolean {
    const c = this.form.get(nome)
    return !!(c && c.invalid && c.touched)
  }

  private creaForm(): FormGroup {
    return this.fb.group({
      causale: [null as string | null, Validators.required],
      movementDate: [null as Date | null, Validators.required],
      cerCode: ['', [Validators.required, Validators.maxLength(10)]],
      wasteDescription: [''],
      quantity: [null as number | null, [Validators.required, Validators.min(0.01)]],
      unit: ['KG'],
      wastePhysicalState: [null as string | null],
      wasteHazardClasses: [''],
      operationCode: [''],
      counterpartName: [''],
      counterpartAddress: [''],
      notes: [''],
      motivo: ['', [Validators.required, Validators.maxLength(500), nonVuoto]],
    })
  }

  /** Precompila il form con i dati vigenti dell'annotazione che si corregge. */
  private inizializza(): void {
    this.conferma.set(null)
    this.invio.set(false)
    this.firConfermata = false
    this.sottoscrizioneOpzioni?.unsubscribe()
    this.sottoscrizioneOpzioni = null
    this.opzioniApi.set([])
    this.messaggioCausale.set(null)
    this.form = this.creaForm()
    this.azzeraLegame()
    const m = this.movimento
    this.causaleAttuale.set(m ? { codice: m.causale, descrizione: m.causaleDescrizione } : null)
    if (!m) return
    // La rettifica non cambia il tipo: le causali sono quelle del tipo dell'annotazione.
    this.tipo.set(m.type)
    // Un'unità della lista si riconduce al suo valore (kg -> KG); una storica resta com'è.
    const grezza = m.unit || 'KG'
    const unita = UNITA_GIACENZA.find(u => u.value === grezza.toUpperCase())?.value ?? grezza
    const stato = normalizzaStatoFisico(m.wastePhysicalState)
    this.unitaCorrente.set(unita)
    this.statoCorrente.set(stato)
    this.form.patchValue({
      causale: m.causale,
      movementDate: dataDaGiorno(m.movementDate),
      cerCode: m.cerCode,
      wasteDescription: m.wasteDescription ?? '',
      quantity: Number(m.quantity),
      unit: unita,
      wastePhysicalState: stato,
      wasteHazardClasses: m.wasteHazardClasses ?? '',
      operationCode: m.operationCode ?? '',
      counterpartName: m.counterpartName ?? '',
      counterpartAddress: m.counterpartAddress ?? '',
      notes: m.notes ?? '',
    })
    if (this.modo === 'rettifica') this.avviaOpzioniCausali(m.type)
    this.avviaLegame(m)
  }

  private azzeraLegame(): void {
    this.sottoscrizioneLegame?.unsubscribe()
    this.sottoscrizioneForm?.unsubscribe()
    this.legameEsistente.set(null)
    this.legameCaricato.set(false)
    this.datiForm.set(null)
    this.cerOriginale.set('')
    this.cerCorrente.set('')
    this.sceltaLegame = null
    this.legame = null
    this.bloccoValido = true
    this.bloccoInAttesa = false
    this.bloccoStato = { visibile: false, confermabile: false }
    this.azioneScelta = 'PROPOSTA'
  }

  /**
   * Legge il legame della catena (solo chi può scrivere: il resto del dialog non lo usa) e tiene
   * aggiornati i dati per il blocco «Fatturazione». Un errore o un 404 valgono «nessun legame»:
   * il registro non si blocca mai per colpa del listino.
   */
  private avviaLegame(m: Movimento): void {
    this.cerOriginale.set(m.cerCode ?? '')
    this.cerCorrente.set(m.cerCode ?? '')
    if (!this.puoScrivereLegami()) return
    this.sottoscrizioneLegame = this.legami
      .perMovimento(m.id)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(l => {
        this.legameEsistente.set(l)
        this.legameCaricato.set(true)
      })
    if (this.modo !== 'rettifica') return
    const aggiorna = (): void => {
      this.cerCorrente.set(String(this.form.get('cerCode')?.value ?? ''))
      this.datiForm.set(this.costruisciDatiLegame(m))
    }
    this.sottoscrizioneForm = this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(aggiorna)
    aggiorna()
  }

  /** Solo con i campi obbligatori compilati e la quantità positiva: prima non c'è nulla da proporre. */
  private costruisciDatiLegame(m: Movimento): DatiMovimentoLegame | null {
    const v = this.form.getRawValue() as Record<string, unknown>
    const cer = typeof v['cerCode'] === 'string' ? v['cerCode'].trim() : ''
    const quantita = v['quantity']
    const data = v['movementDate']
    if (
      !v['causale'] ||
      !cer ||
      !(data instanceof Date) ||
      isNaN(data.getTime()) ||
      typeof quantita !== 'number' ||
      !(quantita > 0)
    ) {
      return null
    }
    return {
      causale: v['causale'] as string,
      type: m.type,
      cerCode: cer,
      movementDate: giornoLocale(data),
      unit: (v['unit'] as string) || 'KG',
      quantity: String(quantita),
      ...(m.firId ? { firId: m.firId } : {}),
    }
  }

  /**
   * Opzioni del tipo della testa alla data del form: si ricaricano a ogni cambio di giorno
   * (`switchMap`, `distinctUntilChanged`; nessuna richiesta per ogni tasto). La causale attuale
   * resta sempre selezionabile; una scelta diversa che dopo il cambio di data non è più fra le
   * opzioni si azzera con un messaggio sotto il campo.
   */
  private avviaOpzioniCausali(tipo: TipoMovimento): void {
    const data = this.form.get('movementDate')!
    const giorni$ = data.valueChanges.pipe(
      startWith(data.value as Date | null),
      map(d => (d instanceof Date && !isNaN(d.getTime()) ? giornoLocale(d) : null)),
      distinctUntilChanged(),
      switchMap(g => (g ? of(g) : EMPTY))
    )
    this.sottoscrizioneOpzioni = merge(giorni$, this.ricaricaOpzioni)
      .pipe(
        switchMap(giorno =>
          this.causali.opzioni(tipo, giorno).pipe(
            catchError(() => {
              this.toast.error('Impossibile caricare le causali: riprova fra poco.')
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(righe => {
        this.opzioniApi.set(righe)
        const ctrl = this.form.get('causale')
        const scelta = ctrl?.value as string | null
        const attuale = this.causaleAttuale()?.codice
        if (scelta && scelta !== attuale && !causaleSelezionabile(righe, scelta)) {
          ctrl?.reset(null)
          this.messaggioCausale.set(MESSAGGIO_CAUSALE_NON_VALIDA)
        } else {
          this.messaggioCausale.set(null)
        }
      })
  }

  chiudi(): void {
    if (this.invio()) return
    this.conferma.set(null)
    this.visibleChange.emit(false)
  }

  annullaConferma(): void {
    this.conferma.set(null)
  }

  invia(azione: 'PROPOSTA' | 'CONFERMA' = 'PROPOSTA'): void {
    if (!this.movimento || this.invio()) return
    // L'annullamento ha solo il motivo; la rettifica tutto il form.
    const invalido =
      this.modo === 'rettifica' ? this.form.invalid : !!this.form.get('motivo')?.invalid
    if (invalido) {
      this.form.markAllAsTouched()
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }
    if (this.modo === 'rettifica' && this.legame && !this.bloccoValido) {
      this.toast.error('Correggi i campi evidenziati nel blocco «Fatturazione» e riprova.')
      return
    }
    if (this.modo === 'rettifica' && azione === 'CONFERMA' && !this.bloccoStato.confermabile) {
      this.toast.error(
        'Il legame non si può confermare: completa i dati del blocco «Fatturazione».'
      )
      return
    }
    if (this.modo === 'rettifica' && this.bloccoInAttesa) {
      this.toast.info('Sto calcolando la fatturazione: riprova fra un istante.')
      return
    }
    this.azioneScelta = azione
    if (this.modo === 'annullamento' && this.movimento.firId && !this.firConfermata) {
      this.conferma.set({ tipo: 'FIR', testo: TESTO_CONFERMA_FIR })
      return
    }
    this.esegui(false)
  }

  /** "Conferma e procedi": FIR -> si invia; MUD -> si reinvia con `confermaAnnoPresentato`. */
  confermaEProcedi(): void {
    const c = this.conferma()
    if (!c) return
    if (c.tipo === 'FIR') {
      this.firConfermata = true
      this.conferma.set(null)
      this.esegui(false)
      return
    }
    this.esegui(true)
  }

  /**
   * Esito del legame dopo la correzione: sempre un avviso, mai un errore (la correzione è
   * riuscita). I testi del backend (`avvisi`) sono già mostrati; qui si aggiunge solo ciò che
   * manca, senza ripetere il rimando a «Da collegare».
   */
  private avvisiFatturazione(f: FatturazioneCorrezione | undefined, avvisi: string[]): void {
    if (!f) return
    const giaDetto = avvisi.some(a => /da collegare/i.test(a))
    if (f.esito === 'NON_RIUSCITO' && !giaDetto) {
      this.toast.warn(
        'Correzione registrata, ma il movimento non è stato collegato alla fatturazione: lo trovi in «Da collegare».'
      )
    } else if (f.esito === 'DA_RIALLINEARE' && !giaDetto) {
      this.toast.warn(
        'Correzione registrata, ma il legame col listino è rimasto indietro: lo trovi in «Da collegare» (da riallineare).'
      )
    } else if (f.esito === 'COLLEGATO') {
      const importanti: AvvisoLegame[] = [
        'CAMBIO_CER_DA_CONFERMARE',
        'QUANTITA_MANUALE_NON_DERIVATA',
      ]
      for (const a of f.avvisi.filter(x => importanti.includes(x))) {
        this.toast.warn(etichettaAvviso(a))
      }
    }
  }

  private esegui(confermaAnnoPresentato: boolean): void {
    const m = this.movimento
    if (!m) return
    const v = this.form.value
    const motivo = String(v.motivo ?? '').trim()
    const conferma = confermaAnnoPresentato ? { confermaAnnoPresentato: true } : {}
    this.invio.set(true)
    const richiesta =
      this.modo === 'rettifica'
        ? this.servizio.rettifica(m.id, {
            movementDate: giornoLocale(v.movementDate as Date),
            causale: v.causale,
            cerCode: String(v.cerCode ?? '').trim(),
            wasteDescription: v.wasteDescription || undefined,
            quantity: v.quantity,
            unit: v.unit || 'KG',
            wastePhysicalState: v.wastePhysicalState || undefined,
            wasteHazardClasses: v.wasteHazardClasses || undefined,
            operationCode: v.operationCode || undefined,
            counterpartName: v.counterpartName || undefined,
            counterpartAddress: v.counterpartAddress || undefined,
            notes: v.notes || undefined,
            motivo,
            // Il blocco prepara il legame; l'azione la decide il pulsante premuto.
            ...(this.legame ? { legame: { ...this.legame, azione: this.azioneScelta } } : {}),
            ...conferma,
          })
        : this.servizio.annulla(m.id, { motivo, ...conferma })
    richiesta.subscribe({
      next: esito => {
        this.invio.set(false)
        this.conferma.set(null)
        const nome = this.modo === 'rettifica' ? 'Rettifica registrata' : 'Annullamento registrato'
        this.toast.success(`${nome}: annotazione ${numeroAnnotazione(esito.movimento)}`)
        for (const avviso of esito.avvisi ?? []) this.toast.warn(avviso)
        this.avvisiFatturazione(esito.fatturazione, esito.avvisi ?? [])
        this.corretto.emit(esito)
        this.visibleChange.emit(false)
      },
      error: err => {
        this.invio.set(false)
        if (err?.status === 409 && err?.error?.error === ERRORE_ANNO_MUD_PRESENTATO) {
          this.conferma.set({ tipo: 'MUD', testo: messaggioErroreCorrezione(err) })
          return
        }
        this.toast.error(messaggioErroreCorrezione(err))
        if (err?.status === 409 && err?.error?.error === 'CAUSALE_MODIFICATA') {
          // la causale è cambiata mentre si compilava: opzioni nuove alla data del form
          this.causali.invalida()
          const d = this.form.get('movementDate')?.value
          if (d instanceof Date && !isNaN(d.getTime())) this.ricaricaOpzioni.next(giornoLocale(d))
        }
      },
    })
  }
}
