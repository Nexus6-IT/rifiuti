import { CommonModule } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { TagModule } from 'primeng/tag'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'
import { AriaInternoDirective } from '../../shared/directives/aria-interno.directive'
import {
  formatCascata,
  formatNumero,
  leggiScontoCascata,
} from '../../shared/utils/numero-modificabile'
import { RigaLegame } from './legami.model'

export type CampoRiga = 'quantita' | 'prezzo' | 'sconto'

/** Valore valido di un campo, già nella forma del backend (stringa col punto). */
export interface ModificaCampoRiga {
  rigaAddebitoId: string
  campo: CampoRiga
  /** `null` solo per lo sconto svuotato (= nessuno sconto). */
  valore: string | null
}

/** Cifre decimali di un numero JS (senza esponente: i campi accettano al massimo 6 decimali). */
function decimali(n: number): number {
  const t = n.toFixed(10).replace(/0+$/, '')
  const i = t.indexOf('.')
  return i < 0 ? 0 : t.length - i - 1
}

/** Numero del campo → stringa col punto (il backend non accetta mai numeri JSON). */
export function numeroComeStringa(n: number): string {
  return n.toFixed(10).replace(/\.?0+$/, '')
}

/**
 * Tabella delle righe di un legame con quantità, prezzo e sconto modificabili. Presentazione
 * pura: non conosce lo stato del legame. Emette solo valori VALIDI (`modifica`) e dice al
 * contenitore se c'è almeno un campo in errore (`erroriChange`), così il pulsante può bloccarsi.
 * Regola numeri: virgola decimale, punto rifiutato, nessun separatore delle migliaia
 * (`appNumeroIt` sui campi decimali; lo sconto è una cascata e usa lo stesso parser condiviso).
 */
