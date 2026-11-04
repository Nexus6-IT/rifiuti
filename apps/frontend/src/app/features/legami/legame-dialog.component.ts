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
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { TagModule } from 'primeng/tag'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'
import { formatCascata, leggiCascata } from '../../shared/utils/numero-modificabile'
import { leggiErroriAzione } from '../listino/errori-azione'
import { LegamiService } from './legami.service'
import {
  LegameVista,
  ModificaRigaLegame,
  ModificheLegame,
  MotivoLegame,
  RigaLegame,
  StatoLegame,
} from './legami.model'
import { etichettaAvviso, etichettaMotivo, etichettaStato, severitaTag } from './vocabolario-legami'

/** Stati in cui il legame si può ancora cambiare (come il backend: gli altri sono sola lettura). */
export const STATI_MODIFICABILI: readonly StatoLegame[] = ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO']

/** Cifre decimali massime accettate dal backend. */
const DECIMALI_QUANTITA = 3
const DECIMALI_PREZZO = 6

/** Numero → stringa col punto, senza esponente e senza zeri finali inutili (`12.5`, non `12.500000`). */
export function numeroPerBackend(n: number, decimali: number): string {
  const t = n.toFixed(decimali)
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t
}

const comeNumero = (v: string | null): number | null => {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Stato di modifica di una riga: i campi numerici sono `number` perché li guida `appNumeroIt`. */
export interface RigaForm {
  riga: RigaLegame
  quantita: number | null
  prezzo: number | null
  /** Cascata scritta con la virgola (`10,5+5`). */
  sconto: string
}

/** Righe da inviare: solo quelle toccate (nella modifica di un legame esistente `righe` è un ritocco). */
export function righeModificate(forms: RigaForm[]): ModificaRigaLegame[] {
  const out: ModificaRigaLegame[] = []
  for (const f of forms) {
    const m: ModificaRigaLegame = { rigaAddebitoId: f.riga.rigaAddebitoId }
    let toccata = false
    const q0 = comeNumero(f.riga.quantita)
    if (f.quantita !== null && f.quantita !== q0) {
      m.quantita = numeroPerBackend(f.quantita, DECIMALI_QUANTITA)
      toccata = true
    }
    const p0 = comeNumero(f.riga.prezzo)
    if (!f.riga.prezzoSpeciale && f.prezzo !== null && f.prezzo !== p0) {
      m.prezzo = numeroPerBackend(f.prezzo, DECIMALI_PREZZO)
      toccata = true
    }
    const s = leggiCascata(f.sconto)
    if (s.errore === null && s.valore !== (f.riga.sconto ?? null)) {
      m.sconto = s.valore
      toccata = true
    }
    if (toccata) out.push(m)
  }
  return out
}

/**
 * Finestra di un legame esistente: cambia contratto ed elenco fra i candidati, ritocca quantità,
 * prezzo e sconto delle righe, poi «Salva» o «Conferma». I valori numerici seguono la regola unica
 * dei campi modificabili (`appNumeroIt`: virgola decimale, nessun separatore delle migliaia).
 * Solo OPERATOR/ADMIN modificano (`puoScrivere`) e solo negli stati modificabili.
 */
@Component({
  selector: 'app-legame-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    NumeroItalianoDirective,
  ],
  template: `
    <p-dialog
      [visible]="!!legame"
      [modal]="true"
      [draggable]="false"
      [closable]="true"
      [style]="{ width: '56rem', maxWidth: '96vw' }"
      header="Legame del movimento"
      (visibleChange)="$event ? null : chiudi()"
      data-testid="legame-dialog"
    >
      <ng-container *ngIf="legame as l">
        <div class="legame-testa">
          <p-tag
            [value]="statoEtichetta(l.stato)"
            [severity]="statoSeverita(l.stato)"
            data-testid="legame-stato"
          />
          <span *ngIf="l.cliente as c" class="legame-cliente" data-testid="legame-cliente">
            {{ c.etichetta }}
            <small *ngIf="c.fonte === 'FIR'">(da FIR)</small>
          </span>
          <span *ngIf="!l.cliente && l.dettaglioCliente" data-testid="legame-cliente-mancante">
            Cliente: {{ l.dettaglioCliente }}
          </span>
        </div>

        <ul *ngIf="l.motivi.length" class="legame-elenco" data-testid="legame-motivi">
          <li *ngFor="let m of l.motivi">{{ motivo(m) }}</li>
        </ul>
        <ul *ngIf="l.avvisi.length" class="legame-elenco" data-testid="legame-avvisi">
          <li *ngFor="let a of l.avvisi">{{ avviso(a) }}</li>
        </ul>

        <p *ngIf="!modificabile()" class="nota-pagina" data-testid="legame-sola-lettura">
          {{
            puoScrivere
              ? 'Nello stato attuale il legame non si può modificare.'
              : 'Solo gli operatori possono modificare il legame.'
          }}
        </p>

        <div class="legame-scelte">
          <div class="legame-campo">
            <label for="legame-contratto">Contratto</label>
            <p-dropdown
              *ngIf="modificabile() && opzioniContratti().length > 1; else contrattoTesto"
              inputId="legame-contratto"
              [options]="opzioniContratti()"
              optionLabel="etichetta"
              optionValue="id"
              [(ngModel)]="contrattoId"
              (onChange)="alCambioScelta()"
              styleClass="w-full"
              data-testid="legame-contratto"
            />
            <ng-template #contrattoTesto>
              <span data-testid="legame-contratto-testo">{{ l.contratto?.etichetta ?? '-' }}</span>
            </ng-template>
          </div>
          <div class="legame-campo">
            <label for="legame-elenco">Elenco di addebiti</label>
            <p-dropdown
              *ngIf="modificabile() && opzioniElenchi().length > 1; else elencoTesto"
              inputId="legame-elenco"
              [options]="opzioniElenchi()"
              optionLabel="etichetta"
              optionValue="id"
              [(ngModel)]="elencoId"
              (onChange)="alCambioScelta()"
              styleClass="w-full"
              data-testid="legame-elenco"
            />
            <ng-template #elencoTesto>
              <span data-testid="legame-elenco-testo">{{ l.elenco?.etichetta ?? '-' }}</span>
            </ng-template>
          </div>
        </div>
        <p
          *ngIf="scelteCambiate() && haPrezzoManuale()"
          class="avviso-riquadro avviso-riquadro--warn"
          role="status"
          data-testid="legame-avviso-perdita"
        >
          Cambiando contratto o elenco i prezzi modificati a mano andranno persi.
        </p>

        <table class="legame-righe" *ngIf="forms.length" aria-label="Righe del legame">
          <thead>
            <tr>
              <th scope="col">Riga</th>
              <th scope="col" class="num-col">Quantità</th>
              <th scope="col" class="num-col">Prezzo</th>
              <th scope="col">Sconto</th>
              <th scope="col" class="num-col">Importo</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let f of forms; let i = index" [attr.data-testid]="'legame-riga-' + i">
              <td>
                {{ f.riga.descrizione || f.riga.tipo }}
                <p-tag
                  *ngIf="prezzoManuale(f)"
                  value="prezzo manuale"
                  severity="warning"
                  [attr.data-testid]="'legame-badge-manuale-' + i"
                />
                <small *ngIf="f.riga.prezzoSpeciale" class="cell-sub">prezzo speciale</small>
              </td>
              <td class="num-col">
                <p-inputNumber
                  *ngIf="modificabile(); else qtaTesto"
                  appNumeroIt
                  locale="it-IT"
                  mode="decimal"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  [min]="0.001"
                  [(ngModel)]="f.quantita"
                  [inputId]="'legame-qta-' + i"
                  [ariaLabel]="'Quantità riga ' + (i + 1)"
                  [attr.data-testid]="'legame-qta-' + i"
                />
                <ng-template #qtaTesto>{{ f.riga.quantita ?? '-' }}</ng-template>
                <small class="cell-sub">{{ f.riga.unitaMisura }}</small>
              </td>
              <td class="num-col">
                <p-inputNumber
                  *ngIf="modificabile() && !f.riga.prezzoSpeciale; else prezzoTesto"
                  appNumeroIt
                  locale="it-IT"
                  mode="decimal"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="6"
                  [min]="0"
                  [(ngModel)]="f.prezzo"
                  [inputId]="'legame-prezzo-' + i"
                  [ariaLabel]="'Prezzo riga ' + (i + 1)"
                  [attr.data-testid]="'legame-prezzo-' + i"
                />
                <ng-template #prezzoTesto>
                  <span [attr.data-testid]="'legame-prezzo-testo-' + i">{{
                    f.riga.prezzo ?? '-'
                  }}</span>
                </ng-template>
              </td>
              <td>
                <input
                  *ngIf="modificabile(); else scontoTesto"
                  pInputText
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  [(ngModel)]="f.sconto"
                  [attr.id]="'legame-sconto-' + i"
                  [attr.aria-label]="'Sconto riga ' + (i + 1)"
                  [attr.aria-invalid]="erroreSconto(f) ? true : null"
                  [attr.data-testid]="'legame-sconto-' + i"
                />
                <ng-template #scontoTesto>{{ f.sconto || '-' }}</ng-template>
                <small
                  *ngIf="erroreSconto(f) as e"
                  class="field-error"
                  role="alert"
                  [attr.data-testid]="'legame-sconto-errore-' + i"
                  >{{ e }}</small
                >
              </td>
              <td class="num-col">{{ f.riga.importo ?? '-' }}</td>
            </tr>
          </tbody>
        </table>

        <p
          *ngIf="errori().length"
          class="avviso-riquadro avviso-riquadro--err"
          role="alert"
          data-testid="legame-errore"
        >
          <span *ngFor="let e of errori()">{{ e }} </span>
          <p-button
            *ngIf="serveRicarica()"
            label="Ricarica"
            icon="pi pi-refresh"
            [text]="true"
            size="small"
            (onClick)="ricarica()"
            data-testid="legame-ricarica"
          />
        </p>
      </ng-container>

      <ng-template pTemplate="footer">
        <p-button
          label="Chiudi"
          [outlined]="true"
          (onClick)="chiudi()"
          data-testid="legame-chiudi"
        />
        <p-button
          *ngIf="modificabile()"
          label="Salva"
          icon="pi pi-save"
          [outlined]="true"
          [disabled]="inCorso() || !valido()"
          (onClick)="salva()"
          data-testid="legame-salva"
        />
        <p-button
          *ngIf="modificabile()"
          label="Conferma"
          icon="pi pi-check"
          [disabled]="inCorso() || !valido()"
          [loading]="inCorso()"
          (onClick)="conferma()"
          data-testid="legame-conferma"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .legame-testa {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        align-items: center;
        margin-bottom: var(--spacing-md);
      }
      .legame-elenco {
        margin: 0 0 var(--spacing-md);
        padding-left: var(--spacing-lg);
      }
      .legame-scelte {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
      .legame-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .legame-righe {
        width: 100%;
        border-collapse: collapse;
      }
      .legame-righe th,
      .legame-righe td {
        padding: var(--spacing-xs) var(--spacing-sm);
        text-align: left;
        vertical-align: top;
        border-bottom: 1px solid var(--surface-border);
      }
      .legame-righe .num-col {
        text-align: right;
      }
    `,
  ],
})
export class LegameDialogComponent implements OnChanges {
  private readonly servizio = inject(LegamiService)

