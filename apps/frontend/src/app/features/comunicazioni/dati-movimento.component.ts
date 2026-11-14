import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { ToastService } from '../../core/services/toast.service'
import { TracciatoDati, erroriDaRisposta } from './dati-comunicazioni.model'
import { DatiComunicazioniService } from './dati-comunicazioni.service'

const PRODOTTI = ['A', 'B', 'C', 'E', 'G']
const CAUSALI = ['B', 'E', 'U', 'M', 'D', 'L']
const PGF = ['A', 'B', 'C', 'D', 'E']
const ATTIVITA_ORR = [
  { value: 'FRA', label: 'Frantumatore' },
  { value: 'ROT', label: 'Rottamatore' },
  { value: 'AUT', label: 'Autodemolitore' },
]

/**
 * Dati del tracciato di un movimento (4.9c-f, D2) per CONOU, COBAT e O.R.R. (attività FRA/ROT/AUT e formulario manuale): prodotto, percentuale, causale
 * e scarico interno per CONOU; tipo di movimento, causa e PGF per COBAT. Si mostra nel pannello
 * della marcatura del movimento, solo per i consorzi per cui il movimento e' marcato. I dati
 * stanno nella radice della catena e non cambiano la marcatura. Scrittura ADMIN/OPERATOR.
 */
@Component({
  selector: 'app-dati-movimento',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule],
  template: `
    <section
      class="dati-movimento"
      data-testid="dati-movimento"
      aria-label="Dati per le comunicazioni"
    >
      <h3 class="section-title">Dati per le comunicazioni</h3>
      <p *ngIf="errore()" role="alert" data-testid="dati-errore">{{ errore() }}</p>
      <ul *ngIf="erroriCampo().length > 0" role="alert" data-testid="dati-errori-campo">
        <li *ngFor="let e of erroriCampo()">{{ e }}</li>
      </ul>
      <form *ngIf="caricato()" (ngSubmit)="salva()" novalidate>
        <ng-container [ngSwitch]="tracciato">
          <ng-container *ngSwitchCase="'CONOU'">
            <div class="campo">
              <label for="dm-prodotto">Prodotto</label>
              <select
                id="dm-prodotto"
                name="prodotto"
                [(ngModel)]="prodotto"
                [disabled]="!puoModificare()"
              >
                <option value="">Dal predefinito</option>
                <option *ngFor="let p of prodotti" [value]="p">{{ p }}</option>
              </select>
            </div>
            <div class="campo">
              <label for="dm-percentuale">Percentuale di olio</label>
              <input
                id="dm-percentuale"
                name="percentuale"
                type="number"
                step="0.01"
                min="0"
                max="99.99"
                [(ngModel)]="percentuale"
                [disabled]="!puoModificare()"
              />
            </div>
            <div class="campo">
              <label for="dm-causale">Causale</label>
              <select
                id="dm-causale"
                name="causale"
                [(ngModel)]="causale"
                [disabled]="!puoModificare()"
              >
                <option value="">Dal verso del movimento</option>
                <option *ngFor="let c of causali" [value]="c">{{ c }}</option>
              </select>
            </div>
            <div class="campo">
              <input
                type="checkbox"
                id="dm-scarico-interno"
                name="scaricoInterno"
                [(ngModel)]="scaricoInterno"
                [disabled]="!puoModificare()"
              />
              <label for="dm-scarico-interno">Scarico interno (quantità negativa)</label>
            </div>
          </ng-container>
          <ng-container *ngSwitchCase="'ORR'">
            <div class="campo">
              <label for="dm-attivita">Attività O.R.R. (FRA, ROT, AUT)</label>
              <select
                id="dm-attivita"
                name="attivitaOrr"
                [(ngModel)]="attivitaOrr"
                [disabled]="!puoModificare()"
              >
                <option value="">Dal tipo impianto della sede</option>
                <option *ngFor="let a of attivitaOrrLista" [value]="a.value">
                  {{ a.label }} ({{ a.value }})
                </option>
              </select>
            </div>
            <div class="campo">
              <label for="dm-formulario-numero">Numero del formulario (se manca il FIR)</label>
              <input
                id="dm-formulario-numero"
                name="formularioNumero"
                type="text"
                maxlength="15"
                [(ngModel)]="formularioNumero"
                [disabled]="!puoModificare()"
              />
            </div>
            <div class="campo">
              <label for="dm-formulario-data">Data del formulario</label>
              <input
                id="dm-formulario-data"
                name="formularioData"
                type="date"
                [(ngModel)]="formularioData"
                [disabled]="!puoModificare()"
              />
            </div>
          </ng-container>
          <ng-container *ngSwitchCase="'COBAT'">
            <div class="campo">
              <label for="dm-tipo">Tipo di movimento (1-7)</label>
              <input
                id="dm-tipo"
                name="tipo"
                type="number"
                min="1"
                max="7"
                [(ngModel)]="tipoMovimento"
                [disabled]="!puoModificare()"
              />
            </div>
            <div class="campo">
              <label for="dm-causa">Causa (1-5)</label>
              <input
                id="dm-causa"
                name="causa"
                type="number"
                min="1"
                max="5"
                [(ngModel)]="causa"
                [disabled]="!puoModificare()"
              />
            </div>
            <div class="campo">
              <label for="dm-pgf">PGF / tipologia</label>
              <select id="dm-pgf" name="pgf" [(ngModel)]="pgf" [disabled]="!puoModificare()">
                <option value="">Dal predefinito</option>
                <option *ngFor="let p of pgfLista" [value]="p">{{ p }}</option>
              </select>
            </div>
          </ng-container>
        </ng-container>
        <ng-container *ngIf="puoModificare()">
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="inCorso()"
            [disabled]="inCorso()"
            (onClick)="salva()"
            data-testid="dati-salva"
          />
          <p-button
            *ngIf="presenti()"
            label="Togli i dati"
            icon="pi pi-undo"
            [text]="true"
            [disabled]="inCorso()"
            (onClick)="togli()"
            data-testid="dati-togli"
          />
        </ng-container>
      </form>
    </section>
  `,
})
export class DatiMovimentoComponent implements OnChanges {
  private readonly servizio = inject(DatiComunicazioniService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) movimentoId!: string
  @Input({ required: true }) tracciato!: Extract<TracciatoDati, 'CONOU' | 'COBAT' | 'ORR'>

