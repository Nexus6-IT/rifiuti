/**
 * Campi di una pesata inserita a mano: peso, strumento (registrato o esterno), memoria alibi,
 * ora indicata dallo strumento, motivo, conferma di stabilita' e foto o PDF del display.
 *
 * Una pesata manuale NON ha garanzia metrologica: l'avviso resta sempre visibile. La chiave di
 * idempotenza nasce con il form (una per apertura del dialog) e non cambia ai tentativi
 * successivi: il doppio clic o un nuovo invio dopo un errore di rete non creano due pesate.
 * Il peso si scrive con la virgola (12,5): il punto e' rifiutato dalla direttiva `appPesoIt`.
 */
import { CommonModule } from '@angular/common'
import { Component, Input, signal } from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { InputNumberModule } from 'primeng/inputnumber'
import { giornoRoma, LIMITE_ALLEGATO_BYTE, oraLocaleInIso, preparaAllegato } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { PesoItalianoDirective } from './peso-it.directive'
import { DatiPesataManuale, StrumentoPesa } from './pese.service'

export const MASSIMO_PESO_KG = 99_999_999.99
export const ESTERNO = '__esterno'
export const AVVISO_PESATA_MANUALE = 'Pesata inserita a mano: nessuna garanzia metrologica.'

export interface PesataManualeRaccolta {
  pesata: DatiPesataManuale
  allegato: Blob | null
  nomeFile: string | undefined
}

