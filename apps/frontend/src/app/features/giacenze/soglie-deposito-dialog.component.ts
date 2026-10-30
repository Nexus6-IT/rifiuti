/**
 * Dialog di configurazione delle soglie del deposito temporaneo (solo amministratori).
 *
 * Il livello è "Tutta l'azienda" o una sede; il PUT sostituisce la riga intera e contiene SEMPRE
 * `giorniMax` (numero o `null`, M7). La validazione lato client usa gli stessi limiti di
 * `validaSoglie` del backend; i 400 del backend si mostrano come arrivano. Il ruolo lo decide il
 * backend (`puoImpostare`): il pulsante che apre il dialog compare solo se è vero.
 */

import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { ToastService } from '../../core/services/toast.service'
import {
  ConfigurazioneSoglie,
  CriterioDeposito,
  DatiSoglie,
  GiacenzeService,
  SoglieDeposito,
} from './giacenze.service'

/** Stessi limiti di `LIMITI_LEGGE` e `validaSoglie` del backend. */
export const LIMITI_SOGLIE = {
  giorniMax: 92,
  preavvisoGiorniMax: 88,
  preavvisoPercentualeMax: 99,
  kgMassimo: 10_000_000,
  noteMax: 500,
} as const

/** Il dropdown non seleziona le voci con valore `null`: "tutta l'azienda" è la stringa vuota. */
export const LIVELLO_AZIENDA = ''

export const CRITERI: { value: CriterioDeposito; label: string; spiegazione: string }[] = [
  {
    value: 'TEMPORALE',
    label: 'Temporale',
    spiegazione: 'Avvio a recupero o smaltimento entro tre mesi di calendario (art. 185-bis).',
  },
  {
    value: 'QUANTITATIVO',
    label: 'Quantitativo',
    spiegazione: 'Fino a 30 m³ (di cui 10 m³ pericolosi) e comunque entro un anno.',
  },
  {
    value: 'NON_SCELTO',
    label: 'Non scelto',
    spiegazione: 'Non hai ancora scelto: si controllano entrambi i criteri.',
  },
]

export interface ValoriFormSoglie {
  livello: string
  criterio: CriterioDeposito
  usaGiorni: boolean
  giorniMax: number | null
  kgMaxTotale: number | null
  kgMaxPericolosi: number | null
  preavvisoGiorni: number | null
  preavvisoPercentuale: number | null
  note: string | null
}

export type CampoSoglie =
  | 'giorniMax'
  | 'kgMaxTotale'
  | 'kgMaxPericolosi'
  | 'preavvisoGiorni'
  | 'preavvisoPercentuale'
  | 'note'

