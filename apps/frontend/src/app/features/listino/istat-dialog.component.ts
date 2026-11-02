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
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { AnteprimaContrattiComponent } from './anteprima-contratti.component'
import { MESSAGGIO_CONCORRENTE, eConcorrente, leggiErroriAzione } from './errori-azione'
import { AnteprimaVariazioneContratti, CorpoIstat, MeseIstat } from './listino.model'
import { ListinoService } from './listino.service'
import { leggiNumero } from './numero-modificabile'
import { puoVariarePrezzi } from './permessi-listino'
import { TIPI_ELENCABILI } from './vocabolario-listino'

export const MESSAGGIO_ISTAT_SUPERATA =
  'I prezzi sono cambiati dopo l’anteprima: rifai l’anteprima.'

const MESI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]
export const etichettaMese = (m: MeseIstat): string => `${MESI[m.mese - 1] ?? m.mese} ${m.anno}`
const chiave = (m: { anno: number; mese: number }): string => `${m.anno}-${m.mese}`

/**
 * Adeguamento ISTAT (E24, D22), solo ADMIN: per ogni mese di inizio dei contratti con l'incremento
 * ISTAT la percentuale da applicare (virgola decimale; vuota = il mese non si tocca), i tipi di
 * addebito, poi anteprima e applicazione con l'impronta. Le regole (percentuale tra 0 e 100,
 * decrescente dai mesi più vecchi ai più recenti, almeno un tipo) le fa il backend e i suoi
 * messaggi si mostrano com'è. Cambiare un dato scarta l'anteprima; un 409 obbliga a rifarla.
 */
