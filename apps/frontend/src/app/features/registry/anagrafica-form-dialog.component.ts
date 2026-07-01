import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { DialogModule } from 'primeng/dialog'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { RegistryService } from './registry.service'
import {
  Produttore,
  Trasportatore,
  Destinatario,
  Indirizzo,
} from '../../shared/models/registry.model'

export type TipoAnagrafica = 'produttore' | 'trasportatore' | 'destinatario'
export type ModalitaAnagrafica = 'create' | 'edit'

export interface AnagraficaSavedEvent {
  tipo: TipoAnagrafica
  entity: Produttore | Trasportatore | Destinatario
}

interface FormData {
  ragioneSociale: string
  partitaIVA: string
  pec: string
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
  numeroIscrizione: string
  numeroAutorizzazione: string
}

function emptyForm(): FormData {
  return {
    ragioneSociale: '',
    partitaIVA: '',
    pec: '',
    via: '',
    civico: '',
    cap: '',
    comune: '',
    provincia: '',
    numeroIscrizione: '',
    numeroAutorizzazione: '',
  }
}

function indirizzoFrom(f: FormData): Indirizzo {
  return {
    via: f.via,
    civico: f.civico,
    cap: f.cap,
    comune: f.comune,
    provincia: f.provincia,
  }
}

