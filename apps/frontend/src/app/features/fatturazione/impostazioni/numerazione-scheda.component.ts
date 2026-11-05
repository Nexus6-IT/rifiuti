import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { SharedModule } from 'primeng/api'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { NumeroItalianoDirective } from '../../../shared/directives/numero-it.directive'
import { puoImpostareFatturazione } from '../../legami/permessi-legami'
import { leggiErroriAzione } from '../../listino/errori-azione'
import { ImpostazioniFatturazione44Service } from './impostazioni-fatturazione-4-4.service'
import { NumerazioneVista, PARTENZA_NON_MODIFICABILE } from './impostazioni.model'

const MESSAGGIO_VERSIONE =
  'La numerazione è stata modificata da un altro utente: i dati sono stati ricaricati.'
const MESSAGGIO_PARTENZA_BLOCCATA =
  'La numerazione ha già fatture definitive o annullate: il numero di partenza non si può più cambiare.'

/** Fine del giorno di oggi: `maxDate` di PrimeNG confronta istanti, non giorni. */
export function fineGiornoDiOggi(): Date {
  const f = new Date()
  f.setHours(23, 59, 59, 999)
  return f
}

/** `AAAA-MM-GG` → `Date` a mezzanotte locale (senza passare da UTC). */
export function dataLocale(iso: string | null): Date | null {
  const m = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** `Date` locale → `AAAA-MM-GG` (mai `toISOString`, che passa da UTC). */
export function isoLocale(d: Date): string {
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`
}

/** `AAAA-MM-GG` → `gg/mm/aaaa`; vuoto se assente. */
export function dataItaliana(iso: string | null): string {
  const m = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Scheda «Numerazione»: una riga per registro IVA attivo, con il numero di partenza dell'anno. */
@Component({
  selector: 'app-numerazione-scheda',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CalendarModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    SharedModule,
    NumeroItalianoDirective,
  ],
  template: `
    <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="numerazione-errore">
      {{ e }}
    </p>

    <div class="field anno">
      <label for="num-anno">Anno</label>
      <p-dropdown
        [options]="anni"
        [ngModel]="anno()"
        (ngModelChange)="cambiaAnno($event)"
        inputId="num-anno"
        appendTo="body"
        data-testid="numerazione-anno"
      />
    </div>

    <section
      *ngIf="!righe() && !errore()"
      class="surface-card"
      data-testid="numerazione-caricamento"
    >
      <p role="status">Caricamento in corso...</p>
    </section>
    <p-button
      *ngIf="!righe() && errore()"
      label="Riprova"
      icon="pi pi-refresh"
      [outlined]="true"
      (onClick)="carica()"
      data-testid="numerazione-riprova"
    />

    <div *ngIf="righe() as elenco" class="tabella-numerazioni surface-card">
      <p *ngIf="elenco.length === 0" data-testid="numerazione-vuota">Nessun registro IVA attivo.</p>
      <table *ngIf="elenco.length > 0" class="numerazioni" data-testid="numerazione-tabella">
        <caption class="sr-only">
          Numerazione delle fatture per registro IVA nell'anno
          {{
            anno()
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Registro</th>
            <th scope="col">Ultimo numero</th>
            <th scope="col">Ultima data</th>
            <th scope="col">Partenza</th>
            <th scope="col"><span class="sr-only">Azioni</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            *ngFor="let r of elenco; trackBy: perRegistro"
            [attr.data-testid]="'numerazione-riga-' + r.codiceRegistro"
          >
            <th scope="row">{{ r.codiceRegistro }}</th>
            <td data-testid="numerazione-ultimo">{{ r.ultimoNumero }}</td>
            <td data-testid="numerazione-data">{{ dataItaliana(r.ultimaData) || '—' }}</td>
            <td data-testid="numerazione-partenza">
              {{ r.numeroPartenza }}
              <span *ngIf="r.dataPartenza"> dal {{ dataItaliana(r.dataPartenza) }}</span>
              <small
                *ngIf="parteDaUno(r)"
                class="nota-pagina"
                role="status"
                data-testid="numerazione-parte-da-1"
              >
                La numerazione partirà da 1.
              </small>
            </td>
            <td>
              <p-button
                *ngIf="r.partenzaModificabile && puoModificare()"
                label="Numero di partenza"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="apriPartenza(r)"
                [attr.data-testid]="'numerazione-modifica-' + r.codiceRegistro"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p *ngIf="!puoModificare()" class="nota-pagina" data-testid="numerazione-sola-lettura">
        Solo gli amministratori possono impostare il numero di partenza.
      </p>
    </div>

    <p-dialog
      [visible]="modificando() !== null"
      (visibleChange)="chiudi($event)"
      [modal]="true"
      [style]="{ width: '28rem' }"
      [header]="'Numero di partenza ' + (modificando()?.codiceRegistro ?? '')"
    >
      <div class="field">
        <label for="num-partenza">Numero di partenza</label>
        <p-inputNumber
          appNumeroIt
          soloIntero
          [useGrouping]="false"
          [(ngModel)]="numeroPartenza"
          inputId="num-partenza"
          locale="it-IT"
          mode="decimal"
          [min]="0"
          [maxFractionDigits]="0"
          styleClass="w-full"
          data-testid="partenza-numero"
        ></p-inputNumber>
        <small class="nota-pagina"
          >Il numero dell'ultima fattura già emessa altrove: la prossima sarà la successiva.</small
        >
      </div>
      <div class="field">
        <label for="num-data">Data dell'ultima fattura</label>
        <p-calendar
          [(ngModel)]="dataPartenza"
          [showIcon]="true"
          dateFormat="dd/mm/yy"
          [maxDate]="fineGiorno()"
          (onShow)="aggiornaFineGiorno()"
          (onFocus)="aggiornaFineGiorno()"
          inputId="num-data"
          styleClass="w-full"
          data-testid="partenza-data"
        ></p-calendar>
      </div>
      <p
        *ngIf="erroreDialogo() as e"
        role="alert"
        class="field-error"
        data-testid="partenza-errore"
      >
        {{ e }}
      </p>
      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="chiudi(false)"
          data-testid="partenza-annulla"
        />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="inCorso()"
          [loading]="inCorso()"
          (onClick)="salvaPartenza()"
          data-testid="partenza-salva"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      /* La didascalia .sr-only è position: absolute: serve un contenitore che la ancori. */
      .tabella-numerazioni {
        position: relative;
      }
      .numerazioni {
        border-collapse: collapse;
        width: 100%;
      }
      .numerazioni th,
      .numerazioni td {
        text-align: left;
        padding: 0.35rem 0.75rem 0.35rem 0;
      }
      .anno {
        max-width: 12rem;
      }
    `,
  ],
})
export class NumerazioneSchedaComponent implements OnInit {
  private readonly servizio = inject(ImpostazioniFatturazione44Service)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly dataItaliana = dataItaliana
  private readonly annoCorrente = new Date().getFullYear()
  readonly anni = [
    this.annoCorrente + 1,
    this.annoCorrente,
    this.annoCorrente - 1,
    this.annoCorrente - 2,
  ]
  readonly anno = signal(this.annoCorrente)
  readonly righe = signal<NumerazioneVista[] | null>(null)
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly modificando = signal<NumerazioneVista | null>(null)
  readonly erroreDialogo = signal<string | null>(null)
  readonly fineGiorno = signal<Date>(fineGiornoDiOggi())
  numeroPartenza: number | null = null
  dataPartenza: Date | null = null

  readonly puoModificare = () => puoImpostareFatturazione(this.auth.currentUser()?.role)

  ngOnInit(): void {
    this.carica()
  }

  perRegistro = (_: number, r: NumerazioneVista): string => r.registroIvaId

  /** Nessuna partenza impostata e nessun numero emesso: il primo numero sarà 1. */
  parteDaUno(r: NumerazioneVista): boolean {
    return r.numeroPartenza === 0 && r.ultimoNumero === 0
  }

  cambiaAnno(anno: number): void {
    // Il dropdown può riemettere il valore corrente (inizializzazione): niente rilettura inutile.
    if (anno === this.anno()) return
    this.anno.set(anno)
    this.righe.set(null)
    this.carica()
  }

  /** Rilegge l'elenco; `messaggio` resta visibile dopo la rilettura (es. versione superata). */
  carica(messaggio: string | null = null): void {
    this.servizio.numerazioni(this.anno()).subscribe({
      next: r => {
        this.righe.set(r)
        this.errore.set(messaggio)
      },
      error: err =>
        this.errore.set(
          leggiErroriAzione(err, 'Impossibile caricare le numerazioni.').messaggi.join(' ')
        ),
    })
  }

  /** `maxDate` di PrimeNG confronta istanti: la fine del giorno si ricalcola a ogni apertura. */
  aggiornaFineGiorno(): void {
    this.fineGiorno.set(fineGiornoDiOggi())
  }

  apriPartenza(r: NumerazioneVista): void {
    this.aggiornaFineGiorno()
    this.numeroPartenza = r.numeroPartenza
    this.dataPartenza = dataLocale(r.dataPartenza)
    this.erroreDialogo.set(null)
    this.modificando.set(r)
  }

  chiudi(aperto: boolean): void {
    if (!aperto) this.modificando.set(null)
  }

  salvaPartenza(): void {
    const r = this.modificando()
    if (!r || this.inCorso()) return
    const n = this.numeroPartenza
    if (n === null || !Number.isInteger(n) || n < 0) {
      this.erroreDialogo.set('Indica un numero di partenza intero, zero o maggiore.')
      return
    }
    this.inCorso.set(true)
    this.erroreDialogo.set(null)
    this.servizio
      .impostaPartenza(r.registroIvaId, r.anno, {
        numeroPartenza: n,
        dataPartenza: this.dataPartenza ? isoLocale(this.dataPartenza) : null,
        versione: r.versione,
      })
      .subscribe({
        next: nuova => {
          this.inCorso.set(false)
          this.modificando.set(null)
          this.righe.update(l =>
            (l ?? []).map(x => (x.registroIvaId === nuova.registroIvaId ? nuova : x))
          )
          this.toast.success('Numero di partenza salvato.', 'Fatturazione')
        },
        error: err => {
          this.inCorso.set(false)
          const e = leggiErroriAzione(err, 'Impossibile salvare il numero di partenza.')
          if (e.conflitto && e.rilettura) {
            this.modificando.set(null)
            this.carica(
              e.codice === PARTENZA_NON_MODIFICABILE
                ? MESSAGGIO_PARTENZA_BLOCCATA
                : MESSAGGIO_VERSIONE
            )
            return
          }
          this.erroreDialogo.set(e.messaggi.join(' '))
        },
      })
  }
}
