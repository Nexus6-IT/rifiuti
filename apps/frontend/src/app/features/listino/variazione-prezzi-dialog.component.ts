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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { Cliente } from '../clienti/clienti.model'
import { Opzione, etichettaCodice } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { SceltaClienteComponent } from '../contratti-cliente/scelta-cliente.component'
import { AnteprimaContrattiComponent } from './anteprima-contratti.component'
import { focalizzaPasso } from '../../shared/utils/focalizza-passo'
import { MESSAGGIO_CONCORRENTE, eConcorrente, leggiErroriAzione } from './errori-azione'
import {
  AnteprimaVariazioneContratti,
  CorpoVariazioneContratti,
  FiltroVariazioneContratti,
  TipoVariazione,
} from './listino.model'
import { ListinoService } from './listino.service'
import {
  leggiNumero,
  messaggioNumero,
  validatoreNumero,
} from '../../shared/utils/numero-modificabile'
import { puoVariarePrezzi } from './permessi-listino'
import { ETICHETTE_TIPO_VARIAZIONE, TIPI_ELENCABILI } from './vocabolario-listino'

const TIPI = Object.keys(ETICHETTE_TIPO_VARIAZIONE) as TipoVariazione[]
export const MESSAGGIO_VARIAZIONE_SUPERATA =
  'I prezzi sono cambiati dopo l’anteprima: rifai l’anteprima.'

type Gruppo =
  | 'tipiPrezzo'
  | 'tipi'
  | 'categorieAddebito'
  | 'centriRicavo'
  | 'tipiContratto'
  | 'categorieContratto'
type Scelte = Record<Gruppo, string[]>
const SCELTE_VUOTE = (): Scelte => ({
  tipiPrezzo: [],
  tipi: [],
  categorieAddebito: [],
  centriRicavo: [],
  tipiContratto: [],
  categorieContratto: [],
})

/**
 * Modifica automatica dei prezzi dei contratti (E21, D20), solo ADMIN. Prima l'anteprima
 * (paginata, con "Scarica CSV"), poi il riepilogo e l'applicazione con l'impronta dell'anteprima:
 * qualsiasi cambio di criterio scarta l'anteprima, un 409 obbliga a rifarla. I filtri sono quelli
 * di D20, compresi i "contratti scelti" (R51) che arrivano dalla lista dei contratti. Le zone di
 * errore sono tre e separate: caricamento dei vocabolari, anteprima, applicazione (R51). Durante
 * l'applicazione né Esc né "Annulla" chiudono il dialog. Prezzo e valore: virgola decimale, punto
 * vietato; con un errore nel campo non si calcola l'anteprima.
 */
