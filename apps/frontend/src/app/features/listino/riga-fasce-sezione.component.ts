import { CommonModule } from '@angular/common'
import { Component, DoCheck, Input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { MAX_FASCE, descrizioneFascia, tipiAmmessi, validaFasce } from './fasce-scadenze-regole'
import { Scaglione, TipoCalcoloScaglione } from './listino.model'
import { RigaCampoComponent } from './riga-campo.component'
import { RigaForm } from './riga-modulo'
import { ETICHETTE_TIPO_CALCOLO, OPZIONI_APPLICA_A } from './vocabolario-listino'

/** Una fascia come si scrive nel dialog: testo libero, virgola decimale. */
interface FasciaTesto {
  finoA: string
  prezzo: string
  sconto: string
  provvigione: string
  tipoCalcolo: TipoCalcoloScaglione
}

const vuota = (): FasciaTesto => ({
  finoA: '',
  prezzo: '',
  sconto: '',
  provvigione: '',
  tipoCalcolo: 'A',
})
const eVuota = (f: FasciaTesto): boolean =>
  f.finoA.trim() === '' &&
  f.prezzo.trim() === '' &&
  f.sconto.trim() === '' &&
  f.provvigione.trim() === ''

/** `0.080000` -> `0,08`: senza migliaia, così quel che si legge si riscrive uguale. */
const inInput = (v: string | null): string => {
  if (v === null) return ''
  const t = /^\d+\.\d+$/.test(v) ? v.replace(/0+$/, '').replace(/\.$/, '') : v
  return t.replace(/\./g, ',')
}
/** Virgola → punto e spazi tolti: il backend valida, qui non si arrotonda. */
const daInput = (t: string): string => t.replace(/\s+/g, '').replace(/,/g, '.')
const opzionale = (t: string): string | null => (daInput(t) === '' ? null : daInput(t))

/**
 * Sezione "Prezzo speciale" del dialog della riga (4.2b, Task 28): a cosa si applica, condizioni
 * riferite, data di riferimento e tabella delle fasce (da 1 a 6 più la fascia «oltre», la 7).
 * Compare solo con la spunta "Prezzo speciale" e per le famiglie che la ammettono. Il valore
 * vive nei controlli di `RigaForm` (`scaglioni`, `applicaA`, …); le righe vuote non partono.
 * Il riscontro immediato (`validaFasce`) è una copia di quello del backend: non blocca il
 * salvataggio, il backend resta l'arbitro e i suoi errori compaiono sotto la tabella.
 */
@Component({
  selector: 'app-riga-fasce-sezione',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, InputTextModule, RigaCampoComponent],
  template: `
    <fieldset class="gruppo" *ngIf="attiva()" data-testid="riga-sezione-fasce">
      <legend>Prezzo speciale</legend>
      <div [formGroup]="stato.form" class="riga">
        <app-riga-campo
          campoId="riga-applica-a"
          etichetta="Si applica a"
          campo="applicaA"
          [errori]="stato.erroriDi('applicaA')"
        >
          <select
            id="riga-applica-a"
            formControlName="applicaA"
            class="p-inputtext"
            data-testid="riga-applica-a"
          >
            <option value="">—</option>
            <option *ngFor="let o of applicaA" [value]="o.value">{{ o.label }}</option>
          </select>
        </app-riga-campo>
        <app-riga-campo
          campoId="riga-condizioni-riferite"
          etichetta="Condizioni riferite"
          campo="condizioniRiferite"
          [errori]="stato.erroriDi('condizioniRiferite')"
        >
          <input
            pInputText
            id="riga-condizioni-riferite"
            formControlName="condizioniRiferite"
            placeholder="es. 12C"
            maxlength="10"
            data-testid="riga-condizioni-riferite"
          />
        </app-riga-campo>
        <ng-container *ngIf="chiedeData()">
          <app-riga-campo
            campoId="riga-riferimento-giorno"
            etichetta="Giorno di riferimento"
            campo="riferimentoGiorno"
            [errori]="stato.erroriDi('riferimentoGiorno')"
          >
            <input
              pInputText
              id="riga-riferimento-giorno"
              formControlName="riferimentoGiorno"
              inputmode="numeric"
              maxlength="2"
              data-testid="riga-riferimento-giorno"
            />
          </app-riga-campo>
          <app-riga-campo
            campoId="riga-riferimento-mese"
            etichetta="Mese di riferimento"
            campo="riferimentoMese"
            [errori]="stato.erroriDi('riferimentoMese')"
          >
            <input
              pInputText
              id="riga-riferimento-mese"
              formControlName="riferimentoMese"
              inputmode="numeric"
              maxlength="2"
              data-testid="riga-riferimento-mese"
            />
          </app-riga-campo>
        </ng-container>
      </div>

      <div class="fasce" role="group" aria-labelledby="riga-fasce-titolo">
        <span class="etichetta" id="riga-fasce-titolo"
          >Fasce (al massimo {{ massimo }}, l'ultima è «oltre»)</span
        >
        <div class="fascia fascia--testata" aria-hidden="true">
          <span>N.</span><span>Fino a</span><span>Prezzo</span><span>Sconto</span
          ><span>Provvigione</span><span>Tipo di calcolo</span><span></span>
        </div>
        <div
          class="fascia-blocco"
          *ngFor="let f of righe; let i = index"
          [attr.data-testid]="'fascia-' + (i + 1)"
        >
          <div class="fascia">
            <span class="numero">{{ i + 1 }}</span>
            <input
              pInputText
              [id]="'riga-fascia-' + (i + 1) + '-fino'"
              [attr.aria-label]="'Fascia ' + (i + 1) + ', fino a'"
              [value]="f.finoA"
              [disabled]="soloLettura"
              inputmode="decimal"
              (input)="cambia(f, 'finoA', $any($event.target).value)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-fino'"
            />
            <input
              pInputText
              [id]="'riga-fascia-' + (i + 1) + '-prezzo'"
              [attr.aria-label]="'Fascia ' + (i + 1) + ', prezzo'"
              [value]="f.prezzo"
              [disabled]="soloLettura"
              inputmode="decimal"
              (input)="cambia(f, 'prezzo', $any($event.target).value)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-prezzo'"
            />
            <input
              pInputText
              [id]="'riga-fascia-' + (i + 1) + '-sconto'"
              [attr.aria-label]="'Fascia ' + (i + 1) + ', sconto'"
              [value]="f.sconto"
              [disabled]="soloLettura"
              placeholder="10+5"
              (input)="cambia(f, 'sconto', $any($event.target).value)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-sconto'"
            />
            <input
              pInputText
              [id]="'riga-fascia-' + (i + 1) + '-provvigione'"
              [attr.aria-label]="'Fascia ' + (i + 1) + ', provvigione'"
              [value]="f.provvigione"
              [disabled]="soloLettura"
              placeholder="10+5"
              (input)="cambia(f, 'provvigione', $any($event.target).value)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-provvigione'"
            />
            <select
              class="p-inputtext"
              [id]="'riga-fascia-' + (i + 1) + '-tipo'"
              [attr.aria-label]="'Fascia ' + (i + 1) + ', tipo di calcolo'"
              [disabled]="soloLettura"
              (change)="cambia(f, 'tipoCalcolo', $any($event.target).value)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-tipo'"
            >
              <option
                *ngFor="let t of tipi(i + 1, f.tipoCalcolo)"
                [value]="t"
                [selected]="t === f.tipoCalcolo"
              >
                {{ etichette[t] }}
              </option>
            </select>
            <button
              type="button"
              class="togli"
              *ngIf="!soloLettura"
              [attr.aria-label]="'Togli la fascia ' + (i + 1)"
              (click)="togli(i)"
              [attr.data-testid]="'fascia-' + (i + 1) + '-togli'"
            >
              ×
            </button>
          </div>
          <small class="field-hint" [attr.data-testid]="'fascia-' + (i + 1) + '-descrizione'">{{
            descrizione(i)
          }}</small>
        </div>

        <div class="fascia-blocco" data-testid="fascia-oltre">
          <div class="fascia">
            <span class="numero">oltre</span>
            <span class="senza-soglia">—</span>
            <input
              pInputText
              id="riga-fascia-oltre-prezzo"
              aria-label="Fascia oltre, prezzo"
              [value]="oltre.prezzo"
              [disabled]="soloLettura"
              inputmode="decimal"
              (input)="cambia(oltre, 'prezzo', $any($event.target).value)"
              data-testid="fascia-oltre-prezzo"
            />
            <input
              pInputText
              id="riga-fascia-oltre-sconto"
              aria-label="Fascia oltre, sconto"
              [value]="oltre.sconto"
              [disabled]="soloLettura"
              placeholder="10+5"
              (input)="cambia(oltre, 'sconto', $any($event.target).value)"
              data-testid="fascia-oltre-sconto"
            />
            <input
              pInputText
              id="riga-fascia-oltre-provvigione"
              aria-label="Fascia oltre, provvigione"
              [value]="oltre.provvigione"
              [disabled]="soloLettura"
              placeholder="10+5"
              (input)="cambia(oltre, 'provvigione', $any($event.target).value)"
              data-testid="fascia-oltre-provvigione"
            />
            <select
              class="p-inputtext"
              id="riga-fascia-oltre-tipo"
              aria-label="Fascia oltre, tipo di calcolo"
              [disabled]="soloLettura"
              (change)="cambia(oltre, 'tipoCalcolo', $any($event.target).value)"
              data-testid="fascia-oltre-tipo"
            >
              <option
                *ngFor="let t of tipi(7, oltre.tipoCalcolo)"
                [value]="t"
                [selected]="t === oltre.tipoCalcolo"
              >
                {{ etichette[t] }}
              </option>
            </select>
          </div>
          <small class="field-hint" data-testid="fascia-oltre-descrizione">{{
            descrizione(-1)
          }}</small>
        </div>

        <p-button
          *ngIf="!soloLettura"
          label="Aggiungi fascia"
          icon="pi pi-plus"
          [outlined]="true"
          size="small"
          [disabled]="righe.length >= massimo - 1"
          (onClick)="aggiungi()"
          data-testid="fasce-aggiungi"
        />

        <ul class="avvisi" *ngIf="avvisi().length > 0" data-testid="fasce-avvisi" role="status">
          <li *ngFor="let m of avvisi()" class="field-hint">{{ m }}</li>
        </ul>
        <small
          *ngFor="let e of stato.erroriDi('scaglioni')"
          role="alert"
          class="field-error"
          data-testid="riga-errore-scaglioni"
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
      .fasce {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
        overflow-x: auto;
      }
      .fascia {
        display: grid;
        grid-template-columns: 3rem 7rem 7rem 6rem 6rem minmax(14rem, 1fr) 2rem;
        gap: 0.4rem;
        align-items: center;
        min-width: 44rem;
      }
      .fascia--testata {
        font-weight: 600;
        font-size: 0.85rem;
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
      .avvisi {
        margin: 0;
        padding-left: 1.1rem;
      }
    `,
  ],
})
export class RigaFasceSezioneComponent implements DoCheck {
  @Input({ required: true }) stato!: RigaForm
  @Input() soloLettura = false