  /** Il legame da mostrare; `null` = finestra chiusa. */
  @Input() legame: LegameVista | null = null
  @Input() puoScrivere = false
  /** Dopo un salvataggio o una conferma riusciti: il legame aggiornato. */
  @Output() aggiornato = new EventEmitter<{ legame: LegameVista; confermato: boolean }>()
  @Output() chiuso = new EventEmitter<void>()

  forms: RigaForm[] = []
  contrattoId: string | null = null
  elencoId: string | null = null
  readonly errori = signal<string[]>([])
  readonly serveRicarica = signal(false)
  readonly inCorso = signal(false)

  readonly statoEtichetta = etichettaStato
  readonly statoSeverita = severitaTag
  readonly motivo = etichettaMotivo
  readonly avviso = etichettaAvviso

  ngOnChanges(c: SimpleChanges): void {
    if (c['legame']) this.carica(this.legame)
  }

  private carica(l: LegameVista | null): void {
    this.errori.set([])
    this.serveRicarica.set(false)
    this.contrattoId = l?.contratto?.id ?? null
    this.elencoId = l?.elenco?.id ?? null
    this.forms = (l?.righe ?? []).map(riga => ({
      riga,
      quantita: comeNumero(riga.quantita),
      prezzo: comeNumero(riga.prezzo),
      sconto: formatCascata(riga.sconto),
    }))
  }

