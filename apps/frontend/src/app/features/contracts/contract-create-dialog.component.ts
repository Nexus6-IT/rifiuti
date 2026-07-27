/**
 * ContractCreateDialogComponent — creazione di un contratto.
 *
 * Estratto da `contracts-list.component.ts`, che faceva lista, creazione e
 * cambio stato in un solo file.
 *
 * Scelta portante: l'operatore non conosce gli id interni, quindi qui non se ne
 * digita nessuno. Il "Tipo controparte" non è più un campo: si deduce dal tipo
 * di contratto, e solo per i tipi che non ne implicano uno solo (servizio
 * completo, accordo quadro) viene chiesto esplicitamente.
 */

import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { CalendarModule } from 'primeng/calendar'
import { CheckboxModule } from 'primeng/checkbox'
import { ToastService } from '../../core/services/toast.service'
import { AnagraficaSelectComponent } from '../registry/anagrafica-select.component'
import { CerMultiSelectComponent } from '../cer/cer-multi-select.component'
import { ContractsService, ContractType, CreateContractDto } from './contracts.service'
import {
  BILLING_FREQUENCY_LABELS,
  PAYMENT_TERM_LABELS,
  PRICING_LABELS,
  RegistroControparte,
  SelectOption,
  TYPE_LABELS,
  opzioni,
  registroDaTipoContratto,
  tipoControparteDaRegistro,
} from './contract-vocabulary'