  readonly applicaA = OPZIONI_APPLICA_A
  readonly etichette = ETICHETTE_TIPO_CALCOLO
  readonly massimo = MAX_FASCE

  righe: FasciaTesto[] = [vuota()]
  oltre: FasciaTesto = vuota()
  /** L'ultimo valore scritto nel controllo: se cambia da fuori (riempi, azzera) si rilegge. */
  private emesso: Scaglione[] | null = null

  attiva(): boolean {
    return this.stato.abilitato('prezzoSpeciale') && this.stato.form.controls.prezzoSpeciale.value
  }

  chiedeData(): boolean {
    const a = this.stato.form.controls.applicaA.value
    return a === 'PROGRESSIVO_DA_DATA' || a === 'CONGUAGLIO_365'
  }

  ngDoCheck(): void {
    const valore = this.stato.form.controls.scaglioni.value
    if (valore !== this.emesso) this.leggi(valore)
  }

  private leggi(valore: Scaglione[]): void {
    const ordinate = [...valore].sort((a, b) => a.ordine - b.ordine)
    const testo = (s: Scaglione): FasciaTesto => ({
      finoA: inInput(s.finoA),
      prezzo: inInput(s.prezzo),
      sconto: inInput(s.sconto),
      provvigione: inInput(s.provvigione),
      tipoCalcolo: s.tipoCalcolo,
    })
    this.righe = ordinate.filter(s => s.ordine < 7).map(testo)
    if (this.righe.length === 0) this.righe = [vuota()]
    const o = ordinate.find(s => s.ordine === 7)
    this.oltre = o ? testo(o) : vuota()
    this.emesso = valore
  }