  modificabile(): boolean {
    return this.puoScrivere && !!this.legame && STATI_MODIFICABILI.includes(this.legame.stato)
  }

  opzioniContratti() {
    return this.legame?.candidati?.contratti ?? []
  }

  opzioniElenchi() {
    return this.legame?.candidati?.elenchi ?? []
  }

  scelteCambiate(): boolean {
    return (
      this.contrattoId !== (this.legame?.contratto?.id ?? null) ||
      this.elencoId !== (this.legame?.elenco?.id ?? null)
    )
  }

  haPrezzoManuale(): boolean {
    return this.forms.some(f => this.prezzoManuale(f))
  }

  /** Vero se la riga era già a prezzo manuale o se ne è stato cambiato il prezzo qui. */
  prezzoManuale(f: RigaForm): boolean {
    return (
      f.riga.prezzoManuale ||
      (!f.riga.prezzoSpeciale && f.prezzo !== null && f.prezzo !== comeNumero(f.riga.prezzo))
    )
  }

  erroreSconto(f: RigaForm): string | null {
    return leggiCascata(f.sconto).errore
  }

  /** Una quantità svuotata (con un valore di partenza) o uno sconto illeggibile bloccano i pulsanti. */
  valido(): boolean {
    return this.forms.every(
      f =>
        this.erroreSconto(f) === null &&
        !(f.quantita === null && comeNumero(f.riga.quantita) !== null)
    )
  }