@Component({
  selector: 'app-anagrafica-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    ProgressSpinnerModule,
  ],
  template: `
    <p-dialog
      [(visible)]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '46rem' }"
      [breakpoints]="{ '768px': '95vw' }"
      [header]="dialogHeader"
      [dismissableMask]="true"
      appendTo="body"
    >
      <form class="ana-form" (ngSubmit)="save()" *ngIf="visible" novalidate>
        <!-- Avviso campi obbligatori -->
        <p class="ana-legend">
          I campi contrassegnati con <span class="req">*</span> sono obbligatori.
        </p>

        <!-- ===== Sezione: Dati aziendali ===== -->
        <fieldset class="ana-fieldset">
          <legend class="ana-legend-title">Dati aziendali</legend>

          <div class="field">
            <label [for]="pfx + '-ragione'">
              Ragione sociale <span class="req" aria-hidden="true">*</span>
            </label>
            <input
              pInputText
              [id]="pfx + '-ragione'"
              name="ragioneSociale"
              [(ngModel)]="form.ragioneSociale"
              (ngModelChange)="clearError('ragioneSociale')"
              placeholder="es. Azienda S.r.l."
              required
              aria-required="true"
              [attr.aria-invalid]="errors.ragioneSociale ? true : null"
              [attr.aria-describedby]="errors.ragioneSociale ? pfx + '-ragione-err' : null"
              autocomplete="organization"
              class="w-full"
              [class.input-error]="errors.ragioneSociale"
            />
            <small
              *ngIf="errors.ragioneSociale"
              [id]="pfx + '-ragione-err'"
              class="field-error"
              role="alert"
              >{{ errors.ragioneSociale }}</small
            >
          </div>

          <div class="ana-row">
            <div class="field ana-row__half">
              <label [for]="pfx + '-piva'">
                Partita IVA <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-piva'"
                name="partitaIVA"
                [(ngModel)]="form.partitaIVA"
                (ngModelChange)="clearError('partitaIVA')"
                placeholder="11 cifre"
                maxlength="11"
                inputmode="numeric"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.partitaIVA ? true : null"
                [attr.aria-describedby]="errors.partitaIVA ? pfx + '-piva-err' : null"
                class="w-full"
                [class.input-error]="errors.partitaIVA"
              />
              <small
                *ngIf="errors.partitaIVA"
                [id]="pfx + '-piva-err'"
                class="field-error"
                role="alert"
                >{{ errors.partitaIVA }}</small
              >
            </div>

            <!-- Numero iscrizione Albo — solo trasportatore -->
            <div class="field ana-row__half" *ngIf="tipo === 'trasportatore'">
              <label [for]="pfx + '-iscrizione'">
                N. iscrizione Albo Gestori <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-iscrizione'"
                name="numeroIscrizione"
                [(ngModel)]="form.numeroIscrizione"
                (ngModelChange)="clearError('numeroIscrizione')"
                placeholder="es. MI/000123"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.numeroIscrizione ? true : null"
                [attr.aria-describedby]="errors.numeroIscrizione ? pfx + '-iscrizione-err' : null"
                class="w-full"
                [class.input-error]="errors.numeroIscrizione"
              />
              <small
                *ngIf="errors.numeroIscrizione"
                [id]="pfx + '-iscrizione-err'"
                class="field-error"
                role="alert"
                >{{ errors.numeroIscrizione }}</small
              >
            </div>

            <!-- Numero autorizzazione — solo destinatario -->
            <div class="field ana-row__half" *ngIf="tipo === 'destinatario'">
              <label [for]="pfx + '-autorizzazione'">
                N. autorizzazione <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-autorizzazione'"
                name="numeroAutorizzazione"
                [(ngModel)]="form.numeroAutorizzazione"
                (ngModelChange)="clearError('numeroAutorizzazione')"
                placeholder="es. AUT/2024/001"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.numeroAutorizzazione ? true : null"
                [attr.aria-describedby]="
                  errors.numeroAutorizzazione ? pfx + '-autorizzazione-err' : null
                "
                class="w-full"
                [class.input-error]="errors.numeroAutorizzazione"
              />
              <small
                *ngIf="errors.numeroAutorizzazione"
                [id]="pfx + '-autorizzazione-err'"
                class="field-error"
                role="alert"
                >{{ errors.numeroAutorizzazione }}</small
              >
            </div>
          </div>

          <div class="field">
            <label [for]="pfx + '-pec'">PEC / e-mail</label>
            <input
              pInputText
              [id]="pfx + '-pec'"
              name="pec"
              type="email"
              [(ngModel)]="form.pec"
              (ngModelChange)="clearError('pec')"
              placeholder="pec@esempio.it"
              autocomplete="email"
              [attr.aria-invalid]="errors.pec ? true : null"
              [attr.aria-describedby]="errors.pec ? pfx + '-pec-err' : null"
              class="w-full"
              [class.input-error]="errors.pec"
            />
            <small *ngIf="errors.pec" [id]="pfx + '-pec-err'" class="field-error" role="alert">{{
              errors.pec
            }}</small>
          </div>
        </fieldset>

        <!-- ===== Sezione: Indirizzo ===== -->
        <fieldset class="ana-fieldset">
          <legend class="ana-legend-title">
            {{ tipo === 'destinatario' ? 'Sede' : 'Sede legale' }}
          </legend>

          <div class="ana-row">
            <div class="field ana-row__two-thirds">
              <label [for]="pfx + '-via'">
                Via <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-via'"
                name="via"
                [(ngModel)]="form.via"
                (ngModelChange)="clearError('via')"
                placeholder="es. Via Roma"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.via ? true : null"
                [attr.aria-describedby]="errors.via ? pfx + '-via-err' : null"
                autocomplete="address-line1"
                class="w-full"
                [class.input-error]="errors.via"
              />
              <small *ngIf="errors.via" [id]="pfx + '-via-err'" class="field-error" role="alert">{{
                errors.via
              }}</small>
            </div>
            <div class="field ana-row__third">
              <label [for]="pfx + '-civico'">
                Civico <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-civico'"
                name="civico"
                [(ngModel)]="form.civico"
                (ngModelChange)="clearError('civico')"
                placeholder="es. 12"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.civico ? true : null"
                [attr.aria-describedby]="errors.civico ? pfx + '-civico-err' : null"
                class="w-full"
                [class.input-error]="errors.civico"
              />
              <small
                *ngIf="errors.civico"
                [id]="pfx + '-civico-err'"
                class="field-error"
                role="alert"
                >{{ errors.civico }}</small
              >
            </div>
          </div>

          <div class="ana-row">
            <div class="field ana-row__third">
              <label [for]="pfx + '-cap'">
                CAP <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-cap'"
                name="cap"
                [(ngModel)]="form.cap"
                (ngModelChange)="clearError('cap')"
                placeholder="5 cifre"
                maxlength="5"
                inputmode="numeric"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.cap ? true : null"
                [attr.aria-describedby]="errors.cap ? pfx + '-cap-err' : null"
                autocomplete="postal-code"
                class="w-full"
                [class.input-error]="errors.cap"
              />
              <small *ngIf="errors.cap" [id]="pfx + '-cap-err'" class="field-error" role="alert">{{
                errors.cap
              }}</small>
            </div>
            <div class="field ana-row__third">
              <label [for]="pfx + '-comune'">
                Comune <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-comune'"
                name="comune"
                [(ngModel)]="form.comune"
                (ngModelChange)="clearError('comune')"
                placeholder="es. Milano"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.comune ? true : null"
                [attr.aria-describedby]="errors.comune ? pfx + '-comune-err' : null"
                autocomplete="address-level2"
                class="w-full"
                [class.input-error]="errors.comune"
              />
              <small
                *ngIf="errors.comune"
                [id]="pfx + '-comune-err'"
                class="field-error"
                role="alert"
                >{{ errors.comune }}</small
              >
            </div>
            <div class="field ana-row__third">
              <label [for]="pfx + '-prov'">
                Provincia <span class="req" aria-hidden="true">*</span>
              </label>
              <input
                pInputText
                [id]="pfx + '-prov'"
                name="provincia"
                [(ngModel)]="form.provincia"
                (ngModelChange)="clearError('provincia')"
                placeholder="es. MI"
                maxlength="2"
                required
                aria-required="true"
                [attr.aria-invalid]="errors.provincia ? true : null"
                [attr.aria-describedby]="errors.provincia ? pfx + '-prov-err' : null"
                class="w-full prov-input"
                [class.input-error]="errors.provincia"
              />
              <small
                *ngIf="errors.provincia"
                [id]="pfx + '-prov-err'"
                class="field-error"
                role="alert"
                >{{ errors.provincia }}</small
              >
            </div>
          </div>
        </fieldset>
      </form>

      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          icon="pi pi-times"
          (onClick)="chiudi()"
          [disabled]="saving"
        />
        <p-button label="Salva" icon="pi pi-check" (onClick)="save()" [loading]="saving" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      /* Griglia 8pt — form interno al dialog */
      .ana-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .ana-legend {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }

      .req {
        color: var(--color-danger);
        font-weight: var(--font-weight-bold);
      }

      .ana-fieldset {
        border: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }

      .ana-legend-title {
        font-family: var(--font-display);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-base);
        color: var(--text-primary);
        padding-bottom: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--surface-border);
        width: 100%;
        display: block;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .field label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }

      /* Righe a più colonne */
      .ana-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
        align-items: flex-start;
      }
      .ana-row__half {
        flex: 1 1 calc(50% - var(--spacing-base) / 2);
        min-width: 0;
      }
      .ana-row__third {
        flex: 1 1 calc(33% - var(--spacing-base));
        min-width: 0;
      }
      .ana-row__two-thirds {
        flex: 2 1 calc(66% - var(--spacing-base));
        min-width: 0;
      }

      .prov-input {
        text-transform: uppercase;
      }

      /* Errore inline per-campo — rosso WCAG AA (color-danger su sfondo chiaro). */
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
        line-height: 1.3;
      }
      /* Bordo rosso sul controllo non valido (feedback visivo, non solo colore testo). */
      .input-error,
      .input-error:enabled:focus {
        border-color: var(--color-danger) !important;
        box-shadow: 0 0 0 1px var(--color-danger) !important;
      }

      @media (max-width: 480px) {
        .ana-row__half,
        .ana-row__third,
        .ana-row__two-thirds {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class AnagraficaFormDialogComponent implements OnChanges {
  @Input() tipo: TipoAnagrafica = 'produttore'
  @Input() modalita: ModalitaAnagrafica = 'create'
  @Input() visible = false
  @Input() entityData: Produttore | Trasportatore | Destinatario | null = null

  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() saved = new EventEmitter<AnagraficaSavedEvent>()

  form: FormData = emptyForm()
  saving = false

  /** Messaggi di errore per-campo mostrati inline accanto al controllo. */
  errors: Partial<Record<keyof FormData, string>> = {}

  get pfx(): string {
    return `ana-${this.tipo}`
  }

  /** Pulisce l'errore di un campo mentre l'utente lo corregge. */
  clearError(field: keyof FormData): void {
    if (this.errors[field]) {
      delete this.errors[field]
    }
  }

  get dialogHeader(): string {
    const label =
      this.tipo === 'produttore'
        ? 'produttore'
        : this.tipo === 'trasportatore'
          ? 'trasportatore'
          : 'destinatario'
    return this.modalita === 'create' ? `Nuovo ${label}` : `Modifica ${label}`
  }

  constructor(
    private registryService: RegistryService,
    private messageService: MessageService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && changes['visible'].currentValue === true) {
      this.form = emptyForm()
      this.errors = {}
      if (this.modalita === 'edit' && this.entityData) {
        this.prefill(this.entityData)
      }
    }
  }

  private prefill(entity: Produttore | Trasportatore | Destinatario): void {
    this.form.ragioneSociale = entity.ragioneSociale
    this.form.partitaIVA = entity.partitaIVA
    this.form.pec = entity.pec ?? ''

    // Indirizzo: produttore/trasportatore → sedeLegale; destinatario → sede
    const addr: Indirizzo =
      this.tipo === 'destinatario'
        ? (entity as Destinatario).sede
        : (entity as Produttore | Trasportatore).sedeLegale

    if (addr) {
      this.form.via = addr.via ?? ''
      this.form.civico = addr.civico ?? ''
      this.form.cap = addr.cap ?? ''
      this.form.comune = addr.comune ?? ''
      this.form.provincia = addr.provincia ?? ''
    }

    if (this.tipo === 'trasportatore') {
      this.form.numeroIscrizione = (entity as Trasportatore).numeroIscrizione ?? ''
    }
    if (this.tipo === 'destinatario') {
      this.form.numeroAutorizzazione = (entity as Destinatario).numeroAutorizzazione ?? ''
    }
  }

  /**
   * Valida i campi obbligatori popolando `errors` (messaggio inline per campo).
   * Ritorna true se non ci sono errori.
   */
  private validate(): boolean {
    const f = this.form
    const errors: Partial<Record<keyof FormData, string>> = {}

    if (!f.ragioneSociale.trim()) errors.ragioneSociale = 'La ragione sociale è obbligatoria.'
    if (!f.partitaIVA.trim()) errors.partitaIVA = 'La partita IVA è obbligatoria.'
    if (!f.via.trim()) errors.via = 'La via è obbligatoria.'
    if (!f.civico.trim()) errors.civico = 'Il civico è obbligatorio.'
    if (!f.cap.trim()) errors.cap = 'Il CAP è obbligatorio.'
    if (!f.comune.trim()) errors.comune = 'Il comune è obbligatorio.'
    if (!f.provincia.trim()) errors.provincia = 'La provincia è obbligatoria.'
    if (this.tipo === 'trasportatore' && !f.numeroIscrizione.trim()) {
      errors.numeroIscrizione = "Il numero di iscrizione all'Albo è obbligatorio."
    }
    if (this.tipo === 'destinatario' && !f.numeroAutorizzazione.trim()) {
      errors.numeroAutorizzazione = 'Il numero di autorizzazione è obbligatorio.'
    }

    this.errors = errors
    return Object.keys(errors).length === 0
  }

  /**
   * Mappa un messaggio d'errore del backend (400/409) al campo pertinente,
   * così l'errore compare anche accanto al controllo e non solo nel toast.
   */
  private mapBackendError(message: string): void {
    const m = message.toLowerCase()
    if (m.includes('iscrizione') || m.includes('albo')) {
      this.errors = { ...this.errors, numeroIscrizione: message }
    } else if (m.includes('autorizzazione')) {
      this.errors = { ...this.errors, numeroAutorizzazione: message }
    } else if (m.includes('partita iva') || m.includes('p.iva') || m.includes('piva')) {
      this.errors = { ...this.errors, partitaIVA: message }
    } else if (m.includes('pec') || m.includes('e-mail') || m.includes('email')) {
      this.errors = { ...this.errors, pec: message }
    } else if (m.includes('ragione sociale')) {
      this.errors = { ...this.errors, ragioneSociale: message }
    }
  }

  save(): void {
    if (!this.validate()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Campi mancanti',
        detail: 'Compila tutti i campi obbligatori prima di salvare.',
      })
      return
    }

    this.saving = true
    const indirizzo = indirizzoFrom(this.form)
    const isEdit = this.modalita === 'edit' && !!this.entityData

    const onSuccess = (entity: Produttore | Trasportatore | Destinatario): void => {
      this.saving = false
      const tipoLabel =
        this.tipo === 'produttore'
          ? 'Produttore'
          : this.tipo === 'trasportatore'
            ? 'Trasportatore'
            : 'Destinatario'
      this.messageService.add({
        severity: 'success',
        summary: 'Salvato',
        detail: `${tipoLabel} ${isEdit ? 'aggiornato' : 'creato'} con successo.`,
      })
      this.saved.emit({ tipo: this.tipo, entity })
      this.chiudi()
    }

    const onError = (err: unknown): void => {
      this.saving = false
      const raw = (err as { error?: { message?: string | string[] } })?.error?.message
      const msg = Array.isArray(raw)
        ? raw.join(', ')
        : (raw ?? 'Errore durante il salvataggio. Riprova.')
      // Conflitto/validazione backend: evidenzia il campo pertinente, oltre al toast.
      this.mapBackendError(msg)
      this.messageService.add({ severity: 'error', summary: 'Errore', detail: msg })
    }

    // In update la P.IVA è immutabile: il DTO di update del backend NON accetta
    // `partitaIVA` (whitelist + forbidNonWhitelisted) → la si invia solo in create.
    const partitaIVA = this.form.partitaIVA.trim()
    if (this.tipo === 'produttore') {
      const base = {
        ragioneSociale: this.form.ragioneSociale.trim(),
        sedeLegale: indirizzo,
        pec: this.form.pec.trim() || undefined,
      }
      const op$ = isEdit
        ? this.registryService.updateProduttore(this.entityData!.id, base)
        : this.registryService.createProduttore({ ...base, partitaIVA })
      op$.subscribe({ next: onSuccess, error: onError })
    } else if (this.tipo === 'trasportatore') {
      const base = {
        ragioneSociale: this.form.ragioneSociale.trim(),
        sedeLegale: indirizzo,
        numeroIscrizione: this.form.numeroIscrizione.trim(),
        pec: this.form.pec.trim() || undefined,
      }
      const op$ = isEdit
        ? this.registryService.updateTrasportatore(this.entityData!.id, base)
        : this.registryService.createTrasportatore({ ...base, partitaIVA })
      op$.subscribe({ next: onSuccess, error: onError })
    } else {
      const base = {
        ragioneSociale: this.form.ragioneSociale.trim(),
        sede: indirizzo,
        numeroAutorizzazione: this.form.numeroAutorizzazione.trim(),
        pec: this.form.pec.trim() || undefined,
      }
      const op$ = isEdit
        ? this.registryService.updateDestinatario(this.entityData!.id, base)
        : this.registryService.createDestinatario({ ...base, partitaIVA })
      op$.subscribe({ next: onSuccess, error: onError })
    }
  }

  chiudi(): void {
    this.saving = false
    this.visibleChange.emit(false)
  }
}