@Component({
  selector: 'app-righe-legame-tabella',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    NumeroItalianoDirective,
    AriaInternoDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p
      class="scorri-hint"
      aria-hidden="true"
      *ngIf="righe.length > 0"
      data-testid="righe-scorri-hint"
    >
      <i class="pi pi-arrows-h"></i> Scorri di lato per vedere tutte le colonne
    </p>
    <div class="tabella-scroll" *ngIf="righe.length > 0">
      <table class="righe-legame" data-testid="righe-legame">
        <caption class="sr-only">
          Righe del legame con quantità, prezzo e sconto
        </caption>
        <thead>
          <tr>
            <th scope="col">Voce</th>
            <th scope="col">Quantità</th>
            <th scope="col">Prezzo</th>
            <th scope="col">Sconto %</th>
            <th *ngIf="mostraIva" scope="col">IVA</th>
            <th scope="col" class="num">Importo</th>
            <th *ngIf="rimovibile" scope="col"><span class="sr-only">Azioni</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            *ngFor="let r of righe; trackBy: perId"
            [attr.data-testid]="'riga-' + r.rigaAddebitoId"
            [class.riga-rimossa]="eRimossa(r)"
          >
            <td>
              <span class="voce">{{ r.descrizione || r.tipo }}</span>
              <p-tag *ngIf="r.origine === 'PROPOSTA'" severity="info" value="Aggiuntiva"></p-tag>
              <small
                *ngIf="eRimossa(r)"
                class="unita"
                [attr.data-testid]="'rimossa-' + r.rigaAddebitoId"
                >da rimuovere</small
              >
            </td>

            <td>
              <ng-container *ngIf="modificabile; else soloQta">
                <p-inputNumber
                  appNumeroIt
                  [useGrouping]="false"
                  [ngModel]="numero(r.quantita)"
                  (ngModelChange)="alCambio(r, 'quantita', $event)"
                  [messaggioInterno]="false"
                  (rifiutato)="alRifiuto(r, 'quantita', $event)"
                  [inputId]="'qta-' + r.rigaAddebitoId"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="6"
                  mode="decimal"
                  locale="it-IT"
                  [ariaLabel]="'Quantità di ' + (r.descrizione || r.tipo)"
                  styleClass="campo-riga"
                  [inputStyleClass]="errore(r, 'quantita') ? 'p-invalid' : ''"
                  [appAriaInterno]="!!errore(r, 'quantita')"
                  [ariaDescrittoDa]="errore(r, 'quantita') ? idErrore(r, 'quantita') : null"
                ></p-inputNumber>
                <span class="unita">{{ r.unitaMisura }}</span>
                <small
                  *ngIf="errore(r, 'quantita') as e"
                  class="field-error p-error block"
                  role="alert"
                  [id]="idErrore(r, 'quantita')"
                  [attr.data-testid]="'errore-qta-' + r.rigaAddebitoId"
                  >{{ e }}</small
                >
              </ng-container>
              <ng-template #soloQta>{{ testoNumero(r.quantita) }} {{ r.unitaMisura }}</ng-template>
            </td>

            <td>
              <span
                *ngIf="r.prezzoSpeciale; else prezzoSingolo"
                [attr.data-testid]="'prezzo-speciale-' + r.rigaAddebitoId"
                >Prezzo speciale (calcolato dal listino)</span
              >
              <ng-template #prezzoSingolo>
                <ng-container *ngIf="modificabile; else soloPrezzo">
                  <p-inputNumber
                    appNumeroIt
                    [useGrouping]="false"
                    [ngModel]="numero(r.prezzo)"
                    (ngModelChange)="alCambio(r, 'prezzo', $event)"
                    [messaggioInterno]="false"
                    (rifiutato)="alRifiuto(r, 'prezzo', $event)"
                    [inputId]="'prezzo-' + r.rigaAddebitoId"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="8"
                    mode="decimal"
                    locale="it-IT"
                    [ariaLabel]="'Prezzo di ' + (r.descrizione || r.tipo)"
                    styleClass="campo-riga"
                    [inputStyleClass]="errore(r, 'prezzo') ? 'p-invalid' : ''"
                    [appAriaInterno]="!!errore(r, 'prezzo')"
                    [ariaDescrittoDa]="errore(r, 'prezzo') ? idErrore(r, 'prezzo') : null"
                  ></p-inputNumber>
                  <small
                    *ngIf="errore(r, 'prezzo') as e"
                    class="field-error p-error block"
                    role="alert"
                    [id]="idErrore(r, 'prezzo')"
                    [attr.data-testid]="'errore-prezzo-' + r.rigaAddebitoId"
                    >{{ e }}</small
                  >
                </ng-container>
                <ng-template #soloPrezzo>{{ testoNumero(r.prezzo) }}</ng-template>
              </ng-template>
              <p-tag
                *ngIf="r.prezzoManuale"
                severity="warning"
                value="prezzo manuale"
                [attr.data-testid]="'badge-prezzo-manuale-' + r.rigaAddebitoId"
              ></p-tag>
            </td>

            <td>
              <ng-container *ngIf="!r.prezzoSpeciale && modificabile; else soloSconto">
                <input
                  pInputText
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  class="campo-riga"
                  [id]="'sconto-' + r.rigaAddebitoId"
                  [value]="testoSconto(r)"
                  (input)="alCambioSconto(r, $any($event.target).value)"
                  [attr.aria-label]="'Sconto di ' + (r.descrizione || r.tipo)"
                  [class.p-invalid]="!!errore(r, 'sconto')"
                  [attr.aria-invalid]="errore(r, 'sconto') ? 'true' : null"
                  [attr.aria-describedby]="errore(r, 'sconto') ? idErrore(r, 'sconto') : null"
                  placeholder="es. 10+5"
                />
                <small
                  *ngIf="errore(r, 'sconto') as e"
                  class="field-error p-error block"
                  role="alert"
                  [id]="idErrore(r, 'sconto')"
                  [attr.data-testid]="'errore-sconto-' + r.rigaAddebitoId"
                  >{{ e }}</small
                >
              </ng-container>
              <ng-template #soloSconto>{{ testoSconto(r) || '—' }}</ng-template>
            </td>

            <td *ngIf="mostraIva" [attr.data-testid]="'iva-' + r.rigaAddebitoId">
              {{ testoIva(r) }}
            </td>

            <td class="num" [attr.data-testid]="'importo-' + r.rigaAddebitoId">
              {{ r.importo !== null ? importoTesto(r.importo) + ' €' : '—' }}
            </td>

            <td *ngIf="rimovibile">
              <p-button
                [label]="eRimossa(r) ? 'Ripristina' : 'Rimuovi'"
                [text]="true"
                size="small"
                (onClick)="rimuovi.emit(r.rigaAddebitoId)"
                [ariaLabel]="(eRimossa(r) ? 'Ripristina ' : 'Rimuovi ') + (r.descrizione || r.tipo)"
                [attr.data-testid]="'rimuovi-' + r.rigaAddebitoId"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      /* position: relative tiene la didascalia sr-only (position: absolute) dentro il
         contenitore: senza, il dialog che ospita la tabella si allunga e scorre (revisione UX C3). */
      .tabella-scroll {
        position: relative;
        overflow-x: auto;
        /* Ombre ai bordi che compaiono solo dove c'e' altro da scorrere (trucco background-attachment). */
        background:
          linear-gradient(to right, var(--surface-section, #fff) 30%, transparent) left center /
            2rem 100% no-repeat local,
          linear-gradient(to left, var(--surface-section, #fff) 30%, transparent) right center /
            2rem 100% no-repeat local,
          radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.28), transparent) left center /
            0.6rem 100% no-repeat scroll,
          radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.28), transparent) right
            center / 0.6rem 100% no-repeat scroll;
      }
      /* Indicazione visibile dello scorrimento: solo dove le colonne possono non entrare. */
      .scorri-hint {
        display: none;
        margin: 0 0 0.35rem;
        font-size: var(--font-size-xs, 0.75rem);
        color: var(--text-secondary, #59615c);
      }
      @media (max-width: 600px) {
        .scorri-hint {
          display: block;
        }
      }
      .field-error {
        font-size: var(--font-size-xs, 0.75rem);
        font-weight: var(--font-weight-medium, 500);
        color: var(--color-danger, #b42318);
      }
      .righe-legame {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .righe-legame th,
      .righe-legame td {
        text-align: left;
        padding: 0.4rem 0.5rem;
        vertical-align: top;
        border-bottom: 1px solid var(--surface-border, #e5e7eb);
      }
      .righe-legame .num {
        text-align: right;
        white-space: nowrap;
      }
      .riga-rimossa .voce {
        text-decoration: line-through;
      }
      .voce {
        margin-right: 0.4rem;
      }
      .unita {
        margin-left: 0.35rem;
        color: var(--text-color-secondary, #6b7280);
      }
      :host ::ng-deep .campo-riga,
      :host ::ng-deep .campo-riga input,
      input.campo-riga {
        width: 8rem;
        max-width: 100%;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class RigheLegameTabellaComponent implements OnChanges {
  @Input() righe: RigaLegame[] = []
  /** Falso: solo lettura (VIEWER, legame fatturato). */
  @Input() modificabile = true
  /** Colonna IVA di sola lettura (riquadro del dettaglio: i valori congelati del legame). */
  @Input() mostraIva = false
  /** Cambia quando gli errori e i testi in corso vanno scordati (nuova scelta a monte). */
  @Input() generazione = 0
  /** Mostra «Rimuovi» / «Ripristina» per riga, in una colonna a parte (finestra del legame). */
  @Input() rimovibile = false
  /** Id delle righe segnate «da rimuovere»: i loro errori non bloccano nulla. Passare un nuovo `Set` a ogni cambio. */
  @Input() rimosse: ReadonlySet<string> = new Set()
  @Output() modifica = new EventEmitter<ModificaCampoRiga>()
  /** `rigaAddebitoId` della riga di cui si chiede rimozione o ripristino. */
  @Output() rimuovi = new EventEmitter<string>()
  /** Vero se almeno un campo è in errore. */
  @Output() erroriChange = new EventEmitter<boolean>()

  /** Errori di valore per campo (`<riga>|<campo>`): zero, negativo, troppi decimali. */
  private readonly erroriCampi = signal<ReadonlyMap<string, string>>(new Map())
  /**
   * Rifiuti di formato della direttiva (punto, testo): vivono a parte perché la direttiva li
   * azzera da sola all'uscita dal campo, dopo che il valore è già stato convalidato.
   */
  private readonly rifiutiCampi = signal<ReadonlyMap<string, string>>(new Map())
  /** Testo dello sconto mentre si scrive (la cascata «10,5+» è un passaggio lecito). */
  private readonly testiSconto = signal<ReadonlyMap<string, string>>(new Map())

  private ultimoStato = false

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['righe'] && !changes['generazione']) {
      // Solo le righe da rimuovere sono cambiate: lo stato complessivo degli errori va ricalcolato.
      if (changes['rimosse']) void Promise.resolve().then(() => this.segnalaErrori())
      return
    }
    if (changes['generazione'] && !changes['generazione'].firstChange) {
      this.erroriCampi.set(new Map())
      this.rifiutiCampi.set(new Map())
      this.testiSconto.set(new Map())
    } else {
      // Le righe sono cambiate: errori e testi di righe sparite non devono restare, invisibili e bloccanti.
      const ids = new Set(this.righe.map(r => r.rigaAddebitoId))
      const tieni = (m: ReadonlyMap<string, string>, perRiga: boolean): Map<string, string> =>
        new Map([...m].filter(([k]) => ids.has(perRiga ? k : k.split('|')[0])))
      this.erroriCampi.set(tieni(this.erroriCampi(), false))
      this.rifiutiCampi.set(tieni(this.rifiutiCampi(), false))
      this.testiSconto.set(tieni(this.testiSconto(), true))
    }
    // Siamo nel change detection del genitore: l'uscita parte in un microtask.
    void Promise.resolve().then(() => this.segnalaErrori())
  }

  eRimossa(r: RigaLegame): boolean {
    return this.rimosse.has(r.rigaAddebitoId)
  }

  perId = (_: number, r: RigaLegame): string => r.rigaAddebitoId

  /** Id del messaggio d'errore di un campo (legato al campo con `aria-describedby`). */
  idErrore(r: RigaLegame, campo: CampoRiga): string {
    return `errore-${campo}-${r.rigaAddebitoId}`
  }

  numero(v: string | null): number | null {
    return v === null || v === undefined || v === '' ? null : Number(v)
  }

  /** Solo lettura: virgola, niente separatore delle migliaia. */
  testoNumero(v: string | null): string {
    return v === null ? '—' : v.replace('.', ',')
  }

  /** Aliquota (`22 %`) o natura dell'esenzione; «—» se la riga non ha né l'una né l'altra. */
  testoIva(r: RigaLegame): string {
    if (r.aliquotaIva !== null && r.aliquotaIva !== '') return `${formatNumero(r.aliquotaIva, 0)} %`
    return r.naturaIva ?? '—'
  }

  /** Importo calcolato dal server: virgola e due decimali, senza separatore delle migliaia. */
  importoTesto(v: string | null): string {
    return formatNumero(v, 2)
  }

  errore(r: RigaLegame, campo: CampoRiga): string | null {
    const k = `${r.rigaAddebitoId}|${campo}`
    return this.rifiutiCampi().get(k) ?? this.erroriCampi().get(k) ?? null
  }

  testoSconto(r: RigaLegame): string {
    return this.testiSconto().get(r.rigaAddebitoId) ?? formatCascata(r.sconto)
  }

  /** Messaggio del rifiuto di un carattere (punto, testo non numerico): il campo non cambia valore. */
  alRifiuto(r: RigaLegame, campo: CampoRiga, messaggio: string | null): void {
    const k = `${r.rigaAddebitoId}|${campo}`
    const nuovi = new Map(this.rifiutiCampi())
    if (messaggio) nuovi.set(k, messaggio)
    else nuovi.delete(k)
    this.rifiutiCampi.set(nuovi)
    this.segnalaErrori()
  }

  alCambio(r: RigaLegame, campo: 'quantita' | 'prezzo', n: number | null): void {
    const esito = this.convalida(campo, n)
    this.impostaErrore(r, campo, esito.errore)
    if (esito.errore === null && esito.valore !== null) {
      this.modifica.emit({ rigaAddebitoId: r.rigaAddebitoId, campo, valore: esito.valore })
    }
  }

  alCambioSconto(r: RigaLegame, testo: string): void {
    const nuovi = new Map(this.testiSconto())
    nuovi.set(r.rigaAddebitoId, testo)
    this.testiSconto.set(nuovi)
    const lettura = leggiScontoCascata(testo)
    this.impostaErrore(r, 'sconto', lettura.errore)
    if (lettura.errore === null) {
      this.modifica.emit({
        rigaAddebitoId: r.rigaAddebitoId,
        campo: 'sconto',
        valore: lettura.valore,
      })
    }
  }

  private convalida(
    campo: 'quantita' | 'prezzo',
    n: number | null
  ): { valore: string | null; errore: string | null } {
    if (campo === 'quantita') {
      if (n === null || !(n > 0))
        return { valore: null, errore: 'Indica una quantità maggiore di zero.' }
      if (decimali(n) > 3) return { valore: null, errore: 'Al massimo 3 decimali.' }
      if (n >= 1e11) return { valore: null, errore: 'Quantità troppo grande.' }
    } else {
      if (n === null) return { valore: null, errore: 'Indica il prezzo.' }
      if (n < 0) return { valore: null, errore: 'Il prezzo non può essere negativo.' }
      if (decimali(n) > 6) return { valore: null, errore: 'Al massimo 6 decimali.' }
      if (n >= 1e8) return { valore: null, errore: 'Prezzo troppo grande.' }
    }
    return { valore: numeroComeStringa(n), errore: null }
  }

  private impostaErrore(r: RigaLegame, campo: CampoRiga, messaggio: string | null): void {
    const chiave = `${r.rigaAddebitoId}|${campo}`
    const nuovi = new Map(this.erroriCampi())
    if (messaggio) nuovi.set(chiave, messaggio)
    else nuovi.delete(chiave)
    this.erroriCampi.set(nuovi)
    this.segnalaErrori()
  }

  private segnalaErrori(): void {
    // Gli errori di una riga «da rimuovere» non contano: la riga non partirà.
    const attivo = (m: ReadonlyMap<string, string>): boolean =>
      [...m.keys()].some(k => !this.rimosse.has(k.split('|')[0]))
    const stato = attivo(this.erroriCampi()) || attivo(this.rifiutiCampi())
    if (stato === this.ultimoStato) return
    this.ultimoStato = stato
    this.erroriChange.emit(stato)
  }
}