  private comeScaglione(f: FasciaTesto, ordine: number): Scaglione {
    return {
      ordine,
      finoA: ordine === 7 ? null : opzionale(f.finoA),
      prezzo: daInput(f.prezzo),
      sconto: opzionale(f.sconto),
      provvigione: opzionale(f.provvigione),
      tipoCalcolo: f.tipoCalcolo,
    }
  }

  /** Le fasce piene, rinumerate di seguito, più «oltre» se ha qualcosa. */
  private valore(): Scaglione[] {
    const fuori = this.righe.filter(f => !eVuota(f)).map((f, i) => this.comeScaglione(f, i + 1))
    if (!eVuota(this.oltre)) fuori.push(this.comeScaglione(this.oltre, 7))
    return fuori
  }

  private emetti(): void {
    const v = this.valore()
    this.emesso = v
    this.stato.form.controls.scaglioni.setValue(v)
  }

  cambia(f: FasciaTesto, campo: keyof FasciaTesto, testo: string): void {
    if (campo === 'tipoCalcolo') f.tipoCalcolo = testo as TipoCalcoloScaglione
    else f[campo] = testo
    this.emetti()
  }

  aggiungi(): void {
    if (this.righe.length >= this.massimo - 1) return
    this.righe = [...this.righe, vuota()]
  }