  readonly prodotti = PRODOTTI
  readonly causali = CAUSALI
  readonly pgfLista = PGF
  readonly attivitaOrrLista = ATTIVITA_ORR
  /** Emesso dopo un salvataggio o una rimozione riusciti. */
  @Output() readonly salvato = new EventEmitter<void>()

  readonly caricato = signal(false)
  readonly presenti = signal(false)
  readonly puoModificare = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  readonly erroriCampo = signal<string[]>([])

  prodotto = ''
  percentuale: number | null = null
  causale = ''
  scaricoInterno = false
  tipoMovimento: number | null = null
  causa: number | null = null
  pgf = ''
  attivitaOrr = ''
  formularioNumero = ''
  formularioData = ''

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['movimentoId'] || changes['tracciato']) && this.movimentoId) this.carica()
  }

  private carica(): void {
    this.errore.set(null)
    this.erroriCampo.set([])
    this.caricato.set(false)
    this.servizio.datiMovimento(this.movimentoId, this.tracciato).subscribe({
      next: r => {
        const d = (r.dati?.dati ?? {}) as Record<string, unknown>
        this.puoModificare.set(r.puoModificare)
        this.presenti.set(r.dati !== null)
        this.prodotto = String(d['prodotto'] ?? '')
        this.percentuale = typeof d['percentualeOlio'] === 'number' ? d['percentualeOlio'] : null
        this.causale = String(d['causale'] ?? '')
        this.scaricoInterno = d['scaricoInterno'] === true
        this.tipoMovimento = typeof d['tipoMovimento'] === 'number' ? d['tipoMovimento'] : null
        this.causa = typeof d['causa'] === 'number' ? d['causa'] : null
        this.pgf = String(d['pgf'] ?? '')
        this.attivitaOrr = String(d['attivita'] ?? '')
        const f = (d['formulario'] ?? {}) as Record<string, unknown>
        this.formularioNumero = String(f['numero'] ?? '')
        this.formularioData = String(f['data'] ?? '')
        this.caricato.set(true)
      },
      error: () => this.errore.set('Impossibile leggere i dati per le comunicazioni.'),
    })
  }

  /** Solo i campi valorizzati (un campo vuoto significa «dal predefinito»). */
  dati(): Record<string, unknown> {
    const d: Record<string, unknown> = {}
    if (this.tracciato === 'CONOU') {
      if (this.prodotto) d['prodotto'] = this.prodotto
      if (this.percentuale !== null && this.percentuale !== undefined)
        d['percentualeOlio'] = this.percentuale
      if (this.causale) d['causale'] = this.causale
      if (this.scaricoInterno) d['scaricoInterno'] = true
    } else if (this.tracciato === 'ORR') {
      if (this.attivitaOrr) d['attivita'] = this.attivitaOrr
      // Numero e data vanno insieme: il backend rifiuta un formulario a meta'.
      if (this.formularioNumero.trim() || this.formularioData)
        d['formulario'] = {
          ...(this.formularioNumero.trim() ? { numero: this.formularioNumero.trim() } : {}),
          ...(this.formularioData ? { data: this.formularioData } : {}),
        }
    } else {
      if (this.tipoMovimento !== null && this.tipoMovimento !== undefined)
        d['tipoMovimento'] = this.tipoMovimento
      if (this.causa !== null && this.causa !== undefined) d['causa'] = this.causa
      if (this.pgf) d['pgf'] = this.pgf
    }
    return d
  }

  salva(): void {
    if (!this.puoModificare() || this.inCorso()) return
    this.inCorso.set(true)
    this.erroriCampo.set([])
    this.servizio.impostaDatiMovimento(this.movimentoId, this.tracciato, this.dati()).subscribe({
      next: () => {
        this.inCorso.set(false)
        this.presenti.set(true)
        this.toast.success('Dati salvati.')
        this.salvato.emit()
      },
      error: err => {
        this.inCorso.set(false)
        const errori = erroriDaRisposta(err)
        this.erroriCampo.set(errori.length > 0 ? errori : ['Salvataggio non riuscito.'])
      },
    })
  }

  togli(): void {
    if (!this.puoModificare() || this.inCorso()) return
    this.inCorso.set(true)
    this.servizio.cancellaDatiMovimento(this.movimentoId, this.tracciato).subscribe({
      next: () => {
        this.inCorso.set(false)
        this.presenti.set(false)
        this.carica()
        this.salvato.emit()
      },
      error: () => {
        this.inCorso.set(false)
        this.toast.error('Operazione non riuscita.')
      },
    })
  }
}
