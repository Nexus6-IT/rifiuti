import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { ClienteDialogComponent } from '../clienti/cliente-dialog.component'
import { AggiuntaInLinea } from '../clienti/aggiunta-in-linea'
import { Cliente, CodificaContratto, Rif } from '../clienti/clienti.model'
import { Opzione, conCorrente, etichettaCodice } from '../clienti/opzioni-fatturazione'
import { SceltaConNuovoComponent } from '../clienti/scelta-con-nuovo.component'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { CodificaDialogComponent } from '../clienti/tabelle/codifica-dialog.component'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { OPZIONI_UNITA_VALIDITA } from '../clienti/vocabolario-clienti'
import { RegistryService } from '../registry/registry.service'
import { SedeDitta } from '../../shared/models/registry.model'
import { FormContratto } from './contratto-cliente-form'
import { SceltaClienteComponent } from './scelta-cliente.component'

/** Le voci correnti di un contratto già salvato: possono non essere più fra quelle attive. */
export interface CorrentiGenerali {
  categoria: Rif | null
  tipo: Rif | null
  sede: { id: string; descrizione: string } | null
}

type SubGenerali = 'cliente' | 'fatturazione' | 'categoria' | 'tipo'

const etichettaSede = (s: SedeDitta): string => `${s.via} ${s.civico}, ${s.citta} (${s.provincia})`

/**
 * Sezione "Dati generali" del dialog del contratto: numero, descrizione, cliente e cliente di
 * fatturazione (con "Nuovo cliente" in linea), sede di servizio, categoria e tipo (con "Nuova …"
 * rapida), date e validità. Le scelte del cliente le gestisce il dialog (`clienteScelto`,
 * `fatturazioneScelta`): precompila i predefiniti e svuota la sede.
 */