@Component({
  selector: 'app-istat-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    AnteprimaContrattiComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Adeguamento ISTAT"
      [modal]="true"
      [closable]="!applicando()"
      [style]="{ width: '52rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <p
        *ngIf="erroreCaricamento() as e"
        role="alert"
        class="field-error"
        data-testid="istat-errore-caricamento"
      >
        {{ e }}
      </p>

      <div *ngIf="esito() !== null" class="dlg-form" role="status" data-testid="istat-esito">
        <p>Prezzi aggiornati: {{ esito() }}</p>
      </div>

      <div *ngIf="esito() === null && inRiepilogo()" class="dlg-form" data-testid="istat-riepilogo">
        <p>Stai per adeguare i prezzi dei contratti. L'operazione non si annulla.</p>
        <ul>
          <li *ngFor="let r of riepilogo()">{{ r }}</li>
        </ul>
      </div>

      <div *ngIf="esito() === null" class="dlg-form" [hidden]="inRiepilogo()">
        <label class="spunta">
          <input
            type="checkbox"
            [checked]="annoPrecedente()"
            (change)="cambiaAnnoPrecedente($any($event.target).checked)"
            data-testid="istat-anno-precedente"
          />
          Includi anche l'anno precedente
        </label>
        <p
          *ngIf="mesi() !== null && mesi()?.length === 0"
          class="field-hint"
          data-testid="istat-nessun-mese"
        >
          Nessun contratto con l'incremento ISTAT da adeguare.
        </p>
        <table *ngIf="mesi()?.length" class="mesi" data-testid="istat-mesi">
          <thead>
            <tr>
              <th scope="col">Mese di inizio</th>
              <th scope="col">Contratti</th>
              <th scope="col">Percentuale (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let m of mesi()">
              <td>
                {{ etichetta(m) }}
                <small
                  *ngIf="m.ultimaApplicazione"
                  class="field-hint"
                  [attr.data-testid]="'istat-applicato-' + chiave(m)"
                >
                  (applicato il {{ m.ultimaApplicazione | date: 'dd/MM/yyyy' }})
                </small>
              </td>
              <td>{{ m.contratti }}</td>
              <td>
                <input
                  pInputText
                  inputmode="decimal"
                  [attr.aria-label]="'Percentuale per ' + etichetta(m)"
                  [ngModel]="percentuali()[chiave(m)] ?? ''"
                  (ngModelChange)="cambiaPercentuale(m, $event)"
                  [attr.data-testid]="'istat-perc-' + chiave(m)"
                />
                <small
                  *ngIf="errorePercentuale(m) as e"
                  role="alert"
                  class="field-error"
                  [attr.data-testid]="'istat-errore-' + chiave(m)"
                  >{{ e }}</small
                >
              </td>
            </tr>
          </tbody>
        </table>

        <fieldset class="gruppo">
          <legend>Tipi di addebito</legend>
          <label *ngFor="let t of tipiProposti" class="spunta" [attr.title]="t.etichetta">
            <input
              type="checkbox"
              [checked]="tipiScelti().includes(t.tipo)"
              (change)="cambiaTipo(t.tipo, $any($event.target).checked)"
              [attr.data-testid]="'istat-tipo-' + t.tipo"
            />
            {{ t.tipo }}
          </label>
        </fieldset>
      </div>

      <p
        *ngIf="erroreAnteprima() as e"
        role="alert"
        class="field-error"
        data-testid="istat-errore-anteprima"
      >
        {{ e }}
      </p>
      <app-anteprima-contratti
        *ngIf="esito() === null && !inRiepilogo() && anteprimaCorrente() as a"
        [anteprima]="a"
        nomeFile="adeguamento-istat.csv"
      />
      <ul
        *ngIf="erroriApplica().length > 0"
        role="alert"
        class="field-error"
        data-testid="istat-errore-applica"
      >
        <li *ngFor="let m of erroriApplica()">{{ m }}</li>
      </ul>

      <ng-template pTemplate="footer">
        <p-button
          [label]="esito() !== null ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="applicando()"
          (onClick)="chiudi()"
          data-testid="istat-chiudi"
        />
        <ng-container *ngIf="esito() === null">
          <ng-container *ngIf="!inRiepilogo()">
            <p-button
              label="Anteprima"
              icon="pi pi-eye"
              [outlined]="true"
              [disabled]="!puoAnteprima()"
              (onClick)="anteprima()"
              data-testid="istat-anteprima"
            />
            <p-button
              *ngIf="anteprimaCorrente() !== null"
              label="Applica"
              icon="pi pi-check"
              [disabled]="!puoApplicare()"
              (onClick)="avanti()"
              data-testid="istat-applica"
            />
          </ng-container>
          <ng-container *ngIf="inRiepilogo()">
            <p-button
              label="Indietro"
              [text]="true"
              [disabled]="applicando()"
              (onClick)="inRiepilogo.set(false)"
              data-testid="istat-indietro"
            />
            <p-button
              label="Conferma l'adeguamento"
              icon="pi pi-check"
              [disabled]="applicando() || !puoApplicare()"
              (onClick)="applica()"
              data-testid="istat-conferma-finale"
            />
          </ng-container>
        </ng-container>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .mesi {
        width: 100%;
        border-collapse: collapse;
      }
      .mesi th,
      .mesi td {
        padding: 0.25rem 0.5rem;
        text-align: left;
      }
      .gruppo {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        border: 1px solid var(--surface-border, #ccc);
        padding: 0.5rem;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
    `,
  ],
})
export class IstatDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() applicata = new EventEmitter<number>()

  readonly etichetta = etichettaMese
  readonly chiave = chiave
  readonly tipiProposti = TIPI_ELENCABILI.filter(t => !t.tipo.includes('?'))
  readonly mesi = signal<MeseIstat[] | null>(null)
  readonly annoPrecedente = signal(false)
  readonly percentuali = signal<Record<string, string>>({})
  readonly tipiScelti = signal<string[]>([])
  readonly erroreCaricamento = signal<string | null>(null)
  readonly erroreAnteprima = signal<string | null>(null)
  readonly erroriApplica = signal<string[]>([])
  readonly inCorso = signal(false)
  readonly applicando = signal(false)
  readonly inRiepilogo = signal(false)
  readonly riepilogo = signal<string[]>([])
  readonly esito = signal<number | null>(null)
  readonly anteprimaCorrente = signal<AnteprimaVariazioneContratti | null>(null)

  /** Percentuali compilate, in ordine di tempo, nella forma del backend. */
  private readonly compilate = computed(() =>
    [...(this.mesi() ?? [])]
      .sort((a, b) => a.anno - b.anno || a.mese - b.mese)
      .map(m => ({ m, testo: this.percentuali()[chiave(m)] ?? '' }))
      .filter(x => x.testo.trim() !== '')
  )
  private readonly conErrori = computed(() =>
    this.compilate().some(x => leggiNumero(x.testo).errore !== null)
  )

  private corpo: (CorpoIstat & { impronta?: string }) | null = null
  private lettura?: Subscription
  private richiesta?: Subscription
  private applicazione?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
  }

  private inizializza(): void {
    this.richiesta?.unsubscribe()
    this.applicazione?.unsubscribe()
    this.annoPrecedente.set(false)
    this.percentuali.set({})
    this.tipiScelti.set([])
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.riepilogo.set([])
    this.esito.set(null)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
    this.inCorso.set(false)
    this.applicando.set(false)
    this.caricaMesi()
  }

  private caricaMesi(): void {
    this.lettura?.unsubscribe()
    this.mesi.set(null)
    this.erroreCaricamento.set(null)
    this.lettura = this.servizio.variazioniContratti.mesiIstat(this.annoPrecedente()).subscribe({
      next: m => this.mesi.set(m),
      error: err =>
        this.erroreCaricamento.set(
          messaggioErrore(err, 'Impossibile caricare i mesi da adeguare.')
        ),
    })
  }

  private scarta(): void {
    this.richiesta?.unsubscribe()
    this.corpo = null
    this.anteprimaCorrente.set(null)
    this.inRiepilogo.set(false)
    this.inCorso.set(false)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
  }

  cambiaAnnoPrecedente(si: boolean): void {
    this.annoPrecedente.set(si)
    this.scarta()
    this.caricaMesi()
  }

  cambiaPercentuale(m: MeseIstat, testo: string): void {
    this.percentuali.update(p => ({ ...p, [chiave(m)]: testo }))
    this.scarta()
  }

  errorePercentuale(m: MeseIstat): string | null {
    return leggiNumero(this.percentuali()[chiave(m)] ?? '').errore
  }

  cambiaTipo(tipo: string, si: boolean): void {
    this.tipiScelti.update(v =>
      si ? [...v.filter(x => x !== tipo), tipo] : v.filter(x => x !== tipo)
    )
    this.scarta()
  }

  puoVariare(): boolean {
    return puoVariarePrezzi(this.auth.currentUser()?.role)
  }

  puoAnteprima(): boolean {
    return (
      this.compilate().length > 0 &&
      !this.conErrori() &&
      this.tipiScelti().length > 0 &&
      !this.inCorso() &&
      !this.applicando() &&
      this.puoVariare()
    )
  }

  puoApplicare(): boolean {
    const a = this.anteprimaCorrente()
    return (
      a !== null &&
      a.righe.length > 0 &&
      a.errori.length === 0 &&
      !this.inCorso() &&
      !this.applicando() &&
      this.puoVariare()
    )
  }

  private costruisciCorpo(): CorpoIstat {
    return {
      percentuali: this.compilate().map(x => ({
        anno: x.m.anno,
        mese: x.m.mese,
        percentuale: leggiNumero(x.testo).valore ?? '',
      })),
      tipi: this.tipiScelti(),
    }
  }

  anteprima(): void {
    if (!this.puoAnteprima()) return
    const corpo = this.costruisciCorpo()
    this.richiesta?.unsubscribe()
    this.anteprimaCorrente.set(null)
    this.erroreAnteprima.set(null)
    this.erroriApplica.set([])
    this.inCorso.set(true)
    this.richiesta = this.servizio.variazioniContratti.anteprimaIstat(corpo).subscribe({
      next: a => {
        this.inCorso.set(false)
        this.corpo = corpo
        this.anteprimaCorrente.set(a)
      },
      error: err => {
        this.inCorso.set(false)
        this.erroreAnteprima.set(
          leggiErroriAzione(err, "Impossibile calcolare l'anteprima.").messaggi.join(' ')
        )
      },
    })
  }

  avanti(): void {
    const a = this.anteprimaCorrente()
    if (!this.puoApplicare() || !a) return
    const righe = this.compilate().map(x => `${etichettaMese(x.m)}: ${x.testo.trim()} %`)
    righe.push(`Tipi di addebito: ${this.tipiScelti().join(', ')}`)
    righe.push(`Prezzi da modificare: ${a.totale}`)
    this.riepilogo.set(righe)
    this.erroriApplica.set([])
    this.inRiepilogo.set(true)
  }

  applica(): void {
    const a = this.anteprimaCorrente()
    const corpo = this.corpo
    if (!this.puoApplicare() || !this.inRiepilogo() || !a || !corpo) return
    this.inCorso.set(true)
    this.applicando.set(true)
    this.erroriApplica.set([])
    this.applicazione = this.servizio.variazioniContratti
      .applicaIstat({ ...corpo, impronta: a.impronta })
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.esito.set(r.aggiornati)
          this.applicata.emit(r.aggiornati)
        },
        error: err => {
          const e = leggiErroriAzione(err, "Impossibile applicare l'adeguamento.")
          this.inCorso.set(false)
          this.applicando.set(false)
          this.inRiepilogo.set(false)
          if (eConcorrente(e)) {
            // Un'altra operazione teneva le righe: l'anteprima resta valida, si riprova con Applica.
            this.erroriApplica.set([MESSAGGIO_CONCORRENTE])
            return
          }
          this.anteprimaCorrente.set(null)
          this.corpo = null
          this.erroriApplica.set(e.conflitto ? [MESSAGGIO_ISTAT_SUPERATA] : e.messaggi)
        },
      })
  }

  chiudi(): void {
    if (this.applicando()) return
    this.richiesta?.unsubscribe()
    this.visibleChange.emit(false)
  }
}
