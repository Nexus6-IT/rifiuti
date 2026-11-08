/**
 * Dialog delle giacenze iniziali del registro (aperture).
 *
 * Una giacenza iniziale non è un movimento: non consuma progressivi e non è "prodotta" né
 * "ricevuta" nel MUD, ma entra in ogni saldo. Serve a chi arriva da WinWaste o dalla carta
 * e non deve più registrare un "Altro carico" fittizio.
 *
 * Il ruolo e la modificabilità li decide il backend (`puoImpostare`, `modificabile`): il
 * frontend non li deduce dal token. La modifica è una sostituzione completa (PUT): il form
 * invia sempre tutti i campi correnti, tranne il CER, che non si cambia (si cancella e si
 * ricrea). `dataRiferimento` viaggia come stringa 'AAAA-MM-GG' e non passa mai da `Date`.
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
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms'
import { Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import { CerSelectComponent } from '../cer/cer-select.component'
import {
  DatiGiacenzaIniziale,
  DatiModificaGiacenzaIniziale,
  ElencoGiacenzeIniziali,
  GiacenzaInizialeInElenco,
  OrigineGiacenzaIniziale,
  RegistroService,
  STATI_FISICI,
  annoItaliano,
} from './registro.service'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'
import { CampoDataComponent } from '../../shared/components/campo-data.component'

const formatoGiornoRoma = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Oggi come 'AAAA-MM-GG' nel calendario italiano (come il backend), senza `toISOString`. */
export function oggiItaliano(istante: Date = new Date()): string {
  return formatoGiornoRoma.format(istante)
}

/**
 * Unità ammesse: le stesse dei FIR (kg, t, m³). Il backend normalizza solo mettendo in
 * maiuscolo, quindi un'unità diversa (es. MC invece di M3) formerebbe una famiglia a parte
 * e non compenserebbe i movimenti.
 */
export const UNITA_GIACENZA: { label: string; value: string }[] = [
  { label: 'kg', value: 'KG' },
  { label: 't', value: 'T' },
  { label: 'm³', value: 'M3' },
]

/** Etichetta leggibile dell'unità; un valore fuori elenco (dato storico) resta com'è. */
export function etichettaUnita(unita: string): string {
  return UNITA_GIACENZA.find(u => u.value === unita.toUpperCase())?.label ?? unita
}

/** Etichetta dello stato fisico (il backend lo salva in maiuscolo); fuori elenco resta com'è. */
export function etichettaStatoFisico(stato: string | null): string {
  if (!stato) return '—'
  return STATI_FISICI.find(x => x.toUpperCase() === stato.toUpperCase()) ?? stato
}

const QUANTITA_MASSIMA = 99_999_999.99
export const ORIGINI_MASSIME = 200

const centesimi = (n: number): number => Math.round(n * 100)

/** Come il backend: coppie (anno, protocollo) distinte e, se tutte con quantità, somma <= giacenza. */
const origineCoerente = (): ValidatorFn => group => {
  const righe = ((group.get('origini') as FormArray | null)?.value ?? []) as {
    anno: number | null
    protocollo: number | null
    quantita: number | null
  }[]
  const errori: Record<string, boolean> = {}
  const viste = new Set<string>()
  for (const r of righe) {
    if (r.anno == null || r.protocollo == null) continue
    const k = `${r.anno}/${r.protocollo}`
    if (viste.has(k)) errori['origineDuplicata'] = true
    viste.add(k)
  }
  const quantita = group.get('quantita')?.value as number | null
  if (righe.length > 0 && quantita != null && righe.every(r => r.quantita != null)) {
    const somma = righe.reduce((t, r) => t + centesimi(Number(r.quantita)), 0)
    if (somma > centesimi(Number(quantita))) errori['origineSommaOltre'] = true
  }
  return Object.keys(errori).length ? errori : null
}

const MSG_ERRORE_GENERICO = 'Operazione sulle giacenze iniziali non riuscita'

/** Messaggio del backend (400/403/404/409) o, in mancanza, uno generico. */
export function messaggioErroreGiacenza(err: any): string {
  const m = err?.error?.message ?? err?.message
  if (Array.isArray(m)) return m.join(' · ')
  return typeof m === 'string' && m ? m : MSG_ERRORE_GENERICO
}

/** 'AAAA-MM-GG' -> 'GG/MM/AAAA' per testo, senza passare da `Date`. */
export function dataItaliana(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return a && m && g ? `${g}/${m}/${a}` : giorno
}

