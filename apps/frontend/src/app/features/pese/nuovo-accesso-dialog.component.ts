/**
 * Apertura di un accesso con la prima pesata manuale (doppia pesata, tara dell'automezzo o
 * pesata singola). Il registro si sceglie solo se l'azienda ne ha piu' d'uno (default: quello
 * della sede principale). La chiave di idempotenza e' quella del form della pesata, creata
 * all'apertura del dialog e riusata ai tentativi successivi.
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { registroPredefinito, etichettaRegistro } from '../registro/registro-sede'
import { RegistroVista } from '../registro/registro.service'
import { messaggioErrorePese, normalizzaTarga } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { PesataManualeFormComponent } from './pesata-manuale-form.component'
import {
  AccessoVista,
  Automezzo,
  ModoPesatura,
  PeseService,
  StrumentoPesa,
  VersoPesata,
} from './pese.service'

const ALTRO_MEZZO = ''

@Component({
  selector: 'app-nuovo-accesso-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    PesataManualeFormComponent,
  ],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      header="Nuovo accesso all'impianto"
      [modal]="true"
      [style]="{ width: '720px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra del nuovo accesso"
      (onShow)="mettiAFuoco()"
    >
      <form [formGroup]="form" (submit)="$event.preventDefault()" novalidate data-testid="na-form">
        <div class="griglia">
          <div class="field" *ngIf="registri.length > 1">
            <label for="na-registro"
              >Registro (sede) <span class="req" aria-hidden="true">*</span></label
            >
            <select
              id="na-registro"
              class="p-inputtext w-full"
              formControlName="registroId"
              data-testid="na-registro"
              [attr.aria-invalid]="erroreRegistro() ? true : null"
              [attr.aria-describedby]="erroreRegistro() ? 'na-registro-errore' : null"
            >
              <option value="">Scegliere…</option>
              <option *ngFor="let r of registri" [value]="r.id">{{ etichetta(r) }}</option>
            </select>
            <small
              *ngIf="erroreRegistro() as e"
              id="na-registro-errore"
              class="field-error"
              role="alert"
              data-testid="na-registro-errore"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label for="na-verso">Verso <span class="req" aria-hidden="true">*</span></label>
            <select
              id="na-verso"
              class="p-inputtext w-full"
              formControlName="verso"
              data-testid="na-verso"
            >
              <option value="CARICO">Carico (rifiuto in ingresso)</option>
              <option value="SCARICO">Scarico (rifiuto in uscita)</option>
            </select>
          </div>
          <div class="field">
            <label for="na-modo"
              >Modo di pesatura <span class="req" aria-hidden="true">*</span></label
            >
            <select
              id="na-modo"
              class="p-inputtext w-full"
              formControlName="modo"
              data-testid="na-modo"
            >
              <option value="DOPPIA">Doppia pesata (entrata e uscita)</option>
              <option value="TARA_ANAGRAFICA">Tara registrata dell'automezzo</option>
              <option value="SINGOLA">Pesata singola</option>
            </select>
          </div>
          <div class="field">
            <label for="na-automezzo">Automezzo</label>
            <select
              id="na-automezzo"
              class="p-inputtext w-full"
              formControlName="automezzoId"
              data-testid="na-automezzo"
              [attr.aria-invalid]="erroreMezzo() ? true : null"
              [attr.aria-describedby]="erroreMezzo() ? 'na-automezzo-errore' : null"
            >
              <option [value]="altroMezzo">Altro mezzo (digitare la targa)</option>
              <option *ngFor="let a of automezziAttivi()" [value]="a.id">
                {{ a.targa }}{{ a.taraKg != null ? '' : ' (senza tara)' }}
              </option>
            </select>
            <small
              *ngIf="erroreMezzo() as e"
              id="na-automezzo-errore"
              class="field-error"
              role="alert"
              data-testid="na-automezzo-errore"
              >{{ e }}</small
            >
          </div>
          <div class="field" *ngIf="!form.value.automezzoId">
            <label for="na-targa">Targa</label>
            <input
              id="na-targa"
              type="text"
              class="p-inputtext w-full"
              formControlName="targa"
              maxlength="40"
              [attr.aria-invalid]="erroreTarga() ? true : null"
              [attr.aria-describedby]="erroreTarga() ? 'na-targa-errore' : null"
              data-testid="na-targa"
            />
            <small
              *ngIf="erroreTarga() as e"
              id="na-targa-errore"
              class="field-error"
              role="alert"
              data-testid="na-targa-errore"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label for="na-rimorchio">Targa del rimorchio</label>
            <input
              id="na-rimorchio"
              type="text"
              class="p-inputtext w-full"
              formControlName="targaRimorchio"
              maxlength="40"
              data-testid="na-rimorchio"
            />
          </div>
          <div class="field">
            <label for="na-cer">Codice CER</label>
            <input
              id="na-cer"
              type="text"
              class="p-inputtext w-full"
              formControlName="cerCode"
              maxlength="20"
              data-testid="na-cer"
            />
          </div>
          <div class="field">
            <label for="na-descrizione">Descrizione del rifiuto</label>
            <input
              id="na-descrizione"
              type="text"
              class="p-inputtext w-full"
              formControlName="descrizione"
              maxlength="255"
            />
          </div>
        </div>
        <div class="field">
          <label for="na-note">Note</label>
          <textarea
            id="na-note"
            class="p-inputtext w-full"
            rows="2"
            maxlength="1000"
            formControlName="note"
          ></textarea>
        </div>
      </form>
      <h3 class="titolo">{{ titoloPesata() }}</h3>
      <app-pesata-manuale-form
        idPrefisso="na-pm"
        [etichettaPeso]="etichettaPeso()"
        [strumenti]="strumentiAttivi()"
      ></app-pesata-manuale-form>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="na-errore">{{ e }}</p>
      <div class="azioni">
        <p-button label="Annulla" [text]="true" (onClick)="chiuso.emit()"></p-button>
        <p-button
          label="Salva"
          icon="pi pi-check"
          [loading]="salvataggio()"
          [disabled]="salvataggio()"
          (onClick)="salva()"
          data-testid="na-salva"
          ariaLabel="Salva il nuovo accesso"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    STILI_PESE,
    `
      .titolo {
        font-size: var(--font-size-base);
        margin: var(--spacing-base) 0 var(--spacing-sm);
      }
    `,
  ],
})
export class NuovoAccessoDialogComponent implements OnInit {
  private readonly pese = inject(PeseService)

  @Input() registri: RegistroVista[] = []
  @Input() strumenti: StrumentoPesa[] = []
  @Input() automezzi: Automezzo[] = []
  @Output() creato = new EventEmitter<AccessoVista>()
  @Output() chiuso = new EventEmitter<void>()

  @ViewChild(PesataManualeFormComponent) pesataForm?: PesataManualeFormComponent

  readonly altroMezzo = ALTRO_MEZZO
  readonly etichetta = etichettaRegistro
  readonly tentato = signal(false)
  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  readonly valori = signal({ registroId: '', modo: 'DOPPIA' as ModoPesatura })

  readonly form = new FormGroup({
    registroId: new FormControl('', { nonNullable: true }),
    verso: new FormControl<VersoPesata>('CARICO', { nonNullable: true }),
    modo: new FormControl<ModoPesatura>('DOPPIA', { nonNullable: true }),
    automezzoId: new FormControl(ALTRO_MEZZO, { nonNullable: true }),
    targa: new FormControl('', { nonNullable: true }),
    targaRimorchio: new FormControl('', { nonNullable: true }),
    cerCode: new FormControl('', { nonNullable: true }),
    descrizione: new FormControl('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
  })

  ngOnInit(): void {
    this.form.controls.registroId.setValue(registroPredefinito(this.registri) ?? '')
    this.form.valueChanges.subscribe(v =>
      this.valori.set({ registroId: v.registroId ?? '', modo: v.modo ?? 'DOPPIA' })
    )
    this.valori.set({ registroId: this.form.controls.registroId.value, modo: 'DOPPIA' })
  }

  automezziAttivi(): Automezzo[] {
    return this.automezzi.filter(a => a.attivo)
  }

  strumentiAttivi(): StrumentoPesa[] {
    const reg = this.valori().registroId
    return this.strumenti.filter(s => s.attivo && (!s.registroId || !reg || s.registroId === reg))
  }

  etichettaPeso(): string {
    const modo = this.valori().modo
    return modo === 'SINGOLA'
      ? 'Peso (kg)'
      : modo === 'TARA_ANAGRAFICA'
        ? 'Peso lordo (kg)'
        : 'Prima pesata (kg)'
  }
  titoloPesata(): string {
    return this.valori().modo === 'DOPPIA' ? 'Prima pesata' : 'Pesata'
  }

  erroreRegistro(): string | null {
    return this.tentato() && this.registri.length > 1 && !this.form.value.registroId
      ? 'Scegliere il registro.'
      : null
  }
  erroreMezzo(): string | null {
    return this.tentato() &&
      this.form.value.modo === 'TARA_ANAGRAFICA' &&
      !this.form.value.automezzoId
      ? "Con la tara registrata va scelto un automezzo dell'elenco."
      : null
  }
  erroreTarga(): string | null {
    const t = this.form.value.targa?.trim()
    if (this.tentato() && t && !normalizzaTarga(t)) {
      return 'La targa non è valida: lettere e numeri, da 2 a 15 caratteri.'
    }
    return null
  }

  mettiAFuoco(): void {
    setTimeout(() =>
      document.getElementById(this.registri.length > 1 ? 'na-registro' : 'na-verso')?.focus()
    )
  }

  salva(): void {
    if (this.salvataggio() || !this.pesataForm) return
    this.tentato.set(true)
    const v = this.form.getRawValue()
    const rigaSbagliata = this.erroreRegistro()
      ? 'na-registro'
      : this.erroreMezzo()
        ? 'na-automezzo'
        : this.erroreTarga()
          ? 'na-targa'
          : null
    const r = this.pesataForm.raccogli()
    if (rigaSbagliata) {
      document.getElementById(rigaSbagliata)?.focus()
      return
    }
    if (!r) return
    this.errore.set(null)
    this.salvataggio.set(true)
    this.pese
      .apriAccesso(
        {
          chiaveIdempotenza: this.pesataForm.chiaveIdempotenza,
          registroId: v.registroId || null,
          verso: v.verso,
          modo: v.modo,
          automezzoId: v.automezzoId || null,
          targa: v.automezzoId ? null : v.targa.trim() || null,
          targaRimorchio: v.targaRimorchio.trim() || null,
          cerCode: v.cerCode.trim() || null,
          descrizione: v.descrizione.trim() || null,
          note: v.note.trim() || null,
          pesata: r.pesata,
        },
        r.allegato,
        r.nomeFile
      )
      .subscribe({
        next: a => {
          this.salvataggio.set(false)
          this.creato.emit(a)
        },
        error: err => {
          this.salvataggio.set(false)
          this.errore.set(messaggioErrorePese(err, "Apertura dell'accesso non riuscita."))
        },
      })
  }
}
