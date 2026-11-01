import { CommonModule } from '@angular/common'
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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import { DittaIdentificativiComponent } from '../registry/ditta-identificativi.component'
import {
  ErroriIdentificativi,
  etichettaIdentificativiCompleta,
  identificativiPerSalvataggio,
} from '../registry/identificativo-fiscale'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import { RegistryService } from '../registry/registry.service'
import { SediDittaDialogComponent } from '../registry/sedi-ditta-dialog.component'
import { Agente, ModificaAgente, NuovoAgente } from './clienti.model'
import { ClientiService } from './clienti.service'
import { messaggioErrore } from './tabelle/tabella-comune'

const OBBLIGATORI = {
  ragioneSociale: 'La ragione sociale è obbligatoria.',
  via: 'La via è obbligatoria.',
  civico: 'Il civico è obbligatorio.',
  cap: 'Il CAP è obbligatorio.',
  comune: 'Il comune è obbligatorio.',
  provincia: 'La provincia è obbligatoria.',
} as const
type CampoObbligatorio = keyof typeof OBBLIGATORI

const vuoto = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/**
 * Nuovo agente o modifica. Il ruolo vive su una ditta (D18): in creazione si cerca la ditta per
 * identificativo e, se esiste, ragione sociale bloccata e sede da scegliere; l'agente privato
 * (solo codice fiscale) non è ammesso. In modifica gli identificativi e la ragione sociale sono
 * della ditta e non si cambiano da qui: restano codice, note e sede.
 */
