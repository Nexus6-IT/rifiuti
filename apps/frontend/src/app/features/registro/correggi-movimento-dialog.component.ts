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
    InputTextModule,
    InputTextareaModule,
    CerSelectComponent,
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
            [label]="modo === 'rettifica' ? 'Rettifica' : 'Annulla il movimento'"
            icon="pi pi-check"
            [severity]="modo === 'annullamento' ? 'danger' : 'primary'"
            [loading]="invio()"
            data-testid="correzione-invia"
            (onClick)="invia()"
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

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Input() modo: ModoCorrezione = 'rettifica'
  @Input() movimento: Movimento | null = null
  /** Emesso dopo una correzione riuscita (il chiamante ricarica l'elenco). */
  @Output() corretto = new EventEmitter<EsitoCorrezioneMovimento>()

  readonly oggi = new Date()
  readonly invio = signal(false)
  readonly conferma = signal<Conferma | null>(null)
  private readonly tipo = signal<TipoMovimento>('CARICO')
  private readonly unitaCorrente = signal<string | null>(null)
  private readonly statoCorrente = signal<string | null>(null)
  /** La conferma FIR è già stata data: non va richiesta di nuovo dopo un 409 MUD. */
  private firConfermata = false

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

  invia(): void {
    if (!this.movimento || this.invio()) return
    // L'annullamento ha solo il motivo; la rettifica tutto il form.
    const invalido =
      this.modo === 'rettifica' ? this.form.invalid : !!this.form.get('motivo')?.invalid
    if (invalido) {
      this.form.markAllAsTouched()
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }
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
