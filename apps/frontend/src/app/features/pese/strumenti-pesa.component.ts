/**
 * Anagrafica degli strumenti di pesa: matricola, portata, divisione e ultima verificazione.
 *
 * La gestione e' degli amministratori: `puoRettificare` arriva dal backend e decide se
 * mostrare i pulsanti (la regola vera resta nel backend, che risponde 403). Portata e
 * divisione si digitano con la virgola (0,5): il punto e' rifiutato, mai trasformato in silenzio.
 * I messaggi 400/403/404/409/422 del backend si mostrano testuali.
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import {
  dataItalianaDa,
  formattaKg,
  giornoRoma,
  messaggioErrorePese,
  verificazioneScaduta,
} from './pese-formato'
import { PesoItalianoDirective } from './peso-it.directive'
import { PeseService, StrumentoPesa } from './pese.service'

// Come le colonne: portata Decimal(10,2), divisione Decimal(8,3).
const MASSIMO_PORTATA = 99_999_999.99
const MASSIMO_DIVISIONE = 99_999.999

const decimaliMax =
  (n: number): ValidatorFn =>
  c => {
    const v = c.value as number | null
    if (v == null) return null
    const f = 10 ** n
    return Math.abs(v * f - Math.round(v * f)) < 1e-6 ? null : { decimali: n }
  }

@Component({
  selector: 'app-pese-strumenti',
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
    <div class="str-barra">
      <p *ngIf="!puoGestire()" class="str-nota" data-testid="str-sola-lettura">
        Gli strumenti di pesa li gestisce un amministratore dell'azienda.
      </p>
      <p-button
        *ngIf="puoGestire()"
        label="Nuovo strumento"
        icon="pi pi-plus"
        (onClick)="apri(null, $event)"
        data-testid="str-nuovo"
        ariaLabel="Aggiungi uno strumento di pesa"
      ></p-button>
    </div>

    <p *ngIf="caricamento()" role="status" class="str-nota">Caricamento…</p>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error" data-testid="str-errore-elenco">
      {{ e }}
    </p>

    <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="str-tabella">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Strumento</th>
          <th scope="col">Matricola</th>
          <th scope="col">Portata</th>
          <th scope="col">Divisione</th>
          <th scope="col">Ultima verificazione</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoGestire()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr [attr.data-testid]="'str-riga-' + s.id">
          <td>
            <strong>{{ s.descrizione }}</strong>
            <div class="str-nota" *ngIf="s.costruttore || s.modello">
              {{ costruttoreModello(s) }}
            </div>
          </td>
          <td>{{ s.matricola || '—' }}</td>
          <td>{{ s.portataMaxKg != null ? kg(s.portataMaxKg) : '—' }}</td>
          <td>{{ s.divisioneKg != null ? kg(s.divisioneKg) : '—' }}</td>
          <td>
            <ng-container *ngIf="s.dataUltimaVerificazione; else mancaVerifica">
              {{ data(s.dataUltimaVerificazione) }}
              <div
                *ngIf="scaduta(s)"
                class="str-avviso"
                [attr.data-testid]="'str-verificazione-scaduta-' + s.id"
              >
                Verificazione periodica scaduta (oltre tre anni).
              </div>
            </ng-container>
            <ng-template #mancaVerifica>
              <div class="str-avviso" [attr.data-testid]="'str-verificazione-scaduta-' + s.id">
                Nessuna verificazione registrata.
              </div>
            </ng-template>
          </td>
          <td>{{ s.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td *ngIf="puoGestire()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(s, $event)"
              [attr.data-testid]="'str-modifica-' + s.id"
              [ariaLabel]="'Modifica lo strumento ' + s.descrizione"
            ></p-button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="puoGestire() ? 7 : 6">
            <span data-testid="str-vuota">Nessuno strumento di pesa registrato.</span>
          </td>
        </tr>
      </ng-template>
    </p-table>

    <p-dialog
      [visible]="dialogo() !== null"
      (visibleChange)="!$event && chiudi()"
      [header]="dialogo()?.modifica ? 'Modifica strumento' : 'Nuovo strumento'"
      [modal]="true"
      [style]="{ width: '620px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra dello strumento"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" novalidate data-testid="str-form">
        <div class="field">
          <label for="str-descrizione"
            >Descrizione <span class="req" aria-hidden="true">*</span></label
          >
          <input
            id="str-descrizione"
            type="text"
            class="p-inputtext w-full"
            formControlName="descrizione"
            maxlength="255"
            aria-required="true"
            [attr.aria-invalid]="tentato() && !form.value.descrizione?.trim() ? true : null"
            [attr.aria-describedby]="
              tentato() && !form.value.descrizione?.trim() ? 'str-descrizione-errore' : null
            "
          />
          <small
            *ngIf="tentato() && !form.value.descrizione?.trim()"
            id="str-descrizione-errore"
            class="field-error"
            role="alert"
            data-testid="str-descrizione-errore"
            >La descrizione è obbligatoria.</small
          >
        </div>
        <div class="str-griglia">
          <div class="field">
            <label for="str-costruttore">Costruttore</label>
            <input
              id="str-costruttore"
              type="text"
              class="p-inputtext w-full"
              formControlName="costruttore"
              maxlength="100"
            />
          </div>
          <div class="field">
            <label for="str-modello">Modello</label>
            <input
              id="str-modello"
              type="text"
              class="p-inputtext w-full"
              formControlName="modello"
              maxlength="100"
            />
          </div>
          <div class="field">
            <label for="str-matricola">Matricola</label>
            <input
              id="str-matricola"
              type="text"
              class="p-inputtext w-full"
              formControlName="matricola"
              maxlength="100"
            />
          </div>
          <div class="field" *ngIf="registri().length > 1">
            <label for="str-registro">Registro (sede)</label>
            <select id="str-registro" class="p-inputtext w-full" formControlName="registroId">
              <option value="">Tutta l'azienda</option>
              <option *ngFor="let r of registri()" [value]="r.id">{{ r.denominazione }}</option>
            </select>
          </div>
          <div class="field">
            <label id="str-portata-etichetta" for="str-portata">Portata massima (kg)</label>
            <p-inputNumber
              [messaggioInterno]="false"
              [useGrouping]="false"
              appPesoIt
              (rifiutato)="rifiutoPortata.set($event)"
              formControlName="portataMaxKg"
              inputId="str-portata"
              mode="decimal"
              locale="it-IT"
              [minFractionDigits]="0"
              [maxFractionDigits]="2"
              [min]="0.01"
              [max]="massimoPortata"
              ariaLabelledBy="str-portata-etichetta"
              pesoAiutoId="str-portata-aiuto"
              [pesoErroreId]="
                erroreNumero('portataMaxKg', rifiutoPortata()) ? 'str-portata-errore' : null
              "
              styleClass="w-full"
            ></p-inputNumber>
            <small id="str-portata-aiuto" class="field-hint"
              >Con la virgola per i decimali (al massimo due). Niente separatore delle migliaia.
              Facoltativa.</small
            >
            <small
              *ngIf="erroreNumero('portataMaxKg', rifiutoPortata()) as e"
              class="field-error"
              role="alert"
              id="str-portata-errore"
              data-testid="str-portata-errore"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label id="str-divisione-etichetta" for="str-divisione">Divisione (kg)</label>
            <p-inputNumber
              [messaggioInterno]="false"
              [useGrouping]="false"
              appPesoIt
              (rifiutato)="rifiutoDivisione.set($event)"
              formControlName="divisioneKg"
              inputId="str-divisione"
              mode="decimal"
              locale="it-IT"
              [minFractionDigits]="0"
              [maxFractionDigits]="3"
              [min]="0.001"
              [max]="massimoDivisione"
              ariaLabelledBy="str-divisione-etichetta"
              pesoAiutoId="str-divisione-aiuto"
              [pesoErroreId]="
                erroreNumero('divisioneKg', rifiutoDivisione()) ? 'str-divisione-errore' : null
              "
              styleClass="w-full"
            ></p-inputNumber>
            <small id="str-divisione-aiuto" class="field-hint"
              >Esempio 0,5, al massimo tre decimali. Niente separatore delle migliaia. Un peso non
              multiplo della divisione genera un avviso.</small
            >
            <small
              *ngIf="erroreNumero('divisioneKg', rifiutoDivisione()) as e"
              class="field-error"
              role="alert"
              id="str-divisione-errore"
              data-testid="str-divisione-errore"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label for="str-data">Ultima verificazione</label>
            <input
              id="str-data"
              type="date"
              class="p-inputtext w-full"
              formControlName="dataUltimaVerificazione"
              [attr.max]="oggi"
            />
          </div>
        </div>
        <div class="field" *ngIf="dialogo()?.modifica">
          <label class="str-check"
            ><input type="checkbox" formControlName="attivo" /> Strumento attivo</label
          >
        </div>
        <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="str-errore">
          {{ e }}
        </p>
        <div class="str-azioni">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudi()"
            ariaLabel="Annulla e chiudi"
          ></p-button>
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="salvataggio()"
            [disabled]="salvataggio()"
            (onClick)="salva()"
            data-testid="str-salva"
            ariaLabel="Salva lo strumento"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [
    `
      .str-barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-base);
      }
      .str-nota {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .str-avviso {
        font-size: var(--font-size-xs);
        color: var(--color-warning);
        font-weight: var(--font-weight-medium);
      }
      .str-griglia {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0 var(--spacing-base);
      }
      .str-azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-base);
      }
      .str-check {
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
export class StrumentiPesaComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)

  readonly righe = signal<StrumentoPesa[]>([])
  readonly puoGestire = signal(false)
  readonly caricamento = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly registri = signal<RegistroVista[]>([])
  readonly dialogo = signal<{ modifica: StrumentoPesa | null } | null>(null)
  readonly errore = signal<string | null>(null)
  readonly salvataggio = signal(false)
  readonly tentato = signal(false)
  readonly rifiutoPortata = signal<string | null>(null)
  readonly rifiutoDivisione = signal<string | null>(null)

  readonly oggi = giornoRoma()
  readonly massimoPortata = MASSIMO_PORTATA
  readonly massimoDivisione = MASSIMO_DIVISIONE
  readonly kg = formattaKg
  readonly data = dataItalianaDa

  readonly form = new FormGroup({
    descrizione: new FormControl('', { nonNullable: true }),
    costruttore: new FormControl('', { nonNullable: true }),
    modello: new FormControl('', { nonNullable: true }),
    matricola: new FormControl('', { nonNullable: true }),
    registroId: new FormControl('', { nonNullable: true }),
    portataMaxKg: new FormControl<number | null>(null, [decimaliMax(2)]),
    divisioneKg: new FormControl<number | null>(null, [decimaliMax(3)]),
    dataUltimaVerificazione: new FormControl('', { nonNullable: true }),
    attivo: new FormControl(true, { nonNullable: true }),
  })

  private ritorno: HTMLElement | null = null

  ngOnInit(): void {
    this.carica()
    this.registroService.listRegistri().subscribe({
      next: r => this.registri.set(r),
      error: () => this.registri.set([]),
    })
  }

  carica(): void {
    this.caricamento.set(true)
    this.erroreElenco.set(null)
    this.pese.elencaStrumenti().subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.puoGestire.set(e.puoRettificare)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile leggere gli strumenti.'))
      },
    })
  }

  costruttoreModello(s: StrumentoPesa): string {
    return [s.costruttore, s.modello].filter(x => !!x).join(' ')
  }

  scaduta(s: StrumentoPesa): boolean {
    return (
      !!s.dataUltimaVerificazione && verificazioneScaduta(s.dataUltimaVerificazione, giornoRoma())
    )
  }

  erroreNumero(campo: 'portataMaxKg' | 'divisioneKg', rifiuto: string | null): string | null {
    if (rifiuto) return rifiuto
    const c = this.form.controls[campo]
    if (c.hasError('decimali')) {
      return campo === 'divisioneKg' ? 'Al massimo tre decimali.' : 'Al massimo due decimali.'
    }
    const minimo = campo === 'divisioneKg' ? 0.001 : 0.01
    if (this.tentato() && c.value != null && c.value < minimo)
      return 'Deve essere maggiore di zero.'
    return null
  }

  apri(s: StrumentoPesa | null, ev?: unknown): void {
    const el = ((ev as { target?: EventTarget })?.target as HTMLElement | undefined)?.closest?.(
      'button'
    )
    this.ritorno = el ?? (document.activeElement as HTMLElement | null)
    this.errore.set(null)
    this.tentato.set(false)
    this.rifiutoPortata.set(null)
    this.rifiutoDivisione.set(null)
    this.form.reset({
      descrizione: s?.descrizione ?? '',
      costruttore: s?.costruttore ?? '',
      modello: s?.modello ?? '',
      matricola: s?.matricola ?? '',
      registroId: s?.registroId ?? '',
      portataMaxKg: s?.portataMaxKg ?? null,
      divisioneKg: s?.divisioneKg ?? null,
      dataUltimaVerificazione: s?.dataUltimaVerificazione ?? '',
      attivo: s?.attivo ?? true,
    })
    this.dialogo.set({ modifica: s })
    setTimeout(() => document.getElementById('str-descrizione')?.focus())
  }

  chiudi(): void {
    this.dialogo.set(null)
    const el = this.ritorno
    this.ritorno = null
    setTimeout(() => el?.isConnected && el.focus())
  }

  salva(): void {
    const dlg = this.dialogo()
    if (!dlg || this.salvataggio()) return
    this.tentato.set(true)
    const v = this.form.getRawValue()
    if (!v.descrizione.trim()) {
      document.getElementById('str-descrizione')?.focus()
      return
    }
    if (
      this.rifiutoPortata() ||
      this.rifiutoDivisione() ||
      this.erroreNumero('portataMaxKg', null) ||
      this.erroreNumero('divisioneKg', null)
    ) {
      return
    }
    this.errore.set(null)
    const dati = {
      descrizione: v.descrizione.trim(),
      costruttore: v.costruttore.trim() || null,
      modello: v.modello.trim() || null,
      matricola: v.matricola.trim() || null,
      registroId: v.registroId || null,
      portataMaxKg: v.portataMaxKg,
      divisioneKg: v.divisioneKg,
      dataUltimaVerificazione: v.dataUltimaVerificazione || null,
      ...(dlg.modifica ? { attivo: v.attivo } : {}),
    }
    this.salvataggio.set(true)
    const richiesta = dlg.modifica
      ? this.pese.aggiornaStrumento(dlg.modifica.id, dati)
      : this.pese.creaStrumento(dati)
    richiesta.subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.chiudi()
        this.toast.success(dlg.modifica ? 'Strumento aggiornato.' : 'Strumento registrato.')
        this.carica()
      },
      error: err => {
        this.salvataggio.set(false)
        this.errore.set(messaggioErrorePese(err, 'Salvataggio dello strumento non riuscito.'))
      },
    })
  }
}
