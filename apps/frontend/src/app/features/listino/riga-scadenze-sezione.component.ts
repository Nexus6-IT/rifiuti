import { CommonModule } from '@angular/common'
import { Component, DestroyRef, DoCheck, Input, OnInit, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import {
  FREQUENZE_CALENDARIO,
  FrequenzaCalendario,
  MAX_SCADENZE,
  calendarioAutomatico,
  dataItaliana,
  periodoCompetenza,
  validaScadenze,
} from './fasce-scadenze-regole'
import { importoItaliano, totaleFissiAnnuo } from './listino-calcoli'
import { PeriodoScadenze, Scadenza } from './listino.model'
import { RigaCampoComponent } from './riga-campo.component'
import { RigaForm } from './riga-modulo'
import { OPZIONI_PERIODO_SCADENZE, PERIODI_EXTRA } from './vocabolario-listino'

/** Una scadenza come si scrive nel dialog: giorno, mese e anno (vuoto = ogni anno). */
interface ScadenzaTesto {
  giorno: string
  mese: string
  anno: string
}

const vuota = (): ScadenzaTesto => ({ giorno: '', mese: '', anno: '' })
const eVuota = (s: ScadenzaTesto): boolean =>
  s.giorno.trim() === '' && s.mese.trim() === '' && s.anno.trim() === ''
/** Numero intero dal testo; un testo che non lo è diventa 0, che il controllo rifiuta come data. */
const intero = (t: string): number => {
  const n = Number.parseInt(t.trim(), 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Sezione "Scadenze" delle righe fisse (4.2b, Task 28): fino a 12 date giorno/mese/anno (anno
 * vuoto = ogni anno), periodo di riferimento con il periodo extra per `XA`/`XD`/`YC`, "Calendario
 * automatico" dalla prima data (copia di `calendarioAutomatico`, il backend rivalida) e totale
 * annuo dei fissi (`totaleFissiAnnuo`: somma esatta, un solo arrotondamento). Il valore vive nei
 * controlli di `RigaForm`; le righe vuote non partono.
 */
@Component({
  selector: 'app-riga-scadenze-sezione',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, InputTextModule, RigaCampoComponent],
  template: `
    <fieldset class="gruppo" *ngIf="attiva()" data-testid="riga-sezione-scadenze">
      <legend>Scadenze</legend>
      <div [formGroup]="stato.form" class="riga">
        <app-riga-campo
          campoId="riga-periodo-scadenze"
          etichetta="Periodo delle scadenze"
          campo="periodoScadenze"
          [errori]="stato.erroriDi('periodoScadenze')"
        >
          <select
            id="riga-periodo-scadenze"
            formControlName="periodoScadenze"
            class="p-inputtext"
            data-testid="riga-periodo-scadenze"
          >
            <option value="">—</option>
            <option *ngFor="let o of periodi" [value]="o.value">{{ o.label }}</option>
          </select>
        </app-riga-campo>
        <ng-container *ngIf="eExtra()">
          <app-riga-campo
            campoId="riga-periodo-extra-dal"
            etichetta="Periodo extra dal"
            campo="periodoExtraDal"
            [errori]="stato.erroriDi('periodoExtraDal')"
          >
            <input
              pInputText
              type="date"
              id="riga-periodo-extra-dal"
              formControlName="periodoExtraDal"
              data-testid="riga-periodo-extra-dal"
            />
          </app-riga-campo>
          <app-riga-campo
            campoId="riga-periodo-extra-al"
            etichetta="Periodo extra al"
            campo="periodoExtraAl"
            [errori]="stato.erroriDi('periodoExtraAl')"
          >
            <input
              pInputText
              type="date"
              id="riga-periodo-extra-al"
              formControlName="periodoExtraAl"
              data-testid="riga-periodo-extra-al"
            />
          </app-riga-campo>
        </ng-container>
      </div>

      <div class="scadenze" role="group" aria-labelledby="riga-scadenze-titolo">
        <span class="etichetta" id="riga-scadenze-titolo"
          >Date (al massimo {{ massimo }}; anno vuoto = ogni anno)</span
        >
        <div
          class="scadenza"
          *ngFor="let s of righe; let i = index"
          [attr.data-testid]="'scadenza-' + (i + 1)"
        >
          <span class="numero">{{ i + 1 }}</span>
          <input
            pInputText
            [id]="'riga-scadenza-' + (i + 1) + '-giorno'"
            [attr.aria-label]="'Scadenza ' + (i + 1) + ', giorno'"
            placeholder="gg"
            maxlength="2"
            inputmode="numeric"
            [value]="s.giorno"
            [disabled]="soloLettura"
            (input)="cambia(s, 'giorno', $any($event.target).value)"
            [attr.data-testid]="'scadenza-' + (i + 1) + '-giorno'"
          />
          <input
            pInputText
            [id]="'riga-scadenza-' + (i + 1) + '-mese'"
            [attr.aria-label]="'Scadenza ' + (i + 1) + ', mese'"
            placeholder="mm"
            maxlength="2"
            inputmode="numeric"
            [value]="s.mese"
            [disabled]="soloLettura"
            (input)="cambia(s, 'mese', $any($event.target).value)"
            [attr.data-testid]="'scadenza-' + (i + 1) + '-mese'"
          />
          <input
            pInputText
            [id]="'riga-scadenza-' + (i + 1) + '-anno'"
            [attr.aria-label]="'Scadenza ' + (i + 1) + ', anno (vuoto: ogni anno)'"
            placeholder="aaaa"
            maxlength="4"
            inputmode="numeric"
            [value]="s.anno"
            [disabled]="soloLettura"
            (input)="cambia(s, 'anno', $any($event.target).value)"
            [attr.data-testid]="'scadenza-' + (i + 1) + '-anno'"
          />
          <button
            type="button"
            class="togli"
            *ngIf="!soloLettura"
            [attr.aria-label]="'Togli la scadenza ' + (i + 1)"
            (click)="togli(i)"
            [attr.data-testid]="'scadenza-' + (i + 1) + '-togli'"
          >
            ×
          </button>
          <small
            class="field-hint competenza"
            [attr.data-testid]="'scadenza-' + (i + 1) + '-periodo'"
            >{{ competenza(i) }}</small
          >
        </div>

        <div class="azioni" *ngIf="!soloLettura">
          <p-button
            label="Aggiungi scadenza"
            icon="pi pi-plus"
            [outlined]="true"
            size="small"
            [disabled]="righe.length >= massimo"
            (onClick)="aggiungi()"
            data-testid="scadenze-aggiungi"
          />
          <label class="frequenza" for="riga-calendario-frequenza">
            Frequenza
            <select
              id="riga-calendario-frequenza"
              class="p-inputtext"
              [value]="frequenza"
              (change)="frequenza = $any($event.target).value"
              data-testid="scadenze-frequenza"
            >
              <option
                *ngFor="let f of frequenze"
                [value]="f.value"
                [selected]="f.value === frequenza"
              >
                {{ f.label }}
              </option>
            </select>
          </label>
          <p-button
            label="Calendario automatico"
            icon="pi pi-calendar"
            [outlined]="true"
            size="small"
            (onClick)="calendario()"
            data-testid="scadenze-calendario"
          />
        </div>
        <small
          *ngIf="erroreCalendario() as e"
          role="alert"
          class="field-error"
          data-testid="scadenze-errore-calendario"
          >{{ e }}</small
        >

        <p class="totale" data-testid="scadenze-totale">
          Totale annuo dei fissi (scadenze di ogni anno):
          <strong data-testid="scadenze-totale-importo">{{ totale() }} €</strong>
        </p>

        <ul class="avvisi" *ngIf="avvisi().length > 0" data-testid="scadenze-avvisi" role="status">
          <li *ngFor="let m of avvisi()" class="field-hint">{{ m }}</li>
        </ul>
        <small
          *ngFor="let e of stato.erroriDi('scadenze')"
          role="alert"
          class="field-error"
          data-testid="riga-errore-scadenze"
          >{{ e }}</small
        >
      </div>
    </fieldset>
  `,
  styles: [
    `
      .gruppo {
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 6px;
        padding: 0.5rem 0.75rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
      }
      .riga {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .scadenze {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
      }
      .scadenza {
        display: grid;
        grid-template-columns: 2rem 4rem 4rem 5.5rem 2rem 1fr;
        gap: 0.4rem;
        align-items: center;
      }
      .numero {
        font-weight: 600;
      }
      .togli {
        background: transparent;
        border: 0;
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .frequenza {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
      }
      .totale {
        margin: 0;
      }
      .avvisi {
        margin: 0;
        padding-left: 1.1rem;
      }
    `,
  ],
})
export class RigaScadenzeSezioneComponent implements OnInit, DoCheck {
  @Input({ required: true }) stato!: RigaForm
  @Input() soloLettura = false

  readonly periodi = OPZIONI_PERIODO_SCADENZE
  readonly frequenze = FREQUENZE_CALENDARIO
  readonly massimo = MAX_SCADENZE
  frequenza: FrequenzaCalendario = 'MENSILE'
  readonly erroreCalendario = signal<string | null>(null)

  righe: ScadenzaTesto[] = [vuota()]
  private emesso: Scadenza[] | null = null

  private readonly distruzione = inject(DestroyRef)

  ngOnInit(): void {
    // Passando a un periodo ordinario il periodo extra non vale più: si svuota (il backend lo
    // rifiuta altrimenti).
    this.stato.form.controls.periodoScadenze.valueChanges
      .pipe(takeUntilDestroyed(this.distruzione))
      .subscribe(p => {
        if (!PERIODI_EXTRA.includes(p as PeriodoScadenze)) {
          this.stato.form.controls.periodoExtraDal.setValue('')
          this.stato.form.controls.periodoExtraAl.setValue('')
        }
      })
  }

  attiva(): boolean {
    return this.stato.abilitato('scadenze')
  }

  eExtra(): boolean {
    return PERIODI_EXTRA.includes(this.stato.form.controls.periodoScadenze.value as PeriodoScadenze)
  }

  ngDoCheck(): void {
    const valore = this.stato.form.controls.scadenze.value
    if (valore !== this.emesso) this.leggi(valore)
  }

  private leggi(valore: Scadenza[]): void {
    this.righe = [...valore]
      .sort((a, b) => a.ordine - b.ordine)
      .map(s => ({
        giorno: String(s.giorno),
        mese: String(s.mese),
        anno: s.anno === null ? '' : String(s.anno),
      }))
    if (this.righe.length === 0) this.righe = [vuota()]
    this.emesso = valore
  }

  private valore(): Scadenza[] {
    return this.righe
      .filter(s => !eVuota(s))
      .map((s, i) => ({
        ordine: i + 1,
        giorno: intero(s.giorno),
        mese: intero(s.mese),
        anno: s.anno.trim() === '' ? null : intero(s.anno),
      }))
  }

  private emetti(): void {
    const v = this.valore()
    this.emesso = v
    this.stato.form.controls.scadenze.setValue(v)
  }

  cambia(s: ScadenzaTesto, campo: keyof ScadenzaTesto, testo: string): void {
    s[campo] = testo
    this.erroreCalendario.set(null)
    this.emetti()
  }

  aggiungi(): void {
    if (this.righe.length < this.massimo) this.righe = [...this.righe, vuota()]
  }

  togli(i: number): void {
    this.righe = this.righe.filter((_, k) => k !== i)
    if (this.righe.length === 0) this.righe = [vuota()]
    this.emetti()
  }

  /** Dalla prima data riempie le altre secondo la frequenza (`calcaut`). */
  calendario(): void {
    const prima = this.righe[0]
    if (!prima || eVuota(prima)) {
      this.erroreCalendario.set('Indica la prima scadenza.')
      return
    }
    const esito = calendarioAutomatico(
      {
        giorno: intero(prima.giorno),
        mese: intero(prima.mese),
        anno: prima.anno.trim() === '' ? null : intero(prima.anno),
      },
      this.frequenza
    )
    if ('errore' in esito) {
      this.erroreCalendario.set(esito.errore)
      return
    }
    this.erroreCalendario.set(null)
    this.righe = esito.scadenze.map(s => ({
      giorno: String(s.giorno),
      mese: String(s.mese),
      anno: s.anno === null ? '' : String(s.anno),
    }))
    this.emetti()
  }

  /** Periodo cui si riferisce la scadenza; senza anno, quello corrente come esempio. */
  competenza(i: number): string {
    const periodo = this.stato.form.controls.periodoScadenze.value as PeriodoScadenze | ''
    const s = this.righe[i]
    if (periodo === '' || eVuota(s) || this.eExtra()) return ''
    const sc: Scadenza = {
      ordine: i + 1,
      giorno: intero(s.giorno),
      mese: intero(s.mese),
      anno: s.anno.trim() === '' ? null : intero(s.anno),
    }
    const anno = sc.anno ?? new Date().getFullYear()
    const p = periodoCompetenza(sc, periodo, anno)
    return p ? `Competenza ${anno}: dal ${dataItaliana(p.dal)} al ${dataItaliana(p.al)}` : ''
  }

  /** Totale annuo della riga: stessa funzione della pagina, quindi stessa somma esatta. */
  totale(): string {
    const v = this.stato.form.getRawValue()
    const numero = (t: string): string | null => {
      // "1.234,5" (formato di lettura) ha il punto delle migliaia: con la virgola si tolgono.
      const senza = t.replace(/\s+/g, '')
      const x = senza.includes(',') ? senza.replace(/\./g, '').replace(/,/g, '.') : senza
      return x === '' ? null : x
    }
    return importoItaliano(
      totaleFissiAnnuo([
        {
          tipo: this.stato.tipoEffettivo(),
          quantitaFissa: numero(v.quantitaFissa),
          prezzo: numero(v.prezzo),
          scadenze: this.valore(),
        },
      ])
    )
  }

  avvisi(): string[] {
    if (this.soloLettura) return []
    const v = this.valore()
    const f = this.stato.form.getRawValue()
    const extra = this.eExtra()
    const errori = validaScadenze(v, (f.periodoScadenze || null) as PeriodoScadenze | null, {
      dal: extra && f.periodoExtraDal ? f.periodoExtraDal : null,
      al: extra && f.periodoExtraAl ? f.periodoExtraAl : null,
    })
    // Periodo extra ancora da indicare: il suggerimento compare solo dopo il primo tentativo.
    return v.length === 0 ? [] : errori
  }
}
