/**
 * Rettifica del peso di una pesata. La pesata originale non si modifica mai: la rettifica e'
 * una riga in piu' con il peso precedente, il numero d'ordine, il nuovo peso e il motivo.
 * Se la rettifica renderebbe il netto non valido il backend risponde 422 e il messaggio si
 * mostra testuale. Avvisi sempre visibili: i documenti collegati (FIR) non cambiano da soli e
 * la tara di un automezzo calcolata da questa pesata non viene aggiornata.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { FormControl } from '@angular/forms'
import { ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { formattaKg, messaggioErrorePese, preparaAllegato } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { MASSIMO_PESO_KG } from './pesata-manuale-form.component'
import { PesoItalianoDirective } from './peso-it.directive'
import { AccessoVista, PesataVista, PeseService } from './pese.service'

@Component({
  selector: 'app-rettifica-pesata-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    PesoItalianoDirective,
  ],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      [header]="'Rettifica del peso — accesso ' + accesso.numero"
      [modal]="true"
      [style]="{ width: '600px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra della rettifica"
      (onShow)="mettiAFuoco()"
    >
      <dl class="riepilogo">
        <dt>Peso attuale</dt>
        <dd data-testid="rt-precedente">{{ kg(pesata.pesoEffettivoKg) }}</dd>
        <dt>Rettifica numero</dt>
        <dd data-testid="rt-numero">{{ pesata.rettifiche.length + 1 }}</dd>
      </dl>
      <p class="avviso-manuale" data-testid="rt-avvisi">
        La pesata originale resta registrata e visibile.
        <ng-container *ngIf="firCollegati() as n"
          >L'accesso è collegato a {{ n === 1 ? 'un FIR' : n + ' FIR' }}: il documento non cambia da
          solo e la differenza in kg resterà evidenziata fino a una correzione.
        </ng-container>
        Se questa pesata è stata usata come tara di un automezzo, la tara dell'automezzo non viene
        aggiornata.
      </p>
      <div class="field">
        <label id="rt-peso-etichetta" for="rt-peso"
          >Nuovo peso (kg) <span class="req" aria-hidden="true">*</span></label
        >
        <p-inputNumber
          [messaggioInterno]="false"
          [useGrouping]="false"
          appPesoIt
          (rifiutato)="rifiuto.set($event)"
          [formControl]="peso"
          inputId="rt-peso"
          mode="decimal"
          locale="it-IT"
          [minFractionDigits]="0"
          [maxFractionDigits]="2"
          [min]="0.01"
          [max]="massimo"
          ariaLabelledBy="rt-peso-etichetta"
          pesoAiutoId="rt-peso-aiuto"
          [pesoErroreId]="errorePeso() ? 'rt-peso-errore' : null"
          styleClass="w-full"
        ></p-inputNumber>
        <small id="rt-peso-aiuto" class="field-hint"
          >Con la virgola per i decimali (al massimo due). Niente separatore delle migliaia.</small
        >
        <small
          *ngIf="errorePeso() as e"
          id="rt-peso-errore"
          class="field-error"
          role="alert"
          data-testid="rt-peso-errore"
          >{{ e }}</small
        >
      </div>
      <div class="field">
        <label for="rt-motivo">Motivo <span class="req" aria-hidden="true">*</span></label>
        <textarea
          id="rt-motivo"
          class="p-inputtext w-full"
          rows="2"
          maxlength="500"
          [formControl]="motivo"
          aria-required="true"
          [attr.aria-invalid]="erroreMotivo() ? true : null"
          [attr.aria-describedby]="erroreMotivo() ? 'rt-motivo-errore' : null"
          data-testid="rt-motivo"
        ></textarea>
        <small
          *ngIf="erroreMotivo() as e"
          id="rt-motivo-errore"
          class="field-error"
          role="alert"
          data-testid="rt-motivo-errore"
          >{{ e }}</small
        >
      </div>
      <div class="field">
        <label for="rt-allegato">Documento a sostegno (foto o PDF)</label>
        <input
          id="rt-allegato"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          (change)="alCambioAllegato($event)"
          [attr.aria-describedby]="erroreAllegato() ? 'rt-allegato-errore' : null"
          data-testid="rt-allegato"
        />
        <small
          *ngIf="erroreAllegato() as e"
          id="rt-allegato-errore"
          class="field-error"
          role="alert"
          data-testid="rt-allegato-errore"
          >{{ e }}</small
        >
      </div>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rt-errore">{{ e }}</p>
      <div class="azioni">
        <p-button label="Annulla" [text]="true" (onClick)="chiuso.emit()"></p-button>
        <p-button
          label="Rettifica"
          icon="pi pi-check"
          [loading]="salvataggio()"
          [disabled]="salvataggio()"
          (onClick)="salva()"
          data-testid="rt-salva"
          ariaLabel="Salva la rettifica del peso"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    STILI_PESE,
    `
      .riepilogo {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--spacing-xs) var(--spacing-base);
        margin: 0 0 var(--spacing-base);
      }
      .riepilogo dt {
        color: var(--text-secondary);
      }
      .riepilogo dd {
        margin: 0;
        font-weight: var(--font-weight-medium);
      }
    `,
  ],
})
export class RettificaPesataDialogComponent {
  private readonly pese = inject(PeseService)

  @Input({ required: true }) accesso!: AccessoVista
  @Input({ required: true }) pesata!: PesataVista
  @Output() fatto = new EventEmitter<AccessoVista>()
  @Output() chiuso = new EventEmitter<void>()
  @Output() ricarica = new EventEmitter<void>()

  readonly massimo = MASSIMO_PESO_KG
  readonly kg = formattaKg
  readonly peso = new FormControl<number | null>(null)
  readonly motivo = new FormControl('', { nonNullable: true })
  readonly tentato = signal(false)
  readonly rifiuto = signal<string | null>(null)
  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  readonly erroreAllegato = signal<string | null>(null)
  private allegato: { blob: Blob; nomeFile: string } | null = null

  firCollegati(): number {
    return this.accesso.collegamenti.filter(c => c.tipo === 'FIR' && !c.revocatoIl).length
  }

  errorePeso(): string | null {
    if (this.rifiuto()) return this.rifiuto()
    if (!this.tentato()) return null
    const v = this.peso.value
    if (v == null) return 'Il nuovo peso è obbligatorio.'
    if (v < 0.01) return 'Il peso deve essere positivo.'
    return null
  }
  erroreMotivo(): string | null {
    return this.tentato() && !this.motivo.value.trim() ? 'Il motivo è obbligatorio.' : null
  }

  mettiAFuoco(): void {
    setTimeout(() => document.getElementById('rt-peso')?.focus())
  }

  async alCambioAllegato(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement
    const file = input.files?.[0]
    this.erroreAllegato.set(null)
    this.allegato = null
    if (!file) return
    try {
      this.allegato = await preparaAllegato(file)
    } catch (e) {
      input.value = ''
      this.erroreAllegato.set(e instanceof Error ? e.message : 'Allegato non valido.')
    }
  }

  salva(): void {
    if (this.salvataggio()) return
    this.tentato.set(true)
    if (this.errorePeso()) {
      document.getElementById('rt-peso')?.focus()
      return
    }
    if (this.erroreMotivo()) {
      document.getElementById('rt-motivo')?.focus()
      return
    }
    this.errore.set(null)
    this.salvataggio.set(true)
    this.pese
      .rettificaPesata(
        this.pesata.id,
        { pesoNuovoKg: this.peso.value as number, motivo: this.motivo.value.trim() },
        this.allegato?.blob ?? null,
        this.allegato?.nomeFile
      )
      .subscribe({
        next: a => {
          this.salvataggio.set(false)
          this.fatto.emit(a)
        },
        error: err => {
          this.salvataggio.set(false)
          this.errore.set(messaggioErrorePese(err, 'Rettifica non riuscita.'))
          if (err?.status === 409) this.ricarica.emit()
        },
      })
  }
}