@Component({
  selector: 'app-contract-create-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    InputTextareaModule,
    CalendarModule,
    CheckboxModule,
    AnagraficaSelectComponent,
    CerMultiSelectComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [style]="{ width: '760px' }"
      [breakpoints]="{ '768px': '95vw' }"
      header="Nuovo contratto"
    >
      <div class="grid formgrid">
        <div class="field col-12 md:col-6">
          <label for="c-number" class="block mb-2">Numero contratto *</label>
          <input
            id="c-number"
            pInputText
            [(ngModel)]="form.contractNumber"
            placeholder="CTR-2026-001"
            class="w-full"
          />
          <small class="block mt-1 text-tertiary">Proposto in automatico, modificabile.</small>
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-type" class="block mb-2">Tipo contratto *</label>
          <p-dropdown
            inputId="c-type"
            [options]="contractTypeOptions"
            [ngModel]="form.contractType"
            (ngModelChange)="onTipoContrattoCambiato($event)"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-producer" class="block mb-2">Produttore *</label>
          <app-anagrafica-select
            inputId="c-producer"
            registro="produttori"
            ariaLabel="Produttore del contratto"
            [(ngModel)]="form.producerId"
          ></app-anagrafica-select>
        </div>

        <!-- Solo per i tipi che non implicano un registro univoco. -->
        <div class="field col-12 md:col-6" *ngIf="!registroImplicito()">
          <label for="c-cp-registro" class="block mb-2">Tipo controparte *</label>
          <p-dropdown
            inputId="c-cp-registro"
            [options]="registroOptions"
            [ngModel]="registroScelto()"
            (ngModelChange)="onRegistroScelto($event)"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-counterparty" class="block mb-2">
            Controparte * <span class="text-tertiary">({{ etichettaControparte() }})</span>
          </label>
          <app-anagrafica-select
            *ngIf="registroEffettivo() as reg"
            inputId="c-counterparty"
            [registro]="reg"
            ariaLabel="Controparte del contratto"
            [(ngModel)]="form.counterpartyId"
          ></app-anagrafica-select>
          <small *ngIf="!registroEffettivo()" class="block text-tertiary">
            Scegli prima il tipo di controparte.
          </small>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-pricing" class="block mb-2">Modello di pricing *</label>
          <p-dropdown
            inputId="c-pricing"
            [options]="pricingModelOptions"
            [(ngModel)]="form.pricingModel"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12">
          <label for="c-cer" class="block mb-2">Codici CER *</label>
          <app-cer-multi-select inputId="c-cer" [(ngModel)]="form.cerCodes"></app-cer-multi-select>
          <small class="block mt-1 text-tertiary">
            Cerca per codice o descrizione e scegli dal catalogo.
          </small>
        </div>

        <div class="field col-12 md:col-4">
          <label for="c-price" class="block mb-2">Prezzo base</label>
          <p-inputNumber
            inputId="c-price"
            [(ngModel)]="form.basePrice"
            mode="decimal"
            [minFractionDigits]="0"
            [maxFractionDigits]="2"
            [min]="0"
            styleClass="w-full"
            inputStyleClass="w-full"
          ></p-inputNumber>
        </div>
        <div class="field col-12 md:col-4">
          <label for="c-uom" class="block mb-2">Unità di misura</label>
          <input
            id="c-uom"
            pInputText
            [(ngModel)]="form.unitOfMeasure"
            placeholder="kg"
            class="w-full"
          />
        </div>
        <div class="field col-12 md:col-4">
          <label for="c-duration" class="block mb-2">Durata (mesi)</label>
          <p-inputNumber
            inputId="c-duration"
            [(ngModel)]="form.durationMonths"
            [min]="1"
            styleClass="w-full"
            inputStyleClass="w-full"
          ></p-inputNumber>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-start" class="block mb-2">Data inizio *</label>
          <p-calendar
            inputId="c-start"
            [(ngModel)]="startDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            appendTo="body"
          ></p-calendar>
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-end" class="block mb-2">Data fine</label>
          <p-calendar
            inputId="c-end"
            [(ngModel)]="endDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            appendTo="body"
          ></p-calendar>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-payment" class="block mb-2">Termini di pagamento</label>
          <p-dropdown
            inputId="c-payment"
            [options]="paymentTermsOptions"
            [(ngModel)]="form.paymentTerms"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-billing" class="block mb-2">Frequenza fatturazione</label>
          <p-dropdown
            inputId="c-billing"
            [options]="billingFrequencyOptions"
            [(ngModel)]="form.billingFrequency"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 flex align-items-center gap-2">
          <p-checkbox [(ngModel)]="form.autoRenew" [binary]="true" inputId="autoRenew"></p-checkbox>
          <label for="autoRenew" class="mb-0">Rinnovo automatico</label>
        </div>
        <div class="field col-12 md:col-6" *ngIf="form.autoRenew">
          <label for="c-notice" class="block mb-2">Preavviso rinnovo (giorni)</label>
          <p-inputNumber
            inputId="c-notice"
            [(ngModel)]="form.renewalNoticeDays"
            [min]="0"
            styleClass="w-full"
            inputStyleClass="w-full"
          ></p-inputNumber>
        </div>

        <div class="field col-12">
          <label for="c-desc" class="block mb-2">Descrizione</label>
          <textarea
            id="c-desc"
            pInputTextarea
            [(ngModel)]="form.description"
            rows="2"
            class="w-full"
          ></textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Crea contratto"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="crea()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .field {
        margin-bottom: 0;
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mb-0 {
        margin-bottom: 0;
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
    `,
  ],
})
export class ContractCreateDialogComponent {
  private readonly contractsService = inject(ContractsService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Emesso a creazione avvenuta, perché la lista si ricarichi. */
  @Output() creato = new EventEmitter<void>()

  readonly saving = signal(false)
  /** Registro scelto a mano, quando il tipo di contratto non ne implica uno. */
  readonly registroScelto = signal<RegistroControparte | null>(null)

  form: CreateContractDto = this.emptyForm()
  startDate: Date | null = null
  endDate: Date | null = null

  readonly contractTypeOptions: SelectOption<ContractType>[] = (
    Object.keys(TYPE_LABELS) as ContractType[]
  ).map(t => ({ label: TYPE_LABELS[t], value: t }))

  // "Intermediario" non compare: non esiste un registro Intermediari da cui
  // scegliere la società, quindi sarebbe una scelta impossibile da portare a
  // termine. L'enum resta a DB per i contratti storici.
  readonly registroOptions: SelectOption<RegistroControparte>[] = [
    { label: 'Trasportatore', value: 'trasportatori' },
    { label: 'Destinatario', value: 'destinatari' },
  ]

  readonly pricingModelOptions = opzioni(PRICING_LABELS)
  readonly paymentTermsOptions = opzioni(PAYMENT_TERM_LABELS)
  readonly billingFrequencyOptions = opzioni(BILLING_FREQUENCY_LABELS)

  // ─── Derivazione del registro ─────────────────────────────────────────────

  /** Registro implicato dal tipo di contratto, se univoco. */
  registroImplicito(): RegistroControparte | null {
    return registroDaTipoContratto(this.form.contractType)
  }

  /** Registro effettivamente in uso: quello implicito, o quello scelto a mano. */
  registroEffettivo(): RegistroControparte | null {
    return this.registroImplicito() ?? this.registroScelto()
  }

  etichettaControparte(): string {
    const reg = this.registroEffettivo()
    if (!reg) return 'da definire'
    return reg === 'trasportatori' ? 'Trasportatore' : 'Destinatario'
  }

  /**
   * Cambiando tipo contratto la controparte già scelta viene azzerata: potrebbe
   * appartenere al registro sbagliato, e un id valido nel registro sbagliato è
   * peggio di un campo vuoto.
   */
  onTipoContrattoCambiato(tipo: ContractType): void {
    const registroPrima = this.registroEffettivo()
    this.form.contractType = tipo
    if (registroDaTipoContratto(tipo)) this.registroScelto.set(null)
    if (this.registroEffettivo() !== registroPrima) this.form.counterpartyId = ''
  }

  onRegistroScelto(registro: RegistroControparte): void {
    if (registro === this.registroScelto()) return
    this.registroScelto.set(registro)
    this.form.counterpartyId = ''
  }

  // ─── Apertura / chiusura ──────────────────────────────────────────────────

  onVisibleChange(v: boolean): void {
    this.visible = v
    this.visibleChange.emit(v)
    if (v) this.reimposta()
  }

  chiudi(): void {
    this.onVisibleChange(false)
  }

  private reimposta(): void {
    this.form = this.emptyForm()
    this.registroScelto.set(null)
    this.startDate = null
    this.endDate = null

    // Numero proposto dal backend: se non arriva, il campo resta libero — è un
    // suggerimento, non un requisito per poter creare.
    this.contractsService.nextNumber().subscribe({
      next: ({ contractNumber }) => (this.form.contractNumber = contractNumber),
      error: () => {
        /* campo lasciato vuoto */
      },
    })
  }

  // ─── Creazione ────────────────────────────────────────────────────────────

  crea(): void {
    const registro = this.registroEffettivo()
    if (!this.validate(registro)) {
      this.toast.warn('Compila tutti i campi obbligatori')
      return
    }

    const dto: CreateContractDto = {
      ...this.form,
      counterpartyType: tipoControparteDaRegistro(registro as RegistroControparte),
      startDate: this.toIsoDate(this.startDate as Date),
      endDate: this.endDate ? this.toIsoDate(this.endDate) : undefined,
    }

    this.saving.set(true)
    this.contractsService.create(dto).subscribe({
      next: () => {
        this.saving.set(false)
        this.toast.success('Contratto creato')
        this.creato.emit()
        this.chiudi()
      },
      error: () => {
        this.saving.set(false)
        this.toast.error('Errore nella creazione del contratto')
      },
    })
  }

  private validate(registro: RegistroControparte | null): boolean {
    return !!(
      this.form.contractNumber?.trim() &&
      this.form.contractType &&
      registro &&
      this.form.producerId?.trim() &&
      this.form.counterpartyId?.trim() &&
      this.form.pricingModel &&
      this.form.cerCodes?.length &&
      this.startDate
    )
  }

  private toIsoDate(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  private emptyForm(): CreateContractDto {
    return {
      contractNumber: '',
      producerId: '',
      counterpartyId: '',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      description: '',
      cerCodes: [],
      pricingModel: 'FLAT_RATE',
      basePrice: undefined,
      unitOfMeasure: 'kg',
      startDate: '',
      endDate: undefined,
      durationMonths: undefined,
      autoRenew: false,
      renewalNoticeDays: 60,
      paymentTerms: 'net_30',
      billingFrequency: 'monthly',
    }
  }
}
