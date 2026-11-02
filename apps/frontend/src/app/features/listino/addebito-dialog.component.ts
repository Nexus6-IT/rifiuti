import { CommonModule } from '@angular/common'
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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { SceltaConNuovoComponent } from '../clienti/scelta-con-nuovo.component'
import { messaggioErrore, permessoScrittura } from '../clienti/tabelle/tabella-comune'
import {
  Addebito,
  DatiAddebito,
  ModificaAddebito,
  NumeroListino,
  PrezzoListino,
  TipoProvvigione,
} from './listino.model'
import { ListinoService } from './listino.service'
import { CHIAVI_OPZIONE, ChiaveOpzione, OpzioniListino } from './opzioni-listino'
import { CodiceIvaDialogComponent } from './tabelle/codice-iva-dialog.component'
import { CodificaAddebitoDialogComponent } from './tabelle/codifica-addebito-dialog.component'
import {
  OPZIONI_TIPO_PROVVIGIONE,
  TIPI_ELENCABILI,
  etichettaTipo,
  tipoAddebitoValido,
} from './vocabolario-listino'

const NUMERI: readonly NumeroListino[] = [1, 2, 3, 4, 5, 6]
const FORMA_CON_CATEGORIA = /^([TM])\d{3}$/

/** Virgola → punto, spazi tolti, vuoto → null: il backend valida (D20), qui non si arrotonda. */
const decimale = (v: string): string | null => {
  const t = v.trim().replace(/,/g, '.')
  return t === '' ? null : t
}
const testo = (v: string): string | null => (v.trim() === '' ? null : v.trim())

interface CampoScelta {
  chiave: ChiaveOpzione
  controllo:
    | 'gruppoId'
    | 'categoriaId'
    | 'centroRicavoId'
    | 'categoriaStatistica1Id'
    | 'categoriaStatistica2Id'
    | 'codiceIvaId'
  id: string
  etichetta: string
  nuovo: string
}

const CAMPI: readonly CampoScelta[] = [
  {
    chiave: 'GRUPPO',
    controllo: 'gruppoId',
    id: 'gruppo',
    etichetta: 'Gruppo',
    nuovo: 'Nuovo gruppo',
  },
  {
    chiave: 'CATEGORIA',
    controllo: 'categoriaId',
    id: 'categoria',
    etichetta: 'Categoria',
    nuovo: 'Nuova categoria',
  },
  {
    chiave: 'CENTRO_RICAVO',
    controllo: 'centroRicavoId',
    id: 'centro',
    etichetta: 'Centro di ricavo',
    nuovo: 'Nuovo centro di ricavo',
  },
  {
    chiave: 'CATEGORIA_STATISTICA_1',
    controllo: 'categoriaStatistica1Id',
    id: 'stat1',
    etichetta: 'Categoria statistica 1',
    nuovo: 'Nuova categoria statistica 1',
  },
  {
    chiave: 'CATEGORIA_STATISTICA_2',
    controllo: 'categoriaStatistica2Id',
    id: 'stat2',
    etichetta: 'Categoria statistica 2',
    nuovo: 'Nuova categoria statistica 2',
  },
  {
    chiave: 'IVA',
    controllo: 'codiceIvaId',
    id: 'iva',
    etichetta: 'Codice IVA',
    nuovo: 'Nuovo codice IVA',
  },
]

const gruppoListino = () =>
  new FormGroup({
    prezzo: new FormControl('', { nonNullable: true }),
    sconto: new FormControl('', { nonNullable: true }),
    provvigione: new FormControl('', { nonNullable: true }),
  })

/**
 * Nuovo addebito o modifica, con la tabella dei sei listini (prezzo, sconto, provvigione). Prezzi,
 * sconti e provvigioni sono campi di testo e viaggiano come stringhe col punto (R12): la
 * validazione è del backend. Il tipo si sceglie dal menu dei tipi d'archivio; `T???` e `M???`
 * chiedono le tre cifre della categoria. Gruppo, categoria, centro di ricavo, statistiche e codice
 * IVA si possono creare in linea (`AggiuntaInLinea`). In modifica Salva si abilita solo a lettura
 * riuscita: il form vuoto non deve poter cancellare i campi. Con `rapida` (aggiunta in linea dal
 * dialog di una riga, R49) restano i soli campi obbligatori: descrizione, unità di misura, tipo e
 * gruppo; `salvato` restituisce l'addebito creato e Esc chiude solo questo dialog.
 */
