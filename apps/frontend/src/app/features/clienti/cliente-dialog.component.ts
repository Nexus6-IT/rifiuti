import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { TipoProvvigione } from '../listino/listino.model'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { SedeDitta } from '../../shared/models/registry.model'
import { etichettaIdentificativiCompleta } from '../registry/identificativo-fiscale'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import { RegistryService } from '../registry/registry.service'
import { SediDittaDialogComponent } from '../registry/sedi-ditta-dialog.component'
import {
  Cliente,
  DatiFiscaliCliente,
  EsigibilitaIva,
  ModificaCliente,
  NuovoCliente,
} from './clienti.model'
import { ClientiService } from './clienti.service'
import { DittaRuoloFormComponent } from './ditta-ruolo-form.component'
import { OpzioniFatturazione } from './opzioni-fatturazione'
import { SceltaAgenteComponent } from './scelta-agente.component'
import { SceltaConNuovoComponent } from './scelta-con-nuovo.component'
import { SottoDialogFatturazioneComponent } from './sotto-dialog-fatturazione.component'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { messaggioErrore } from './tabelle/tabella-comune'
import {
  formatCascata,
  formatNumero,
  leggiCascata,
  leggiNumero,
  messaggioNumero,
  validatoreNumero,
} from '../../shared/utils/numero-modificabile'
import { OPZIONI_TIPO_PROVVIGIONE } from '../listino/vocabolario-listino'
import { OPZIONI_ESIGIBILITA } from './vocabolario-clienti'

const MESSAGGIO_PRIVATO = 'Per un cliente persona fisica indica nome e cognome.'
const CODICE_NESSUNO = '0000000'

const vuoto = (v: string): string | null => (v.trim() === '' ? null : v.trim())
const vuotoId = (v: string): string | null => (v === '' ? null : v)
const senzaSpazi = (v: string | null): string | null =>
  v === null ? null : v.replace(/\s+/g, '').toUpperCase()

/**
 * Nuovo cliente o modifica. Il ruolo vive su una ditta (D18): in creazione si cerca la ditta per
 * identificativo (blocco condiviso `app-ditta-ruolo-form`); in modifica identificativi e
 * indirizzo sono della ditta e restano in sola lettura, con il link alle sedi. Ogni campo che
 * sceglie una tabella ha accanto "Nuovo …" (aggiunta in linea, D20).
 */