@Component({
  selector: 'app-sezione-dati-generali',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    SceltaClienteComponent,
    SceltaConNuovoComponent,
    ClienteDialogComponent,
    CodificaDialogComponent,
  ],
  template: `
    <div class="sezione" [formGroup]="form">
      <label for="contratto-dlg-numero">Numero</label>
      <input
        pInputText
        id="contratto-dlg-numero"
        formControlName="numero"
        maxlength="50"
        data-testid="contratto-dlg-numero"
      />
      <label for="contratto-dlg-descrizione">Descrizione</label>
      <input
        pInputText
        id="contratto-dlg-descrizione"
        formControlName="descrizione"
        maxlength="255"
        data-testid="contratto-dlg-descrizione"
      />

      <app-scelta-cliente
        prefisso="contratto-dlg-cliente"
        prefissoNuovo="contratto-dlg-nuovo-cliente"
        etichetta="Cliente"
        [valore]="clienteOpt"
        [disabled]="!libero('clienteId')"
        [puoCreare]="libero('clienteId')"
        (scelto)="clienteScelto.emit($event)"
        (nuovo)="inLinea.apri('cliente', 'create', $event)"
      />
      <app-scelta-cliente
        prefisso="contratto-dlg-fatturazione"
        prefissoNuovo="contratto-dlg-nuovo-fatturazione"
        etichetta="Cliente di fatturazione (se diverso dal cliente)"
        [valore]="fatturazioneOpt"
        [escludiId]="form.controls.clienteId.value || null"
        [disabled]="!libero('clienteFatturazioneId')"
        [puoCreare]="libero('clienteFatturazioneId')"
        (scelto)="fatturazioneScelta.emit($event)"
        (nuovo)="inLinea.apri('fatturazione', 'create', $event)"
      />

      <label for="contratto-dlg-sede">Sede di servizio</label>
      <select
        id="contratto-dlg-sede"
        formControlName="sedeId"
        class="p-inputtext"
        data-testid="contratto-dlg-sede"
      >
        <option value="">—</option>
        <option *ngFor="let s of opzioniSedi()" [value]="s.id">{{ s.etichetta }}</option>
      </select>

      <app-scelta-con-nuovo
        inputId="contratto-dlg-categoria"
        testid="contratto-dlg-categoria"
        etichetta="Categoria"
        [controllo]="form.controls.categoriaId"
        [opzioni]="opzCategorie()"
        nuovoEtichetta="Nuova categoria"
        nuovoTestid="contratto-dlg-nuova-categoria"
        [puoCreare]="libero('categoriaId')"
        (nuovo)="inLinea.apri('categoria', 'create', $any($event))"
      />
      <app-scelta-con-nuovo
        inputId="contratto-dlg-tipo"
        testid="contratto-dlg-tipo"
        etichetta="Tipo di contratto"
        [controllo]="form.controls.tipoId"
        [opzioni]="opzTipi()"
        nuovoEtichetta="Nuovo tipo"
        nuovoTestid="contratto-dlg-nuovo-tipo"
        [puoCreare]="libero('tipoId')"
        (nuovo)="inLinea.apri('tipo', 'create', $any($event))"
      />

      <div class="riga">
        <div class="campo">
          <label for="contratto-dlg-data-inizio">Data di inizio</label>
          <input
            type="date"
            class="p-inputtext"
            id="contratto-dlg-data-inizio"
            formControlName="dataInizio"
            data-testid="contratto-dlg-data-inizio"
          />
        </div>
        <div class="campo">
          <label for="contratto-dlg-data-fine">Data di fine</label>
          <input
            type="date"
            class="p-inputtext"
            id="contratto-dlg-data-fine"
            formControlName="dataFine"
            data-testid="contratto-dlg-data-fine"
          />
        </div>
        <div class="campo">
          <label for="contratto-dlg-data-stipula">Data di stipula</label>
          <input
            type="date"
            class="p-inputtext"
            id="contratto-dlg-data-stipula"
            formControlName="dataStipula"
            data-testid="contratto-dlg-data-stipula"
          />
        </div>
      </div>

      <div class="riga">
        <div class="campo">
          <label for="contratto-dlg-validita-quantita">Validità: durata</label>
          <input
            type="text"
            inputmode="numeric"
            maxlength="3"
            class="p-inputtext"
            id="contratto-dlg-validita-quantita"
            formControlName="validitaQuantita"
            data-testid="contratto-dlg-validita-quantita"
          />
        </div>
        <div class="campo">
          <label for="contratto-dlg-validita-unita">Validità: unità</label>
          <select
            id="contratto-dlg-validita-unita"
            formControlName="validitaUnita"
            class="p-inputtext"
            data-testid="contratto-dlg-validita-unita"
          >
            <option value="">—</option>
            <option *ngFor="let o of unita" [value]="o.value">{{ o.label }}</option>
          </select>
        </div>
      </div>
      <small
        *ngIf="validitaIncompleta()"
        class="field-hint"
        role="status"
        data-testid="contratto-dlg-validita-avviso"
        >Indica sia la durata sia l'unità, oppure nessuna delle due.</small
      >
    </div>

    <app-cliente-dialog
      [visible]="inLinea.aperto === 'cliente' || inLinea.aperto === 'fatturazione'"
      (visibleChange)="chiudiSub($event)"
      (salvato)="dopoCliente($event)"
    />
    <app-codifica-dialog
      [visible]="inLinea.aperto === 'categoria'"
      genere="CATEGORIA"
      [rapida]="true"
      (visibleChange)="chiudiSub($event)"
      (salvato)="dopoCodifica('categoria', $event)"
    />
    <app-codifica-dialog
      [visible]="inLinea.aperto === 'tipo'"
      genere="TIPO"
      [rapida]="true"
      (visibleChange)="chiudiSub($event)"
      (salvato)="dopoCodifica('tipo', $event)"
    />
  `,
  styles: [
    `
      .sezione {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .riga {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .campo {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 10rem;
        min-width: 0;
      }
    `,
  ],
})
export class SezioneDatiGeneraliComponent implements OnChanges, OnDestroy {
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly registry = inject(RegistryService)

  @Input({ required: true }) form!: FormContratto
  /** Dialog aperto: a ogni apertura si rileggono le liste. */
  @Input() visible = false
  @Input() puoScrivere = false
  /** Campi non modificabili del contratto (stato diverso da bozza): niente "Nuovo …" accanto. */
  @Input() bloccati: ReadonlySet<string> = new Set()
  @Input() clienteOpt: Opzione | null = null
  @Input() fatturazioneOpt: Opzione | null = null
  /** Ditta del cliente scelto: le sue sedi attive sono quelle fra cui scegliere. */
  @Input() dittaId: string | null = null
  @Input() correnti: CorrentiGenerali | null = null
  @Output() clienteScelto = new EventEmitter<Cliente | null>()
  @Output() fatturazioneScelta = new EventEmitter<Cliente | null>()
  /** Errore di caricamento delle liste. */
  @Output() errore = new EventEmitter<string>()