@Component({
  selector: 'app-variazione-prezzi-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    SceltaClienteComponent,
    AnteprimaContrattiComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Modifica automatica dei prezzi"
      [modal]="true"
      [closable]="!applicando()"
      [style]="{ width: '60rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <p
        *ngIf="erroreCaricamento() as e"
        role="alert"
        class="field-error"
        data-testid="vp-errore-caricamento"
      >
        {{ e }}
      </p>

      <div *ngIf="esito() !== null" class="dlg-form" role="status" data-testid="vp-esito">
        <p>Prezzi aggiornati: {{ esito() }}</p>
      </div>

      <div
        *ngIf="esito() === null && inRiepilogo()"
        class="dlg-form"
        tabindex="-1"
        data-testid="vp-riepilogo"
      >
        <p>Stai per modificare i prezzi dei contratti. L'operazione non si annulla.</p>
        <ul>
          <li *ngFor="let r of riepilogo()">{{ r }}</li>
        </ul>
      </div>

      <form
        *ngIf="esito() === null"
        [formGroup]="form"
        class="dlg-form"
        [hidden]="inRiepilogo()"
        (ngSubmit)="anteprima()"
      >
        <label for="vp-tipo">Tipo di variazione</label>
        <select id="vp-tipo" formControlName="tipo" class="p-inputtext" data-testid="vp-tipo">
          <option *ngFor="let t of tipi" [value]="t">{{ etichette[t] }}</option>
        </select>

        <ng-container *ngIf="!sostituzioneIva()">
          <label for="vp-valore">{{ etichettaValore() }}</label>
          <input
            pInputText
            id="vp-valore"
            formControlName="valore"
            inputmode="decimal"
            [attr.aria-invalid]="erroreCampo('valore') ? 'true' : null"
            [attr.aria-describedby]="erroreCampo('valore') ? 'vp-errore-valore' : null"
            data-testid="vp-valore"
          />
          <small
            *ngIf="erroreCampo('valore') as e"
            role="alert"
            class="field-error"
            id="vp-errore-valore"
            data-testid="vp-errore-valore"
            >{{ e }}</small
          >
          <label class="spunta">
            <input type="checkbox" formControlName="soloMinimi" data-testid="vp-solo-minimi" />
            Cambia solo il minimo fatturabile
          </label>
        </ng-container>
        <ng-container *ngIf="sostituzioneIva()">
          <label for="vp-da-iva">Dal codice IVA</label>
          <select
            id="vp-da-iva"
            formControlName="daCodiceIvaId"
            class="p-inputtext"
            data-testid="vp-da-iva"
          >
            <option value="">—</option>
            <option *ngFor="let o of codiciIva()" [value]="o.id">{{ o.etichetta }}</option>
          </select>
          <label for="vp-a-iva">Al codice IVA</label>
          <select
            id="vp-a-iva"
            formControlName="aCodiceIvaId"
            class="p-inputtext"
            data-testid="vp-a-iva"
          >
            <option value="">—</option>
            <option *ngFor="let o of codiciIva()" [value]="o.id">{{ o.etichetta }}</option>
          </select>
        </ng-container>

        <h3 class="sezione">Quali righe</h3>
        <label class="spunta" *ngIf="contrattiIds?.length">
          <input
            type="checkbox"
            formControlName="soloContrattiScelti"
            data-testid="vp-contratti-scelti"
          />
          Solo i {{ contrattiIds?.length }} contratti scelti
        </label>
        <label class="spunta" *ngIf="addebitiIds?.length">
          <input
            type="checkbox"
            formControlName="soloAddebitiScelti"
            data-testid="vp-addebiti-scelti"
          />
          Solo i {{ addebitiIds?.length }}
          {{ addebitiIds?.length === 1 ? 'addebito scelto' : 'addebiti scelti' }}
        </label>
        <app-scelta-cliente
          prefisso="vp-cliente"
          prefissoNuovo="vp-cliente-nuovo"
          etichetta="Cliente"
          (scelto)="sceltoCliente($event)"
        />
        <label for="vp-addebito-cerca"
          >Addebito (cerca per codice o descrizione, poi premi «Cerca»)</label
        >
        <div class="ricerca">
          <input
            pInputText
            id="vp-addebito-cerca"
            formControlName="addebitoTesto"
            (change)="cercaAddebiti()"
            (keydown.enter)="$event.preventDefault(); cercaAddebiti()"
            data-testid="vp-addebito-cerca"
          />
          <p-button
            label="Cerca"
            icon="pi pi-search"
            [outlined]="true"
            size="small"
            (onClick)="cercaAddebiti()"
            data-testid="vp-addebito-cerca-vai"
          />
        </div>
        <div class="ricerca" *ngIf="addebiti().length > 0">
          <select
            class="p-inputtext"
            aria-label="Addebito trovato"
            formControlName="addebitoId"
            data-testid="vp-addebito"
          >
            <option value="">—</option>
            <option *ngFor="let o of addebiti()" [value]="o.id">{{ o.etichetta }}</option>
          </select>
          <p-button
            label="Aggiungi alla lista"
            icon="pi pi-plus"
            [outlined]="true"
            size="small"
            [disabled]="form.controls.addebitoId.value === ''"
            (onClick)="aggiungiAddebito()"
            data-testid="vp-addebito-aggiungi"
          />
        </div>
        <ul class="chip" *ngIf="addebitiScelti().length > 0" aria-label="Addebiti scelti">
          <li *ngFor="let a of addebitiScelti()" [attr.data-testid]="'vp-addebito-chip-' + a.id">
            {{ a.etichetta }}
            <button
              type="button"
              [attr.aria-label]="'Togli ' + a.etichetta"
              (click)="togliAddebito(a.id)"
              [attr.data-testid]="'vp-addebito-togli-' + a.id"
            >
              ×
            </button>
          </li>
        </ul>
        <label for="vp-cer">CER</label>
        <input pInputText id="vp-cer" formControlName="cerCode" data-testid="vp-cer" />
        <label for="vp-riferimento">Riferimento</label>
        <input
          pInputText
          id="vp-riferimento"
          formControlName="riferimento"
          maxlength="8"
          data-testid="vp-riferimento"
        />
        <label for="vp-prezzo">Prezzo attuale</label>
        <input
          pInputText
          id="vp-prezzo"
          formControlName="prezzoAttuale"
          inputmode="decimal"
          [attr.aria-invalid]="erroreCampo('prezzoAttuale') ? 'true' : null"
          [attr.aria-describedby]="erroreCampo('prezzoAttuale') ? 'vp-errore-prezzo' : null"
          data-testid="vp-prezzo-attuale"
        />
        <small
          *ngIf="erroreCampo('prezzoAttuale') as e"
          role="alert"
          class="field-error"
          id="vp-errore-prezzo"
          data-testid="vp-errore-prezzo"
          >{{ e }}</small
        >
        <label class="spunta">
          <input type="checkbox" formControlName="anchePrezziZero" data-testid="vp-prezzi-zero" />
          Anche i prezzi a zero
        </label>

        <fieldset class="gruppo">
          <legend>Prezzi (nessuno = tutti)</legend>
          <label class="spunta"
            ><input
              type="checkbox"
              [checked]="scelte().tipiPrezzo.includes('NORMALE')"
              (change)="cambia('tipiPrezzo', 'NORMALE', $any($event.target).checked)"
              data-testid="vp-prezzo-NORMALE"
            />
            Normali</label
          >
          <label class="spunta"
            ><input
              type="checkbox"
              [checked]="scelte().tipiPrezzo.includes('SPECIALE')"
              (change)="cambia('tipiPrezzo', 'SPECIALE', $any($event.target).checked)"
              data-testid="vp-prezzo-SPECIALE"
            />
            Speciali</label
          >
        </fieldset>
        <fieldset class="gruppo">
          <legend>Tipi di addebito (nessuno = tutti)</legend>
          <label *ngFor="let t of tipiProposti" class="spunta" [attr.title]="t.etichetta">
            <input
              type="checkbox"
              [checked]="scelte().tipi.includes(t.tipo)"
              (change)="cambia('tipi', t.tipo, $any($event.target).checked)"
              [attr.data-testid]="'vp-tipo-' + t.tipo"
            />
            {{ t.tipo }}
          </label>
        </fieldset>
        <fieldset class="gruppo" *ngFor="let g of gruppiOpzioni">
          <legend>{{ g.titolo }} (nessuna = tutte)</legend>
          <label *ngFor="let o of g.opzioni()" class="spunta">
            <input
              type="checkbox"
              [checked]="scelte()[g.chiave].includes(o.id)"
              (change)="cambia(g.chiave, o.id, $any($event.target).checked)"
              [attr.data-testid]="'vp-' + g.chiave + '-' + o.id"
            />
            {{ o.etichetta }}
          </label>
        </fieldset>

        <h3 class="sezione">Date del contratto</h3>
        <div class="date">
          <label for="vp-inizio-dal">Inizio dal</label>
          <input
            id="vp-inizio-dal"
            type="date"
            class="p-inputtext"
            formControlName="inizioDal"
            data-testid="vp-inizio-dal"
          />
          <label for="vp-inizio-al">al</label>
          <input
            id="vp-inizio-al"
            type="date"
            class="p-inputtext"
            formControlName="inizioAl"
            data-testid="vp-inizio-al"
          />
          <label for="vp-fine-dal">Fine dal</label>
          <input
            id="vp-fine-dal"
            type="date"
            class="p-inputtext"
            formControlName="fineDal"
            data-testid="vp-fine-dal"
          />
          <label for="vp-fine-al">al</label>
          <input
            id="vp-fine-al"
            type="date"
            class="p-inputtext"
            formControlName="fineAl"
            data-testid="vp-fine-al"
          />
        </div>
        <label for="vp-prima-scadenza">Fissi con prima scadenza il</label>
        <input
          id="vp-prima-scadenza"
          type="date"
          class="p-inputtext"
          formControlName="primaScadenzaFissi"
          data-testid="vp-prima-scadenza"
        />
      </form>

      <p
        *ngIf="erroreAnteprima() as e"
        role="alert"
        class="field-error"
        data-testid="vp-errore-anteprima"
      >
        {{ e }}
      </p>
      <app-anteprima-contratti
        *ngIf="esito() === null && !inRiepilogo() && anteprimaCorrente() as a"
        [anteprima]="a"
        nomeFile="variazione-prezzi-contratti.csv"
      />
      <ul
        *ngIf="erroriApplica().length > 0"
        role="alert"
        class="field-error"
        data-testid="vp-errore-applica"
      >
        <li *ngFor="let m of erroriApplica()">{{ m }}</li>
      </ul>

      <ng-template pTemplate="footer">
        <p-button
          [label]="esito() !== null ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="applicando()"
          (onClick)="chiudi()"
          data-testid="vp-chiudi"
        />
        <ng-container *ngIf="esito() === null">
          <ng-container *ngIf="!inRiepilogo()">
            <p-button
              label="Anteprima"
              icon="pi pi-eye"
              [outlined]="true"
              [disabled]="!puoAnteprima()"
              (onClick)="anteprima()"
              data-testid="vp-anteprima"
            />
            <p-button
              *ngIf="anteprimaCorrente() !== null"
              label="Applica"
              icon="pi pi-check"
              [disabled]="!puoApplicare()"
              (onClick)="avanti()"
              data-testid="vp-applica"
            />
          </ng-container>
          <ng-container *ngIf="inRiepilogo()">
            <p-button
              label="Indietro"
              [text]="true"
              [disabled]="applicando()"
              (onClick)="inRiepilogo.set(false)"
              data-testid="vp-indietro"
            />
            <p-button
              label="Conferma la variazione"
              icon="pi pi-check"
              [disabled]="applicando() || !puoApplicare()"
              (onClick)="applica()"
              data-testid="vp-conferma-finale"
            />
          </ng-container>
        </ng-container>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .gruppo {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        border: 1px solid var(--surface-border, #ccc);
        padding: 0.5rem;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .ricerca {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .chip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .chip li {
        border: 1px solid var(--surface-border, #ccc);
        border-radius: 1rem;
        padding: 0.1rem 0.6rem;
      }
      .chip button {
        border: 0;
        background: none;
        cursor: pointer;
      }
      .date {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .sezione {
        margin: 0.75rem 0 0.25rem;
      }
    `,
  ],
})
export class VariazionePrezziDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  /** Contratti scelti nella lista (R51); vuoto = nessun filtro per contratto. */
  @Input() contrattiIds: string[] | null = null
  /** Solo questi addebiti (azione dall'archivio); vuoto = nessun filtro per addebiti scelti. */
  @Input() addebitiIds: string[] | null = null
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Numero dei prezzi aggiornati. */
  @Output() applicata = new EventEmitter<number>()

  readonly tipi = TIPI
  readonly etichette = ETICHETTE_TIPO_VARIAZIONE
  readonly tipiProposti = TIPI_ELENCABILI.filter(t => !t.tipo.includes('?'))
  readonly scelte = signal<Scelte>(SCELTE_VUOTE())
  readonly categorieAddebito = signal<Opzione[]>([])
  readonly centriRicavo = signal<Opzione[]>([])
  readonly tipiContratto = signal<Opzione[]>([])
  readonly categorieContratto = signal<Opzione[]>([])
  readonly codiciIva = signal<Opzione[]>([])
  readonly addebiti = signal<Opzione[]>([])
  /** Addebiti messi in lista dall'operatore: filtro «addebiti scelti» (D20). */
  readonly addebitiScelti = signal<Opzione[]>([])
  readonly gruppiOpzioni: { chiave: Gruppo; titolo: string; opzioni: () => Opzione[] }[] = [
    {
      chiave: 'categorieAddebito',
      titolo: 'Categorie di addebito',
      opzioni: () => this.categorieAddebito(),
    },
    { chiave: 'centriRicavo', titolo: 'Centri di ricavo', opzioni: () => this.centriRicavo() },
    { chiave: 'tipiContratto', titolo: 'Tipi di contratto', opzioni: () => this.tipiContratto() },
    {
      chiave: 'categorieContratto',
      titolo: 'Categorie di contratto',
      opzioni: () => this.categorieContratto(),
    },
  ]

  readonly erroreCaricamento = signal<string | null>(null)
  readonly erroreAnteprima = signal<string | null>(null)
  readonly erroriApplica = signal<string[]>([])
  readonly inCorso = signal(false)
  readonly applicando = signal(false)
  readonly inRiepilogo = signal(false)
  readonly riepilogo = signal<string[]>([])
  readonly esito = signal<number | null>(null)
  readonly anteprimaCorrente = signal<AnteprimaVariazioneContratti | null>(null)

  readonly form = new FormGroup({
    tipo: new FormControl<TipoVariazione>('AUMENTO_PERCENTUALE', { nonNullable: true }),
    valore: new FormControl('', { nonNullable: true, validators: [validatoreNumero('decimale')] }),
    soloMinimi: new FormControl(false, { nonNullable: true }),
    daCodiceIvaId: new FormControl('', { nonNullable: true }),
    aCodiceIvaId: new FormControl('', { nonNullable: true }),
    soloContrattiScelti: new FormControl(true, { nonNullable: true }),
    soloAddebitiScelti: new FormControl(true, { nonNullable: true }),
    addebitoTesto: new FormControl('', { nonNullable: true }),
    addebitoId: new FormControl('', { nonNullable: true }),
    cerCode: new FormControl('', { nonNullable: true }),
    riferimento: new FormControl('', { nonNullable: true }),
    prezzoAttuale: new FormControl('', {
      nonNullable: true,
      validators: [validatoreNumero('decimale')],
    }),
    anchePrezziZero: new FormControl(false, { nonNullable: true }),
    inizioDal: new FormControl('', { nonNullable: true }),
    inizioAl: new FormControl('', { nonNullable: true }),
    fineDal: new FormControl('', { nonNullable: true }),
    fineAl: new FormControl('', { nonNullable: true }),
    primaScadenzaFissi: new FormControl('', { nonNullable: true }),
  })

  private clienteId: string | null = null
  /** Corpo con cui è stata chiesta l'anteprima: è quello che si applica, non il form di adesso. */
  private corpo: CorpoVariazioneContratti | null = null
  private letture?: Subscription
  private ricercaAddebiti?: Subscription
  private richiesta?: Subscription
  private applicazione?: Subscription
  private readonly modifiche: Subscription

  constructor() {
    this.modifiche = this.form.valueChanges.subscribe(() => this.scarta())
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.letture?.unsubscribe()
    this.ricercaAddebiti?.unsubscribe()
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
    this.modifiche.unsubscribe()
  }

  private inizializza(): void {
    this.letture?.unsubscribe()
    this.ricercaAddebiti?.unsubscribe()
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
    this.form.reset({
      tipo: 'AUMENTO_PERCENTUALE',
      soloContrattiScelti: true,
      soloAddebitiScelti: true,
    })
    this.scelte.set(SCELTE_VUOTE())
    this.clienteId = null
    this.addebiti.set([])
    this.addebitiScelti.set([])
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.riepilogo.set([])
    this.esito.set(null)
    this.erroreCaricamento.set(null)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
    this.inCorso.set(false)
    this.applicando.set(false)
    const s = new Subscription()
    this.letture = s
    const errori: string[] = []
    const guasto = (cosa: string) => () => {
      errori.push(cosa)
      this.erroreCaricamento.set(`Impossibile caricare: ${errori.join(', ')}.`)
    }
    const opzioni = (l: { id: string; codice: string | null; descrizione: string }[]): Opzione[] =>
      l.map(c => ({ id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) }))
    s.add(
      this.servizio.codifiche.list('CATEGORIA').subscribe({
        next: l => this.categorieAddebito.set(opzioni(l)),
        error: guasto('categorie di addebito'),
      })
    )
    s.add(
      this.servizio.codifiche.list('CENTRO_RICAVO').subscribe({
        next: l => this.centriRicavo.set(opzioni(l)),
        error: guasto('centri di ricavo'),
      })
    )
    s.add(
      this.servizio.codiciIva
        .list()
        .subscribe({ next: l => this.codiciIva.set(opzioni(l)), error: guasto('codici IVA') })
    )
    s.add(
      this.tabelle.codifiche.list('TIPO').subscribe({
        next: l => this.tipiContratto.set(opzioni(l)),
        error: guasto('tipi di contratto'),
      })
    )
    s.add(
      this.tabelle.codifiche.list('CATEGORIA').subscribe({
        next: l => this.categorieContratto.set(opzioni(l)),
        error: guasto('categorie di contratto'),
      })
    )
  }

  sostituzioneIva(): boolean {
    return this.form.controls.tipo.value === 'SOSTITUZIONE_IVA'
  }

  etichettaValore(): string {
    return this.form.controls.tipo.value.endsWith('PERCENTUALE') ? 'Percentuale (%)' : 'Importo (€)'
  }

  erroreCampo(campo: 'valore' | 'prezzoAttuale'): string | null {
    return messaggioNumero(this.form.controls[campo])
  }

  puoVariare(): boolean {
    return puoVariarePrezzi(this.auth.currentUser()?.role)
  }

  /** Cambiano i criteri: l'anteprima non vale più e l'impronta con lei. */
  private scarta(): void {
    this.richiesta?.unsubscribe()
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.inCorso.set(false)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
  }

  cambia(gruppo: Gruppo, valore: string, si: boolean): void {
    this.scelte.update(s => ({
      ...s,
      [gruppo]: si
        ? [...s[gruppo].filter(x => x !== valore), valore]
        : s[gruppo].filter(x => x !== valore),
    }))
    this.scarta()
  }

  sceltoCliente(c: Cliente | null): void {
    this.clienteId = c?.id ?? null
    this.scarta()
  }

  cercaAddebiti(): void {
    const testo = this.form.controls.addebitoTesto.value.trim()
    this.ricercaAddebiti?.unsubscribe()
    this.form.controls.addebitoId.setValue('')
    if (testo === '') {
      this.addebiti.set([])
      return
    }
    this.ricercaAddebiti = this.servizio.addebiti
      .list({ testo, pagina: 1, dimensione: 50 })
      .subscribe({
        next: p =>
          this.addebiti.set(
            p.elementi.map(a => ({ id: a.id, etichetta: `${a.codice} - ${a.descrizione}` }))
          ),
        error: err =>
          this.erroreCaricamento.set(messaggioErrore(err, 'Impossibile cercare gli addebiti.')),
      })
  }

  aggiungiAddebito(): void {
    const id = this.form.controls.addebitoId.value
    const scelto = this.addebiti().find(o => o.id === id)
    if (!scelto) return
    if (!this.addebitiScelti().some(o => o.id === id)) {
      this.addebitiScelti.update(l => [...l, scelto])
    }
    this.form.controls.addebitoId.setValue('')
    this.scarta()
  }

  togliAddebito(id: string): void {
    this.addebitiScelti.update(l => l.filter(o => o.id !== id))
    this.scarta()
  }

  private erroriLocali(): boolean {
    const c = this.form.controls
    return (!this.sostituzioneIva() && c.valore.invalid) || c.prezzoAttuale.invalid
  }

  private criteriCompleti(): boolean {
    const v = this.form.getRawValue()
    if (this.erroriLocali()) return false
    return this.sostituzioneIva()
      ? v.daCodiceIvaId !== '' && v.aCodiceIvaId !== ''
      : v.valore.trim() !== ''
  }

  puoAnteprima(): boolean {
    return this.criteriCompleti() && !this.inCorso() && !this.applicando() && this.puoVariare()
  }

  puoApplicare(): boolean {
    const a = this.anteprimaCorrente()
    return (
      a !== null &&
      a.totale > 0 &&
      a.errori.length === 0 &&
      !this.inCorso() &&
      !this.applicando() &&
      this.puoVariare()
    )
  }

  /** Addebiti dall'esterno (se la spunta è accesa) e quelli messi in lista, senza doppioni. */
  private idsAddebitiScelti(daFuori: boolean): string[] {
    const esterni = daFuori ? (this.addebitiIds ?? []) : []
    return [...new Set([...esterni, ...this.addebitiScelti().map(o => o.id)])]
  }

  private filtri(): FiltroVariazioneContratti {
    const v = this.form.getRawValue()
    const s = this.scelte()
    const testo = (x: string): string | undefined => (x.trim() === '' ? undefined : x.trim())
    const lista = <T>(x: T[]): T[] | undefined => (x.length > 0 ? x : undefined)
    const f: FiltroVariazioneContratti = {
      addebitoId: testo(v.addebitoId),
      cerCode: testo(v.cerCode),
      clienteId: this.clienteId ?? undefined,
      riferimento: testo(v.riferimento),
      prezzoAttuale: leggiNumero(v.prezzoAttuale).valore ?? undefined,
      anchePrezziZero: v.anchePrezziZero ? true : undefined,
      tipiPrezzo: lista(s.tipiPrezzo) as ('NORMALE' | 'SPECIALE')[] | undefined,
      tipi: lista(s.tipi),
      categorieAddebitoIds: lista(s.categorieAddebito),
      centriRicavoIds: lista(s.centriRicavo),
      tipiContrattoIds: lista(s.tipiContratto),
      categorieContrattoIds: lista(s.categorieContratto),
      inizioDal: testo(v.inizioDal),
      inizioAl: testo(v.inizioAl),
      fineDal: testo(v.fineDal),
      fineAl: testo(v.fineAl),
      contrattiIds:
        v.soloContrattiScelti && this.contrattiIds?.length ? this.contrattiIds : undefined,
      addebitiIds: lista(this.idsAddebitiScelti(v.soloAddebitiScelti)),
      primaScadenzaFissi: testo(v.primaScadenzaFissi),
    }
    return Object.fromEntries(
      Object.entries(f).filter(([, x]) => x !== undefined)
    ) as FiltroVariazioneContratti
  }

  private costruisciCorpo(): CorpoVariazioneContratti {
    const v = this.form.getRawValue()
    return {
      tipo: v.tipo,
      ...(this.sostituzioneIva()
        ? { daCodiceIvaId: v.daCodiceIvaId, aCodiceIvaId: v.aCodiceIvaId }
        : {
            valore: leggiNumero(v.valore).valore ?? '',
            ...(v.soloMinimi ? { soloMinimi: true } : {}),
          }),
      filtri: this.filtri(),
    }
  }

  anteprima(): void {
    if (!this.puoAnteprima()) return
    const corpo = this.costruisciCorpo()
    this.richiesta?.unsubscribe()
    this.anteprimaCorrente.set(null)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
    this.inCorso.set(true)
    this.richiesta = this.servizio.variazioniContratti.anteprima(corpo).subscribe({
      next: a => {
        this.inCorso.set(false)
        this.corpo = corpo
        this.anteprimaCorrente.set(a)
      },
      error: err => {
        this.inCorso.set(false)
        this.erroreAnteprima.set(
          leggiErroriAzione(err, "Impossibile calcolare l'anteprima.").messaggi.join(' ')
        )
      },
    })
  }

  /** Primo passo dell'applicazione: riepilogo e conferma (la variazione non si annulla). */
  avanti(): void {
    const a = this.anteprimaCorrente()
    if (!this.puoApplicare() || !a) return
    const v = this.form.getRawValue()
    const righe = [`Tipo: ${this.etichette[v.tipo]}`]
    if (this.sostituzioneIva()) {
      const nome = (id: string) => this.codiciIva().find(o => o.id === id)?.etichetta ?? 'scelto'
      righe.push(`Da ${nome(v.daCodiceIvaId)} a ${nome(v.aCodiceIvaId)}`)
    } else {
      righe.push(`Valore: ${v.valore.trim()}${v.tipo.endsWith('PERCENTUALE') ? ' %' : ' €'}`)
      if (v.soloMinimi) righe.push('Solo il minimo fatturabile')
    }
    const f = this.filtri()
    righe.push(`Criteri impostati: ${Object.keys(f).length}`)
    if (f.contrattiIds) righe.push(`Contratti scelti: ${f.contrattiIds.length}`)
    if (f.addebitiIds) righe.push(`Addebiti scelti: ${f.addebitiIds.length}`)
    righe.push(`Prezzi da modificare: ${a.totale}`)
    if (a.invariate) righe.push(`Righe invariate (non scritte): ${a.invariate}`)
    this.riepilogo.set(righe)
    this.erroriApplica.set([])
    this.inRiepilogo.set(true)
    focalizzaPasso('vp-riepilogo')
  }

  applica(): void {
    const a = this.anteprimaCorrente()
    const corpo = this.corpo
    if (!this.puoApplicare() || !this.inRiepilogo() || !a || !corpo) return
    this.inCorso.set(true)
    this.applicando.set(true)
    this.erroriApplica.set([])
    this.applicazione = this.servizio.variazioniContratti
      .applica({ ...corpo, impronta: a.impronta })
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.esito.set(r.aggiornati)
          this.applicata.emit(r.aggiornati)
        },
        error: err => {
          const e = leggiErroriAzione(err, 'Impossibile applicare la variazione.')
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          if (eConcorrente(e)) {
            // Un'altra operazione teneva le righe: l'anteprima resta valida, si riprova con Applica.
            this.erroriApplica.set([MESSAGGIO_CONCORRENTE])
            return
          }
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.erroriApplica.set(e.conflitto ? [MESSAGGIO_VARIAZIONE_SUPERATA] : e.messaggi)
        },
      })
  }

  chiudi(): void {
    if (this.applicando()) return
    this.richiesta?.unsubscribe()
    this.visibleChange.emit(false)
  }
}