const intero = (n: unknown, min: number, max: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

const alPiuDueDecimali = (n: number): boolean => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

/** Giorni effettivamente inviati: solo con criterio che li usa e casella accesa. */
export function giorniEffettivi(v: ValoriFormSoglie): number | null {
  return v.criterio !== 'QUANTITATIVO' && v.usaGiorni ? v.giorniMax : null
}

/** Come `validaSoglie` del backend, ma con il messaggio associato al campo. */
export function validaFormSoglie(v: ValoriFormSoglie): Partial<Record<CampoSoglie, string>> {
  const e: Partial<Record<CampoSoglie, string>> = {}
  const giorni = giorniEffettivi(v)
  const usaGiorni = v.criterio !== 'QUANTITATIVO' && v.usaGiorni
  if (usaGiorni && !intero(v.giorniMax, 1, LIMITI_SOGLIE.giorniMax)) {
    e.giorniMax = `La soglia in giorni può solo anticipare i tre mesi di legge: al massimo ${LIMITI_SOGLIE.giorniMax} giorni, numero intero (almeno 1).`
  }
  const tot = v.kgMaxTotale
  if (tot == null || !(tot > 0) || tot > LIMITI_SOGLIE.kgMassimo) {
    e.kgMaxTotale = 'La soglia totale in kg deve essere maggiore di zero e al massimo 10.000.000.'
  } else if (!alPiuDueDecimali(tot)) {
    e.kgMaxTotale = 'La soglia totale in kg può avere al massimo 2 decimali.'
  }
  const per = v.kgMaxPericolosi
  if (per == null || !(per > 0)) {
    e.kgMaxPericolosi = 'La soglia dei pericolosi in kg deve essere maggiore di zero.'
  } else if (tot != null && per > tot) {
    e.kgMaxPericolosi = 'La soglia dei pericolosi non può superare la soglia totale.'
  } else if (!alPiuDueDecimali(per)) {
    e.kgMaxPericolosi = 'La soglia dei pericolosi in kg può avere al massimo 2 decimali.'
  }
  if (!intero(v.preavvisoGiorni, 0, LIMITI_SOGLIE.preavvisoGiorniMax)) {
    e.preavvisoGiorni = `Il preavviso in giorni deve essere un numero intero da 0 a ${LIMITI_SOGLIE.preavvisoGiorniMax} (meno della durata minima di tre mesi).`
  } else if (
    giorni !== null &&
    intero(giorni, 1, LIMITI_SOGLIE.giorniMax) &&
    (v.preavvisoGiorni as number) >= giorni
  ) {
    e.preavvisoGiorni = 'Il preavviso in giorni deve essere inferiore alla soglia in giorni.'
  }
  if (!intero(v.preavvisoPercentuale, 0, LIMITI_SOGLIE.preavvisoPercentualeMax)) {
    e.preavvisoPercentuale =
      'La percentuale di preavviso deve essere un numero intero da 0 a 99 (0 = nessun preavviso).'
  }
  if ((v.note?.trim().length ?? 0) > LIMITI_SOGLIE.noteMax) {
    e.note = `La nota può avere al massimo ${LIMITI_SOGLIE.noteMax} caratteri.`
  }
  return e
}

const MSG_GENERICO = 'Salvataggio delle soglie non riuscito.'

/** Messaggi del backend così come arrivano: `details.messaggi`, poi `message`. */
export function messaggiErroreSoglie(err: any): string[] {
  const dettagli = err?.error?.details?.messaggi
  if (Array.isArray(dettagli) && dettagli.length) return dettagli.map(String)
  const m = err?.error?.message
  if (Array.isArray(m) && m.length) return m.map(String)
  return [typeof m === 'string' && m ? m : MSG_GENERICO]
}

@Component({
  selector: 'app-soglie-deposito-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextareaModule,
    SelectButtonModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      header="Soglie del deposito temporaneo"
      [modal]="true"
      [closable]="true"
      [closeOnEscape]="true"
      [style]="{ width: '760px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra delle soglie"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" data-testid="sd-form" novalidate>
        <div class="field">
          <label for="sd-livello">A chi si applicano</label>
          <p-dropdown
            formControlName="livello"
            inputId="sd-livello"
            data-testid="sd-livello"
            [options]="opzioniLivello()"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            ariaLabel="Livello delle soglie"
            (onChange)="cambiaLivello($event.value)"
          ></p-dropdown>
          <small class="field-hint" id="sd-livello-hint" data-testid="sd-livello-hint">{{
            testoLivello()
          }}</small>
        </div>

        <div class="field">
          <span id="sd-criterio-label" class="sd-etichetta">Criterio del deposito</span>
          <p-selectButton
            formControlName="criterio"
            data-testid="sd-criterio"
            [options]="criteri"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            ariaLabelledBy="sd-criterio-label"
          ></p-selectButton>
          <ul class="sd-spiegazioni" id="sd-criterio-desc">
            <li *ngFor="let c of criteri" [class.sd-attiva]="c.value === criterio">
              <strong>{{ c.label }}</strong
              >: {{ c.spiegazione }}
            </li>
          </ul>
        </div>

        <div *ngIf="mostraGiorni()" class="field" data-testid="sd-blocco-giorni">
          <label class="sd-check">
            <input type="checkbox" formControlName="usaGiorni" data-testid="sd-usa-giorni" />
            Avvio anticipato rispetto ai tre mesi
          </label>
          <ng-container *ngIf="form.get('usaGiorni')?.value">
            <label for="sd-giorni">Soglia in giorni (da 1 a 92)</label>
            <p-inputNumber
              formControlName="giorniMax"
              inputId="sd-giorni"
              [useGrouping]="false"
              [min]="1"
              [max]="92"
              [styleClass]="inv('giorniMax') ? 'w-full p-invalid' : 'w-full'"
              [attr.aria-invalid]="inv('giorniMax') ? true : null"
              [attr.aria-describedby]="inv('giorniMax') ? 'sd-giorni-err' : null"
            ></p-inputNumber>
            <small
              *ngIf="inv('giorniMax') as m"
              id="sd-giorni-err"
              class="field-error"
              role="alert"
              data-testid="sd-err-giorniMax"
              >{{ m }}</small
            >
          </ng-container>
        </div>

        <ng-container *ngIf="mostraKg()">
          <div class="field" data-testid="sd-blocco-kg">
            <label for="sd-kg-totale"
              >Quanti kg corrispondono, per i vostri rifiuti, a 30 m³?</label
            >
            <p-inputNumber
              formControlName="kgMaxTotale"
              inputId="sd-kg-totale"
              mode="decimal"
              locale="it-IT"
              [minFractionDigits]="0"
              [maxFractionDigits]="2"
              [min]="0.01"
              [max]="10000000"
              [styleClass]="inv('kgMaxTotale') ? 'w-full p-invalid' : 'w-full'"
              [attr.aria-invalid]="inv('kgMaxTotale') ? true : null"
              [attr.aria-describedby]="inv('kgMaxTotale') ? 'sd-kg-totale-err' : null"
            ></p-inputNumber>
            <small
              *ngIf="inv('kgMaxTotale') as m"
              id="sd-kg-totale-err"
              class="field-error"
              role="alert"
              data-testid="sd-err-kgMaxTotale"
              >{{ m }}</small
            >
          </div>
          <div class="field">
            <label for="sd-kg-pericolosi"
              >Quanti kg corrispondono, per i vostri rifiuti, a 10 m³ di rifiuti pericolosi?</label
            >
            <p-inputNumber
              formControlName="kgMaxPericolosi"
              inputId="sd-kg-pericolosi"
              mode="decimal"
              locale="it-IT"
              [minFractionDigits]="0"
              [maxFractionDigits]="2"
              [min]="0.01"
              [max]="10000000"
              [styleClass]="inv('kgMaxPericolosi') ? 'w-full p-invalid' : 'w-full'"
              [attr.aria-invalid]="inv('kgMaxPericolosi') ? true : null"
              [attr.aria-describedby]="inv('kgMaxPericolosi') ? 'sd-kg-pericolosi-err' : null"
            ></p-inputNumber>
            <small
              *ngIf="inv('kgMaxPericolosi') as m"
              id="sd-kg-pericolosi-err"
              class="field-error"
              role="alert"
              data-testid="sd-err-kgMaxPericolosi"
              >{{ m }}</small
            >
          </div>
        </ng-container>

        <div class="grid">
          <div class="col-12 sm:col-6">
            <div class="field">
              <label for="sd-prev-giorni">Preavviso (giorni prima della scadenza)</label>
              <p-inputNumber
                formControlName="preavvisoGiorni"
                inputId="sd-prev-giorni"
                [useGrouping]="false"
                [min]="0"
                [max]="88"
                [styleClass]="inv('preavvisoGiorni') ? 'w-full p-invalid' : 'w-full'"
                [attr.aria-invalid]="inv('preavvisoGiorni') ? true : null"
                [attr.aria-describedby]="inv('preavvisoGiorni') ? 'sd-prev-giorni-err' : null"
              ></p-inputNumber>
              <small
                *ngIf="inv('preavvisoGiorni') as m"
                id="sd-prev-giorni-err"
                class="field-error"
                role="alert"
                data-testid="sd-err-preavvisoGiorni"
                >{{ m }}</small
              >
            </div>
          </div>
          <div class="col-12 sm:col-6">
            <div class="field">
              <label for="sd-prev-perc">Preavviso (% del limite, 0 = nessuno)</label>
              <p-inputNumber
                formControlName="preavvisoPercentuale"
                inputId="sd-prev-perc"
                [useGrouping]="false"
                [min]="0"
                [max]="99"
                [styleClass]="inv('preavvisoPercentuale') ? 'w-full p-invalid' : 'w-full'"
                [attr.aria-invalid]="inv('preavvisoPercentuale') ? true : null"
                [attr.aria-describedby]="inv('preavvisoPercentuale') ? 'sd-prev-perc-err' : null"
              ></p-inputNumber>
              <small
                *ngIf="inv('preavvisoPercentuale') as m"
                id="sd-prev-perc-err"
                class="field-error"
                role="alert"
                data-testid="sd-err-preavvisoPercentuale"
                >{{ m }}</small
              >
            </div>
          </div>
        </div>

        <div class="field">
          <label for="sd-note">Note</label>
          <textarea
            id="sd-note"
            pInputTextarea
            formControlName="note"
            rows="2"
            maxlength="500"
            class="w-full"
            [attr.aria-invalid]="inv('note') ? true : null"
            [attr.aria-describedby]="inv('note') ? 'sd-note-err' : null"
          ></textarea>
          <small
            *ngIf="inv('note') as m"
            id="sd-note-err"
            class="field-error"
            role="alert"
            data-testid="sd-err-note"
            >{{ m }}</small
          >
        </div>

        <div
          *ngIf="erroriNascosti().length"
          class="sd-errori"
          role="alert"
          data-testid="sd-errori-nascosti"
        >
          <p *ngFor="let m of erroriNascosti()">{{ m }}</p>
        </div>

        <div *ngIf="erroriBackend().length" class="sd-errori" role="alert" data-testid="sd-backend">
          <p *ngFor="let m of erroriBackend()">{{ m }}</p>
        </div>

        <div class="sd-azioni">
          <p-button
            *ngIf="haRiga()"
            [label]="
              livello === '' ? 'Torna ai valori predefiniti' : 'Usa le soglie dell\\'azienda'
            "
            icon="pi pi-undo"
            severity="secondary"
            [outlined]="true"
            [disabled]="salvataggio()"
            (onClick)="ripristina()"
            data-testid="sd-ripristina"
          ></p-button>
          <span class="sd-spazio"></span>
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="visibleChange.emit(false)"
            data-testid="sd-annulla"
          ></p-button>
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="salvataggio()"
            (onClick)="salva()"
            data-testid="sd-salva"
            ariaLabel="Salva le soglie"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [
    `
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .field > label,
      .sd-etichetta {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .sd-check {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
      }
      .sd-spiegazioni {
        margin: 0;
        padding-left: var(--spacing-base);
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .sd-attiva {
        color: var(--text-primary);
      }
      .sd-errori {
        margin-bottom: var(--spacing-base);
        padding: var(--spacing-md) var(--spacing-base);
        border: 1px solid var(--color-danger);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }
      .sd-errori p {
        margin: 0;
      }
      .sd-azioni {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }
      .sd-spazio {
        flex: 1;
      }
    `,
  ],
})
export class SoglieDepositoDialogComponent implements OnChanges, OnDestroy {
  private readonly fb = inject(FormBuilder)
  private readonly service = inject(GiacenzeService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Input() configurazione: ConfigurazioneSoglie | null = null
  /** Sede preselezionata all'apertura; null/'' = tutta l'azienda. */
  @Input() registroIniziale: string | null = null
  /** Emesso dopo un salvataggio o un ripristino riusciti: la pagina ricarica. */
  @Output() salvato = new EventEmitter<void>()

  readonly criteri = CRITERI
  readonly salvataggio = signal(false)
  readonly erroriBackend = signal<string[]>([])
  private readonly tentato = signal(false)
  private operazione?: Subscription

  readonly form: FormGroup = this.fb.group({
    livello: [LIVELLO_AZIENDA],
    criterio: ['NON_SCELTO' as CriterioDeposito],
    usaGiorni: [false],
    giorniMax: [null as number | null],
    kgMaxTotale: [null as number | null],
    kgMaxPericolosi: [null as number | null],
    preavvisoGiorni: [15 as number | null],
    preavvisoPercentuale: [80 as number | null],
    note: [''],
  })

  get livello(): string {
    return this.form.get('livello')?.value ?? LIVELLO_AZIENDA
  }
  get criterio(): CriterioDeposito {
    return this.form.get('criterio')?.value
  }

  opzioniLivello(): { label: string; value: string }[] {
    return [
      { label: "Tutta l'azienda", value: LIVELLO_AZIENDA },
      ...(this.configurazione?.registri ?? []).map(r => ({
        label: r.registroDescrizione + (r.attivo ? '' : ' (disattivato)'),
        value: r.registroId,
      })),
    ]
  }

  mostraGiorni(): boolean {
    return this.criterio !== 'QUANTITATIVO'
  }
  mostraKg(): boolean {
    return this.criterio !== 'TEMPORALE'
  }

  /** Riga salvata al livello scelto (quindi ripristinabile). */
  haRiga(): boolean {
    const c = this.configurazione
    if (!c) return false
    if (this.livello === LIVELLO_AZIENDA) return !!c.azienda
    return !!c.registri.find(r => r.registroId === this.livello)?.soglie
  }

  testoLivello(): string {
    if (this.haRiga()) return 'Per questo livello ci sono soglie salvate.'
    return this.livello === LIVELLO_AZIENDA
      ? 'Nessuna soglia salvata: valgono i valori predefiniti.'
      : "Questa sede usa le soglie dell'azienda (o i valori predefiniti)."
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.tentato.set(false)
      this.erroriBackend.set([])
      this.salvataggio.set(false)
      const iniziale = this.registroIniziale || LIVELLO_AZIENDA
      this.form.get('livello')?.setValue(iniziale, { emitEvent: false })
      this.carica(iniziale)
      // Focus sul primo campo a dialog aperto.
      setTimeout(() => document.getElementById('sd-livello')?.focus(), 50)
    }
  }

  ngOnDestroy(): void {
    this.operazione?.unsubscribe()
  }

  cambiaLivello(valore: string): void {
    this.tentato.set(false)
    this.erroriBackend.set([])
    this.carica(valore ?? LIVELLO_AZIENDA)
  }

  /** Precompila dal livello: riga propria, altrimenti quella dell'azienda, altrimenti predefinite. */
  private carica(livello: string): void {
    const c = this.configurazione
    let s: (SoglieDeposito & { note?: string | null }) | null = null
    if (c) {
      s =
        (livello === LIVELLO_AZIENDA
          ? null
          : (c.registri.find(r => r.registroId === livello)?.soglie ?? null)) ??
        c.azienda ??
        c.predefinite
    }
    if (!s) return
    this.form.patchValue({
      livello,
      criterio: s.criterio,
      usaGiorni: s.giorniMax !== null,
      giorniMax: s.giorniMax,
      kgMaxTotale: s.kgMaxTotale,
      kgMaxPericolosi: s.kgMaxPericolosi,
      preavvisoGiorni: s.preavvisoGiorni,
      preavvisoPercentuale: s.preavvisoPercentuale,
      note: s.note ?? '',
    })
  }

  private valori(): ValoriFormSoglie {
    return this.form.getRawValue() as ValoriFormSoglie
  }

  /** Messaggio d'errore del campo, solo dopo un tentativo di salvataggio. */
  inv(campo: CampoSoglie): string | null {
    return this.tentato() ? (validaFormSoglie(this.valori())[campo] ?? null) : null
  }

  /** Errori di campi non visibili con il criterio scelto: altrimenti il blocco sarebbe muto. */
  erroriNascosti(): string[] {
    if (!this.tentato()) return []
    const e = validaFormSoglie(this.valori())
    const nascosti: string[] = []
    if (!this.mostraKg()) {
      if (e.kgMaxTotale) nascosti.push(e.kgMaxTotale)
      if (e.kgMaxPericolosi) nascosti.push(e.kgMaxPericolosi)
    }
    return nascosti
  }

  salva(): void {
    this.tentato.set(true)
    this.erroriBackend.set([])
    const v = this.valori()
    if (Object.keys(validaFormSoglie(v)).length > 0) {
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }
    const dati: DatiSoglie = {
      criterio: v.criterio,
      giorniMax: giorniEffettivi(v),
      kgMaxTotale: Number(v.kgMaxTotale),
      kgMaxPericolosi: Number(v.kgMaxPericolosi),
      preavvisoGiorni: Number(v.preavvisoGiorni),
      preavvisoPercentuale: Number(v.preavvisoPercentuale),
      note: v.note?.trim() ? v.note.trim() : null,
    }
    this.salvataggio.set(true)
    this.operazione?.unsubscribe()
    this.operazione = this.service.impostaSoglie(this.idRegistro(), dati).subscribe({
      next: () => this.concluso('Soglie salvate.'),
      error: err => this.fallita(err),
    })
  }

  ripristina(): void {
    this.erroriBackend.set([])
    this.salvataggio.set(true)
    this.operazione?.unsubscribe()
    this.operazione = this.service.eliminaSoglie(this.idRegistro()).subscribe({
      next: () =>
        this.concluso(
          this.livello === LIVELLO_AZIENDA
            ? 'Soglie riportate ai valori predefiniti.'
            : "La sede usa ora le soglie dell'azienda."
        ),
      error: err => this.fallita(err),
    })
  }

  private idRegistro(): string | null {
    return this.livello === LIVELLO_AZIENDA ? null : this.livello
  }

  private concluso(messaggio: string): void {
    this.salvataggio.set(false)
    this.toast.success(messaggio)
    this.visibleChange.emit(false)
    this.salvato.emit()
  }

  private fallita(err: any): void {
    this.salvataggio.set(false)
    this.erroriBackend.set(messaggiErroreSoglie(err))
  }
}
