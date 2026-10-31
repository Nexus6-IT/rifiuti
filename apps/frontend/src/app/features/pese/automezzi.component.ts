/**
 * Anagrafica degli automezzi per le pese: targhe, trasportatore e tara.
 *
 * Nessuna regola di ruolo qui: `puoOperare` e `puoRettificare` arrivano dal backend. La tara
 * dichiarata (solo amministratori) e la tara da una pesata (operatori) hanno regole di dominio
 * (solo il lato a vuoto dello stesso automezzo) che arbitra il backend: i suoi messaggi
 * 400/403/404/409/422 si mostrano testuali. I pesi si digitano con la virgola (es. 12,5).
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import { RegistryService } from '../registry/registry.service'
import {
  dataItalianaDa,
  etichettaFonte,
  formattaKg,
  messaggioErrorePese,
  normalizzaTarga,
  taraVecchia,
} from './pese-formato'
import { PesoItalianoDirective } from './peso-it.directive'
import { AccessoRiepilogo, Automezzo, PeseService, PesataVista } from './pese.service'

const TARA_MASSIMA = 99_999_999.99

const decimaliAl2: ValidatorFn = c => {
  const v = c.value as number | null
  if (v == null) return null
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? null : { decimali: true }
}

type Modo = 'dichiarata' | 'pesata'

@Component({
  selector: 'app-pese-automezzi',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    TableModule,
    PesoItalianoDirective,
  ],
  template: `
    <div class="aut-barra">
      <p class="aut-nota">
        Le targhe si confrontano senza spazi, trattini e punti, in maiuscolo. La tara serve a
        calcolare il netto quando l'automezzo si pesa una volta sola.
      </p>
      <p-button
        *ngIf="puoOperare()"
        label="Nuovo automezzo"
        icon="pi pi-plus"
        (onClick)="apriAutomezzo(null, $event)"
        data-testid="aut-nuovo"
        ariaLabel="Aggiungi un automezzo"
      ></p-button>
    </div>

    <p *ngIf="caricamento()" role="status" class="aut-nota">Caricamento…</p>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error" data-testid="aut-errore-elenco">
      {{ e }}
    </p>

    <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="aut-tabella">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Targa</th>
          <th scope="col">Rimorchio</th>
          <th scope="col">Trasportatore</th>
          <th scope="col">Tara</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoOperare()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-a>
        <tr [attr.data-testid]="'aut-riga-' + a.id">
          <td>
            <strong>{{ a.targa }}</strong>
          </td>
          <td>{{ a.targaRimorchio || '—' }}</td>
          <td>{{ nomeTrasportatore(a.trasportatoreId) }}</td>
          <td>
            <ng-container *ngIf="a.taraKg != null; else senzaTara">
              {{ kg(a.taraKg) }}
              <small class="aut-nota"
                >{{ a.taraOrigine === 'PESATA' ? 'Da pesata' : 'Dichiarata' }}
                <ng-container *ngIf="a.taraAggiornataIl">
                  · {{ data(a.taraAggiornataIl) }}</ng-container
                ></small
              >
              <div
                *ngIf="vecchia(a)"
                class="aut-avviso"
                [attr.data-testid]="'aut-tara-vecchia-' + a.id"
              >
                Tara non aggiornata da oltre un anno: conviene rifarla.
              </div>
            </ng-container>
            <ng-template #senzaTara><span class="aut-nota">Nessuna tara</span></ng-template>
          </td>
          <td>{{ a.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td *ngIf="puoOperare()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apriAutomezzo(a, $event)"
              [attr.data-testid]="'aut-modifica-' + a.id"
              [ariaLabel]="'Modifica l\\'automezzo ' + a.targa"
            ></p-button>
            <p-button
              label="Tara"
              icon="pi pi-calculator"
              [text]="true"
              size="small"
              (onClick)="apriTara(a, $event)"
              [attr.data-testid]="'aut-tara-' + a.id"
              [ariaLabel]="'Imposta la tara dell\\'automezzo ' + a.targa"
            ></p-button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="puoOperare() ? 6 : 5">
            <span data-testid="aut-vuota">Nessun automezzo registrato.</span>
          </td>
        </tr>
      </ng-template>
    </p-table>

    <!-- Dialog nuovo / modifica -->
    <p-dialog
      [visible]="dialogAut() !== null"
      (visibleChange)="!$event && chiudiAutomezzo()"
      [header]="dialogAut()?.modifica ? 'Modifica automezzo' : 'Nuovo automezzo'"
      [modal]="true"
      [style]="{ width: '520px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra dell'automezzo"
    >
      <form [formGroup]="formAut" (ngSubmit)="salvaAutomezzo()" novalidate data-testid="aut-form">
        <div class="field">
          <label for="aut-targa">Targa <span class="req" aria-hidden="true">*</span></label>
          <input
            id="aut-targa"
            type="text"
            class="p-inputtext w-full"
            formControlName="targa"
            maxlength="40"
            autocomplete="off"
            aria-required="true"
            aria-describedby="aut-targa-aiuto"
            [attr.aria-invalid]="targaNonValida() ? true : null"
          />
          <small
            id="aut-targa-aiuto"
            data-testid="aut-targa-normalizzata"
            [class.field-error]="targaNonValida()"
            [attr.role]="targaNonValida() ? 'alert' : null"
          >
            <ng-container *ngIf="anteprimaTarga() as t; else nessuna">
              Verrà salvata come <strong>{{ t }}</strong
              >.
            </ng-container>
            <ng-template #nessuna>
              <ng-container *ngIf="formAut.value.targa; else vuota"
                >Targa non valida: servono 2-15 tra lettere e cifre (spazi, trattini e punti si
                ignorano).</ng-container
              >
              <ng-template #vuota
                >Lettere e cifre; spazi, trattini e punti si ignorano.</ng-template
              >
            </ng-template>
          </small>
        </div>
        <div class="field">
          <label for="aut-rimorchio">Targa del rimorchio</label>
          <input
            id="aut-rimorchio"
            type="text"
            class="p-inputtext w-full"
            formControlName="targaRimorchio"
            maxlength="40"
            autocomplete="off"
            aria-describedby="aut-rimorchio-aiuto"
          />
          <small id="aut-rimorchio-aiuto" data-testid="aut-rimorchio-normalizzata">
            <ng-container *ngIf="anteprimaRimorchio() as t"
              >Verrà salvata come <strong>{{ t }}</strong
              >.</ng-container
            >
            <ng-container *ngIf="!anteprimaRimorchio()">Facoltativa.</ng-container>
          </small>
        </div>
        <div class="field">
          <label for="aut-trasportatore">Trasportatore</label>
          <select
            id="aut-trasportatore"
            class="p-inputtext w-full"
            formControlName="trasportatoreId"
          >
            <option value="">Nessuno</option>
            <option *ngFor="let t of trasportatori()" [value]="t.id">{{ t.ragioneSociale }}</option>
          </select>
        </div>
        <div class="field">
          <label for="aut-note">Note</label>
          <textarea
            id="aut-note"
            class="p-inputtext w-full"
            formControlName="note"
            rows="2"
            maxlength="500"
          ></textarea>
        </div>
        <div class="field" *ngIf="dialogAut()?.modifica">
          <label class="aut-check"
            ><input type="checkbox" formControlName="attivo" /> Automezzo attivo</label
          >
        </div>
        <p *ngIf="erroreAut() as e" class="field-error" role="alert" data-testid="aut-errore">
          {{ e }}
        </p>
        <div class="aut-azioni">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudiAutomezzo()"
            ariaLabel="Annulla e chiudi"
          ></p-button>
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="salvataggio()"
            [disabled]="salvataggio()"
            (onClick)="salvaAutomezzo()"
            data-testid="aut-salva"
            ariaLabel="Salva l'automezzo"
          ></p-button>
        </div>
      </form>
    </p-dialog>

    <!-- Dialog tara -->
    <p-dialog
      [visible]="dialogTara() !== null"
      (visibleChange)="!$event && chiudiTara()"
      [header]="'Tara · ' + (dialogTara()?.targa ?? '')"
      [modal]="true"
      [style]="{ width: '540px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra della tara"
    >
      <div role="group" aria-label="Origine della tara" class="aut-modi">
        <p-button
          *ngIf="puoRettificare()"
          label="Dichiarata"
          [outlined]="modoTara() !== 'dichiarata'"
          size="small"
          (onClick)="scegliModo('dichiarata')"
          data-testid="tara-modo-dichiarata"
          [attr.aria-pressed]="modoTara() === 'dichiarata'"
          ariaLabel="Tara dichiarata"
        ></p-button>
        <p-button
          label="Da una pesata"
          [outlined]="modoTara() !== 'pesata'"
          size="small"
          (onClick)="scegliModo('pesata')"
          data-testid="tara-modo-pesata"
          [attr.aria-pressed]="modoTara() === 'pesata'"
          ariaLabel="Tara da una pesata"
        ></p-button>
      </div>

      <ng-container *ngIf="modoTara() === 'dichiarata'">
        <div class="field">
          <label id="tara-valore-etichetta" for="tara-valore"
            >Tara dichiarata (kg) <span class="req" aria-hidden="true">*</span></label
          >
          <p-inputNumber
            appPesoIt
            (rifiutato)="rifiutoPunto.set($event)"
            [formControl]="taraCtrl"
            inputId="tara-valore"
            mode="decimal"
            locale="it-IT"
            [minFractionDigits]="0"
            [maxFractionDigits]="2"
            [min]="0.01"
            [max]="taraMassima"
            ariaRequired="true"
            ariaLabelledBy="tara-valore-etichetta tara-valore-aiuto"
            styleClass="w-full"
          ></p-inputNumber>
          <small id="tara-valore-aiuto" class="field-hint"
            >Peso a vuoto del mezzo, con la virgola per i decimali (esempio 12500,5), al massimo due
            decimali.</small
          >
          <small
            *ngIf="erroreTaraPeso() as e"
            class="field-error"
            role="alert"
            data-testid="tara-peso-errore"
            >{{ e }}</small
          >
        </div>
      </ng-container>

      <ng-container *ngIf="modoTara() === 'pesata'">
        <p class="aut-nota">
          Si può usare solo il peso del lato a vuoto dello stesso automezzo: le altre pesate le
          rifiuta il sistema con la spiegazione.
        </p>
        <div class="field">
          <label for="tara-accesso">Accesso alla pesa</label>
          <select
            id="tara-accesso"
            class="p-inputtext w-full"
            (change)="scegliAccesso($any($event.target).value)"
          >
            <option value="">Seleziona un accesso</option>
            <option
              *ngFor="let a of accessiTara()"
              [value]="a.id"
              [selected]="a.id === accessoTara()"
            >
              {{ a.numero }} · {{ data(a.apertoIl) }} ·
              {{ a.verso === 'CARICO' ? 'Carico' : 'Scarico' }}
            </option>
          </select>
          <small *ngIf="!caricamentoTara() && accessiTara().length === 0" class="field-hint"
            >Nessun accesso recente per questa targa.</small
          >
        </div>
        <div class="field" *ngIf="accessoTara()">
          <label for="tara-pesata">Pesata</label>
          <select
            id="tara-pesata"
            class="p-inputtext w-full"
            (change)="pesataTara.set($any($event.target).value)"
          >
            <option value="">Seleziona una pesata</option>
            <option *ngFor="let p of pesateTara()" [value]="p.id">
              Pesata {{ p.ordine }} · {{ kg(p.pesoEffettivoKg) }} · {{ fonte(p.fonte) }}
            </option>
          </select>
        </div>
      </ng-container>

      <p *ngIf="erroreTara() as e" class="field-error" role="alert" data-testid="tara-errore">
        {{ e }}
      </p>
      <div class="aut-azioni">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="chiudiTara()"
          ariaLabel="Annulla e chiudi"
        ></p-button>
        <p-button
          label="Imposta tara"
          icon="pi pi-check"
          [loading]="salvataggio()"
          [disabled]="salvataggio()"
          (onClick)="salvaTara()"
          data-testid="tara-salva"
          ariaLabel="Imposta la tara"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .aut-barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-base);
        margin-bottom: var(--spacing-base);
      }
      .aut-nota {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .aut-avviso {
        margin-top: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--color-warning);
        font-weight: var(--font-weight-medium);
      }
      .aut-azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-base);
      }
      .aut-modi {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .aut-check {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .field > label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .req {
        color: var(--color-danger);
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
    `,
  ],
})
export class AutomezziComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly registry = inject(RegistryService)
  private readonly toast = inject(ToastService)

  readonly righe = signal<Automezzo[]>([])
  readonly puoOperare = signal(false)
  readonly puoRettificare = signal(false)
  readonly caricamento = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly trasportatori = signal<{ id: string; ragioneSociale: string }[]>([])
  readonly salvataggio = signal(false)

  readonly dialogAut = signal<{ modifica: Automezzo | null } | null>(null)
  readonly erroreAut = signal<string | null>(null)
  readonly formAut = new FormGroup({
    targa: new FormControl('', { nonNullable: true }),
    targaRimorchio: new FormControl('', { nonNullable: true }),
    trasportatoreId: new FormControl('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
    attivo: new FormControl(true, { nonNullable: true }),
  })

  readonly dialogTara = signal<Automezzo | null>(null)
  readonly modoTara = signal<Modo>('pesata')
  readonly erroreTara = signal<string | null>(null)
  readonly taraCtrl = new FormControl<number | null>(null, [decimaliAl2])
  readonly rifiutoPunto = signal<string | null>(null)
  readonly tentatoTara = signal(false)
  readonly accessiTara = signal<AccessoRiepilogo[]>([])
  readonly caricamentoTara = signal(false)
  readonly accessoTara = signal('')
  readonly pesateTara = signal<PesataVista[]>([])
  readonly pesataTara = signal('')
  readonly taraMassima = TARA_MASSIMA

  readonly kg = formattaKg
  readonly data = dataItalianaDa
  readonly fonte = etichettaFonte

  /** Elemento che aveva il focus prima di aprire un dialog, a cui tornare alla chiusura. */
  private ritorno: HTMLElement | null = null

  ngOnInit(): void {
    this.carica()
    this.registry.getTrasportatori(1, 100).subscribe({
      next: r =>
        this.trasportatori.set(r.items.map(t => ({ id: t.id, ragioneSociale: t.ragioneSociale }))),
      error: () => this.trasportatori.set([]),
    })
  }

  carica(): void {
    this.caricamento.set(true)
    this.erroreElenco.set(null)
    this.pese.elencaAutomezzi().subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.puoOperare.set(e.puoOperare)
        this.puoRettificare.set(e.puoRettificare)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile leggere gli automezzi.'))
      },
    })
  }

  nomeTrasportatore(id: string | null): string {
    if (!id) return '—'
    return this.trasportatori().find(t => t.id === id)?.ragioneSociale ?? '—'
  }

  vecchia(a: Automezzo): boolean {
    return taraVecchia(a.taraAggiornataIl)
  }

  // --- automezzo ---------------------------------------------------------------------------
  anteprimaTarga(): string | null {
    return normalizzaTarga(this.formAut.value.targa ?? '')
  }
  anteprimaRimorchio(): string | null {
    return normalizzaTarga(this.formAut.value.targaRimorchio ?? '')
  }
  targaNonValida(): boolean {
    return !!this.formAut.value.targa && !this.anteprimaTarga()
  }

  apriAutomezzo(a: Automezzo | null, ev?: unknown): void {
    this.ricordaFuoco(ev)
    this.erroreAut.set(null)
    this.formAut.reset({
      targa: a?.targa ?? '',
      targaRimorchio: a?.targaRimorchio ?? '',
      trasportatoreId: a?.trasportatoreId ?? '',
      note: a?.note ?? '',
      attivo: a?.attivo ?? true,
    })
    this.dialogAut.set({ modifica: a })
    this.focus('aut-targa')
  }

  chiudiAutomezzo(): void {
    this.dialogAut.set(null)
    this.ripristinaFuoco()
  }

  salvaAutomezzo(): void {
    const dlg = this.dialogAut()
    if (!dlg || this.salvataggio()) return
    const v = this.formAut.getRawValue()
    if (!this.anteprimaTarga()) {
      this.erroreAut.set('Indicare una targa valida (2-15 tra lettere e cifre).')
      this.focus('aut-targa')
      return
    }
    const rimorchio = v.targaRimorchio.trim()
    if (rimorchio && !normalizzaTarga(rimorchio)) {
      this.erroreAut.set('La targa del rimorchio non è valida.')
      this.focus('aut-rimorchio')
      return
    }
    this.erroreAut.set(null)
    const dati = {
      targa: v.targa.trim(),
      targaRimorchio: rimorchio || null,
      trasportatoreId: v.trasportatoreId || null,
      note: v.note.trim() || null,
      ...(dlg.modifica ? { attivo: v.attivo } : {}),
    }
    this.salvataggio.set(true)
    const richiesta = dlg.modifica
      ? this.pese.aggiornaAutomezzo(dlg.modifica.id, dati)
      : this.pese.creaAutomezzo(dati)
    richiesta.subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.chiudiAutomezzo()
        this.toast.success(dlg.modifica ? 'Automezzo aggiornato.' : 'Automezzo registrato.')
        this.carica()
      },
      error: err => {
        this.salvataggio.set(false)
        this.erroreAut.set(messaggioErrorePese(err, "Salvataggio dell'automezzo non riuscito."))
      },
    })
  }

  // --- tara --------------------------------------------------------------------------------
  apriTara(a: Automezzo, ev?: unknown): void {
    this.ricordaFuoco(ev)
    this.erroreTara.set(null)
    this.taraCtrl.reset(null)
    this.rifiutoPunto.set(null)
    this.tentatoTara.set(false)
    this.accessoTara.set('')
    this.pesateTara.set([])
    this.pesataTara.set('')
    this.accessiTara.set([])
    this.dialogTara.set(a)
    this.scegliModo(this.puoRettificare() ? 'dichiarata' : 'pesata')
  }

  chiudiTara(): void {
    this.dialogTara.set(null)
    this.ripristinaFuoco()
  }

  scegliModo(m: Modo): void {
    this.modoTara.set(m)
    this.erroreTara.set(null)
    if (m === 'pesata') {
      const a = this.dialogTara()
      if (a && this.accessiTara().length === 0) {
        this.caricamentoTara.set(true)
        this.pese.elencaAccessi({ targa: a.targa }).subscribe({
          next: e => {
            this.accessiTara.set(e.righe.filter(r => r.stato !== 'ANNULLATO'))
            this.caricamentoTara.set(false)
          },
          error: err => {
            this.caricamentoTara.set(false)
            this.erroreTara.set(messaggioErrorePese(err, 'Impossibile leggere gli accessi.'))
          },
        })
      }
      this.focus('tara-accesso')
    } else {
      this.focus('tara-valore')
    }
  }

  scegliAccesso(id: string): void {
    this.accessoTara.set(id)
    this.pesateTara.set([])
    this.pesataTara.set('')
    this.erroreTara.set(null)
    if (!id) return
    this.pese.dettaglioAccesso(id).subscribe({
      next: acc => this.pesateTara.set(acc.pesate),
      error: err => this.erroreTara.set(messaggioErrorePese(err, "Impossibile leggere l'accesso.")),
    })
  }

  erroreTaraPeso(): string | null {
    if (this.rifiutoPunto()) return this.rifiutoPunto()
    if (!this.tentatoTara() && !this.taraCtrl.touched) return null
    const v = this.taraCtrl.value
    if (v == null) return this.tentatoTara() ? 'Indicare la tara.' : null
    if (v < 0.01) return 'La tara deve essere maggiore di zero.'
    if (this.taraCtrl.hasError('decimali')) return 'Al massimo due decimali.'
    return null
  }

  salvaTara(): void {
    const a = this.dialogTara()
    if (!a || this.salvataggio()) return
    let richiesta
    if (this.modoTara() === 'dichiarata') {
      this.tentatoTara.set(true)
      if (this.rifiutoPunto() || this.erroreTaraPeso() || this.taraCtrl.value == null) {
        this.focus('tara-valore')
        return
      }
      richiesta = this.pese.impostaTara(a.id, { taraKg: this.taraCtrl.value })
    } else {
      if (!this.pesataTara()) {
        this.erroreTara.set('Scegliere la pesata da cui prendere la tara.')
        return
      }
      richiesta = this.pese.impostaTara(a.id, { pesataId: this.pesataTara() })
    }
    this.erroreTara.set(null)
    this.salvataggio.set(true)
    richiesta.subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.chiudiTara()
        this.toast.success('Tara aggiornata.')
        this.carica()
      },
      error: err => {
        this.salvataggio.set(false)
        this.erroreTara.set(messaggioErrorePese(err, 'Impostazione della tara non riuscita.'))
      },
    })
  }

  // --- focus -------------------------------------------------------------------------------
  private ricordaFuoco(ev: unknown): void {
    const e = ev as { target?: EventTarget | null } | undefined
    const el = (e?.target as HTMLElement | undefined)?.closest?.('button') ?? null
    this.ritorno = el ?? (document.activeElement as HTMLElement | null)
  }
  private ripristinaFuoco(): void {
    const el = this.ritorno
    this.ritorno = null
    setTimeout(() => el?.isConnected && el.focus())
  }
  private focus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus())
  }
}