  readonly inLinea = new AggiuntaInLinea<SubGenerali>()
  readonly unita = OPZIONI_UNITA_VALIDITA

  private readonly categorie = signal<Opzione[]>([])
  private readonly tipi = signal<Opzione[]>([])
  private readonly sedi = signal<Opzione[]>([])
  private readonly correntiSig = signal<CorrentiGenerali | null>(null)
  readonly opzCategorie = computed(() =>
    conCorrente(this.categorie(), this.correntiSig()?.categoria)
  )
  readonly opzTipi = computed(() => conCorrente(this.tipi(), this.correntiSig()?.tipo))
  readonly opzioniSedi = () => {
    const s = this.correntiSig()?.sede
    const lista = this.sedi()
    return s && !lista.some(o => o.id === s.id) && this.form.controls.sedeId.value === s.id
      ? [...lista, { id: s.id, etichetta: s.descrizione }]
      : lista
  }

  private letture?: Subscription
  private letturaSedi?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['correnti']) this.correntiSig.set(this.correnti)
    if (c['visible']) {
      if (this.visible) this.carica()
      else this.azzera()
    }
    if (c['dittaId'] || (c['visible'] && this.visible)) this.caricaSedi()
  }

  ngOnDestroy(): void {
    this.azzera()
  }

  libero(campo: string): boolean {
    return this.puoScrivere && !this.bloccati.has(campo)
  }

  validitaIncompleta(): boolean {
    const v = this.form.getRawValue()
    return (v.validitaQuantita.trim() !== '') !== (v.validitaUnita !== '')
  }

  /** Un sub-dialog "Nuovo …" è aperto: Esc non deve chiudere anche il contratto. */
  inLineaAperta(): boolean {
    return this.inLinea.aperto !== null
  }

  bloccaChiusuraEsterna(visibile: boolean): boolean {
    return this.inLinea.bloccaChiusuraEsterna(visibile)
  }

  private azzera(): void {
    this.letture?.unsubscribe()
    this.letturaSedi?.unsubscribe()
    this.inLinea.aperto = null
    this.categorie.set([])
    this.tipi.set([])
    this.sedi.set([])
  }

  private carica(): void {
    this.letture?.unsubscribe()
    const s = new Subscription()
    this.letture = s
    const voce = (c: CodificaContratto): Opzione => ({
      id: c.id,
      etichetta: etichettaCodice(c.codice, c.descrizione),
    })
    const errore = (err: unknown) =>
      this.errore.emit(messaggioErrore(err, 'Impossibile caricare le codifiche del contratto.'))
    s.add(
      this.tabelle.codifiche.list('CATEGORIA').subscribe({
        next: l => this.categorie.set(l.map(voce)),
        error: errore,
      })
    )
    s.add(
      this.tabelle.codifiche.list('TIPO').subscribe({
        next: l => this.tipi.set(l.map(voce)),
        error: errore,
      })
    )
  }

  /** Sedi attive della ditta del cliente; la sede già scelta resta in elenco anche se disattivata. */
  private caricaSedi(): void {
    this.letturaSedi?.unsubscribe()
    this.sedi.set([])
    if (!this.dittaId) return
    const attuale = this.form.controls.sedeId.value
    this.letturaSedi = this.registry.getDitta(this.dittaId).subscribe({
      next: d =>
        this.sedi.set(
          d.sedi
            .filter(s => s.attiva || s.id === attuale)
            .map(s => ({ id: s.id, etichetta: etichettaSede(s) }))
        ),
      error: () => this.sedi.set([]),
    })
  }

  chiudiSub(visibile: boolean): void {
    if (!visibile) this.inLinea.chiudi()
  }

  dopoCliente(c: Cliente): void {
    const per = this.inLinea.aperto
    this.inLinea.salvato(
      c,
      () => {
        if (per === 'fatturazione') this.fatturazioneScelta.emit(c)
        else this.clienteScelto.emit(c)
      },
      false
    )
  }

  dopoCodifica(chi: 'categoria' | 'tipo', c: CodificaContratto): void {
    const lista = chi === 'categoria' ? this.categorie : this.tipi
    const campo: FormControl<string> =
      chi === 'categoria' ? this.form.controls.categoriaId : this.form.controls.tipoId
    lista.update(v => [
      ...v.filter(o => o.id !== c.id),
      { id: c.id, etichetta: etichettaCodice(c.codice, c.descrizione) },
    ])
    this.inLinea.salvato(c, id => campo.setValue(id), false)
  }
}
