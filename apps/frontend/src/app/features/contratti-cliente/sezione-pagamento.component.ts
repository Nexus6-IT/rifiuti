import { CommonModule } from '@angular/common'
import {
  Component,
  forwardRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AggiuntaInLinea } from '../clienti/aggiunta-in-linea'
import { Rif, TestoFatturazione } from '../clienti/clienti.model'
import { OpzioniFatturazione, conCorrente, etichettaCodice } from '../clienti/opzioni-fatturazione'
import { SceltaAgenteComponent } from '../clienti/scelta-agente.component'
import { SceltaConNuovoComponent } from '../clienti/scelta-con-nuovo.component'
import { SottoDialogFatturazioneComponent } from '../clienti/sotto-dialog-fatturazione.component'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { TestoFatturazioneDialogComponent } from '../clienti/tabelle/testo-fatturazione-dialog.component'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { OPZIONI_ESIGIBILITA } from '../clienti/vocabolario-clienti'
import { FormContratto } from './contratto-cliente-form'
import { SEZIONE_CONTRATTO } from './sezione-contratto'

/**
 * Sezione "Pagamento e fatturazione": condizione, conto, spese, bollo, registro, esigibilità,
 * ritenuta, agente e testo di fatturazione (codice destinatario e riferimento stanno nella sezione PA).
 * Condizione, conto, spese, bollo, registro e agente stanno in `OpzioniFatturazione` (stessa
 * logica del dialog del cliente); il testo di fatturazione ha la sua aggiunta in linea qui.
 */
@Component({
  selector: 'app-sezione-pagamento',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    SceltaConNuovoComponent,
    SceltaAgenteComponent,
    SottoDialogFatturazioneComponent,
    TestoFatturazioneDialogComponent,
  ],
  providers: [
    { provide: SEZIONE_CONTRATTO, useExisting: forwardRef(() => SezionePagamentoComponent) },
  ],
  template: `
    <div class="sezione" [formGroup]="form">
      <app-scelta-con-nuovo
        inputId="contratto-dlg-condizione"
        testid="contratto-dlg-condizione"
        etichetta="Condizione di pagamento"
        [controllo]="form.controls.condizionePagamentoId"
        [opzioni]="opzioni.opzCondizioni()"
        nuovoEtichetta="Nuova condizione"
        nuovoTestid="contratto-dlg-nuova-condizione"
        [puoCreare]="libero('condizionePagamentoId')"
        (nuovo)="opzioni.inLinea.apri('condizione', 'create', $any($event))"
      />
      <app-scelta-con-nuovo
        inputId="contratto-dlg-conto"
        testid="contratto-dlg-conto"
        etichetta="Ns. coordinate bancarie (conto del gestore)"
        [controllo]="form.controls.contoCorrenteId"
        [opzioni]="opzioni.opzConti()"
        [vuoto]="contoVuoto"
        nuovoEtichetta="Nuovo conto"
        nuovoTestid="contratto-dlg-nuovo-conto"
        [puoCreare]="libero('contoCorrenteId')"
        (nuovo)="opzioni.inLinea.apri('conto', 'create', $any($event))"
      />
      <app-scelta-con-nuovo
        inputId="contratto-dlg-spese"
        testid="contratto-dlg-spese"
        etichetta="Spese di incasso"
        [controllo]="form.controls.speseIncassoId"
        [opzioni]="opzioni.opzSpese()"
        nuovoEtichetta="Nuova spesa di incasso"
        nuovoTestid="contratto-dlg-nuove-spese"
        [puoCreare]="libero('speseIncassoId')"
        (nuovo)="opzioni.inLinea.apri('spese', 'create', $any($event))"
      />
      <app-scelta-con-nuovo
        inputId="contratto-dlg-bollo"
        testid="contratto-dlg-bollo"
        etichetta="Bollo"
        [controllo]="form.controls.bolloId"
        [opzioni]="opzioni.opzBolli()"
        vuoto="Bollo non addebitato"
        nuovoEtichetta="Nuovo bollo"
        nuovoTestid="contratto-dlg-nuovo-bollo"
        [puoCreare]="libero('bolloId')"
        (nuovo)="opzioni.inLinea.apri('bollo', 'create', $any($event))"
      />
      <app-scelta-con-nuovo
        inputId="contratto-dlg-registro"
        testid="contratto-dlg-registro"
        etichetta="Registro IVA"
        [controllo]="form.controls.registroIvaId"
        [opzioni]="opzioni.opzRegistri()"
        nuovoEtichetta="Nuovo registro"
        nuovoTestid="contratto-dlg-nuovo-registro"
        [puoCreare]="libero('registroIvaId')"
        (nuovo)="opzioni.inLinea.apri('registro', 'create', $any($event))"
      />

      <label for="contratto-dlg-esigibilita">Esigibilità IVA</label>
      <select
        id="contratto-dlg-esigibilita"
        formControlName="esigibilitaIva"
        class="p-inputtext"
        data-testid="contratto-dlg-esigibilita"
      >
        <option *ngFor="let o of esigibilita" [value]="o.value">{{ o.label }}</option>
      </select>

      <label for="contratto-dlg-ritenuta">Ritenuta d'acconto (%)</label>
      <input
        pInputText
        id="contratto-dlg-ritenuta"
        formControlName="ritenutaPercentuale"
        inputmode="decimal"
        data-testid="contratto-dlg-ritenuta"
      />

      <app-scelta-agente
        prefisso="contratto-dlg"
        [opzioni]="opzioni"
        [puoScegliere]="libero('agenteId')"
        [puoCreare]="libero('agenteId')"
      />

      <app-scelta-con-nuovo
        inputId="contratto-dlg-testo"
        testid="contratto-dlg-testo"
        etichetta="Testo di fatturazione"
        [controllo]="form.controls.testoFatturazioneId"
        [opzioni]="opzTesti()"
        nuovoEtichetta="Nuovo testo"
        nuovoTestid="contratto-dlg-nuovo-testo"
        [puoCreare]="libero('testoFatturazioneId')"
        (nuovo)="inLineaTesto.apri('testo', 'create', $any($event))"
      />
      <ul
        *ngIf="righeTesto().length > 0"
        class="righe-testo"
        data-testid="contratto-dlg-testo-righe"
      >
        <li *ngFor="let r of righeTesto()">{{ r }}</li>
      </ul>
    </div>

    <app-sotto-dialog-fatturazione [opzioni]="opzioni" />
    <app-testo-fatturazione-dialog
      [visible]="inLineaTesto.aperto === 'testo'"
      (visibleChange)="chiudiTesto($event)"
      (salvato)="dopoTesto($event)"
    />
  `,
  styles: [
    `
      .sezione {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .righe-testo {
        margin: 0;
        padding-left: 1.25rem;
        font-size: 0.9rem;
        color: var(--text-color-secondary, #666);
      }
    `,
  ],
})
export class SezionePagamentoComponent implements OnChanges, OnDestroy {
  private readonly tabelle = inject(TabelleFatturazioneService)

