import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, signal } from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import { DittaIdentificativiComponent } from '../registry/ditta-identificativi.component'
import {
  ErroriIdentificativi,
  identificativiPerSalvataggio,
} from '../registry/identificativo-fiscale'
import { DatiDittaRuolo } from './clienti.model'

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

/** Dati della ditta pronti per il corpo di `POST /agenti` o `POST /clienti` (R37). */
export interface DatiDittaRaccolti {
  dati: DatiDittaRuolo
  /** Sede scelta fra quelle della ditta già censita; assente = sede nuova. */
  sedeId?: string
}

/**
 * Blocco "ditta" della creazione di un ruolo (agente, cliente): ragione sociale, identificativi
 * con ricerca della ditta già presente, indirizzo della sede e recapiti. Condiviso dai dialog di
 * agente e cliente. Il genitore chiama `raccogli()` al salvataggio (null = errori mostrati) e
 * `azzera()` alla chiusura. `privatoChange` dice se la ditta è un privato (solo codice fiscale).
 */
@Component({
  selector: 'app-ditta-ruolo-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextModule, DittaIdentificativiComponent],
  template: `
    <div [formGroup]="form" class="drf">
      <label [for]="pfx + '-ragione'">Ragione sociale</label>
      <input
        pInputText
        [id]="pfx + '-ragione'"
        formControlName="ragioneSociale"
        maxlength="200"
        [attr.aria-invalid]="errori().ragioneSociale ? true : null"
        [attr.data-testid]="pfx + '-ragione'"
      />
      <small *ngIf="dittaTrovata" class="field-hint"
        >Ragione sociale della ditta già registrata: non si modifica da qui.</small
      >
      <small *ngIf="errori().ragioneSociale as e" role="alert" class="field-error">{{ e }}</small>

      <app-ditta-identificativi
        [pfx]="pfx"
        [testidPrefix]="pfx"
        [tipo]="tipo"
        modalita="create"
        [partitaIVA]="partitaIVA"
        (partitaIVAChange)="alCambioIdentificativo('piva', $event)"
        [codiceFiscale]="codiceFiscale"
        (codiceFiscaleChange)="alCambioIdentificativo('cf', $event)"
        [errori]="erroriId"
        (dittaTrovata)="onDittaTrovata($event)"
        (sedeScelta)="onSedeScelta($event)"
      />

      <div class="dlg-riga">
        <div class="dlg-campo dlg-campo--grande">
          <label [for]="pfx + '-via'">Via</label>
          <input
            pInputText
            [id]="pfx + '-via'"
            formControlName="via"
            [attr.data-testid]="pfx + '-via'"
          />
          <small *ngIf="errori().via as e" role="alert" class="field-error">{{ e }}</small>
        </div>
        <div class="dlg-campo">
          <label [for]="pfx + '-civico'">Civico</label>
          <input
            pInputText
            [id]="pfx + '-civico'"
            formControlName="civico"
            [attr.data-testid]="pfx + '-civico'"
          />
          <small *ngIf="errori().civico as e" role="alert" class="field-error">{{ e }}</small>
        </div>
      </div>
      <div class="dlg-riga">
        <div class="dlg-campo">
          <label [for]="pfx + '-cap'">CAP</label>
          <input
            pInputText
            [id]="pfx + '-cap'"
            formControlName="cap"
            maxlength="5"
            [attr.data-testid]="pfx + '-cap'"
          />
          <small *ngIf="errori().cap as e" role="alert" class="field-error">{{ e }}</small>
        </div>
        <div class="dlg-campo dlg-campo--grande">
          <label [for]="pfx + '-comune'">Comune</label>
          <input
            pInputText
            [id]="pfx + '-comune'"
            formControlName="comune"
            [attr.data-testid]="pfx + '-comune'"
          />
          <small *ngIf="errori().comune as e" role="alert" class="field-error">{{ e }}</small>
        </div>
        <div class="dlg-campo">
          <label [for]="pfx + '-provincia'">Provincia</label>
          <input
            pInputText
            [id]="pfx + '-provincia'"
            formControlName="provincia"
            maxlength="2"
            [attr.data-testid]="pfx + '-provincia'"
          />
          <small *ngIf="errori().provincia as e" role="alert" class="field-error">{{ e }}</small>
        </div>
      </div>
      <label [for]="pfx + '-referente'">Referente (facoltativo)</label>
      <input
        pInputText
        [id]="pfx + '-referente'"
        formControlName="referente"
        [attr.data-testid]="pfx + '-referente'"
      />
      <label [for]="pfx + '-email'">Email (facoltativa)</label>
      <input
        pInputText
        [id]="pfx + '-email'"
        formControlName="email"
        [attr.data-testid]="pfx + '-email'"
      />
      <label [for]="pfx + '-telefono'">Telefono (facoltativo)</label>
      <input
        pInputText
        [id]="pfx + '-telefono'"
        formControlName="telefono"
        [attr.data-testid]="pfx + '-telefono'"
      />
      <label [for]="pfx + '-pec'">PEC (facoltativa)</label>
      <input
        pInputText
        [id]="pfx + '-pec'"
        formControlName="pec"
        [attr.data-testid]="pfx + '-pec'"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .drf {
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
export class DittaRuoloFormComponent {
  /** Prefisso degli id e dei data-testid dei campi. */
  @Input() pfx = 'ditta'
  @Input() tipo: 'agente' | 'cliente' = 'cliente'
  /** `true` quando la ditta è un privato: solo codice fiscale, o ditta trovata marcata privato. */
  @Output() privatoChange = new EventEmitter<boolean>()

  readonly errori = signal<Partial<Record<CampoObbligatorio, string>>>({})
  partitaIVA = ''
  codiceFiscale = ''
  erroriId: ErroriIdentificativi = {}
  dittaTrovata: Ditta | null = null
  sedeScelta: SedeDitta | null = null
  private ultimoPrivato = false

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
  })

  get privato(): boolean {
    if (this.dittaTrovata) return this.dittaTrovata.privato
    return !this.partitaIVA.trim() && !!this.codiceFiscale.trim()
  }

  private aggiornaPrivato(): void {
    const p = this.privato
    if (p === this.ultimoPrivato) return
    this.ultimoPrivato = p
    this.privatoChange.emit(p)
  }

  alCambioIdentificativo(quale: 'piva' | 'cf', valore: string): void {
    if (quale === 'piva') this.partitaIVA = valore
    else this.codiceFiscale = valore
    this.erroriId = {}
    this.aggiornaPrivato()
  }

  onDittaTrovata(ditta: Ditta | null): void {
    this.dittaTrovata = ditta
    if (ditta) {
      this.form.controls.ragioneSociale.setValue(ditta.ragioneSociale)
      this.form.controls.ragioneSociale.disable()
    } else {
      this.form.controls.ragioneSociale.enable()
    }
    this.aggiornaPrivato()
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

  /** Valida e compone i dati; null se qualcosa manca (gli errori restano sotto i campi). */
  raccogli(): DatiDittaRaccolti | null {
    const v = this.form.getRawValue()
    const id = identificativiPerSalvataggio(
      { partitaIVA: this.partitaIVA, codiceFiscale: this.codiceFiscale },
      this.tipo,
      null
    )
    this.erroriId = id.errori
    const errori: Partial<Record<CampoObbligatorio, string>> = {}
    for (const campo of Object.keys(OBBLIGATORI) as CampoObbligatorio[]) {
      if (!v[campo].trim()) errori[campo] = OBBLIGATORI[campo]
    }
    this.errori.set(errori)
    if (Object.keys(id.errori).length > 0 || Object.keys(errori).length > 0) return null

    const dati: DatiDittaRuolo = {
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
    const facoltativi = {
      referente: vuoto(v.referente),
      email: vuoto(v.email),
      telefono: vuoto(v.telefono),
      pec: vuoto(v.pec),
    }
    for (const [k, valore] of Object.entries(facoltativi)) {
      if (valore !== null) (dati as unknown as Record<string, unknown>)[k] = valore
    }
    return { dati, sedeId: this.sedeScelta?.id }
  }

  azzera(): void {
    this.form.reset()
    this.form.controls.ragioneSociale.enable()
    this.errori.set({})
    this.erroriId = {}
    this.partitaIVA = ''
    this.codiceFiscale = ''
    this.dittaTrovata = null
    this.sedeScelta = null
    this.aggiornaPrivato()
  }
}
