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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { SedeDitta } from '../../shared/models/registry.model'
import { etichettaIdentificativiCompleta } from '../registry/identificativo-fiscale'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import { RegistryService } from '../registry/registry.service'
import { SediDittaDialogComponent } from '../registry/sedi-ditta-dialog.component'
import { Agente, ModificaAgente, NuovoAgente } from './clienti.model'
import { ClientiService } from './clienti.service'
import { DittaRuoloFormComponent } from './ditta-ruolo-form.component'
import { messaggioErrore } from './tabelle/tabella-comune'

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
    DittaRuoloFormComponent,
    SediDittaDialogComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="agente ? 'Modifica agente' : 'Nuovo agente'"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <app-ditta-ruolo-form *ngIf="!agente" pfx="agente-dlg" tipo="agente" />

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
          [disabled]="!puoSalvare()"
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
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  readonly sedi = signal<SedeDitta[]>([])
  readonly puoScrivere = () => puoGestireAnagrafiche(this.auth.currentUser()?.role)

  @ViewChild(DittaRuoloFormComponent) private ditta?: DittaRuoloFormComponent
  sediAperte = false
  /** Versione del record caricato (in modifica). */
  private versione = 0
  private originale: Agente | null = null
  private lettura?: Subscription
  private lettureSedi?: Subscription

  readonly form = new FormGroup({
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
    this.ditta?.azzera()
    this.errore.set(null)
    this.inCorso.set(false)
    this.caricamento.set(false)
    this.sedi.set([])
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

  /** In modifica serve il record letto (altrimenti il form vuoto cancellerebbe codice e note). */
  puoSalvare(): boolean {
    if (this.inCorso() || this.caricamento() || !this.puoScrivere()) return false
    return !this.agente || this.originale !== null
  }

  /** Esc nel dialog delle sedi chiude anche questo (PrimeNG): si ignora, o si perdono le modifiche. */
  alCambioVisibilita(visibile: boolean): void {
    if (!visibile && this.sediAperte) return
    if (!visibile) this.chiudi()
  }

  salva(): void {
    if (!this.puoSalvare()) return
    if (this.agente) this.salvaModifica(this.agente)
    else this.salvaNuovo()
  }

  private salvaNuovo(): void {
    const raccolti = this.ditta?.raccogli()
    if (!raccolti) return
    const v = this.form.getRawValue()
    const dati: NuovoAgente = { ...raccolti.dati }
    if (raccolti.sedeId) dati.sedeId = raccolti.sedeId
    const facoltativi = { codice: vuoto(v.codice), note: vuoto(v.note) }
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