  alCambioScelta(): void {
    this.errori.set([])
  }

  /** Solo i campi davvero cambiati: un legame senza ritocchi si conferma senza `modifiche`. */
  modifiche(): ModificheLegame | undefined {
    const l = this.legame
    if (!l) return undefined
    const m: ModificheLegame = {}
    if (this.contrattoId && this.contrattoId !== (l.contratto?.id ?? null)) {
      m.contrattoId = this.contrattoId
    }
    if (this.elencoId && this.elencoId !== (l.elenco?.id ?? null)) m.elencoId = this.elencoId
    const righe = righeModificate(this.forms)
    if (righe.length) m.righe = righe
    return Object.keys(m).length ? m : undefined
  }

  salva(): void {
    const l = this.legame
    if (!l) return
    this.esegui(
      this.servizio.modifica(l.id, { versione: l.versione, ...(this.modifiche() ?? {}) }),
      false
    )
  }

  conferma(): void {
    const l = this.legame
    if (!l) return
    const modifiche = this.modifiche()
    this.esegui(
      this.servizio.conferma(l.id, { versione: l.versione, ...(modifiche ? { modifiche } : {}) }),
      true
    )
  }

  ricarica(): void {
    const l = this.legame
    if (!l) return
    this.servizio.dettaglio(l.id).subscribe({
      next: nuovo => this.carica(nuovo),
      error: err => this.mostraErrore(err),
    })
  }

  chiudi(): void {
    this.chiuso.emit()
  }

  private esegui(chiamata: ReturnType<LegamiService['modifica']>, confermato: boolean): void {
    this.inCorso.set(true)
    this.errori.set([])
    chiamata.subscribe({
      next: legame => {
        this.inCorso.set(false)
        this.aggiornato.emit({ legame, confermato })
      },
      error: err => {
        this.inCorso.set(false)
        this.mostraErrore(err)
      },
    })
  }

  private mostraErrore(err: unknown): void {
    const e = leggiErroriAzione(err, 'Operazione non riuscita. Riprova.')
    const dettagli = (
      err as { error?: { details?: { motivi?: unknown; dettaglioCliente?: unknown } } } | null
    )?.error?.details
    if (e.codice === 'LEGAME_INCOMPLETO' && dettagli && Array.isArray(dettagli.motivi)) {
      const testi = (dettagli.motivi as MotivoLegame[]).map(etichettaMotivo)
      if (typeof dettagli.dettaglioCliente === 'string') testi.push(dettagli.dettaglioCliente)
      this.errori.set(['Il legame è incompleto:', ...testi.map(t => `${t}.`)])
    } else {
      this.errori.set(e.messaggi)
    }
    this.serveRicarica.set(e.rilettura || e.codice === 'VERSIONE_SUPERATA')
  }
}