  @Input({ required: true }) form!: FormContratto
  @Input({ required: true }) opzioni!: OpzioniFatturazione
  /** Dialog aperto: a ogni apertura si rilegge l'elenco dei testi. */
  @Input() visible = false
  @Input() puoScrivere = false
  @Input() bloccati: ReadonlySet<string> = new Set()
  @Input() testoCorrente: Rif | null = null
  /** Testo dell'opzione vuota del conto: "dal cliente: <descrizione>" (D4) o "—". */
  @Input() contoVuoto = '—'
  /** Errore di caricamento dell'elenco dei testi. */
  @Input() segnalaErrore: (messaggio: string) => void = () => undefined

  readonly inLineaTesto = new AggiuntaInLinea<'testo'>()
  readonly esigibilita = OPZIONI_ESIGIBILITA

  private readonly testi = signal<TestoFatturazione[]>([])
  private readonly correnteSig = signal<Rif | null>(null)
  private readonly sceltaTesto = signal('')
  readonly opzTesti = computed(() =>
    conCorrente(
      this.testi().map(t => ({ id: t.id, etichetta: etichettaCodice(t.codice, t.titolo) })),
      this.correnteSig()
    )
  )
  /** Le righe del testo scelto, sotto il campo. */
  readonly righeTesto = () => this.testi().find(t => t.id === this.sceltaTesto())?.righe ?? []

  private lettura?: Subscription
  private segui?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['testoCorrente']) this.correnteSig.set(this.testoCorrente)
    if (c['form'] && this.form) {
      this.segui?.unsubscribe()
      this.sceltaTesto.set(this.form.controls.testoFatturazioneId.value)
      this.segui = this.form.controls.testoFatturazioneId.valueChanges.subscribe(v =>
        this.sceltaTesto.set(v)
      )
    }
    if (c['visible']) {
      if (this.visible) this.carica()
      else this.azzera()
    }
  }

  ngOnDestroy(): void {
    this.azzera()
    this.segui?.unsubscribe()
  }

  libero(campo: string): boolean {
    return this.puoScrivere && !this.bloccati.has(campo)
  }

  inLineaAperta(): boolean {
    return this.inLineaTesto.aperto !== null || this.opzioni.inLinea.aperto !== null
  }

  bloccaChiusuraEsterna(visibile: boolean): boolean {
    return (
      this.inLineaTesto.bloccaChiusuraEsterna(visibile) ||
      this.opzioni.inLinea.bloccaChiusuraEsterna(visibile)
    )
  }

  private azzera(): void {
    this.lettura?.unsubscribe()
    this.inLineaTesto.aperto = null
    this.testi.set([])
  }

  private carica(): void {
    this.lettura?.unsubscribe()
    this.lettura = this.tabelle.testi.list().subscribe({
      next: l => this.testi.set(l),
      error: err =>
        this.segnalaErrore(messaggioErrore(err, 'Impossibile caricare i testi di fatturazione.')),
    })
  }

  chiudiTesto(visibile: boolean): void {
    if (!visibile) this.inLineaTesto.chiudi()
  }

  dopoTesto(t: TestoFatturazione): void {
    this.testi.update(v => [...v.filter(x => x.id !== t.id), t])
    this.inLineaTesto.salvato(t, id => this.form.controls.testoFatturazioneId.setValue(id), false)
  }
}