const dataNonFutura = (): ValidatorFn => control => {
  const v = control.value as string | null
  if (!v) return null
  return v > oggiItaliano() ? { dataFutura: true } : null
}

@Component({
  selector: 'app-giacenze-iniziali-dialog',
  standalone: true,
  imports: [
    CampoDataComponent,
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    NumeroItalianoDirective,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    CerSelectComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [header]="titolo()"
      [modal]="true"
      [closable]="true"
      [style]="{ width: '860px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra delle giacenze iniziali"
    >
      <p *ngIf="sede" class="gi-sede" data-testid="giacenze-iniziali-sede">
        Le giacenze valgono per il registro di <strong>{{ sede }}</strong
        >.
      </p>
      <p class="gi-nota">
        Quantità già in deposito all'avvio del registro (migrazione da un altro programma o dalla
        carta). Non sono movimenti: non prendono un numero e non contano come prodotto o ricevuto
        nel MUD, ma entrano nel saldo e nel blocco dello scarico.
      </p>

      <p *ngIf="caricamento()" class="gi-nota" role="status">Caricamento…</p>
      <p *ngIf="erroreCaricamento() as e" class="field-error" role="alert" data-testid="gi-errore">
        {{ e }}
      </p>

      <p
        *ngIf="!caricamento() && !erroreCaricamento() && elenco() && !elenco()!.registroId"
        class="gi-nota"
        role="status"
        data-testid="gi-registro-da-indicare"
      >
        Nessun registro determinato: se l'azienda ha più registri e nessuno è predefinito, scegli la
        sede nel filtro del registro e riapri questa finestra; se non ha ancora un registro, crealo
        prima registrando un movimento.
      </p>

      <ng-container *ngIf="elenco() as el">
        <ng-container *ngIf="el.registroId">
          <p-table [value]="el.voci" styleClass="p-datatable-sm" data-testid="gi-tabella">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">CER</th>
                <th scope="col">Stato fisico</th>
                <th scope="col" class="text-right">Quantità</th>
                <th scope="col">Dal</th>
                <th scope="col" class="text-right">Origini</th>
                <th scope="col" style="width: 190px">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-v>
              <tr [attr.data-testid]="'gi-riga-' + v.id">
                <td>
                  <strong>{{ v.cerCode }}</strong>
                </td>
                <td>{{ etichettaStatoFisico(v.statoFisico) }}</td>
                <td class="text-right">
                  {{ v.quantita | number: '1.0-2' }} {{ etichettaUnita(v.unita) }}
                </td>
                <td>{{ dataItaliana(v.dataRiferimento) }}</td>
                <td class="text-right">{{ v.origini.length }}</td>
                <td>
                  <ng-container *ngIf="el.puoImpostare">
                    <ng-container *ngIf="v.modificabile; else bloccata">
                      <ng-container *ngIf="daEliminare() !== v.id; else conferma">
                        <p-button
                          label="Modifica"
                          icon="pi pi-pencil"
                          [text]="true"
                          size="small"
                          (onClick)="apriModifica(v)"
                          [attr.data-testid]="'gi-modifica-' + v.id"
                          [ariaLabel]="'Modifica la giacenza iniziale del CER ' + v.cerCode"
                        ></p-button>
                        <p-button
                          label="Elimina"
                          icon="pi pi-trash"
                          severity="danger"
                          [text]="true"
                          size="small"
                          (onClick)="chiediEliminazione(v.id)"
                          [attr.data-testid]="'gi-elimina-' + v.id"
                          [ariaLabel]="'Elimina la giacenza iniziale del CER ' + v.cerCode"
                        ></p-button>
                      </ng-container>
                      <ng-template #conferma>
                        <span class="gi-conferma">Eliminare?</span>
                        <p-button
                          label="Sì"
                          severity="danger"
                          size="small"
                          [loading]="salvataggio()"
                          (onClick)="elimina(v)"
                          [attr.data-testid]="'gi-elimina-conferma-' + v.id"
                          ariaLabel="Conferma l'eliminazione della giacenza iniziale"
                        ></p-button>
                        <p-button
                          label="No"
                          [text]="true"
                          size="small"
                          (onClick)="daEliminare.set(null)"
                          ariaLabel="Annulla l'eliminazione"
                        ></p-button>
                      </ng-template>
                    </ng-container>
                    <ng-template #bloccata>
                      <small class="gi-bloccata" [attr.data-testid]="'gi-bloccata-' + v.id"
                        >Usata da uno scarico registrato dopo l'apertura: non si modifica né si
                        elimina.</small
                      >
                    </ng-template>
                  </ng-container>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <span data-testid="gi-vuota">Nessuna giacenza iniziale nel registro.</span>
                </td>
              </tr>
            </ng-template>
          </p-table>

          <p *ngIf="!el.puoImpostare" class="gi-nota" data-testid="gi-sola-lettura">
            Le giacenze iniziali le gestisce un amministratore dell'azienda.
          </p>

          <p-button
            *ngIf="el.puoImpostare && !formAperto()"
            label="Aggiungi giacenza iniziale"
            icon="pi pi-plus"
            [outlined]="true"
            styleClass="gi-aggiungi"
            (onClick)="apriNuova()"
            data-testid="gi-aggiungi"
            ariaLabel="Aggiungi una giacenza iniziale"
          ></p-button>

          <form
            *ngIf="el.puoImpostare && formAperto()"
            [formGroup]="form"
            class="mov-form gi-form"
            data-testid="gi-form"
            (ngSubmit)="salva()"
          >
            <h3 class="gi-form-titolo">
              {{ inModifica() ? 'Modifica giacenza iniziale' : 'Nuova giacenza iniziale' }}
            </h3>
            <div class="grid">
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="gi-cer"
                    >Codice CER <span class="req" aria-hidden="true">*</span></label
                  >
                  <app-cer-select
                    inputId="gi-cer"
                    formControlName="cerCode"
                    ariaLabel="Codice CER della giacenza iniziale"
                    placeholder="Cerca per codice o descrizione…"
                    [required]="true"
                    [invalid]="errore('cerCode')"
                    [ariaDescribedBy]="errore('cerCode') ? 'gi-cer-err' : null"
                  />
                  <small *ngIf="inModifica()" class="field-hint" data-testid="gi-cer-bloccato"
                    >Il CER non si modifica: cancella la giacenza e creane un'altra.</small
                  >
                  <small *ngIf="errore('cerCode')" id="gi-cer-err" class="field-error" role="alert"
                    >Il codice CER è obbligatorio.</small
                  >
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="gi-stato">Stato fisico</label>
                  <p-dropdown
                    formControlName="statoFisico"
                    inputId="gi-stato"
                    [options]="statiFisiciOptions()"
                    placeholder="Seleziona stato"
                    styleClass="w-full"
                    [showClear]="true"
                  ></p-dropdown>
                </div>
              </div>
              <div class="col-12 sm:col-4">
                <div class="field">
                  <label for="gi-quantita"
                    >Quantità <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-inputNumber
                    appNumeroIt
                    [useGrouping]="false"
                    formControlName="quantita"
                    inputId="gi-quantita"
                    mode="decimal"
                    locale="it-IT"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="2"
                    [min]="0.01"
                    [max]="99999999.99"
                    ariaRequired="true"
                    [styleClass]="errore('quantita') ? 'w-full p-invalid' : 'w-full'"
                    [attr.aria-invalid]="errore('quantita') ? true : null"
                    [attr.aria-describedby]="errore('quantita') ? 'gi-quantita-err' : null"
                  ></p-inputNumber>
                  <small
                    *ngIf="errore('quantita')"
                    id="gi-quantita-err"
                    class="field-error"
                    role="alert"
                    >Indica una quantità maggiore di zero (al più 2 decimali).</small
                  >
                </div>
              </div>
              <div class="col-12 sm:col-4">
                <div class="field">
                  <label for="gi-unita">Unità <span class="req" aria-hidden="true">*</span></label>
                  <p-dropdown
                    formControlName="unita"
                    inputId="gi-unita"
                    [options]="unitaOptions()"
                    styleClass="w-full"
                  ></p-dropdown>
                </div>
              </div>
              <div class="col-12 sm:col-4">
                <div class="field">
                  <label for="gi-data"
                    >In deposito dal <span class="req" aria-hidden="true">*</span></label
                  >
                  <app-campo-data
                    inputId="gi-data"
                    formControlName="dataRiferimento"
                    [max]="oggi"
                    [ariaRequired]="true"
                    [ariaInvalid]="!!errore('dataRiferimento')"
                    [piena]="true"
                  />
                  <small *ngIf="errore('dataRiferimento')" class="field-error" role="alert"
                    >Indica una data non successiva a oggi.</small
                  >
                </div>
              </div>

              <div class="col-12">
                <div class="field">
                  <span class="gi-etichetta">Carichi d'origine (anno e protocollo RENTRI)</span>
                  <small class="field-hint"
                    >Facoltativo: i carichi che compongono la giacenza. Se indichi tutte le
                    quantità, la somma non deve superare la giacenza.</small
                  >
                  <div formArrayName="origini">
                    <div
                      *ngFor="let o of origini.controls; let i = index"
                      [formGroupName]="i"
                      class="gi-origine"
                      data-testid="gi-origine"
                    >
                      <p-inputNumber
                        appNumeroIt
                        locale="it-IT"
                        soloIntero
                        [maxFractionDigits]="0"
                        formControlName="anno"
                        [useGrouping]="false"
                        [min]="1990"
                        [max]="annoCorrente"
                        placeholder="Anno"
                        [inputId]="'gi-o-anno-' + i"
                        [ariaLabel]="'Anno del carico ' + (i + 1)"
                      ></p-inputNumber>
                      <p-inputNumber
                        appNumeroIt
                        locale="it-IT"
                        soloIntero
                        [maxFractionDigits]="0"
                        formControlName="protocollo"
                        [useGrouping]="false"
                        [min]="1"
                        placeholder="Protocollo"
                        [inputId]="'gi-o-prot-' + i"
                        [ariaLabel]="'Protocollo del carico ' + (i + 1)"
                      ></p-inputNumber>
                      <p-inputNumber
                        appNumeroIt
                        [useGrouping]="false"
                        formControlName="quantita"
                        mode="decimal"
                        locale="it-IT"
                        [minFractionDigits]="0"
                        [maxFractionDigits]="2"
                        [min]="0.01"
                        [max]="quantitaMassima"
                        placeholder="Quantità"
                        [inputId]="'gi-o-qta-' + i"
                        [ariaLabel]="'Quantità del carico ' + (i + 1)"
                      ></p-inputNumber>
                      <p-button
                        icon="pi pi-times"
                        [text]="true"
                        severity="danger"
                        (onClick)="rimuoviOrigine(i)"
                        [ariaLabel]="'Rimuovi il carico d\\'origine ' + (i + 1)"
                      ></p-button>
                    </div>
                  </div>
                  <small *ngIf="origini.invalid && origini.touched" class="field-error" role="alert"
                    >Per ogni carico indica anno (da 1990 a quest'anno) e protocollo.</small
                  >
                  <small
                    *ngIf="form.hasError('origineDuplicata') && (origini.dirty || form.touched)"
                    class="field-error"
                    role="alert"
                    data-testid="gi-origine-duplicata"
                    >Ogni coppia anno/protocollo può comparire una volta sola.</small
                  >
                  <small
                    *ngIf="form.hasError('origineSommaOltre') && (origini.dirty || form.touched)"
                    class="field-error"
                    role="alert"
                    data-testid="gi-origine-somma"
                    >La somma delle quantità dei carichi supera la giacenza.</small
                  >
                  <p-button
                    label="Aggiungi carico d'origine"
                    icon="pi pi-plus"
                    [text]="true"
                    size="small"
                    [disabled]="origini.length >= maxOrigini"
                    (onClick)="aggiungiOrigine()"
                    data-testid="gi-aggiungi-origine"
                    ariaLabel="Aggiungi un carico d'origine"
                  ></p-button>
                </div>
              </div>

              <div class="col-12">
                <div class="field">
                  <label for="gi-note">Note</label>
                  <textarea
                    id="gi-note"
                    pInputTextarea
                    formControlName="note"
                    rows="2"
                    maxlength="500"
                    class="w-full"
                  ></textarea>
                </div>
              </div>
            </div>

            <div class="gi-azioni">
              <p-button
                label="Annulla"
                [text]="true"
                (onClick)="chiudiForm()"
                ariaLabel="Annulla e chiudi il modulo"
              ></p-button>
              <p-button
                [label]="inModifica() ? 'Salva modifiche' : 'Aggiungi'"
                icon="pi pi-check"
                [loading]="salvataggio()"
                (onClick)="salva()"
                data-testid="gi-salva"
                ariaLabel="Salva la giacenza iniziale"
              ></p-button>
            </div>
          </form>
        </ng-container>
      </ng-container>

      <div *ngIf="avvisi().length" class="gi-avvisi" role="status" data-testid="gi-avvisi">
        <strong>Attenzione</strong>
        <p *ngFor="let a of avvisi()">{{ a }}</p>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .gi-sede,
      .gi-nota {
        margin: 0 0 var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .gi-bloccata {
        color: var(--text-tertiary);
        font-size: var(--font-size-xs);
      }
      .gi-conferma {
        font-size: var(--font-size-sm);
        margin-right: var(--spacing-sm);
      }
      .gi-form {
        margin-top: var(--spacing-base);
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }
      .gi-form-titolo {
        margin: 0 0 var(--spacing-base);
        font-family: var(--font-display);
        font-size: var(--font-size-base);
      }
      .gi-etichetta {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .gi-origine {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        align-items: center;
        margin-top: var(--spacing-sm);
      }
      .gi-azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-base);
      }
      .gi-avvisi {
        margin-top: var(--spacing-base);
        padding: var(--spacing-md) var(--spacing-base);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        background: var(--color-warning-bg);
        font-size: var(--font-size-sm);
      }
      .gi-avvisi p {
        margin: var(--spacing-xs) 0 0;
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
      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        line-height: 1.3;
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
        line-height: 1.3;
      }
    `,
  ],
})
export class GiacenzeInizialiDialogComponent implements OnChanges, OnDestroy {
  private readonly fb = inject(FormBuilder)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Registro a cui si riferiscono le aperture (sede filtrata o predefinita); assente = lo decide il backend. */
  @Input() registroId: string | null | undefined = undefined
  /** Etichetta della sede, solo con più registri. */
  @Input() sede: string | null = null

  readonly elenco = signal<ElencoGiacenzeIniziali | null>(null)
  readonly caricamento = signal(false)
  readonly erroreCaricamento = signal<string | null>(null)
  readonly salvataggio = signal(false)
  readonly avvisi = signal<string[]>([])
  readonly formAperto = signal(false)
  /** Apertura in modifica; null = nuova. */
  readonly inModifica = signal<GiacenzaInizialeInElenco | null>(null)
  readonly daEliminare = signal<string | null>(null)

  readonly oggi = oggiItaliano()
  readonly annoCorrente = annoItaliano(new Date())
  readonly quantitaMassima = QUANTITA_MASSIMA
  readonly maxOrigini = ORIGINI_MASSIME
  readonly etichettaUnita = etichettaUnita
  readonly etichettaStatoFisico = etichettaStatoFisico
  readonly dataItaliana = dataItaliana

  readonly form: FormGroup = this.creaForm()

  get origini(): FormArray {
    return this.form.get('origini') as FormArray
  }

  titolo(): string {
    return 'Giacenze iniziali' + (this.sede ? ` · ${this.sede}` : '')
  }

  statiFisiciOptions(): { label: string; value: string }[] {
    const base: { label: string; value: string }[] = STATI_FISICI.map(s => ({
      label: s,
      value: s.toUpperCase(),
    }))
    // Il backend salva lo stato in maiuscolo; se è un valore fuori elenco lo si conserva.
    const corrente = this.form.get('statoFisico')?.value as string | null
    if (corrente && !base.some(o => o.value === corrente)) {
      base.push({ label: corrente, value: corrente })
    }
    return base
  }

  unitaOptions(): { label: string; value: string }[] {
    const lista = [...UNITA_GIACENZA]
    const corrente = this.form.get('unita')?.value as string | null
    if (corrente && !lista.some(u => u.value === corrente)) {
      lista.push({ label: corrente, value: corrente })
    }
    return lista
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.chiudiForm()
      this.avvisi.set([])
      this.daEliminare.set(null)
      this.carica()
    }
  }

  /** Lettura in corso: una nuova la sostituisce, così una risposta vecchia non vince. */
  private lettura?: Subscription

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
  }

  carica(): void {
    this.lettura?.unsubscribe()
    this.caricamento.set(true)
    this.erroreCaricamento.set(null)
    this.lettura = this.registroService
      .getGiacenzeIniziali(this.registroId ?? undefined)
      .subscribe({
        next: el => {
          this.elenco.set(el)
          this.caricamento.set(false)
        },
        error: err => {
          this.elenco.set(null)
          this.caricamento.set(false)
          this.erroreCaricamento.set(messaggioErroreGiacenza(err))
        },
      })
  }

  errore(nome: string): boolean {
    const c = this.form.get(nome)
    return !!(c && c.invalid && c.touched)
  }

  aggiungiOrigine(o?: OrigineGiacenzaIniziale): void {
    if (this.origini.length >= ORIGINI_MASSIME) return
    this.origini.push(
      this.fb.group({
        anno: [
          o?.anno ?? null,
          [Validators.required, Validators.min(1990), Validators.max(this.annoCorrente)],
        ],
        protocollo: [o?.protocollo ?? null, [Validators.required, Validators.min(1)]],
        quantita: [o?.quantita ?? null, [Validators.min(0.01), Validators.max(QUANTITA_MASSIMA)]],
      })
    )
  }

  /** Chiede conferma e porta il focus sul "Sì" (da tastiera il pulsante apparirebbe senza focus). */
  chiediEliminazione(id: string): void {
    this.daEliminare.set(id)
    setTimeout(() => {
      const si = document.querySelector<HTMLElement>(
        `[data-testid="gi-elimina-conferma-${id}"] button`
      )
      si?.focus()
    })
  }

  rimuoviOrigine(i: number): void {
    this.origini.removeAt(i)
  }

  apriNuova(): void {
    this.inModifica.set(null)
    this.azzeraForm()
    this.form.get('cerCode')?.enable({ emitEvent: false })
    this.formAperto.set(true)
  }

  apriModifica(v: GiacenzaInizialeInElenco): void {
    this.inModifica.set(v)
    this.azzeraForm()
    this.form.patchValue({
      cerCode: v.cerCode,
      statoFisico: v.statoFisico,
      quantita: v.quantita,
      unita: v.unita,
      dataRiferimento: v.dataRiferimento,
      note: v.note ?? '',
    })
    for (const o of v.origini) this.aggiungiOrigine(o)
    // Il CER non si modifica e non si invia: il backend risponde 400 a un cerCode nel PUT.
    this.form.get('cerCode')?.disable({ emitEvent: false })
    this.formAperto.set(true)
  }

  chiudiForm(): void {
    this.formAperto.set(false)
    this.inModifica.set(null)
  }

  salva(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched()
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }
    const v = this.form.getRawValue()
    const comuni: DatiModificaGiacenzaIniziale = {
      statoFisico: v.statoFisico || null,
      quantita: Number(v.quantita),
      unita: v.unita,
      dataRiferimento: v.dataRiferimento,
      origini: (v.origini as any[]).map(o => ({
        anno: Number(o.anno),
        protocollo: Number(o.protocollo),
        ...(o.quantita != null ? { quantita: Number(o.quantita) } : {}),
      })),
      note: String(v.note ?? '').trim() || null,
    }
    const modifica = this.inModifica()
    this.salvataggio.set(true)
    this.avvisi.set([])

    if (modifica) {
      this.registroService.modificaGiacenzaIniziale(modifica.id, comuni).subscribe({
        next: () => {
          this.salvataggio.set(false)
          this.chiudiForm()
          this.toast.success('Giacenza iniziale aggiornata.')
          this.carica()
        },
        error: err => this.fallita(err),
      })
      return
    }

    const dati: DatiGiacenzaIniziale = { cerCode: v.cerCode, ...comuni }
    this.registroService.creaGiacenzaIniziale(dati, this.registroId ?? undefined).subscribe({
      next: esito => {
        this.salvataggio.set(false)
        this.chiudiForm()
        this.avvisi.set(esito.avvisi ?? [])
        this.toast.success('Giacenza iniziale registrata.')
        this.carica()
      },
      error: err => this.fallita(err),
    })
  }

  elimina(v: GiacenzaInizialeInElenco): void {
    this.salvataggio.set(true)
    this.registroService.eliminaGiacenzaIniziale(v.id).subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.daEliminare.set(null)
        this.toast.success('Giacenza iniziale eliminata.')
        this.carica()
      },
      error: err => {
        this.daEliminare.set(null)
        this.fallita(err)
        // Lo stato può essere cambiato (es. uno scarico nel frattempo): si rilegge.
        this.carica()
      },
    })
  }

  private fallita(err: any): void {
    this.salvataggio.set(false)
    this.toast.error(messaggioErroreGiacenza(err))
  }

  private azzeraForm(): void {
    this.origini.clear()
    this.form.reset({
      cerCode: '',
      statoFisico: null,
      quantita: null,
      unita: 'KG',
      dataRiferimento: null,
      note: '',
    })
  }

  private creaForm(): FormGroup {
    return this.fb.group(
      {
        cerCode: ['', [Validators.required, Validators.maxLength(20)]],
        statoFisico: [null as string | null],
        quantita: [
          null as number | null,
          [Validators.required, Validators.min(0.01), Validators.max(QUANTITA_MASSIMA)],
        ],
        unita: ['KG', Validators.required],
        dataRiferimento: [null as string | null, [Validators.required, dataNonFutura()]],
        origini: this.fb.array([]),
        note: ['', Validators.maxLength(500)],
      },
      { validators: [origineCoerente()] }
    )
  }
}