@Component({
  selector: 'app-addebito-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    SceltaConNuovoComponent,
    CodificaAddebitoDialogComponent,
    CodiceIvaDialogComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="addebito ? 'Modifica addebito' : 'Nuovo addebito'"
      [modal]="true"
      [style]="{ width: '60rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <div class="riga">
          <div class="campo" *ngIf="!rapida">
            <label for="add-dlg-codice">Codice (vuoto = automatico)</label>
            <input
              pInputText
              id="add-dlg-codice"
              formControlName="codice"
              maxlength="5"
              inputmode="numeric"
              data-testid="add-dlg-codice"
            />
          </div>
          <div class="campo campo--largo">
            <label for="add-dlg-descrizione">Descrizione</label>
            <input
              pInputText
              id="add-dlg-descrizione"
              formControlName="descrizione"
              maxlength="100"
              data-testid="add-dlg-descrizione"
            />
          </div>
          <div class="campo">
            <label for="add-dlg-um">Unità di misura</label>
            <input
              pInputText
              id="add-dlg-um"
              formControlName="unitaMisura"
              maxlength="3"
              data-testid="add-dlg-um"
            />
          </div>
        </div>

        <div class="riga">
          <div class="campo campo--largo">
            <label for="add-dlg-tipo">Tipo di addebito</label>
            <select
              id="add-dlg-tipo"
              formControlName="tipo"
              class="p-inputtext"
              data-testid="add-dlg-tipo"
            >
              <option value="">—</option>
              <option *ngFor="let t of opzioniTipo()" [value]="t.tipo">
                {{ t.tipo }} - {{ t.etichetta }}
              </option>
            </select>
          </div>
          <div class="campo" *ngIf="chiedeCifre()">
            <label for="add-dlg-tipo-cifre">Categoria (tre cifre)</label>
            <input
              pInputText
              id="add-dlg-tipo-cifre"
              formControlName="tipoCifre"
              maxlength="3"
              inputmode="numeric"
              data-testid="add-dlg-tipo-cifre"
            />
          </div>
          <div class="campo" *ngIf="!rapida">
            <label for="add-dlg-tipo-provv">Provvigione calcolata</label>
            <select
              id="add-dlg-tipo-provv"
              formControlName="tipoProvvigione"
              class="p-inputtext"
              data-testid="add-dlg-tipo-provv"
            >
              <option *ngFor="let o of tipiProvvigione" [value]="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>

        <div class="griglia-scelte">
          <app-scelta-con-nuovo
            *ngFor="let c of campiMostrati()"
            [inputId]="'add-dlg-' + c.id + '-sel'"
            [testid]="'add-dlg-' + c.id"
            [etichetta]="c.etichetta"
            [controllo]="controllo(c.controllo)"
            [opzioni]="opzioni.lista[c.chiave]()"
            [nuovoEtichetta]="c.nuovo"
            [nuovoTestid]="'add-dlg-nuovo-' + c.id"
            [puoCreare]="puoScrivere()"
            (nuovo)="opzioni.inLinea.apri(c.chiave, 'create', $any($event))"
          />
        </div>

        <h3 class="sezione" *ngIf="!rapida">Listini</h3>
        <table
          class="listini"
          *ngIf="!rapida"
          formArrayName="listini"
          data-testid="add-dlg-listini"
        >
          <thead>
            <tr>
              <th scope="col">Listino</th>
              <th scope="col">Prezzo</th>
              <th scope="col">Sconto (es. 10+5)</th>
              <th scope="col">Provvigione (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let n of numeri; let i = index" [formGroupName]="i">
              <th scope="row">{{ n }}</th>
              <td>
                <input
                  pInputText
                  formControlName="prezzo"
                  inputmode="decimal"
                  [attr.aria-label]="'Prezzo del listino ' + n"
                  [attr.data-testid]="'add-dlg-prezzo-' + n"
                />
              </td>
              <td>
                <input
                  pInputText
                  formControlName="sconto"
                  [attr.aria-label]="'Sconto del listino ' + n"
                  [attr.data-testid]="'add-dlg-sconto-' + n"
                />
              </td>
              <td>
                <input
                  pInputText
                  formControlName="provvigione"
                  inputmode="decimal"
                  [attr.aria-label]="'Provvigione del listino ' + n"
                  [attr.data-testid]="'add-dlg-provv-' + n"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <ng-container *ngIf="!rapida">
          <label for="add-dlg-nota">Nota d'uso interno</label>
          <input
            pInputText
            id="add-dlg-nota"
            formControlName="notaUsoInterno"
            maxlength="200"
            data-testid="add-dlg-nota"
          />
          <label for="add-dlg-appunti">Appunti</label>
          <input
            pInputText
            id="add-dlg-appunti"
            formControlName="appunti"
            maxlength="500"
            data-testid="add-dlg-appunti"
          />
        </ng-container>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="add-dlg-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="!puoSalvare()"
          (onClick)="salva()"
          data-testid="add-dlg-salva"
        />
      </ng-template>
    </p-dialog>
    <app-codifica-addebito-dialog
      *ngFor="let g of generi"
      [visible]="opzioni.inLinea.aperto === g"
      [genere]="g"
      [rapida]="true"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoCodifica($event)"
    />
    <app-codice-iva-dialog
      [visible]="opzioni.inLinea.aperto === 'IVA'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoIva($event)"
    />
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .riga {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .campo {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 10rem;
      }
      .campo--largo {
        flex: 3 1 16rem;
      }
      .griglia-scelte {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        gap: 0.75rem;
      }
      .sezione {
        margin: 0.5rem 0 0;
      }
      .listini {
        width: 100%;
        border-collapse: collapse;
      }
      .listini th,
      .listini td {
        padding: 0.25rem;
        text-align: left;
      }
      .listini input {
        width: 100%;
      }
    `,
  ],
})
export class AddebitoDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() addebito: Addebito | null = null
  /** Aggiunta in linea (R49): solo i campi obbligatori. */
  @Input() rapida = false
  @Output() salvato = new EventEmitter<Addebito>()
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Dopo un 409 la riga dell'elenco è vecchia: l'elenco si ricarica. */
  @Output() daRicaricare = new EventEmitter<void>()

  readonly puoScrivere = permessoScrittura()
  readonly campi = CAMPI
  readonly generi = CHIAVI_OPZIONE.filter(c => c !== 'IVA') as Exclude<ChiaveOpzione, 'IVA'>[]
  readonly numeri = NUMERI
  readonly tipiProvvigione = OPZIONI_TIPO_PROVVIGIONE
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  /** Il tipo salvato, se non è fra quelli proposti, resta scelto. */
  readonly opzioniTipo = signal<readonly { tipo: string; etichetta: string }[]>(TIPI_ELENCABILI)

  readonly form = new FormGroup({
    codice: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^\d{0,5}$/)],
    }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    unitaMisura: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tipo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tipoCifre: new FormControl('', { nonNullable: true }),
    tipoProvvigione: new FormControl<TipoProvvigione>('SCONTATO', { nonNullable: true }),
    gruppoId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    categoriaId: new FormControl('', { nonNullable: true }),
    centroRicavoId: new FormControl('', { nonNullable: true }),
    categoriaStatistica1Id: new FormControl('', { nonNullable: true }),
    categoriaStatistica2Id: new FormControl('', { nonNullable: true }),
    codiceIvaId: new FormControl('', { nonNullable: true }),
    notaUsoInterno: new FormControl('', { nonNullable: true }),
    appunti: new FormControl('', { nonNullable: true }),
    listini: new FormArray(NUMERI.map(() => gruppoListino())),
  })

  readonly opzioni = new OpzioniListino(
    this.servizio,
    {
      GRUPPO: this.form.controls.gruppoId,
      CATEGORIA: this.form.controls.categoriaId,
      CENTRO_RICAVO: this.form.controls.centroRicavoId,
      CATEGORIA_STATISTICA_1: this.form.controls.categoriaStatistica1Id,
      CATEGORIA_STATISTICA_2: this.form.controls.categoriaStatistica2Id,
      IVA: this.form.controls.codiceIvaId,
    },
    messaggio => this.errore.set(messaggio)
  )

  private originale: Addebito | null = null
  private versione = 0
  private lettura?: Subscription
  private salvataggio?: Subscription

  campiMostrati(): readonly CampoScelta[] {
    return this.rapida ? CAMPI.filter(c => c.chiave === 'GRUPPO') : CAMPI
  }

  controllo(nome: CampoScelta['controllo']): FormControl<string> {
    return this.form.controls[nome]
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
    this.salvataggio?.unsubscribe()
    this.opzioni.azzera()
  }

  private azzera(): void {
    this.lettura?.unsubscribe()
    this.salvataggio?.unsubscribe()
    this.opzioni.azzera()
    this.form.reset({ tipoProvvigione: 'SCONTATO' })
    this.errore.set(null)
    this.inCorso.set(false)
    this.caricamento.set(false)
    this.originale = null
    this.opzioniTipo.set(TIPI_ELENCABILI)
  }

  private inizializza(): void {
    this.azzera()
    this.opzioni.carica()
    const a = this.addebito
    this.versione = a?.versione ?? 0
    if (!a) return
    this.caricamento.set(true)
    this.lettura = this.servizio.addebiti.get(a.id).subscribe({
      next: d => {
        this.originale = d
        this.versione = d.versione
        this.riempi(d)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrore(err, "Impossibile caricare l'addebito."))
      },
    })
  }

  private riempi(d: Addebito): void {
    const conCategoria = FORMA_CON_CATEGORIA.exec(d.tipo)
    if (!conCategoria && !TIPI_ELENCABILI.some(t => t.tipo === d.tipo)) {
      this.opzioniTipo.set([...TIPI_ELENCABILI, { tipo: d.tipo, etichetta: etichettaTipo(d.tipo) }])
    }
    this.opzioni.impostaCorrenti({
      GRUPPO: d.gruppo,
      CATEGORIA: d.categoria,
      CENTRO_RICAVO: d.centroRicavo,
      CATEGORIA_STATISTICA_1: d.categoriaStatistica1,
      CATEGORIA_STATISTICA_2: d.categoriaStatistica2,
      IVA: d.codiceIva,
    })
    this.form.reset({
      codice: d.codice,
      descrizione: d.descrizione,
      unitaMisura: d.unitaMisura,
      tipo: conCategoria ? `${conCategoria[1]}???` : d.tipo,
      tipoCifre: conCategoria ? d.tipo.slice(1) : '',
      tipoProvvigione: d.tipoProvvigione,
      gruppoId: d.gruppo.id,
      categoriaId: d.categoria?.id ?? '',
      centroRicavoId: d.centroRicavo?.id ?? '',
      categoriaStatistica1Id: d.categoriaStatistica1?.id ?? '',
      categoriaStatistica2Id: d.categoriaStatistica2?.id ?? '',
      codiceIvaId: d.codiceIva?.id ?? '',
      notaUsoInterno: d.notaUsoInterno ?? '',
      appunti: d.appunti ?? '',
      listini: NUMERI.map(n => {
        const l = d.listini.find(x => x.numero === n)
        return {
          prezzo: l?.prezzo ?? '',
          sconto: l?.sconto ?? '',
          provvigione: l?.provvigione ?? '',
        }
      }),
    })
  }

  chiedeCifre(): boolean {
    return this.form.controls.tipo.value.endsWith('???')
  }

  /** Il tipo come lo conosce il backend: `T???` + `123` → `T123`. */
  private tipoEffettivo(): string {
    const { tipo, tipoCifre } = this.form.getRawValue()
    return tipo.endsWith('???') ? `${tipo[0]}${tipoCifre.trim()}` : tipo
  }

  tipoCompleto(): boolean {
    return tipoAddebitoValido(this.tipoEffettivo())
  }

  /** In modifica serve il record letto (altrimenti il form vuoto cancellerebbe i campi). */
  puoSalvare(): boolean {
    if (this.inCorso() || this.caricamento() || !this.puoScrivere()) return false
    if (this.addebito && this.originale === null) return false
    return this.form.valid && this.tipoCompleto()
  }

  /** Esc in un sub-dialog chiude anche questo (PrimeNG): si ignora, o si perde il form. */
  alCambioVisibilita(visibile: boolean): void {
    if (!visibile && this.opzioni.inLinea.bloccaChiusuraEsterna(visibile)) return
    if (!visibile) this.chiudi()
  }

  private listini(): PrezzoListino[] {
    return this.form.controls.listini.controls.map((g, i) => {
      const v = g.getRawValue()
      return {
        numero: NUMERI[i],
        prezzo: decimale(v.prezzo),
        sconto: decimale(v.sconto),
        provvigione: decimale(v.provvigione),
      }
    })
  }

  salva(): void {
    if (!this.puoSalvare()) return
    const v = this.form.getRawValue()
    const comuni = {
      descrizione: v.descrizione.trim(),
      gruppoId: v.gruppoId,
      unitaMisura: v.unitaMisura.trim(),
      codiceIvaId: v.codiceIvaId || null,
      tipo: this.tipoEffettivo(),
      categoriaId: v.categoriaId || null,
      tipoProvvigione: v.tipoProvvigione,
      centroRicavoId: v.centroRicavoId || null,
      categoriaStatistica1Id: v.categoriaStatistica1Id || null,
      categoriaStatistica2Id: v.categoriaStatistica2Id || null,
      notaUsoInterno: testo(v.notaUsoInterno),
      appunti: testo(v.appunti),
      listini: this.listini(),
    }
    const codice = v.codice.trim()
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.addebito
      ? this.servizio.addebiti.modifica(this.addebito.id, {
          ...comuni,
          ...(codice !== '' && codice !== this.originale?.codice ? { codice } : {}),
          versione: this.versione,
        } satisfies ModificaAddebito)
      : this.servizio.addebiti.crea({
          ...comuni,
          ...(codice !== '' ? { codice } : {}),
        } satisfies DatiAddebito)
    this.salvataggio = chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        if ((err as { status?: number })?.status === 409) this.daRicaricare.emit()
        this.errore.set(messaggioErrore(err, "Impossibile salvare l'addebito."))
      },
    })
  }

  chiudi(): void {
    this.azzera()
    this.visibleChange.emit(false)
  }
}