@Component({
  selector: 'app-pesata-manuale-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputNumberModule, PesoItalianoDirective],
  template: `
    <p class="avviso-manuale" data-testid="pm-avviso">{{ avviso }}</p>
    <form [formGroup]="form" (submit)="$event.preventDefault()" novalidate data-testid="pm-form">
      <div class="field">
        <label [id]="id('peso-etichetta')" [for]="id('peso')"
          >{{ etichettaPeso }} <span class="req" aria-hidden="true">*</span></label
        >
        <p-inputNumber
          appPesoIt
          (rifiutato)="rifiutoPeso.set($event)"
          formControlName="pesoKg"
          [inputId]="id('peso')"
          mode="decimal"
          locale="it-IT"
          [minFractionDigits]="0"
          [maxFractionDigits]="2"
          [min]="0.01"
          [max]="massimo"
          [ariaLabelledBy]="id('peso-etichetta')"
          [pesoAiutoId]="id('peso-aiuto')"
          [pesoErroreId]="errorePeso() ? id('peso-errore') : null"
          styleClass="w-full"
        ></p-inputNumber>
        <small [id]="id('peso-aiuto')" class="field-hint"
          >Con la virgola per i decimali (al massimo due, esempio 12,5). Il punto separa solo le
          migliaia: 1.250 = milleduecentocinquanta.</small
        >
        <small
          *ngIf="errorePeso() as e"
          [id]="id('peso-errore')"
          class="field-error"
          role="alert"
          data-testid="pm-peso-errore"
          >{{ e }}</small
        >
      </div>

      <div class="griglia">
        <div class="field">
          <label [for]="id('strumento')"
            >Strumento di pesa <span class="req" aria-hidden="true">*</span></label
          >
          <select
            [id]="id('strumento')"
            class="p-inputtext w-full"
            formControlName="sorgente"
            aria-required="true"
            [attr.aria-invalid]="erroreSorgente() ? true : null"
            [attr.aria-describedby]="erroreSorgente() ? id('strumento-errore') : null"
            data-testid="pm-strumento"
          >
            <option value="">Scegliere…</option>
            <option *ngFor="let s of strumenti" [value]="s.id">
              {{ s.descrizione }}{{ s.matricola ? ' (' + s.matricola + ')' : '' }}
            </option>
            <option [value]="esterno">Strumento esterno (non in elenco)</option>
          </select>
          <small
            *ngIf="erroreSorgente() as e"
            [id]="id('strumento-errore')"
            class="field-error"
            role="alert"
            data-testid="pm-strumento-errore"
            >{{ e }}</small
          >
        </div>
        <div class="field" *ngIf="form.value.sorgente === esterno">
          <label [for]="id('esterno')"
            >Descrizione dello strumento esterno
            <span class="req" aria-hidden="true">*</span></label
          >
          <input
            [id]="id('esterno')"
            type="text"
            class="p-inputtext w-full"
            formControlName="esterno"
            maxlength="200"
            aria-required="true"
            [attr.aria-invalid]="erroreEsterno() ? true : null"
            [attr.aria-describedby]="erroreEsterno() ? id('esterno-errore') : null"
            data-testid="pm-esterno"
          />
          <small
            *ngIf="erroreEsterno() as e"
            [id]="id('esterno-errore')"
            class="field-error"
            role="alert"
            data-testid="pm-esterno-errore"
            >{{ e }}</small
          >
        </div>
        <div class="field">
          <label [for]="id('alibi')">Memoria alibi</label>
          <input
            [id]="id('alibi')"
            type="text"
            class="p-inputtext w-full"
            formControlName="alibiId"
            maxlength="40"
            [attr.aria-describedby]="id('alibi-aiuto')"
            data-testid="pm-alibi"
          />
          <small [id]="id('alibi-aiuto')" class="field-hint"
            >Il numero stampato dallo strumento: ogni numero si usa una volta sola.
            Facoltativa.</small
          >
        </div>
        <div class="field">
          <label [for]="id('data')">Giorno indicato dallo strumento</label>
          <input
            [id]="id('data')"
            type="date"
            class="p-inputtext w-full"
            formControlName="data"
            [attr.max]="oggi"
            data-testid="pm-data"
          />
        </div>
        <div class="field">
          <label [for]="id('ora')">Ora indicata dallo strumento</label>
          <input
            [id]="id('ora')"
            type="time"
            class="p-inputtext w-full"
            formControlName="ora"
            [attr.aria-describedby]="id('ora-aiuto')"
            data-testid="pm-ora"
          />
          <small [id]="id('ora-aiuto')" class="field-hint"
            >Ora italiana. Facoltativa: se manca vale l'ora di registrazione.</small
          >
        </div>
      </div>

      <div class="field">
        <label [for]="id('motivo')"
          >Perché la pesata è manuale <span class="req" aria-hidden="true">*</span></label
        >
        <textarea
          [id]="id('motivo')"
          class="p-inputtext w-full"
          rows="2"
          maxlength="500"
          formControlName="motivo"
          aria-required="true"
          [attr.aria-invalid]="erroreMotivo() ? true : null"
          [attr.aria-describedby]="erroreMotivo() ? id('motivo-errore') : null"
          data-testid="pm-motivo"
        ></textarea>
        <small
          *ngIf="erroreMotivo() as e"
          [id]="id('motivo-errore')"
          class="field-error"
          role="alert"
          data-testid="pm-motivo-errore"
          >{{ e }}</small
        >
      </div>

      <div class="field">
        <label class="spunta">
          <input
            type="checkbox"
            formControlName="stabile"
            [attr.aria-invalid]="erroreStabile() ? true : null"
            [attr.aria-describedby]="erroreStabile() ? id('stabile-errore') : null"
            data-testid="pm-stabile"
          />
          Confermo che il display indicava un peso stabile
          <span class="req" aria-hidden="true">*</span>
        </label>
        <small
          *ngIf="erroreStabile() as e"
          [id]="id('stabile-errore')"
          class="field-error"
          role="alert"
          data-testid="pm-stabile-errore"
          >{{ e }}</small
        >
      </div>

      <div class="field">
        <label [for]="id('allegato')">Foto del display o documento (PDF)</label>
        <input
          [id]="id('allegato')"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          (change)="alCambioAllegato($event)"
          [attr.aria-describedby]="
            id('allegato-aiuto') + (erroreAllegato() ? ' ' + id('allegato-errore') : '')
          "
          data-testid="pm-allegato"
        />
        <small [id]="id('allegato-aiuto')" class="field-hint"
          >Facoltativo ma consigliato: senza prova documentale la pesata resta segnalata. JPEG, PNG
          o PDF, al massimo 4 MB; le foto grandi vengono ridimensionate.</small
        >
        <span *ngIf="nomeAllegato() as n" class="nota" data-testid="pm-allegato-nome"
          >{{ n }}
          <button
            type="button"
            class="p-button p-button-text p-button-sm"
            (click)="rimuoviAllegato()"
          >
            Rimuovi
          </button>
        </span>
        <small
          *ngIf="erroreAllegato() as e"
          [id]="id('allegato-errore')"
          class="field-error"
          role="alert"
          data-testid="pm-allegato-errore"
          >{{ e }}</small
        >
      </div>
    </form>
  `,
  styles: [
    STILI_PESE,
    `
      .spunta {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
    `,
  ],
})
export class PesataManualeFormComponent {
  /** Strumenti attivi tra cui scegliere (il chiamante li filtra per registro). */
  @Input() strumenti: StrumentoPesa[] = []
  /** Prefisso degli id, per avere id unici se compaiono due form nella pagina. */
  @Input() idPrefisso = 'pm'
  @Input() etichettaPeso = 'Peso (kg)'

  /** Una per apertura del form: resta uguale ai tentativi successivi. */
  readonly chiaveIdempotenza = crypto.randomUUID()
  readonly avviso = AVVISO_PESATA_MANUALE
  readonly massimo = MASSIMO_PESO_KG
  readonly esterno = ESTERNO
  readonly oggi = giornoRoma()

