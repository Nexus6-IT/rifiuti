/**
 * Nuovo ritiro o modifica. In creazione si può ripetere il ritiro («ogni N giorni/settimane fino
 * al…», al massimo 52 occorrenze) con l'anteprima delle date. La chiave di idempotenza nasce
 * all'apertura e si riusa ai tentativi successivi: un nuovo invio dopo un errore di rete non crea
 * doppioni. Le sedi si scelgono solo se la ditta ne ha più d'una attiva.
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { Observable } from 'rxjs'
import { CerSelectComponent } from '../cer/cer-select.component'
import { ProvenienzaRifiuto, TipoTratta } from '../fir/fir.service'
import { Automezzo, PeseService } from '../pese/pese.service'
import { AnagraficaSelectComponent } from '../registry/anagrafica-select.component'
import { RegistryService } from '../registry/registry.service'
import { CampoDataComponent } from '../../shared/components/campo-data.component'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'
import { SedeDitta } from '../../shared/models/registry.model'
import { STILI_RITIRI } from './ritiri-stili'
import {
  anteprimaDate,
  dataItaliana,
  DatiRitiro,
  ETICHETTA_FASCIA,
  FasciaRitiro,
  MAX_OCCORRENZE,
  messaggioErroreRitiri,
  RipetizioneRitiro,
  RisultatoCreazioneRitiri,
  RitiroVista,
} from './ritiri.model'
import { RitiriService } from './ritiri.service'

const STATI_FISICI = ['Solido', 'Liquido', 'Fangoso', 'Polvere']
const UNITA = ['kg', 't', 'litri']
const SEDE_NON_SCELTA = ''

type Ruolo = 'produttore' | 'destinatario'
type ValoriForm = {
  ripeti: boolean
  intervallo: number | null
  unitaRipetizione: 'giorni' | 'settimane'
  fino: string
}

@Component({
  selector: 'app-ritiro-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    NumeroItalianoDirective,
    CampoDataComponent,
    CerSelectComponent,
    AnagraficaSelectComponent,
  ],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      [header]="ritiro ? 'Modifica ritiro' : 'Nuovo ritiro'"
      [modal]="true"
      [style]="{ width: '760px', maxWidth: '95vw' }"
      [closeAriaLabel]="ritiro ? 'Chiudi la modifica del ritiro' : 'Chiudi il nuovo ritiro'"
    >
      <form [formGroup]="form" (submit)="$event.preventDefault()" novalidate data-testid="rd-form">
        <div class="griglia">
          <div class="field">
            <label for="rd-data">Data prevista <span class="req" aria-hidden="true">*</span></label>
            <app-campo-data
              inputId="rd-data"
              formControlName="dataPrevista"
              data-testid="rd-data"
              ariaDescribedby="rd-data-errore"
              [ariaInvalid]="!!errore('dataPrevista')"
            />
            <small
              *ngIf="errore('dataPrevista') as e"
              id="rd-data-errore"
              class="field-error"
              role="alert"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label for="rd-fascia">Fascia</label>
            <select
              id="rd-fascia"
              class="p-inputtext w-full"
              formControlName="fascia"
              data-testid="rd-fascia"
            >
              <option value="">Nessuna</option>
              <option *ngFor="let f of fasce" [value]="f[0]">{{ f[1] }}</option>
            </select>
          </div>
          <div class="field">
            <label for="rd-ordine">Ordine nel giro</label>
            <p-inputNumber
              appNumeroIt
              soloIntero
              inputId="rd-ordine"
              formControlName="ordineGiro"
              locale="it-IT"
              [useGrouping]="false"
              [maxFractionDigits]="0"
              [min]="1"
              [max]="999"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
        </div>

        <h3 class="titolo-sezione">Soggetti</h3>
        <div class="griglia">
          <div class="field">
            <label for="rd-produttore"
              >Produttore <span class="req" aria-hidden="true">*</span></label
            >
            <app-anagrafica-select
              #produttoreSel
              registro="produttori"
              inputId="rd-produttore"
              ariaLabel="Produttore del rifiuto"
              formControlName="produttoreId"
              [preselezionaSeUnica]="false"
              [required]="true"
              [invalid]="!!errore('produttoreId')"
              (ngModelChange)="alCambioSoggetto('produttore')"
              data-testid="rd-produttore"
            />
            <small *ngIf="errore('produttoreId') as e" class="field-error" role="alert">{{
              e
            }}</small>
          </div>
          <div class="field" *ngIf="sediProduttore().length > 1">
            <label for="rd-sede-produttore">Sede del produttore</label>
            <select
              id="rd-sede-produttore"
              class="p-inputtext w-full"
              formControlName="produttoreSedeId"
              data-testid="rd-sede-produttore"
            >
              <option *ngFor="let s of sediProduttore()" [value]="s.id">
                {{ etichettaSede(s) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label for="rd-trasportatore"
              >Trasportatore <span class="req" aria-hidden="true">*</span></label
            >
            <app-anagrafica-select
              registro="trasportatori"
              inputId="rd-trasportatore"
              ariaLabel="Trasportatore"
              formControlName="trasportatoreId"
              [preselezionaSeUnica]="false"
              [required]="true"
              [invalid]="!!errore('trasportatoreId')"
              data-testid="rd-trasportatore"
            />
            <small *ngIf="errore('trasportatoreId') as e" class="field-error" role="alert">{{
              e
            }}</small>
          </div>
          <div class="field">
            <label for="rd-destinatario"
              >Destinatario <span class="req" aria-hidden="true">*</span></label
            >
            <app-anagrafica-select
              #destinatarioSel
              registro="destinatari"
              inputId="rd-destinatario"
              ariaLabel="Destinatario"
              formControlName="destinatarioId"
              [preselezionaSeUnica]="false"
              [required]="true"
              [invalid]="!!errore('destinatarioId')"
              (ngModelChange)="alCambioSoggetto('destinatario')"
              data-testid="rd-destinatario"
            />
            <small *ngIf="errore('destinatarioId') as e" class="field-error" role="alert">{{
              e
            }}</small>
          </div>
          <div class="field" *ngIf="sediDestinatario().length > 1">
            <label for="rd-sede-destinatario">Sede del destinatario</label>
            <select
              id="rd-sede-destinatario"
              class="p-inputtext w-full"
              formControlName="destinatarioSedeId"
              data-testid="rd-sede-destinatario"
            >
              <option *ngFor="let s of sediDestinatario()" [value]="s.id">
                {{ etichettaSede(s) }}
              </option>
            </select>
          </div>
          <div class="field" *ngIf="automezzi().length">
            <label for="rd-automezzo">Automezzo</label>
            <select
              id="rd-automezzo"
              class="p-inputtext w-full"
              formControlName="automezzoId"
              data-testid="rd-automezzo"
            >
              <option value="">Nessuno</option>
              <option *ngFor="let a of automezzi()" [value]="a.id">{{ a.targa }}</option>
            </select>
          </div>
        </div>

        <h3 class="titolo-sezione">Rifiuto</h3>
        <div class="griglia">
          <div class="field">
            <label for="rd-cer">Codice CER <span class="req" aria-hidden="true">*</span></label>
            <app-cer-select
              inputId="rd-cer"
              ariaLabel="Codice CER del rifiuto"
              formControlName="cerCode"
              [required]="true"
              [invalid]="!!errore('cerCode')"
              data-testid="rd-cer"
            />
            <small *ngIf="errore('cerCode') as e" class="field-error" role="alert">{{ e }}</small>
          </div>
          <div class="field">
            <label for="rd-descrizione"
              >Descrizione <span class="req" aria-hidden="true">*</span></label
            >
            <input
              id="rd-descrizione"
              type="text"
              class="p-inputtext w-full"
              formControlName="descrizione"
              maxlength="255"
              data-testid="rd-descrizione"
              [attr.aria-invalid]="errore('descrizione') ? true : null"
              aria-describedby="rd-descrizione-errore"
            />
            <small
              *ngIf="errore('descrizione') as e"
              id="rd-descrizione-errore"
              class="field-error"
              role="alert"
              >{{ e }}</small
            >
          </div>
          <div class="field">
            <label for="rd-quantita"
              >Quantità presunta <span class="req" aria-hidden="true">*</span></label
            >
            <p-inputNumber
              appNumeroIt
              inputId="rd-quantita"
              formControlName="quantita"
              mode="decimal"
              locale="it-IT"
              [useGrouping]="false"
              [minFractionDigits]="0"
              [maxFractionDigits]="2"
              [min]="0.01"
              styleClass="w-full"
              data-testid="rd-quantita"
            ></p-inputNumber>
            <small *ngIf="errore('quantita') as e" class="field-error" role="alert">{{ e }}</small>
          </div>
          <div class="field">
            <label for="rd-unita">Unità</label>
            <select
              id="rd-unita"
              class="p-inputtext w-full"
              formControlName="unita"
              data-testid="rd-unita"
            >
              <option *ngFor="let u of unita" [value]="u">{{ u }}</option>
            </select>
          </div>
          <div class="field">
            <label for="rd-provenienza">Provenienza</label>
            <select
              id="rd-provenienza"
              class="p-inputtext w-full"
              formControlName="provenienza"
              data-testid="rd-provenienza"
            >
              <option value="">Non indicata</option>
              <option value="SPECIALE">Speciale</option>
              <option value="URBANO">Urbano</option>
            </select>
          </div>
          <div class="field">
            <label for="rd-tratta">Tratta</label>
            <select
              id="rd-tratta"
              class="p-inputtext w-full"
              formControlName="tipoTratta"
              data-testid="rd-tratta"
            >
              <option value="TERRESTRE">Terrestre</option>
              <option value="FERROVIARIA">Ferroviaria</option>
              <option value="MARITTIMA">Marittima</option>
            </select>
          </div>
          <div class="field">
            <label for="rd-stato-fisico">Stato fisico</label>
            <select id="rd-stato-fisico" class="p-inputtext w-full" formControlName="statoFisico">
              <option value="">Non indicato</option>
              <option *ngFor="let s of statiFisici" [value]="s">{{ s }}</option>
            </select>
          </div>
          <div class="field">
            <label for="rd-colli">Numero di colli</label>
            <p-inputNumber
              appNumeroIt
              soloIntero
              inputId="rd-colli"
              formControlName="numeroColli"
              locale="it-IT"
              [useGrouping]="false"
              [maxFractionDigits]="0"
              [min]="0"
              styleClass="w-full"
            ></p-inputNumber>
          </div>
          <div class="field">
            <label for="rd-operazione">Operazione (R/D)</label>
            <input
              id="rd-operazione"
              type="text"
              class="p-inputtext w-full"
              formControlName="codiceOperazione"
              maxlength="10"
            />
          </div>
          <div class="field">
            <label for="rd-hp">Caratteristiche di pericolo</label>
            <input
              id="rd-hp"
              type="text"
              class="p-inputtext w-full"
              formControlName="caratteristichePericolo"
              maxlength="100"
            />
          </div>
        </div>

        <div class="field">
          <label for="rd-annotazioni">Annotazioni (vanno sul FIR)</label>
          <textarea
            id="rd-annotazioni"
            class="p-inputtext w-full"
            rows="2"
            maxlength="1000"
            formControlName="annotazioni"
          ></textarea>
        </div>
        <div class="field">
          <label for="rd-note">Note interne (solo per l'operatore)</label>
          <textarea
            id="rd-note"
            class="p-inputtext w-full"
            rows="2"
            maxlength="1000"
            formControlName="noteInterne"
          ></textarea>
        </div>

        <fieldset class="ripeti" *ngIf="!ritiro">
          <legend>
            <label>
              <input type="checkbox" formControlName="ripeti" data-testid="rd-ripeti" />
              Ripeti il ritiro
            </label>
          </legend>
          <div class="griglia" *ngIf="form.controls.ripeti.value">
            <div class="field">
              <label for="rd-ogni-tipo">Ogni</label>
              <div class="ogni">
                <p-inputNumber
                  appNumeroIt
                  soloIntero
                  inputId="rd-ogni"
                  formControlName="intervallo"
                  locale="it-IT"
                  [useGrouping]="false"
                  [maxFractionDigits]="0"
                  [min]="1"
                  [max]="365"
                  ariaLabel="Intervallo di ripetizione"
                ></p-inputNumber>
                <select
                  id="rd-ogni-tipo"
                  class="p-inputtext"
                  formControlName="unitaRipetizione"
                  data-testid="rd-ogni-tipo"
                >
                  <option value="giorni">giorni</option>
                  <option value="settimane">settimane</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="rd-fino">Fino al <span class="req" aria-hidden="true">*</span></label>
              <app-campo-data
                inputId="rd-fino"
                formControlName="fino"
                data-testid="rd-fino"
                [ariaInvalid]="!!errore('fino')"
                ariaDescribedby="rd-fino-errore"
              />
              <small
                *ngIf="errore('fino') as e"
                id="rd-fino-errore"
                class="field-error"
                role="alert"
                >{{ e }}</small
              >
            </div>
          </div>
          <p
            class="nota"
            *ngIf="form.controls.ripeti.value"
            role="status"
            data-testid="rd-anteprima"
            aria-live="polite"
          >
            <ng-container *ngIf="date().length; else senzaDate">
              {{ date().length }} ritiri: {{ elencoDate() }}
              <strong *ngIf="date().length === massimo">
                (massimo {{ massimo }}: le date oltre non vengono create)</strong
              >
            </ng-container>
            <ng-template #senzaDate
              >Indica data di partenza, intervallo e data finale per vedere le date.</ng-template
            >
          </p>
        </fieldset>

        <p *ngIf="erroreGenerale() as e" role="alert" class="field-error" data-testid="rd-errore">
          {{ e }}
        </p>
        <div class="azioni">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiuso.emit()"
            data-testid="rd-annulla"
          ></p-button>
          <p-button
            [label]="
              ritiro
                ? 'Salva'
                : date().length > 1 && form.controls.ripeti.value
                  ? 'Crea ' + date().length + ' ritiri'
                  : 'Crea il ritiro'
            "
            icon="pi pi-check"
            styleClass="wf-primario"
            [loading]="salvataggio()"
            [disabled]="salvataggio()"
            (onClick)="salva()"
            data-testid="rd-salva"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [
    STILI_RITIRI,
    `
      .ripeti {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm) var(--spacing-base);
        margin: 0 0 var(--spacing-base);
      }
      .ripeti legend {
        font-size: var(--font-size-sm);
        padding: 0 var(--spacing-xs);
      }
      .ogni {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }
    `,
  ],
})
export class RitiroDialogComponent implements OnInit {
  private readonly servizio = inject(RitiriService)
  private readonly pese = inject(PeseService)
  private readonly registry = inject(RegistryService)

  /** Ritiro da modificare; assente = nuovo. */
  @Input() ritiro: RitiroVista | null = null
  @Output() salvato = new EventEmitter<RisultatoCreazioneRitiri | RitiroVista>()
  @Output() chiuso = new EventEmitter<void>()

  @ViewChild('produttoreSel') produttoreSel?: AnagraficaSelectComponent
  @ViewChild('destinatarioSel') destinatarioSel?: AnagraficaSelectComponent

  readonly fasce = Object.entries(ETICHETTA_FASCIA)
  readonly unita = UNITA
  readonly statiFisici = STATI_FISICI
  readonly massimo = MAX_OCCORRENZE
  readonly automezzi = signal<Automezzo[]>([])
  readonly sediProduttore = signal<SedeDitta[]>([])
  readonly sediDestinatario = signal<SedeDitta[]>([])
  readonly salvataggio = signal(false)
  readonly tentato = signal(false)
  readonly erroreGenerale = signal<string | null>(null)
  /** Messaggi di errore per campo, calcolati a ogni cambio del form (anche dopo il primo tentativo). */
  private readonly valoriForm = signal(0)

  /** Chiave unica del form: stessa a ogni tentativo. */
  private readonly chiave = crypto.randomUUID()

  readonly form = new FormGroup({
    dataPrevista: new FormControl('', { nonNullable: true }),
    fascia: new FormControl<FasciaRitiro | ''>('', { nonNullable: true }),
    ordineGiro: new FormControl<number | null>(null),
    produttoreId: new FormControl('', { nonNullable: true }),
    produttoreSedeId: new FormControl(SEDE_NON_SCELTA, { nonNullable: true }),
    trasportatoreId: new FormControl('', { nonNullable: true }),
    destinatarioId: new FormControl('', { nonNullable: true }),
    destinatarioSedeId: new FormControl(SEDE_NON_SCELTA, { nonNullable: true }),
    automezzoId: new FormControl('', { nonNullable: true }),
    cerCode: new FormControl('', { nonNullable: true }),
    descrizione: new FormControl('', { nonNullable: true }),
    quantita: new FormControl<number | null>(null),
    unita: new FormControl('kg', { nonNullable: true }),
    provenienza: new FormControl<ProvenienzaRifiuto | ''>('SPECIALE', { nonNullable: true }),
    tipoTratta: new FormControl<TipoTratta>('TERRESTRE', { nonNullable: true }),
    statoFisico: new FormControl('', { nonNullable: true }),
    numeroColli: new FormControl<number | null>(null),
    codiceOperazione: new FormControl('', { nonNullable: true }),
    caratteristichePericolo: new FormControl('', { nonNullable: true }),
    annotazioni: new FormControl('', { nonNullable: true }),
    noteInterne: new FormControl('', { nonNullable: true }),
    ripeti: new FormControl(false, { nonNullable: true }),
    intervallo: new FormControl<number | null>(1),
    unitaRipetizione: new FormControl<'giorni' | 'settimane'>('settimane', { nonNullable: true }),
    fino: new FormControl('', { nonNullable: true }),
  })

  /** Date dell'anteprima (vuota se la ripetizione è spenta o incompleta). */
  readonly date = computed(() => {
    this.valoriForm()
    const v = this.form.getRawValue()
    if (!v.ripeti || !v.dataPrevista) return []
    return anteprimaDate(v.dataPrevista, this.ripetizione(v) ?? { fino: '' })
  })
  readonly elencoDate = computed(() => {
    const d = this.date()
    const prime = d.slice(0, 6).map(dataItaliana).join(', ')
    return d.length > 6 ? `${prime}… ${dataItaliana(d[d.length - 1])}` : prime
  })

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => this.valoriForm.update(n => n + 1))
    // L'elenco dei mezzi è delle pese: se il modulo non c'è, il campo resta nascosto.
    this.pese.elencaAutomezzi().subscribe({
      next: e => this.automezzi.set(e.righe.filter(a => a.attivo)),
      error: () => this.automezzi.set([]),
    })
    if (this.ritiro) this.precompila(this.ritiro)
  }

  private precompila(r: RitiroVista): void {
    this.form.patchValue({
      dataPrevista: r.dataPrevista,
      fascia: r.fascia ?? '',
      ordineGiro: r.ordineGiro,
      produttoreId: r.produttore.id,
      produttoreSedeId: r.produttore.sedeId,
      trasportatoreId: r.trasportatore.id,
      destinatarioId: r.destinatario.id,
      destinatarioSedeId: r.destinatario.sedeId,
      automezzoId: r.automezzo?.id ?? '',
      cerCode: r.cerCode,
      descrizione: r.descrizione,
      quantita: Number(r.quantitaPresunta),
      unita: r.unita,
      provenienza: r.provenienza ?? '',
      tipoTratta: r.tipoTratta ?? 'TERRESTRE',
      statoFisico: r.statoFisico ?? '',
      numeroColli: r.numeroColli ?? null,
      codiceOperazione: r.codiceOperazione ?? '',
      caratteristichePericolo: r.caratteristichePericolo ?? '',
      annotazioni: r.annotazioni ?? '',
      noteInterne: r.noteInterne ?? '',
    })
  }

  etichettaSede(s: SedeDitta): string {
    const nome = s.denominazione ? `${s.denominazione} — ` : ''
    return `${nome}${s.via} ${s.civico}, ${s.citta}${s.principale ? ' (principale)' : ''}`
  }

  /** Scelto un produttore o un destinatario: legge le sedi attive e propone la principale. */
  alCambioSoggetto(ruolo: Ruolo): void {
    const sel = ruolo === 'produttore' ? this.produttoreSel : this.destinatarioSel
    const id = this.form.controls[ruolo === 'produttore' ? 'produttoreId' : 'destinatarioId'].value
    const sedeCtrl =
      this.form.controls[ruolo === 'produttore' ? 'produttoreSedeId' : 'destinatarioSedeId']
    const elenco = ruolo === 'produttore' ? this.sediProduttore : this.sediDestinatario
    const entita = id ? sel?.trovaEntita(id) : null
    elenco.set([])
    sedeCtrl.setValue(SEDE_NON_SCELTA)
    if (!entita?.dittaId) return
    this.registry.getDitta(entita.dittaId).subscribe({
      next: d => {
        const attive = d.sedi.filter(s => s.attiva)
        elenco.set(attive)
        const predefinita =
          attive.find(s => s.id === entita.sedeId) ?? attive.find(s => s.principale) ?? attive[0]
        sedeCtrl.setValue(predefinita?.id ?? SEDE_NON_SCELTA)
      },
      error: () => sedeCtrl.setValue(entita.sedeId ?? SEDE_NON_SCELTA),
    })
  }

  private ripetizione(v: ValoriForm): RipetizioneRitiro | null {
    if (!v.ripeti || !v.intervallo) return null
    return v.unitaRipetizione === 'giorni'
      ? { ogniGiorni: v.intervallo, fino: v.fino }
      : { ogniSettimane: v.intervallo, fino: v.fino }
  }

  /** Errore di un campo, visibile solo dopo il primo tentativo di salvare. */
  errore(campo: string): string | null {
    if (!this.tentato()) return null
    this.valoriForm()
    const v = this.form.getRawValue()
    switch (campo) {
      case 'dataPrevista':
        return v.dataPrevista ? null : 'Indica la data prevista.'
      case 'produttoreId':
        return v.produttoreId ? null : 'Scegli il produttore.'
      case 'trasportatoreId':
        return v.trasportatoreId ? null : 'Scegli il trasportatore.'
      case 'destinatarioId':
        return v.destinatarioId ? null : 'Scegli il destinatario.'
      case 'cerCode':
        return v.cerCode ? null : 'Scegli il codice CER.'
      case 'descrizione':
        return v.descrizione.trim() ? null : 'Scrivi la descrizione del rifiuto.'
      case 'quantita':
        return v.quantita != null && v.quantita > 0
          ? null
          : 'La quantità deve essere maggiore di zero.'
      case 'fino':
        if (!v.ripeti) return null
        if (!v.fino) return 'Indica fino a quando ripetere.'
        return this.date().length ? null : 'La data finale deve essere dopo la data di partenza.'
      default:
        return null
    }
  }

  private haErrori(): boolean {
    return [
      'dataPrevista',
      'produttoreId',
      'trasportatoreId',
      'destinatarioId',
      'cerCode',
      'descrizione',
      'quantita',
      'fino',
    ].some(c => this.errore(c) !== null)
  }

  private dati(): DatiRitiro {
    const v = this.form.getRawValue()
    const testo = (s: string): string | null => (s.trim() === '' ? null : s.trim())
    return {
      dataPrevista: v.dataPrevista,
      fascia: v.fascia || null,
      ordineGiro: v.ordineGiro,
      produttoreId: v.produttoreId,
      produttoreSedeId: v.produttoreSedeId,
      trasportatoreId: v.trasportatoreId,
      destinatarioId: v.destinatarioId,
      destinatarioSedeId: v.destinatarioSedeId,
      automezzoId: v.automezzoId || null,
      cerCode: v.cerCode,
      descrizione: v.descrizione.trim(),
      statoFisico: testo(v.statoFisico),
      caratteristichePericolo: testo(v.caratteristichePericolo),
      numeroColli: v.numeroColli,
      quantitaPresunta: (v.quantita ?? 0).toFixed(2),
      unita: v.unita,
      codiceOperazione: testo(v.codiceOperazione),
      provenienza: v.provenienza || null,
      tipoTratta: v.tipoTratta,
      annotazioni: testo(v.annotazioni),
      noteInterne: testo(v.noteInterne),
    }
  }

  salva(): void {
    if (this.salvataggio()) return
    this.tentato.set(true)
    this.valoriForm.update(n => n + 1)
    this.erroreGenerale.set(null)
    if (this.haErrori()) return
    const dati = this.dati()
    const richiesta: Observable<RisultatoCreazioneRitiri | RitiroVista> = this.ritiro
      ? this.servizio.modifica(this.ritiro.id, { ...dati, versione: this.ritiro.versione })
      : this.servizio.crea({
          ...dati,
          chiaveIdempotenza: this.chiave,
          ripetizione: this.ripetizione(this.form.getRawValue()) ?? undefined,
        })
    this.salvataggio.set(true)
    richiesta.subscribe({
      next: r => {
        this.salvataggio.set(false)
        this.salvato.emit(r)
      },
      error: err => {
        this.salvataggio.set(false)
        this.erroreGenerale.set(messaggioErroreRitiri(err, 'Impossibile salvare il ritiro.'))
      },
    })
  }
}
