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
  VoceScelta,
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

/** Stessa regola del backend (`cascataValida`): al massimo tre termini, ciascuno fino a 99,99. */
export const MSG_CASCATA =
  'Le percentuali a cascata sono al massimo tre (es. 10+5), ciascuna fino a 99,99.'
const TERMINE_CASCATA = /^\d{1,2}(\.\d{1,2})?$/

/** Errore di uno sconto scritto a mano, o null. Nessun valore negativo, nessun punto decimale. */
export function erroreSconto(testo: string): string | null {
  const l = leggiCascata(testo)
  if (l.errore !== null) return l.errore
  if (l.valore === null) return null
  return l.valore.split('+').length <= 3 && l.valore.split('+').every(t => TERMINE_CASCATA.test(t))
    ? null
    : MSG_CASCATA
}

export function erroreQuantita(f: RigaForm): string | null {
  if (f.quantita === null) {
    return comeNumero(f.riga.quantita) !== null ? 'La quantità è obbligatoria.' : null
  }
  return f.quantita > 0 ? null : 'La quantità deve essere maggiore di zero.'
}

export function errorePrezzo(f: RigaForm): string | null {
  if (f.riga.prezzoSpeciale) return null
  if (f.prezzo === null) {
    return comeNumero(f.riga.prezzo) !== null ? 'Il prezzo è obbligatorio.' : null
  }
  return f.prezzo >= 0 ? null : 'Il prezzo non può essere negativo.'
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
    // Su una riga a prezzo speciale anche lo sconto è bloccato (400 PREZZO_SPECIALE_NON_MODIFICABILE).
    if (!f.riga.prezzoSpeciale) {
      const s = leggiCascata(f.sconto)
      if (s.errore === null && s.valore !== (f.riga.sconto ?? null)) {
        m.sconto = s.valore
        toccata = true
      }
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
      [visible]="!!corrente()"
      [modal]="true"
      [draggable]="false"
      [closable]="true"
      [style]="{ width: '56rem', maxWidth: '96vw' }"
      header="Legame del movimento"
      (visibleChange)="$event ? null : chiudi()"
      data-testid="legame-dialog"
    >
      <ng-container *ngIf="corrente() as l">
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
          <div class="legame-campo" *ngIf="modificabile()">
            <label for="legame-cliente-scelta">Cliente da fatturare</label>
            <p-dropdown
              inputId="legame-cliente-scelta"
              [options]="opzioniClienti()"
              optionLabel="label"
              optionValue="value"
              [ngModel]="clienteId"
              (ngModelChange)="clienteId = $event; alCambioCliente()"
              [filter]="true"
              placeholder="Scegli il cliente"
              styleClass="w-full"
              data-testid="legame-cliente-scelta"
            />
          </div>
          <div class="legame-campo">
            <label for="legame-contratto">Contratto</label>
            <p-dropdown
              *ngIf="modificabile() && opzioniContratti().length > 1; else contrattoTesto"
              inputId="legame-contratto"
              [options]="opzioniContratti()"
              optionLabel="etichetta"
              optionValue="id"
              [ngModel]="contrattoId"
              (ngModelChange)="contrattoId = $event; alCambioContratto()"
              [disabled]="clienteCambiato()"
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
              [ngModel]="elencoId"
              (ngModelChange)="elencoId = $event; alCambioScelta()"
              [disabled]="clienteCambiato() || contrattoCambiato()"
              styleClass="w-full"
              data-testid="legame-elenco"
            />
            <ng-template #elencoTesto>
              <span data-testid="legame-elenco-testo">{{ l.elenco?.etichetta ?? '-' }}</span>
            </ng-template>
          </div>
        </div>
        <p
          *ngIf="scelteCambiate()"
          class="avviso-riquadro avviso-riquadro--warn"
          role="status"
          data-testid="legame-avviso-rigenera"
        >
          Cambiando cliente, contratto o elenco le righe si rigenerano dal listino quando salvi
          {{ haPrezzoManuale() ? ': i prezzi modificati a mano andranno persi' : '' }}.
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
                  *ngIf="righeModificabili(); else qtaTesto"
                  appNumeroIt
                  locale="it-IT"
                  mode="decimal"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  [(ngModel)]="f.quantita"
                  [inputId]="'legame-qta-' + i"
                  [ariaLabel]="'Quantità riga ' + (i + 1)"
                  [attr.data-testid]="'legame-qta-' + i"
                />
                <ng-template #qtaTesto>{{ f.riga.quantita ?? '-' }}</ng-template>
                <small class="cell-sub">{{ f.riga.unitaMisura }}</small>
                <small
                  *ngIf="righeModificabili() && erroreQuantita(f) as e"
                  class="field-error"
                  role="alert"
                  [attr.data-testid]="'legame-qta-errore-' + i"
                  >{{ e }}</small
                >
              </td>
              <td class="num-col">
                <p-inputNumber
                  *ngIf="righeModificabili() && !f.riga.prezzoSpeciale; else prezzoTesto"
                  appNumeroIt
                  locale="it-IT"
                  mode="decimal"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="6"
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
                <small
                  *ngIf="righeModificabili() && errorePrezzo(f) as e"
                  class="field-error"
                  role="alert"
                  [attr.data-testid]="'legame-prezzo-errore-' + i"
                  >{{ e }}</small
                >
              </td>
              <td>
                <input
                  *ngIf="righeModificabili() && !f.riga.prezzoSpeciale; else scontoTesto"
                  pInputText
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  [(ngModel)]="f.sconto"
                  [attr.id]="'legame-sconto-' + i"
                  [attr.aria-label]="'Sconto riga ' + (i + 1)"
                  [attr.aria-invalid]="erroreSconto(f.sconto) ? true : null"
                  [attr.data-testid]="'legame-sconto-' + i"
                />
                <ng-template #scontoTesto>
                  <span [attr.data-testid]="'legame-sconto-testo-' + i">{{ f.sconto || '-' }}</span>
                </ng-template>
                <small
                  *ngIf="righeModificabili() && erroreSconto(f.sconto) as e"
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

        <section
          *ngIf="righeModificabili() && (righeDisponibili().length || aggiunte.length)"
          class="legame-aggiunte"
          aria-label="Righe da aggiungere"
          data-testid="legame-aggiunte"
        >
          <ul *ngIf="aggiunte.length" class="legame-elenco">
            <li *ngFor="let r of aggiunte" data-testid="legame-aggiunta">
              {{ r.etichetta }}
              <p-button
                label="Togli"
                [text]="true"
                size="small"
                (onClick)="togliRiga(r)"
                [attr.data-testid]="'legame-togli-' + r.id"
              />
            </li>
          </ul>
          <div *ngIf="righeDisponibili().length" class="legame-campo">
            <label for="legame-riga-scelta">Aggiungi una riga dell'elenco</label>
            <p-dropdown
              inputId="legame-riga-scelta"
              [options]="righeDisponibili()"
              optionLabel="etichetta"
              optionValue="id"
              [(ngModel)]="rigaDaAggiungere"
              placeholder="Scegli la riga"
              styleClass="w-full"
              data-testid="legame-riga-scelta"
            />
            <p-button
              label="Aggiungi riga"
              icon="pi pi-plus"
              [outlined]="true"
              [disabled]="!rigaDaAggiungere"
              (onClick)="aggiungiRiga()"
              data-testid="legame-riga-aggiungi"
            />
          </div>
        </section>

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
      .legame-aggiunte {
        margin-top: var(--spacing-md);
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

  /** Il legame da mostrare; `null` = finestra chiusa. Dopo «Ricarica» vale `corrente`. */
  @Input() legame: LegameVista | null = null
  @Input() puoScrivere = false
  /** Clienti scegliibili (l'elenco lo carica la pagina). */
  @Input() clienti: { label: string; value: string }[] = []
  /** Dopo un salvataggio o una conferma riusciti: il legame aggiornato. */
  @Output() aggiornato = new EventEmitter<{ legame: LegameVista; confermato: boolean }>()
  @Output() chiuso = new EventEmitter<void>()

  /** Il legame in uso: parte da `legame` e si sostituisce con «Ricarica» (versione compresa). */
  readonly corrente = signal<LegameVista | null>(null)
  forms: RigaForm[] = []
  clienteId: string | null = null
  contrattoId: string | null = null
  elencoId: string | null = null
  /** Righe dell'elenco aggiunte al legame (solo con le scelte invariate). */
  aggiunte: VoceScelta[] = []
  rigaDaAggiungere: string | null = null
  readonly errori = signal<string[]>([])
  readonly serveRicarica = signal(false)
  readonly inCorso = signal(false)

  readonly statoEtichetta = etichettaStato
  readonly statoSeverita = severitaTag
  readonly motivo = etichettaMotivo
  readonly avviso = etichettaAvviso
  readonly erroreSconto = erroreSconto
  readonly erroreQuantita = erroreQuantita
  readonly errorePrezzo = errorePrezzo

  ngOnChanges(c: SimpleChanges): void {
    if (c['legame']) {
      this.corrente.set(this.legame)
      this.carica(this.legame)
    }
  }

  private carica(l: LegameVista | null): void {
    this.errori.set([])
    this.serveRicarica.set(false)
    this.clienteId = l?.cliente?.id ?? null
    this.contrattoId = l?.contratto?.id ?? null
    this.elencoId = l?.elenco?.id ?? null
    this.aggiunte = []
    this.rigaDaAggiungere = null
    this.forms = (l?.righe ?? []).map(riga => ({
      riga,
      quantita: comeNumero(riga.quantita),
      prezzo: comeNumero(riga.prezzo),
      sconto: formatCascata(riga.sconto),
    }))
  }

  modificabile(): boolean {
    const l = this.corrente()
    return this.puoScrivere && !!l && STATI_MODIFICABILI.includes(l.stato)
  }

  /** Le righe si ritoccano solo a scelte invariate: se cambiano, il server le rigenera. */
  righeModificabili(): boolean {
    return this.modificabile() && !this.scelteCambiate()
  }

  /** Clienti del menu, con quello attuale anche se non è fra i primi caricati. */
  opzioniClienti(): { label: string; value: string }[] {
    const c = this.corrente()?.cliente
    return c && !this.clienti.some(x => x.value === c.id)
      ? [{ label: c.etichetta, value: c.id }, ...this.clienti]
      : this.clienti
  }

  opzioniContratti() {
    return this.corrente()?.candidati?.contratti ?? []
  }

  opzioniElenchi() {
    return this.corrente()?.candidati?.elenchi ?? []
  }

  /** Righe candidate non ancora nel legame né già scelte. */
  righeDisponibili(): VoceScelta[] {
    const gia = new Set([
      ...this.forms.map(f => f.riga.rigaAddebitoId),
      ...this.aggiunte.map(r => r.id),
    ])
    return (this.corrente()?.candidati?.righe ?? []).filter(r => !gia.has(r.id))
  }

  clienteCambiato(): boolean {
    return this.clienteId !== null && this.clienteId !== (this.corrente()?.cliente?.id ?? null)
  }

  contrattoCambiato(): boolean {
    return (
      !this.clienteCambiato() &&
      this.contrattoId !== null &&
      this.contrattoId !== (this.corrente()?.contratto?.id ?? null)
    )
  }

  elencoCambiato(): boolean {
    return (
      !this.clienteCambiato() &&
      !this.contrattoCambiato() &&
      this.elencoId !== null &&
      this.elencoId !== (this.corrente()?.elenco?.id ?? null)
    )
  }

  scelteCambiate(): boolean {
    return this.clienteCambiato() || this.contrattoCambiato() || this.elencoCambiato()
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

  /** Quantità, prezzo o sconto non validi bloccano i pulsanti (solo se le righe sono modificabili). */
  valido(): boolean {
    if (!this.righeModificabili()) return true
    return this.forms.every(
      f => erroreQuantita(f) === null && errorePrezzo(f) === null && erroreSconto(f.sconto) === null
    )
  }

  /** Nuovo cliente: contratto ed elenco si azzerano (i candidati erano del cliente vecchio). */
  alCambioCliente(): void {
    const l = this.corrente()
    const invariato = this.clienteId === (l?.cliente?.id ?? null)
    this.contrattoId = invariato ? (l?.contratto?.id ?? null) : null
    this.elencoId = invariato ? (l?.elenco?.id ?? null) : null
    this.alCambioScelta()
  }

  /** Nuovo contratto: l'elenco si azzera, il menu resta chiuso finché non si salva. */
  alCambioContratto(): void {
    const l = this.corrente()
    this.elencoId = this.contrattoId === (l?.contratto?.id ?? null) ? (l?.elenco?.id ?? null) : null
    this.alCambioScelta()
  }

  alCambioScelta(): void {
    this.errori.set([])
  }

  aggiungiRiga(): void {
    const r = this.righeDisponibili().find(x => x.id === this.rigaDaAggiungere)
    if (!r) return
    this.aggiunte = [...this.aggiunte, r]
    this.rigaDaAggiungere = null
  }

  togliRiga(r: VoceScelta): void {
    this.aggiunte = this.aggiunte.filter(x => x.id !== r.id)
  }

  /**
   * Cosa inviare. Se cambia il «capo» (cliente, contratto o elenco) il backend rigenera le righe
   * e tratta `righe` come selezione completa: si manda solo la scelta, mai le righe. A scelte
   * invariate `righe` è un ritocco: le righe toccate più quelle aggiunte.
   */
  modifiche(): ModificheLegame | undefined {
    if (!this.corrente()) return undefined
    if (this.clienteCambiato()) return { clienteId: this.clienteId! }
    if (this.contrattoCambiato()) return { contrattoId: this.contrattoId! }
    if (this.elencoCambiato()) return { elencoId: this.elencoId! }
    const righe = [
      ...righeModificate(this.forms),
      ...this.aggiunte.map(r => ({ rigaAddebitoId: r.id })),
    ]
    return righe.length ? { righe } : undefined
  }

  salva(): void {
    const l = this.corrente()
    if (!l) return
    this.esegui(
      this.servizio.modifica(l.id, { versione: l.versione, ...(this.modifiche() ?? {}) }),
      false
    )
  }

  conferma(): void {
    const l = this.corrente()
    if (!l) return
    const modifiche = this.modifiche()
    this.esegui(
      this.servizio.conferma(l.id, { versione: l.versione, ...(modifiche ? { modifiche } : {}) }),
      true
    )
  }

  /** Rilegge tutto il legame (versione, stato, candidati) e riparte dai suoi valori. */
  ricarica(): void {
    const l = this.corrente()
    if (!l) return
    this.servizio.dettaglio(l.id).subscribe({
      next: nuovo => {
        this.corrente.set(nuovo)
        this.carica(nuovo)
      },
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