@Component({
  selector: 'app-agente-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    DittaIdentificativiComponent,
    SediDittaDialogComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="agente ? 'Modifica agente' : 'Nuovo agente'"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <ng-container *ngIf="!agente">
          <label for="agente-dlg-ragione">Ragione sociale</label>
          <input
            pInputText
            id="agente-dlg-ragione"
            formControlName="ragioneSociale"
            maxlength="200"
            [attr.aria-invalid]="errori().ragioneSociale ? true : null"
            data-testid="agente-dlg-ragione"
          />
          <small *ngIf="dittaTrovata" class="field-hint"
            >Ragione sociale della ditta già registrata: non si modifica da qui.</small
          >
          <small *ngIf="errori().ragioneSociale as e" role="alert" class="field-error">{{
            e
          }}</small>

          <app-ditta-identificativi
            pfx="agente-dlg"
            testidPrefix="agente-dlg"
            tipo="agente"
            modalita="create"
            [partitaIVA]="partitaIVA"
            (partitaIVAChange)="partitaIVA = $event; erroriId = {}"
            [codiceFiscale]="codiceFiscale"
            (codiceFiscaleChange)="codiceFiscale = $event; erroriId = {}"
            [errori]="erroriId"
            (dittaTrovata)="onDittaTrovata($event)"
            (sedeScelta)="onSedeScelta($event)"
          />

          <div class="dlg-riga">
            <div class="dlg-campo dlg-campo--grande">
              <label for="agente-dlg-via">Via</label>
              <input
                pInputText
                id="agente-dlg-via"
                formControlName="via"
                data-testid="agente-dlg-via"
              />
              <small *ngIf="errori().via as e" role="alert" class="field-error">{{ e }}</small>
            </div>
            <div class="dlg-campo">
              <label for="agente-dlg-civico">Civico</label>
              <input
                pInputText
                id="agente-dlg-civico"
                formControlName="civico"
                data-testid="agente-dlg-civico"
              />
              <small *ngIf="errori().civico as e" role="alert" class="field-error">{{ e }}</small>
            </div>
          </div>
          <div class="dlg-riga">
            <div class="dlg-campo">
              <label for="agente-dlg-cap">CAP</label>
              <input
                pInputText
                id="agente-dlg-cap"
                formControlName="cap"
                maxlength="5"
                data-testid="agente-dlg-cap"
              />
              <small *ngIf="errori().cap as e" role="alert" class="field-error">{{ e }}</small>
            </div>
            <div class="dlg-campo dlg-campo--grande">
              <label for="agente-dlg-comune">Comune</label>
              <input
                pInputText
                id="agente-dlg-comune"
                formControlName="comune"
                data-testid="agente-dlg-comune"
              />
              <small *ngIf="errori().comune as e" role="alert" class="field-error">{{ e }}</small>
            </div>
            <div class="dlg-campo">
              <label for="agente-dlg-provincia">Provincia</label>
              <input
                pInputText
                id="agente-dlg-provincia"
                formControlName="provincia"
                maxlength="2"
                data-testid="agente-dlg-provincia"
              />
              <small *ngIf="errori().provincia as e" role="alert" class="field-error">{{
                e
              }}</small>
            </div>
          </div>
          <label for="agente-dlg-referente">Referente (facoltativo)</label>
          <input
            pInputText
            id="agente-dlg-referente"
            formControlName="referente"
            data-testid="agente-dlg-referente"
          />
          <label for="agente-dlg-email">Email (facoltativa)</label>
          <input
            pInputText
            id="agente-dlg-email"
            formControlName="email"
            data-testid="agente-dlg-email"
          />
          <label for="agente-dlg-telefono">Telefono (facoltativo)</label>
          <input
            pInputText
            id="agente-dlg-telefono"
            formControlName="telefono"
            data-testid="agente-dlg-telefono"
          />
          <label for="agente-dlg-pec">PEC (facoltativa)</label>
          <input
            pInputText
            id="agente-dlg-pec"
            formControlName="pec"
            data-testid="agente-dlg-pec"
          />
        </ng-container>

        <ng-container *ngIf="agente">
          <p class="dlg-ditta" data-testid="agente-dlg-ditta">
            <strong>{{ agente.ditta.ragioneSociale }}</strong>
          </p>
          <p class="field-hint" data-testid="agente-dlg-identificativi">
            {{ identificativi }} — non modificabili: sono l'identità fiscale del soggetto.
          </p>
          <label for="agente-dlg-sede">Sede</label>
          <select
            id="agente-dlg-sede"
            formControlName="sedeId"
            class="p-inputtext"
            data-testid="agente-dlg-sede"
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
            data-testid="agente-dlg-sedi"
          />
        </ng-container>

        <label for="agente-dlg-codice">Codice (facoltativo)</label>
        <input
          pInputText
          id="agente-dlg-codice"
          formControlName="codice"
          maxlength="20"
          data-testid="agente-dlg-codice"
        />
        <label for="agente-dlg-note">Note</label>
        <input
          pInputText
          id="agente-dlg-note"
          formControlName="note"
          maxlength="500"
          data-testid="agente-dlg-note"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="agente-dlg-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="inCorso() || caricamento()"
          (onClick)="salva()"
          data-testid="agente-dlg-salva"
        />
      </ng-template>
    </p-dialog>
    <app-sedi-ditta-dialog
      *ngIf="agente"
      [(visible)]="sediAperte"
      [dittaId]="agente.ditta.id"
      [ragioneSociale]="agente.ditta.ragioneSociale"
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
      .dlg-campo--grande {
        flex: 2 1 0;
      }
    `,
  ],
})
export class AgenteDialogComponent implements OnChanges {
  private readonly servizio = inject(ClientiService)
  private readonly registry = inject(RegistryService)
  private readonly messaggi = inject(MessageService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() agente: Agente | null = null
  @Output() salvato = new EventEmitter<Agente>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly errore = signal<string | null>(null)
  readonly errori = signal<Partial<Record<CampoObbligatorio, string>>>({})
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  readonly sedi = signal<SedeDitta[]>([])
  readonly puoScrivere = () => puoGestireAnagrafiche(this.auth.currentUser()?.role)

  partitaIVA = ''
  codiceFiscale = ''
  erroriId: ErroriIdentificativi = {}
  dittaTrovata: Ditta | null = null
  sedeScelta: SedeDitta | null = null
  sediAperte = false
  /** Versione del record caricato (in modifica). */
  private versione = 0
  private originale: Agente | null = null
  private lettura?: Subscription
  private lettureSedi?: Subscription

  readonly form = new FormGroup({
    ragioneSociale: new FormControl('', { nonNullable: true }),
    via: new FormControl('', { nonNullable: true }),
    civico: new FormControl('', { nonNullable: true }),
    cap: new FormControl('', { nonNullable: true }),
    comune: new FormControl('', { nonNullable: true }),
    provincia: new FormControl('', { nonNullable: true }),
    referente: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    telefono: new FormControl('', { nonNullable: true }),
    pec: new FormControl('', { nonNullable: true }),
    codice: new FormControl('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
    sedeId: new FormControl('', { nonNullable: true }),
  })

  get identificativi(): string {
    const d = this.agente?.ditta
    return d ? etichettaIdentificativiCompleta(d.partitaIva, d.codiceFiscale) : ''
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private azzera(): void {
    this.lettura?.unsubscribe()
    this.lettureSedi?.unsubscribe()
    this.form.reset()
    this.form.controls.ragioneSociale.enable()
    this.errore.set(null)
    this.errori.set({})
    this.erroriId = {}
    this.inCorso.set(false)
    this.caricamento.set(false)
    this.sedi.set([])
    this.partitaIVA = ''
    this.codiceFiscale = ''
    this.dittaTrovata = null
    this.sedeScelta = null
    this.sediAperte = false
    this.originale = null
  }

  private inizializza(): void {
    this.azzera()
    const a = this.agente
    this.versione = a?.versione ?? 0
    if (!a) return
    this.caricamento.set(true)
    this.lettura = this.servizio.agenti.get(a.id).subscribe({
      next: d => {
        this.originale = d
        this.versione = d.versione
        this.form.reset({ codice: d.codice ?? '', note: d.note ?? '', sedeId: d.sede.id })
        this.caricamento.set(false)
        this.caricaSedi()
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrore(err, "Impossibile caricare l'agente."))
      },
    })
  }

  /** Le sedi attive della ditta, per cambiare la sede dell'agente. */
  caricaSedi(): void {
    const a = this.agente
    if (!a) return
    this.lettureSedi?.unsubscribe()
    this.lettureSedi = this.registry.getDitta(a.ditta.id).subscribe({
      next: d => this.sedi.set(d.sedi.filter(s => s.attiva || s.id === this.originale?.sede.id)),
      // Senza l'elenco resta la sede attuale: non si blocca la modifica di codice e note.
      error: () => this.sedi.set(this.originale ? [this.originale.sede] : []),
    })
  }

  onDittaTrovata(ditta: Ditta | null): void {
    this.dittaTrovata = ditta
    if (ditta) {
      this.form.controls.ragioneSociale.setValue(ditta.ragioneSociale)
      this.form.controls.ragioneSociale.disable()
    } else {
      this.form.controls.ragioneSociale.enable()
    }
  }

  /** Sede scelta fra quelle della ditta trovata: precompila l'indirizzo; "Nuova sede" lo svuota. */
  onSedeScelta(sede: SedeDitta | null): void {
    this.sedeScelta = sede
    this.form.patchValue({
      via: sede?.via ?? '',
      civico: sede?.civico ?? '',
      cap: sede?.cap ?? '',
      comune: sede?.citta ?? '',
      provincia: sede?.provincia ?? '',
      email: sede?.email ?? '',
      telefono: sede?.telefono ?? '',
      pec: sede?.pec ?? '',
      referente: sede?.referente ?? '',
    })
    this.errori.set({})
  }

  salva(): void {
    if (this.inCorso() || this.caricamento()) return
    if (this.agente) this.salvaModifica(this.agente)
    else this.salvaNuovo()
  }

  private salvaNuovo(): void {
    const v = this.form.getRawValue()
    const id = identificativiPerSalvataggio(
      { partitaIVA: this.partitaIVA, codiceFiscale: this.codiceFiscale },
      'agente',
      null
    )
    this.erroriId = id.errori
    const errori: Partial<Record<CampoObbligatorio, string>> = {}
    for (const campo of Object.keys(OBBLIGATORI) as CampoObbligatorio[]) {
      if (!v[campo].trim()) errori[campo] = OBBLIGATORI[campo]
    }
    this.errori.set(errori)
    if (Object.keys(id.errori).length > 0 || Object.keys(errori).length > 0) return

    const dati: NuovoAgente = {
      ragioneSociale: v.ragioneSociale.trim(),
      indirizzo: {
        via: v.via.trim(),
        civico: v.civico.trim(),
        cap: v.cap.trim(),
        comune: v.comune.trim(),
        provincia: v.provincia.trim(),
      },
    }
    if (id.partitaIVA) dati.partitaIva = id.partitaIVA
    if (id.codiceFiscale) dati.codiceFiscale = id.codiceFiscale
    if (this.sedeScelta) dati.sedeId = this.sedeScelta.id
    const facoltativi = {
      referente: vuoto(v.referente),
      email: vuoto(v.email),
      telefono: vuoto(v.telefono),
      pec: vuoto(v.pec),
      codice: vuoto(v.codice),
      note: vuoto(v.note),
    }
    for (const [k, valore] of Object.entries(facoltativi)) {
      if (valore !== null) (dati as unknown as Record<string, unknown>)[k] = valore
    }

    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.agenti.crea(dati).subscribe({
      next: esito => {
        this.inCorso.set(false)
        for (const avviso of esito.avvisi ?? []) {
          this.messaggi.add({ severity: 'warn', summary: 'Attenzione', detail: avviso })
        }
        this.salvato.emit(esito.agente)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, "Impossibile salvare l'agente."))
      },
    })
  }

  private salvaModifica(a: Agente): void {
    const base = this.originale ?? a
    const v = this.form.getRawValue()
    const dati: ModificaAgente = { versione: this.versione }
    const codice = vuoto(v.codice)
    if (codice !== base.codice) dati.codice = codice
    const note = vuoto(v.note)
    if (note !== base.note) dati.note = note
    if (v.sedeId && v.sedeId !== base.sede.id) dati.sedeId = v.sedeId

    if (Object.keys(dati).length === 1) {
      this.chiudi()
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.agenti.modifica(a.id, dati).subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, "Impossibile salvare l'agente."))
      },
    })
  }

  chiudi(): void {
    this.azzera()
    this.visibleChange.emit(false)
  }
}
