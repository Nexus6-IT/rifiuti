/**
 * Campi "Partita IVA" e "Codice fiscale" di un'anagrafica, con la ricerca della ditta gia'
 * presente (F2-10). Condiviso dal dialog di anagrafica e dai form delle tre liste.
 *
 * - In creazione, all'uscita da un campo con un identificativo valido chiama `cercaDitta` (una
 *   volta sola per valore): se la ditta esiste mostra un avviso `role="status"` e la scelta fra le
 *   sue sedi attive o "Nuova sede"; il genitore blocca la ragione sociale e precompila l'indirizzo.
 * - In modifica gli identificativi impostati non si cambiano, salvo la P.IVA "da verificare"
 *   (D2.8: campo modificabile con avviso); quelli mancanti si possono aggiungere.
 * - Mai un identificativo nei messaggi di errore.
 */
import { Component, EventEmitter, Input, Output, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { RegistryService } from './registry.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'
import {
  ErroriIdentificativi,
  TipoRuoloDitta,
  identificativoPerRicerca,
} from './identificativo-fiscale'
import type { ModalitaAnagrafica } from './anagrafica-form-dialog.component'

const ETICHETTA_RUOLO: Record<TipoRuoloDitta, string> = {
  produttore: 'produttore',
  trasportatore: 'trasportatore',
  destinatario: 'destinatario',
  cliente: 'cliente',
  agente: 'agente',
}

@Component({
  selector: 'app-ditta-identificativi',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule],
  template: `
    <div class="ident-row">
      <div class="ident-field">
        <label [for]="pfx + '-piva'">Partita IVA</label>
        <input
          pInputText
          [id]="pfx + '-piva'"
          name="partitaIVA"
          [ngModel]="partitaIVA"
          (ngModelChange)="onPivaChange($event)"
          (blur)="cercaSeServe()"
          placeholder="11 cifre"
          maxlength="14"
          inputmode="numeric"
          autocomplete="off"
          [disabled]="pivaBloccata"
          [attr.aria-invalid]="errori.partitaIva || errori.generale ? true : null"
          [attr.aria-describedby]="descrizionePiva"
          class="w-full"
          [class.input-error]="errori.partitaIva || errori.generale"
          [attr.data-testid]="tid + '-piva-input'"
        />
        <small *ngIf="pivaBloccata" [id]="pfx + '-piva-hint'" class="field-hint"
          >Non modificabile: è l'identità fiscale del soggetto.</small
        >
        <small
          *ngIf="modalita === 'edit' && partitaIvaDaVerificare"
          [id]="pfx + '-piva-warn'"
          class="field-warning"
          [attr.data-testid]="tid + '-piva-da-verificare'"
          >Da verificare: questa partita IVA non supera il controllo di validità. Se è errata puoi
          sostituirla con quella corretta.</small
        >
        <small
          *ngIf="errori.partitaIva"
          [id]="pfx + '-piva-err'"
          class="field-error"
          role="alert"
          >{{ errori.partitaIva }}</small
        >
      </div>

      <div class="ident-field">
        <label [for]="pfx + '-cf'">Codice fiscale</label>
        <input
          pInputText
          [id]="pfx + '-cf'"
          name="codiceFiscale"
          [ngModel]="codiceFiscale"
          (ngModelChange)="onCfChange($event)"
          (blur)="cercaSeServe()"
          placeholder="16 caratteri"
          maxlength="16"
          autocomplete="off"
          [disabled]="cfBloccato"
          [attr.aria-invalid]="errori.codiceFiscale ? true : null"
          [attr.aria-describedby]="descrizioneCf"
          class="w-full cf-input"
          [class.input-error]="errori.codiceFiscale"
          [attr.data-testid]="tid + '-cf-input'"
        />
        <small *ngIf="cfBloccato" [id]="pfx + '-cf-hint'" class="field-hint"
          >Non modificabile: è l'identità fiscale del soggetto.</small
        >
        <small
          *ngIf="errori.codiceFiscale"
          [id]="pfx + '-cf-err'"
          class="field-error"
          role="alert"
          >{{ errori.codiceFiscale }}</small
        >
      </div>
    </div>
    <small *ngIf="errori.generale" [id]="pfx + '-id-err'" class="field-error" role="alert">{{
      errori.generale
    }}</small>

    <!-- Ditta gia' presente (solo in creazione) -->
    <div
      *ngIf="ditta"
      class="ditta-presente"
      role="status"
      [attr.data-testid]="tid + '-ditta-presente'"
    >
      <p class="ditta-presente__titolo">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        Ditta già presente: <strong>{{ ditta.ragioneSociale }}</strong
        >. Verranno usati i suoi dati; scegli la sede.
      </p>
      <p *ngIf="ruoloGiaPresente" class="field-error">
        È già registrata come {{ etichettaRuolo }}: non puoi aggiungerla di nuovo.
      </p>
      <fieldset class="sede-scelta">
        <legend>Sede</legend>
        <label class="sede-opzione" *ngFor="let s of sediAttive">
          <input
            type="radio"
            [name]="pfx + '-sede'"
            [checked]="sedeSelezionataId === s.id"
            (change)="scegliSede(s)"
            [attr.data-testid]="tid + '-sede-' + s.id"
          />
          <span
            >{{ s.via }} {{ s.civico }}, {{ s.cap }} {{ s.citta }} ({{ s.provincia }})
            <em *ngIf="s.principale">— principale</em></span
          >
        </label>
        <label class="sede-opzione">
          <input
            type="radio"
            [name]="pfx + '-sede'"
            [checked]="sedeSelezionataId === null"
            (change)="scegliSede(null)"
            [attr.data-testid]="tid + '-sede-nuova'"
          />
          <span>Nuova sede</span>
        </label>
      </fieldset>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ident-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
        align-items: flex-start;
      }
      .ident-field {
        flex: 1 1 calc(50% - var(--spacing-base) / 2);
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .ident-field label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .cf-input {
        text-transform: uppercase;
      }
      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .field-warning {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        background: var(--stato-warn-bg);
        border: 1px solid var(--stato-warn-edge);
        border-radius: var(--radius-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
        line-height: 1.3;
      }
      .input-error,
      .input-error:enabled:focus {
        border-color: var(--color-danger) !important;
        box-shadow: 0 0 0 1px var(--color-danger) !important;
      }
      .ditta-presente {
        margin-top: var(--spacing-base);
        padding: var(--spacing-base);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md, 6px);
        background: var(--surface-ground, transparent);
      }
      .ditta-presente__titolo {
        margin: 0 0 var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--text-primary);
      }
      .sede-scelta {
        border: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .sede-scelta legend {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
        padding: 0 0 var(--spacing-xs);
      }
      .sede-opzione {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      @media (max-width: 480px) {
        .ident-field {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class DittaIdentificativiComponent {
  private readonly registry = inject(RegistryService)

  /** Prefisso degli id, per averne di unici quando il componente compare piu' volte. */
  @Input() pfx = 'ident'
  /** Prefisso dei `data-testid` (default: `pfx`); le liste mantengono quelli degli E2E. */
  @Input() testidPrefix = ''
  @Input() tipo: TipoRuoloDitta = 'produttore'
  @Input() modalita: ModalitaAnagrafica = 'create'
  @Input() partitaIVA: string | null | undefined = ''
  @Input() codiceFiscale: string | null | undefined = ''
  /** In modifica: gli identificativi gia' impostati sul ruolo. */
  @Input() partitaIvaOriginale: string | null = null
  @Input() codiceFiscaleOriginale: string | null = null
  @Input() partitaIvaDaVerificare = false
  @Input() errori: ErroriIdentificativi = {}

  @Output() partitaIVAChange = new EventEmitter<string>()
  @Output() codiceFiscaleChange = new EventEmitter<string>()
  /** La ditta trovata dalla ricerca (null se non c'e' o se l'identificativo e' cambiato). */
  @Output() dittaTrovata = new EventEmitter<Ditta | null>()
  /** La sede scelta fra quelle della ditta trovata (null = "Nuova sede"). */
  @Output() sedeScelta = new EventEmitter<SedeDitta | null>()

  ditta: Ditta | null = null
  sedeSelezionataId: string | null = null
  private ultimoValoreCercato: string | null = null

  get tid(): string {
    return this.testidPrefix || this.pfx
  }

  get pivaBloccata(): boolean {
    return this.modalita === 'edit' && !!this.partitaIvaOriginale && !this.partitaIvaDaVerificare
  }

  get cfBloccato(): boolean {
    return this.modalita === 'edit' && !!this.codiceFiscaleOriginale
  }

  get sediAttive(): SedeDitta[] {
    return (this.ditta?.sedi ?? []).filter(s => s.attiva)
  }

  get etichettaRuolo(): string {
    return ETICHETTA_RUOLO[this.tipo]
  }

  get ruoloGiaPresente(): boolean {
    const r = this.ditta?.ruoli
    if (!r) return false
    return !!(
      (this.tipo === 'produttore' && r.produttoreId) ||
      (this.tipo === 'trasportatore' && r.trasportatoreId) ||
      (this.tipo === 'destinatario' && r.destinatarioId) ||
      (this.tipo === 'cliente' && r.clienteId) ||
      (this.tipo === 'agente' && r.agenteId)
    )
  }

  private ids(...id: Array<string | false>): string | null {
    const v = id.filter((x): x is string => !!x)
    return v.length ? v.join(' ') : null
  }

  get descrizionePiva(): string | null {
    return this.ids(
      this.pivaBloccata && this.pfx + '-piva-hint',
      this.modalita === 'edit' && this.partitaIvaDaVerificare && this.pfx + '-piva-warn',
      !!this.errori.partitaIva && this.pfx + '-piva-err',
      !!this.errori.generale && this.pfx + '-id-err'
    )
  }

  get descrizioneCf(): string | null {
    return this.ids(
      this.cfBloccato && this.pfx + '-cf-hint',
      !!this.errori.codiceFiscale && this.pfx + '-cf-err',
      !!this.errori.generale && this.pfx + '-id-err'
    )
  }

  onPivaChange(valore: string): void {
    this.partitaIVA = valore
    this.partitaIVAChange.emit(valore)
    this.azzeraDittaSeCambiato()
  }

  onCfChange(valore: string): void {
    this.codiceFiscale = valore
    this.codiceFiscaleChange.emit(valore)
    this.azzeraDittaSeCambiato()
  }

  /** Se l'identificativo non e' piu' quello cercato, la ditta trovata non vale piu'. */
  private azzeraDittaSeCambiato(): void {
    if (!this.ditta) return
    if (
      identificativoPerRicerca(this.partitaIVA, this.codiceFiscale) !== this.ultimoValoreCercato
    ) {
      this.ditta = null
      this.sedeSelezionataId = null
      this.ultimoValoreCercato = null
      this.dittaTrovata.emit(null)
    }
  }

  /** All'uscita dal campo: cerca la ditta, una sola volta per valore (solo in creazione). */
  cercaSeServe(): void {
    if (this.modalita !== 'create') return
    const valore = identificativoPerRicerca(this.partitaIVA, this.codiceFiscale)
    if (!valore || valore === this.ultimoValoreCercato) return
    this.ultimoValoreCercato = valore
    this.registry.cercaDitta(valore).subscribe({
      next: r => {
        // risposta in ritardo per un valore ormai superato
        if (this.ultimoValoreCercato !== valore) return
        if (!r.ditta) {
          if (this.ditta) {
            this.ditta = null
            this.sedeSelezionataId = null
            this.dittaTrovata.emit(null)
          }
          return
        }
        this.ditta = r.ditta
        this.dittaTrovata.emit(r.ditta)
        const predefinita = this.sediAttive.find(s => s.principale) ?? this.sediAttive[0] ?? null
        this.scegliSede(predefinita)
      },
      // La validazione vera la fa il backend al salvataggio: qui un errore non blocca il form.
      error: () => {
        if (this.ultimoValoreCercato === valore) this.ultimoValoreCercato = null
      },
    })
  }

  scegliSede(sede: SedeDitta | null): void {
    this.sedeSelezionataId = sede?.id ?? null
    this.sedeScelta.emit(sede)
  }
}