  togli(i: number): void {
    this.righe = this.righe.filter((_, k) => k !== i)
    if (this.righe.length === 0) this.righe = [vuota()]
    this.emetti()
  }

  /** Tipi scelti per la posizione; quello attuale resta in lista anche se non più ammesso. */
  tipi(ordine: number, attuale: TipoCalcoloScaglione): TipoCalcoloScaglione[] {
    const t = tipiAmmessi(ordine, this.conCondizioni())
    return t.includes(attuale) ? t : [...t, attuale]
  }

  private conCondizioni(): boolean {
    return this.stato.form.controls.condizioniRiferite.value.trim() !== ''
  }

  /** Descrizione dinamica (`vedilist1`, R50) della fascia `i`; `-1` = «oltre». */
  descrizione(i: number): string {
    const f = i < 0 ? this.oltre : this.righe[i]
    if (eVuota(f)) return ''
    const emesse = this.valore()
    const ordine = i < 0 ? 7 : this.righe.slice(0, i).filter(r => !eVuota(r)).length + 1
    const indice = emesse.findIndex(s => s.ordine === ordine)
    return indice < 0
      ? ''
      : descrizioneFascia(emesse, indice, this.stato.form.controls.unitaMisura.value)
  }

  avvisi(): string[] {
    if (this.soloLettura) return []
    const v = this.valore()
    // Tabella ancora intatta: nessun avviso, il backend risponde al salvataggio.
    return v.length === 0 ? [] : validaFasce(v, this.conCondizioni())
  }
}