@Component({
  selector: 'app-cliente-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    DittaRuoloFormComponent,
    SediDittaDialogComponent,
    SceltaConNuovoComponent,
    SceltaAgenteComponent,
    SottoDialogFatturazioneComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="cliente ? 'Modifica cliente' : 'Nuovo cliente'"
      [modal]="true"
      [style]="{ width: '52rem' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <h3 class="sezione">Ditta</h3>
        <app-ditta-ruolo-form
          *ngIf="!cliente"
          pfx="cliente-dlg"
          tipo="cliente"
          (privatoChange)="privato = $event"
        />
        <ng-container *ngIf="cliente">
          <p class="dlg-ditta" data-testid="cliente-dlg-ditta">
            <strong>{{ cliente.ditta.ragioneSociale }}</strong>
          </p>
          <p class="field-hint" data-testid="cliente-dlg-identificativi">
            {{ identificativi }} — non modificabili: sono l'identità fiscale del soggetto.
          </p>
          <label for="cliente-dlg-sede">Sede di fatturazione</label>
          <select
            id="cliente-dlg-sede"
            formControlName="sedeId"
            class="p-inputtext"
            data-testid="cliente-dlg-sede"
          >
            <option *ngFor="let s of sedi()" [value]="s.id">
              {{ s.via }} {{ s.civico }}, {{ s.cap }} {{ s.citta }} ({{ s.provincia }})
            </option>
          </select>
          <p-button
            *ngIf="puoScrivere()"
            label="Sedi"
            icon="pi pi-map-marker"
            [text]="true"
            size="small"
            (onClick)="sediAperte = true"
            data-testid="cliente-dlg-sedi"
          />
        </ng-container>

        <ng-container *ngIf="mostraNomeCognome">
          <div class="dlg-riga">
            <div class="dlg-campo">
              <label for="cliente-dlg-nome">Nome</label>
              <input
                pInputText
                id="cliente-dlg-nome"
                formControlName="nome"
                maxlength="60"
                data-testid="cliente-dlg-nome"
              />
            </div>
            <div class="dlg-campo">
              <label for="cliente-dlg-cognome">Cognome</label>
              <input
                pInputText
                id="cliente-dlg-cognome"
                formControlName="cognome"
                maxlength="60"
                data-testid="cliente-dlg-cognome"
              />
            </div>
          </div>
          <small *ngIf="erroreNome() as e" role="alert" class="field-error">{{ e }}</small>
        </ng-container>

        <label for="cliente-dlg-codice">Codice (facoltativo)</label>
        <input
          pInputText
          id="cliente-dlg-codice"
          formControlName="codice"
          maxlength="20"
          data-testid="cliente-dlg-codice"
        />

        <h3 class="sezione">Fatturazione elettronica</h3>
        <label for="cliente-dlg-codice-dest">Codice destinatario SDI</label>
        <input
          pInputText
          id="cliente-dlg-codice-dest"
          formControlName="codiceDestinatario"
          maxlength="7"
          data-testid="cliente-dlg-codice-dest"
        />
        <label for="cliente-dlg-pec-fatt">PEC per la fattura elettronica</label>
        <input
          pInputText
          id="cliente-dlg-pec-fatt"
          formControlName="pecFatturazione"
          data-testid="cliente-dlg-pec-fatt"
        />
        <small class="field-hint"
          >La PEC si indica solo con il codice destinatario 0000000 o senza codice.</small
        >
        <label for="cliente-dlg-rif-amm">Riferimento amministrazione</label>
        <input
          pInputText
          id="cliente-dlg-rif-amm"
          formControlName="riferimentoAmministrazione"
          maxlength="20"
          data-testid="cliente-dlg-rif-amm"
        />
        <small class="field-hint"
          >Si indica solo insieme a un codice destinatario diverso da 0000000.</small
        >

        <h3 class="sezione">Pagamento</h3>
        <app-scelta-con-nuovo
          inputId="cliente-dlg-condizione"
          testid="cliente-dlg-condizione"
          etichetta="Condizione di pagamento"
          [controllo]="form.controls.condizionePagamentoId"
          [opzioni]="opzioni.opzCondizioni()"
          nuovoEtichetta="Nuova condizione"
          nuovoTestid="cliente-dlg-nuova-condizione"
          [puoCreare]="puoScrivere()"
          (nuovo)="opzioni.inLinea.apri('condizione', 'create', $any($event))"
        />
        <app-scelta-con-nuovo
          inputId="cliente-dlg-conto"
          testid="cliente-dlg-conto"
          etichetta="Ns. coordinate bancarie (conto del gestore)"
          [controllo]="form.controls.contoCorrenteId"
          [opzioni]="opzioni.opzConti()"
          nuovoEtichetta="Nuovo conto"
          nuovoTestid="cliente-dlg-nuovo-conto"
          [puoCreare]="puoScrivere()"
          (nuovo)="opzioni.inLinea.apri('conto', 'create', $any($event))"
        />

        <label for="cliente-dlg-iban">IBAN del cliente (facoltativo)</label>
        <input
          pInputText
          id="cliente-dlg-iban"
          formControlName="iban"
          maxlength="42"
          autocomplete="off"
          data-testid="cliente-dlg-iban"
        />

        <app-scelta-con-nuovo
          inputId="cliente-dlg-spese"
          testid="cliente-dlg-spese"
          etichetta="Spese di incasso"
          [controllo]="form.controls.speseIncassoId"
          [opzioni]="opzioni.opzSpese()"
          nuovoEtichetta="Nuova spesa di incasso"
          nuovoTestid="cliente-dlg-nuove-spese"
          [puoCreare]="puoScrivere()"
          (nuovo)="opzioni.inLinea.apri('spese', 'create', $any($event))"
        />
        <app-scelta-con-nuovo
          inputId="cliente-dlg-bollo"
          testid="cliente-dlg-bollo"
          etichetta="Bollo"
          [controllo]="form.controls.bolloId"
          [opzioni]="opzioni.opzBolli()"
          vuoto="Bollo non addebitato"
          nuovoEtichetta="Nuovo bollo"
          nuovoTestid="cliente-dlg-nuovo-bollo"
          [puoCreare]="puoScrivere()"
          (nuovo)="opzioni.inLinea.apri('bollo', 'create', $any($event))"
        />

        <h3 class="sezione">Fiscale</h3>
        <label for="cliente-dlg-esigibilita">Esigibilità IVA</label>
        <select
          id="cliente-dlg-esigibilita"
          formControlName="esigibilitaIva"
          class="p-inputtext"
          data-testid="cliente-dlg-esigibilita"
        >
          <option *ngFor="let o of esigibilita" [value]="o.value">{{ o.label }}</option>
        </select>

        <app-scelta-con-nuovo
          inputId="cliente-dlg-registro"
          testid="cliente-dlg-registro"
          etichetta="Registro IVA"
          [controllo]="form.controls.registroIvaId"
          [opzioni]="opzioni.opzRegistri()"
          nuovoEtichetta="Nuovo registro"
          nuovoTestid="cliente-dlg-nuovo-registro"
          [puoCreare]="puoScrivere()"
          (nuovo)="opzioni.inLinea.apri('registro', 'create', $any($event))"
        />

        <label for="cliente-dlg-ritenuta">Ritenuta d'acconto (%)</label>
        <input
          pInputText
          id="cliente-dlg-ritenuta"
          formControlName="ritenutaPercentuale"
          inputmode="decimal"
          [attr.aria-invalid]="erroreRitenuta() ? 'true' : null"
          aria-describedby="cliente-dlg-ritenuta-errore"
          data-testid="cliente-dlg-ritenuta"
        />
        <small
          *ngIf="erroreRitenuta() as e"
          role="alert"
          class="field-error"
          id="cliente-dlg-ritenuta-errore"
          data-testid="cliente-dlg-ritenuta-errore"
          >{{ e }}</small
        >

        <app-scelta-agente
          prefisso="cliente-dlg"
          [opzioni]="opzioni"
          [puoScegliere]="puoScrivere()"
          [puoCreare]="puoScrivere()"
        />

        <label for="cliente-dlg-listino">Listino</label>
        <select
          id="cliente-dlg-listino"
          formControlName="listino"
          class="p-inputtext"
          [attr.aria-invalid]="erroreListino() ? 'true' : null"
          aria-describedby="cliente-dlg-listino-errore"
          data-testid="cliente-dlg-listino"
        >
          <option value="">Nessuno</option>
          <option *ngFor="let n of listini" [value]="n">Listino {{ n }}</option>
        </select>
        <small
          *ngIf="erroreListino() as e"
          role="alert"
          class="field-error"
          id="cliente-dlg-listino-errore"
          data-testid="cliente-dlg-listino-errore"
          >{{ e }}</small
        >

        <label for="cliente-dlg-provvigione">Provvigione predefinita (%)</label>
        <input
          pInputText
          id="cliente-dlg-provvigione"
          formControlName="provvigionePredefinita"
          inputmode="decimal"
          maxlength="20"
          [attr.aria-invalid]="messaggioProvvigione() ? 'true' : null"
          aria-describedby="cliente-dlg-provvigione-errore"
          data-testid="cliente-dlg-provvigione"
        />
        <small
          *ngIf="messaggioProvvigione() as e"
          role="alert"
          class="field-error"
          id="cliente-dlg-provvigione-errore"
          data-testid="cliente-dlg-provvigione-errore"
          >{{ e }}</small
        >
        <label for="cliente-dlg-tipo-provvigione">Provvigione calcolata</label>
        <select
          id="cliente-dlg-tipo-provvigione"
          formControlName="tipoProvvigionePredefinita"
          class="p-inputtext"
          [attr.aria-invalid]="erroreTipo() ? 'true' : null"
          aria-describedby="cliente-dlg-tipo-provvigione-errore"
          data-testid="cliente-dlg-tipo-provvigione"
        >
          <option value="">Da indicare</option>
          <option *ngFor="let o of tipiProvvigione" [value]="o.value">{{ o.label }}</option>
        </select>
        <small
          *ngIf="erroreTipo() as e"
          role="alert"
          class="field-error"
          id="cliente-dlg-tipo-provvigione-errore"
          data-testid="cliente-dlg-tipo-provvigione-errore"
          >{{ e }}</small
        >

        <h3 class="sezione">Note</h3>
        <label for="cliente-dlg-note">Note</label>
        <input
          pInputText
          id="cliente-dlg-note"
          formControlName="note"
          maxlength="2000"
          data-testid="cliente-dlg-note"
        />
        <small class="contatore" data-testid="cliente-dlg-note-contatore">
          {{ form.controls.note.value.length }}/2000 caratteri
        </small>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="cliente-dlg-errore">
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
          data-testid="cliente-dlg-salva"
        />
      </ng-template>
    </p-dialog>

    <app-sotto-dialog-fatturazione [opzioni]="opzioni" />
    <app-sedi-ditta-dialog
      *ngIf="cliente"
      [(visible)]="sediAperte"
      [dittaId]="cliente.ditta.id"
      [ragioneSociale]="cliente.ditta.ragioneSociale"
      [puoGestire]="puoScrivere()"
      (modificata)="caricaSedi()"
    />
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .sezione {
        margin: 0.75rem 0 0;
        font-size: 1rem;
      }
      .dlg-riga {
        display: flex;
        gap: 0.75rem;
      }
      .dlg-campo {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 0;
        min-width: 0;
      }
    `,
  ],
})
export class ClienteDialogComponent implements OnChanges {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly registry = inject(RegistryService)
  private readonly toast = inject(ToastService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() cliente: Cliente | null = null
  @Output() salvato = new EventEmitter<Cliente>()
  @Output() visibleChange = new EventEmitter<boolean>()

  @ViewChild(DittaRuoloFormComponent) private ditta?: DittaRuoloFormComponent

  readonly esigibilita = OPZIONI_ESIGIBILITA
  readonly listini = [1, 2, 3, 4, 5, 6]
  readonly tipiProvvigione = OPZIONI_TIPO_PROVVIGIONE

  readonly errore = signal<string | null>(null)
  readonly erroreNome = signal<string | null>(null)
  readonly erroreListino = signal<string | null>(null)
  readonly erroreProvvigione = signal<string | null>(null)
  readonly erroreTipo = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  readonly sedi = signal<SedeDitta[]>([])
  readonly puoScrivere = () => puoGestireAnagrafiche(this.auth.currentUser()?.role)
  /** Il cliente letto dal server (in modifica): base dei confronti. */
  private readonly letto = signal<Cliente | null>(null)

  /** Ditta del nuovo cliente senza partita IVA: servono nome e cognome. */
  privato = false
  sediAperte = false
  private versione = 0
  private lettura?: Subscription
  private lettureSedi?: Subscription

  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true }),
    cognome: new FormControl('', { nonNullable: true }),
    codice: new FormControl('', { nonNullable: true }),
    codiceDestinatario: new FormControl('', { nonNullable: true }),
    pecFatturazione: new FormControl('', { nonNullable: true }),
    riferimentoAmministrazione: new FormControl('', { nonNullable: true }),
    iban: new FormControl('', { nonNullable: true }),
    contoCorrenteId: new FormControl('', { nonNullable: true }),
    condizionePagamentoId: new FormControl('', { nonNullable: true }),
    speseIncassoId: new FormControl('', { nonNullable: true }),
    bolloId: new FormControl('', { nonNullable: true }),
    esigibilitaIva: new FormControl<EsigibilitaIva>('IMMEDIATA', { nonNullable: true }),
    registroIvaId: new FormControl('', { nonNullable: true }),
    ritenutaPercentuale: new FormControl('', {
      nonNullable: true,
      validators: [validatoreNumero('decimale')],
    }),
    agenteId: new FormControl('', { nonNullable: true }),
    listino: new FormControl('', { nonNullable: true }),
    provvigionePredefinita: new FormControl('', {
      nonNullable: true,
      validators: [validatoreNumero('cascata')],
    }),
    tipoProvvigionePredefinita: new FormControl<TipoProvvigione | ''>('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
    sedeId: new FormControl('', { nonNullable: true }),
  })

  /** Condizione, conto, spese, bollo, registro e agente con le loro aggiunte in linea. */
  readonly opzioni = new OpzioniFatturazione(
    this.tabelle,
    this.servizio,
    {
      condizione: this.form.controls.condizionePagamentoId,
      conto: this.form.controls.contoCorrenteId,
      spese: this.form.controls.speseIncassoId,
      bollo: this.form.controls.bolloId,
      registro: this.form.controls.registroIvaId,
      agente: this.form.controls.agenteId,
    },
    messaggio => this.toast.warn(messaggio, 'Registro IVA'),
    messaggio => this.errore.set(messaggio)
  )

  constructor() {
    this.form.controls.codiceDestinatario.valueChanges.subscribe(() => this.aggiornaCampiSdi())
    this.form.controls.provvigionePredefinita.valueChanges.subscribe(() => {
      this.erroreProvvigione.set(null)
      this.aggiornaTipoProvvigione(true)
    })
    this.form.controls.listino.valueChanges.subscribe(() => this.erroreListino.set(null))
    this.form.controls.tipoProvvigionePredefinita.valueChanges.subscribe(() =>
      this.erroreTipo.set(null)
    )
  }

  get identificativi(): string {
    const d = this.cliente?.ditta
    return d ? etichettaIdentificativiCompleta(d.partitaIva, d.codiceFiscale) : ''
  }

  get mostraNomeCognome(): boolean {
    return this.cliente ? !!this.letto()?.ditta.privato : this.privato
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  /** PEC solo con 0000000 o senza codice; riferimento amministrazione solo con un codice vero. */
  private aggiornaCampiSdi(): void {
    if (!this.puoScrivere()) return
    const codice = this.form.controls.codiceDestinatario.value.trim().toUpperCase()
    const nessuno = codice === '' || codice === CODICE_NESSUNO
    this.abilita(this.form.controls.pecFatturazione, nessuno)
    this.abilita(this.form.controls.riferimentoAmministrazione, codice !== '' && !nessuno)
  }

  /** Il tipo della provvigione ha senso solo con una provvigione (R26: senza, parte null). */
  private aggiornaTipoProvvigione(preimposta = false): void {
    if (!this.puoScrivere()) return
    const c = this.form.controls.tipoProvvigionePredefinita
    const conProvvigione = this.cascata(this.form.controls.provvigionePredefinita.value) !== null
    if (conProvvigione && c.disabled) {
      c.enable({ emitEvent: false })
      // Come il WinWaste ("S"): con una provvigione nuova il tipo parte da "sul prezzo scontato".
      if (preimposta && c.value === '') c.setValue('SCONTATO', { emitEvent: false })
    } else if (!conProvvigione && c.enabled) c.disable({ emitEvent: false })
  }

  /** Solo disabilita: il valore resta, così digitare il codice carattere per carattere non lo perde. */
  private abilita(c: FormControl<string>, abilitato: boolean): void {
    if (abilitato && c.disabled) c.enable({ emitEvent: false })
    else if (!abilitato && c.enabled) c.disable({ emitEvent: false })
  }

  /** Cosa inviare di PEC e riferimento: quello che il codice destinatario attuale ammette. */
  private recapitiSdi(v: {
    codiceDestinatario: string
    pecFatturazione: string
    riferimentoAmministrazione: string
  }): {
    pec: string | null
    riferimento: string | null
  } {
    const codice = v.codiceDestinatario.trim().toUpperCase()
    const nessuno = codice === '' || codice === CODICE_NESSUNO
    return {
      pec: nessuno ? vuoto(v.pecFatturazione) : null,
      riferimento: !nessuno ? vuoto(v.riferimentoAmministrazione) : null,
    }
  }

  private azzera(): void {
    this.lettura?.unsubscribe()
    this.lettureSedi?.unsubscribe()
    this.opzioni.azzera()
    this.form.enable({ emitEvent: false })
    this.form.reset({ esigibilitaIva: 'IMMEDIATA' })
    this.ditta?.azzera()
    this.errore.set(null)
    this.erroreNome.set(null)
    this.erroreListino.set(null)
    this.erroreProvvigione.set(null)
    this.erroreTipo.set(null)
    this.inCorso.set(false)
    this.caricamento.set(false)
    this.sedi.set([])
    this.letto.set(null)
    this.privato = false
    this.sediAperte = false
    this.aggiornaCampiSdi()
    this.aggiornaTipoProvvigione()
    if (!this.puoScrivere()) this.form.disable({ emitEvent: false })
  }

  private inizializza(): void {
    this.azzera()
    this.opzioni.carica()
    const c = this.cliente
    this.versione = c?.versione ?? 0
    if (!c) return
    this.caricamento.set(true)
    this.lettura = this.servizio.clienti.get(c.id).subscribe({
      next: d => {
        this.letto.set(d)
        this.versione = d.versione
        this.form.enable({ emitEvent: false })
        this.form.reset({
          nome: d.nome ?? '',
          cognome: d.cognome ?? '',
          codice: d.codice ?? '',
          codiceDestinatario: d.codiceDestinatario ?? '',
          pecFatturazione: d.pecFatturazione ?? '',
          riferimentoAmministrazione: d.riferimentoAmministrazione ?? '',
          iban: d.iban ?? '',
          contoCorrenteId: d.contoCorrenteId ?? '',
          condizionePagamentoId: d.condizionePagamentoId ?? '',
          speseIncassoId: d.speseIncassoId ?? '',
          bolloId: d.bolloId ?? '',
          esigibilitaIva: d.esigibilitaIva,
          registroIvaId: d.registroIvaId ?? '',
          ritenutaPercentuale: formatNumero(d.ritenutaPercentuale),
          agenteId: d.agenteId ?? '',
          listino: d.listino == null ? '' : String(d.listino),
          provvigionePredefinita: formatCascata(d.provvigionePredefinita),
          tipoProvvigionePredefinita: d.tipoProvvigionePredefinita ?? '',
          note: d.note ?? '',
          sedeId: d.sedeFatturazione.id,
        })
        this.opzioni.impostaCorrenti(d)
        this.caricamento.set(false)
        this.aggiornaCampiSdi()
        this.aggiornaTipoProvvigione()
        if (!this.puoScrivere()) this.form.disable({ emitEvent: false })
        this.caricaSedi()
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile caricare il cliente.'))
      },
    })
  }

  /** Le sedi attive della ditta, per cambiare la sede di fatturazione. */
  caricaSedi(): void {
    const c = this.cliente
    if (!c) return
    this.lettureSedi?.unsubscribe()
    const attuale = this.letto()?.sedeFatturazione
    this.lettureSedi = this.registry.getDitta(c.ditta.id).subscribe({
      next: d => this.sedi.set(d.sedi.filter(s => s.attiva || s.id === attuale?.id)),
      // Senza l'elenco resta la sede attuale: non si blocca la modifica degli altri campi.
      error: () => this.sedi.set(attuale ? [attuale] : []),
    })
  }

  // ─── Salvataggio ─────────────────────────────────────────────────────────

  /** In modifica serve il record letto (altrimenti il form vuoto cancellerebbe i dati). */
  puoSalvare(): boolean {
    if (this.inCorso() || this.caricamento() || !this.puoScrivere()) return false
    // Ritenuta o provvigione col punto o con testo errato: il form non si salva.
    if (this.erroreRitenuta() || messaggioNumero(this.form.controls.provvigionePredefinita))
      return false
    return !this.cliente || this.letto() !== null
  }

  /**
   * Esc nel sub-dialog (o nel dialog delle sedi) chiude anche questo (PrimeNG chiude ogni
   * dialog aperto): si ignora, o si perde il form compilato.
   */
  alCambioVisibilita(visibile: boolean): void {
    if (!visibile && (this.sediAperte || this.opzioni.inLinea.bloccaChiusuraEsterna(visibile)))
      return
    if (!visibile) this.chiudi()
  }

  salva(): void {
    if (!this.puoSalvare()) return
    if (this.cliente) this.salvaModifica(this.cliente)
    else this.salvaNuovo()
  }

  /** Come `normalizzaCascata` del backend ("10 + 5,5" -> "10+5.5"); il punto nel form è già un errore. */
  private cascata(v: string): string | null {
    return leggiCascata(v).valore
  }

  private ritenuta(v: string): string | null {
    return leggiNumero(v).valore
  }

  /** Errore di numero della ritenuta (punto o testo), o null. */
  erroreRitenuta(): string | null {
    return messaggioNumero(this.form.controls.ritenutaPercentuale)
  }

  /** Errore del backend sulla provvigione, altrimenti quello del numero scritto. */
  messaggioProvvigione(): string | null {
    return this.erroreProvvigione() ?? messaggioNumero(this.form.controls.provvigionePredefinita)
  }

  /** Listino scelto: intero 1-6, null se "Nessuno". */
  private listinoScelto(v: string): number | null {
    return v === '' ? null : Number(v)
  }

  /** Provvigione e tipo insieme: senza provvigione anche il tipo è null (R26). */
  private provvigioneScelta(v: {
    provvigionePredefinita: string
    tipoProvvigionePredefinita: TipoProvvigione | ''
  }): { provvigione: string | null; tipo: TipoProvvigione | null } {
    const provvigione = this.cascata(v.provvigionePredefinita)
    return {
      provvigione,
      tipo:
        provvigione === null || v.tipoProvvigionePredefinita === ''
          ? null
          : v.tipoProvvigionePredefinita,
    }
  }

  /**
   * Gli errori 400 che parlano di listino o provvigione vanno sotto il loro campo, gli altri in
   * fondo al form.
   */
  private mostraErrore(err: unknown, ripiego: string): void {
    const m = (err as { error?: { message?: string | string[] } } | null)?.error?.message
    const messaggi = (Array.isArray(m) ? m : typeof m === 'string' ? [m] : []).filter(
      x => typeof x === 'string' && x.trim()
    )
    const listino: string[] = []
    const provvigione: string[] = []
    const tipo: string[] = []
    const altri: string[] = []
    for (const x of messaggi) {
      if (/listino/i.test(x)) listino.push(x)
      else if (/su cosa|tipo/i.test(x)) tipo.push(x)
      else if (/provvigione/i.test(x)) provvigione.push(x)
      else altri.push(x)
    }
    this.erroreListino.set(listino.join(' ') || null)
    this.erroreProvvigione.set(provvigione.join(' ') || null)
    this.erroreTipo.set(tipo.join(' ') || null)
    this.errore.set(messaggi.length === 0 ? ripiego : altri.length > 0 ? altri.join(' ') : null)
  }

  private salvaNuovo(): void {
    const raccolti = this.ditta?.raccogli()
    this.erroreNome.set(null)
    const v = this.form.getRawValue()
    if (this.privato && (!v.nome.trim() || !v.cognome.trim()))
      this.erroreNome.set(MESSAGGIO_PRIVATO)
    if (!raccolti || this.erroreNome()) return

    const dati: NuovoCliente = { ...raccolti.dati, esigibilitaIva: v.esigibilitaIva }
    if (raccolti.sedeId) dati.sedeId = raccolti.sedeId
    const sdi = this.recapitiSdi(v)
    const prov = this.provvigioneScelta(v)
    const facoltativi: Record<string, string | number | null> = {
      listino: this.listinoScelto(v.listino),
      provvigionePredefinita: prov.provvigione,
      tipoProvvigionePredefinita: prov.tipo,
      codice: vuoto(v.codice),
      codiceDestinatario: vuoto(v.codiceDestinatario)?.toUpperCase() ?? null,
      pecFatturazione: sdi.pec,
      riferimentoAmministrazione: sdi.riferimento,
      iban: vuoto(v.iban),
      contoCorrenteId: vuotoId(v.contoCorrenteId),
      condizionePagamentoId: vuotoId(v.condizionePagamentoId),
      speseIncassoId: vuotoId(v.speseIncassoId),
      bolloId: vuotoId(v.bolloId),
      registroIvaId: vuotoId(v.registroIvaId),
      agenteId: vuotoId(v.agenteId),
      ritenutaPercentuale: this.ritenuta(v.ritenutaPercentuale),
      note: vuoto(v.note),
      ...(this.privato ? { nome: vuoto(v.nome), cognome: vuoto(v.cognome) } : {}),
    }
    for (const [k, valore] of Object.entries(facoltativi)) {
      if (valore !== null) (dati as unknown as Record<string, unknown>)[k] = valore
    }

    this.inCorso.set(true)
    this.errore.set(null)
    this.erroreListino.set(null)
    this.erroreProvvigione.set(null)
    this.erroreTipo.set(null)
    this.servizio.clienti.crea(dati).subscribe({
      next: esito => {
        this.inCorso.set(false)
        for (const avviso of esito.avvisi ?? []) this.toast.warn(avviso, 'Attenzione')
        this.salvato.emit(esito.cliente)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.mostraErrore(err, 'Impossibile salvare il cliente.')
      },
    })
  }

  /** Solo i campi cambiati rispetto al record letto, più la versione. */
  private differenze(base: Cliente): ModificaCliente {
    const v = this.form.getRawValue()
    const sdi = this.recapitiSdi(v)
    const dati: ModificaCliente = { versione: this.versione }
    const testo: Array<[keyof DatiFiscaliCliente, string | null, string | null]> = [
      ['codice', vuoto(v.codice), base.codice],
      [
        'codiceDestinatario',
        vuoto(v.codiceDestinatario)?.toUpperCase() ?? null,
        base.codiceDestinatario,
      ],
      ['pecFatturazione', sdi.pec, base.pecFatturazione],
      ['riferimentoAmministrazione', sdi.riferimento, base.riferimentoAmministrazione],
      ['note', vuoto(v.note), base.note],
      ['contoCorrenteId', vuotoId(v.contoCorrenteId), base.contoCorrenteId],
      ['condizionePagamentoId', vuotoId(v.condizionePagamentoId), base.condizionePagamentoId],
      ['speseIncassoId', vuotoId(v.speseIncassoId), base.speseIncassoId],
      ['bolloId', vuotoId(v.bolloId), base.bolloId],
      ['registroIvaId', vuotoId(v.registroIvaId), base.registroIvaId],
      ['agenteId', vuotoId(v.agenteId), base.agenteId],
    ]
    if (base.ditta.privato) {
      testo.push(['nome', vuoto(v.nome), base.nome], ['cognome', vuoto(v.cognome), base.cognome])
    }
    // Ritenuta: confronto numerico ("10" e "10.00" sono lo stesso valore).
    const ritenuta = this.ritenuta(v.ritenutaPercentuale)
    const ritenutaBase = base.ritenutaPercentuale ?? null
    if (
      ritenuta !== ritenutaBase &&
      (ritenuta === null || ritenutaBase === null || Number(ritenuta) !== Number(ritenutaBase))
    )
      dati.ritenutaPercentuale = ritenuta
    for (const [campo, nuovo, vecchio] of testo) {
      if (nuovo !== vecchio) (dati as Record<string, unknown>)[campo] = nuovo
    }
    // L'IBAN si confronta senza spazi: "IT60 X…" e "IT60X…" sono lo stesso valore.
    const iban = vuoto(v.iban)
    if (senzaSpazi(iban) !== senzaSpazi(base.iban)) dati.iban = iban
    const listino = this.listinoScelto(v.listino)
    if (listino !== (base.listino ?? null)) dati.listino = listino
    // R26: provvigione e tipo si azzerano insieme, o il CHECK del database dà 500.
    const prov = this.provvigioneScelta(v)
    const provBase = base.provvigionePredefinita ?? null
    const tipoBase = base.tipoProvvigionePredefinita ?? null
    if (prov.provvigione !== provBase) dati.provvigionePredefinita = prov.provvigione
    if (prov.tipo !== tipoBase) dati.tipoProvvigionePredefinita = prov.tipo
    if (prov.provvigione === null && provBase !== null) dati.tipoProvvigionePredefinita = null
    if (v.esigibilitaIva !== base.esigibilitaIva) dati.esigibilitaIva = v.esigibilitaIva
    if (v.sedeId && v.sedeId !== base.sedeFatturazione.id) dati.sedeId = v.sedeId
    return dati
  }

  private salvaModifica(c: Cliente): void {
    const base = this.letto() ?? c
    const dati = this.differenze(base)
    if (Object.keys(dati).length === 1) {
      this.toast.info('Nessuna modifica da salvare.', 'Cliente')
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.erroreListino.set(null)
    this.erroreProvvigione.set(null)
    this.erroreTipo.set(null)
    this.servizio.clienti.modifica(c.id, dati).subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        const messaggio = messaggioErrore(err, 'Impossibile salvare il cliente.')
        const codice = String((err as { error?: { error?: unknown } })?.error?.error ?? '')
        if (
          (err as { status?: number })?.status === 409 &&
          codice.endsWith('MODIFICATO_NEL_FRATTEMPO')
        ) {
          // Il record è cambiato: avviso, e il genitore lo rilegge.
          this.toast.error(messaggio, 'Cliente')
          this.salvato.emit(base)
          this.chiudi()
          return
        }
        this.mostraErrore(err, 'Impossibile salvare il cliente.')
      },
    })
  }

  chiudi(): void {
    this.azzera()
    this.visibleChange.emit(false)
  }
}
