import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  DoCheck,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core'
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
import { leggiIntero, leggiNumero } from './numero-modificabile'
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
/** Numero intero dal testo; vuoto o errato diventa 0, che il controllo rifiuta come data. */
const intero = (t: string): number => leggiIntero(t).valore ?? 0

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
            [attr.aria-invalid]="invalido(s, 'giorno') ? 'true' : null"
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
            [attr.aria-invalid]="invalido(s, 'mese') ? 'true' : null"
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
            [attr.aria-invalid]="invalido(s, 'anno') ? 'true' : null"
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

        <ul
          class="errori-numeri"
          *ngIf="erroriNumeri().length > 0"
          aria-live="polite"
          data-testid="scadenze-errori-numeri"
        >
          <li *ngFor="let m of erroriNumeri()" class="field-error">{{ m }}</li>
        </ul>
        <ul class="avvisi" *ngIf="avvisi().length > 0" data-testid="scadenze-avvisi">
          <li *ngFor="let m of avvisi()" class="field-hint">{{ m }}</li>
        </ul>
        <span class="solo-lettori" aria-live="polite" data-testid="scadenze-annuncio">{{
          annuncio
        }}</span>
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
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .errori-numeri,
      .avvisi {
        margin: 0;
        padding-left: 1.1rem;
      }
    `,
  ],
})
export class RigaScadenzeSezioneComponent implements OnInit, DoCheck, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
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

  annuncio = ''
  private chiaveAvvisi = ''
  private timer: ReturnType<typeof setTimeout> | undefined

  ngOnDestroy(): void {
    clearTimeout(this.timer)
  }

  ngOnInit(): void {
    this.stato.registraBloccante('scadenze', () => (this.attiva() ? this.erroriNumeri() : []))
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
    const chiave = this.avvisi().join(' ')
    if (chiave !== this.chiaveAvvisi) {
      this.chiaveAvvisi = chiave
      clearTimeout(this.timer)
      this.timer = setTimeout(() => (this.annuncio = chiave), 800)
    }
  }

  /** Giorno, mese o anno scritti male (lettere, punti): non si salva. */
  erroriNumeri(): string[] {
    const m: string[] = []
    this.righe.forEach((s, i) => {
      for (const c of ['giorno', 'mese', 'anno'] as const) {
        const e = leggiIntero(s[c]).errore
        if (e) m.push(`Scadenza ${i + 1}, ${c}: ${e}`)
      }
    })
    return m
  }

  invalido(s: ScadenzaTesto, c: keyof ScadenzaTesto): boolean {
    return leggiIntero(s[c]).errore !== null
  }

  private focalizza(id: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`)?.focus())
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

  /**
   * Le scadenze fino all'ultima compilata, con il numero che hanno sullo schermo (una riga vuota
   * in mezzo parte come data non valida e il backend la segnala con quel numero).
   */
  private valore(): Scadenza[] {
    let fine = 0
    this.righe.forEach((s, i) => {
      if (!eVuota(s)) fine = i + 1
    })
    return this.righe.slice(0, fine).map((s, i) => ({
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
    if (this.righe.length >= this.massimo) return
    this.righe = [...this.righe, vuota()]
    this.focalizza(`riga-scadenza-${this.righe.length}-giorno`)
  }

  togli(i: number): void {
    this.righe = this.righe.filter((_, k) => k !== i)
    if (this.righe.length === 0) this.righe = [vuota()]
    this.emetti()
    this.focalizza(`riga-scadenza-${Math.min(i + 1, this.righe.length)}-giorno`)
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
    if (this.erroriNumeri().length > 0) return ''
    const sc: Scadenza = {
      ordine: i + 1,
      giorno: intero(s.giorno),
      mese: intero(s.mese),
      anno: s.anno.trim() === '' ? null : intero(s.anno),
    }
    if (sc.mese < 1 || sc.mese > 12 || sc.giorno < 1) return ''
    const anno = sc.anno ?? new Date().getFullYear()
    const p = periodoCompetenza(sc, periodo, anno)
    return p ? `Competenza ${anno}: dal ${dataItaliana(p.dal)} al ${dataItaliana(p.al)}` : ''
  }

  /** Totale annuo della riga: stessa funzione della pagina, quindi stessa somma esatta. */
  totale(): string {
    const v = this.stato.form.getRawValue()
    const numero = (t: string): string | null => leggiNumero(t).valore
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
    // Senza scadenze nessun avviso: il backend risponde al salvataggio. Il periodo extra
    // mancante, invece, si segnala appena c'è una data.
    return v.length === 0 ? [] : errori
  }
}