  readonly tentato = signal(false)
  readonly rifiutoPeso = signal<string | null>(null)
  readonly erroreAllegato = signal<string | null>(null)
  readonly nomeAllegato = signal<string | null>(null)
  private allegato: { blob: Blob; nomeFile: string } | null = null

  readonly form = new FormGroup({
    pesoKg: new FormControl<number | null>(null),
    sorgente: new FormControl('', { nonNullable: true }),
    esterno: new FormControl('', { nonNullable: true }),
    alibiId: new FormControl('', { nonNullable: true }),
    data: new FormControl(giornoRoma(), { nonNullable: true }),
    ora: new FormControl('', { nonNullable: true }),
    motivo: new FormControl('', { nonNullable: true }),
    stabile: new FormControl(false, { nonNullable: true }),
  })

  id(nome: string): string {
    return `${this.idPrefisso}-${nome}`
  }

  errorePeso(): string | null {
    if (this.rifiutoPeso()) return this.rifiutoPeso()
    if (!this.tentato()) return null
    const v = this.form.controls.pesoKg.value
    if (v == null) return 'Il peso è obbligatorio.'
    if (v < 0.01) return 'Il peso deve essere positivo.'
    return null
  }
  erroreSorgente(): string | null {
    return this.tentato() && !this.form.value.sorgente
      ? 'Scegliere lo strumento o indicare uno strumento esterno.'
      : null
  }
  erroreEsterno(): string | null {
    return this.tentato() &&
      this.form.value.sorgente === ESTERNO &&
      !this.form.value.esterno?.trim()
      ? 'Indicare la descrizione dello strumento esterno.'
      : null
  }
  erroreMotivo(): string | null {
    return this.tentato() && !this.form.value.motivo?.trim() ? 'Il motivo è obbligatorio.' : null
  }
  erroreStabile(): string | null {
    return this.tentato() && !this.form.value.stabile
      ? 'Confermare che il display indicava un peso stabile.'
      : null
  }

  async alCambioAllegato(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement
    const file = input.files?.[0]
    this.erroreAllegato.set(null)
    if (!file) {
      this.rimuoviAllegato()
      return
    }
    try {
      this.allegato = await preparaAllegato(file)
      this.nomeAllegato.set(
        `${this.allegato.nomeFile} (${Math.max(1, Math.round(this.allegato.blob.size / 1024))} kB)`
      )
    } catch (e) {
      this.allegato = null
      this.nomeAllegato.set(null)
      input.value = ''
      this.erroreAllegato.set(
        e instanceof Error
          ? e.message
          : `Allegato non valido (massimo ${LIMITE_ALLEGATO_BYTE / 1048576} MB).`
      )
    }
  }

  rimuoviAllegato(): void {
    this.allegato = null
    this.nomeAllegato.set(null)
    this.erroreAllegato.set(null)
    const input = document.getElementById(this.id('allegato')) as HTMLInputElement | null
    if (input) input.value = ''
  }

  /**
   * Valida e restituisce i dati da inviare; null (con il primo campo sbagliato a fuoco) se
   * manca qualcosa. Non invia nulla: lo fa il dialog, che tiene la chiave di idempotenza.
   */
  raccogli(): PesataManualeRaccolta | null {
    this.tentato.set(true)
    const v = this.form.getRawValue()
    const primoErrore =
      this.rifiutoPeso() || this.errorePeso()
        ? 'peso'
        : this.erroreSorgente()
          ? 'strumento'
          : this.erroreEsterno()
            ? 'esterno'
            : this.erroreMotivo()
              ? 'motivo'
              : this.erroreStabile()
                ? 'stabile'
                : null
    if (primoErrore || v.pesoKg == null) {
      const target = document.getElementById(this.id(primoErrore ?? 'peso'))
      ;(target?.tagName === 'INPUT' ||
      target?.tagName === 'SELECT' ||
      target?.tagName === 'TEXTAREA'
        ? target
        : target?.querySelector('input')
      )?.focus()
      return null
    }
    const esterna = v.sorgente === ESTERNO
    let oraStrumento: string | null = null
    if (v.ora) {
      const [a, m, g] = (v.data || this.oggi).split('-').map(Number)
      oraStrumento = oraLocaleInIso(new Date(a, m - 1, g), v.ora)
    }
    return {
      pesata: {
        pesoKg: v.pesoKg,
        strumentoId: esterna ? null : v.sorgente,
        strumentoEsterno: esterna ? v.esterno.trim() : null,
        alibiId: v.alibiId.trim() || null,
        oraStrumento,
        motivo: v.motivo.trim(),
        stabileDichiarato: true,
      },
      allegato: this.allegato?.blob ?? null,
      nomeFile: this.allegato?.nomeFile,
    }
  }
}
