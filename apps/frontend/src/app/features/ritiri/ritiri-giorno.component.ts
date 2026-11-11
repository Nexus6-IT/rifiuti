/**
 * Lista del giorno per l'autista, da telefono (4.7 T11, P7 §7, D7): una card per ritiro in ordine
 * di giro, con indirizzo (link alle mappe), CER e quantità, «PDF del FIR» e «Non eseguito» con
 * motivo. Nessuna modifica dei dati del rifiuto da qui. Pensata per 360 px.
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { CampoDataComponent } from '../../shared/components/campo-data.component'
import { PillolaStatoComponent } from '../../shared/components/pillola-stato.component'
import { puoCreareFir } from '../fir/fir-permissions'
import { PeseService } from '../pese/pese.service'
import { NonEseguitoDialogComponent } from './non-eseguito-dialog.component'
import {
  ETICHETTA_FASCIA,
  ETICHETTA_STATO,
  messaggioErroreRitiri,
  oggiIso,
  quantitaItaliana,
  RitiroVista,
  StatoVisibileRitiro,
  TONO_STATO_RITIRO,
} from './ritiri.model'
import { RitiriService } from './ritiri.service'

/** Ordine di giro (i senza ordine in fondo), poi fascia (mattina prima), poi produttore. */
export function ordinaGiro(righe: readonly RitiroVista[]): RitiroVista[] {
  const fascia = (r: RitiroVista): number =>
    r.fascia === 'MATTINA' ? 0 : r.fascia === 'POMERIGGIO' ? 1 : 2
  return [...righe].sort(
    (a, b) =>
      (a.ordineGiro ?? Number.MAX_SAFE_INTEGER) - (b.ordineGiro ?? Number.MAX_SAFE_INTEGER) ||
      fascia(a) - fascia(b) ||
      a.produttore.nome.localeCompare(b.produttore.nome, 'it')
  )
}

@Component({
  selector: 'app-ritiri-giorno',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CampoDataComponent,
    PillolaStatoComponent,
    NonEseguitoDialogComponent,
  ],
  template: `
    <section class="page giorno">
      <h1>Ritiri del giorno</h1>

      <div class="scelta">
        <div class="field">
          <label for="rg-data">Data</label>
          <app-campo-data
            inputId="rg-data"
            [ngModel]="data()"
            (ngModelChange)="cambiaData($event)"
            name="data"
            data-testid="rg-data"
          />
        </div>
        <div class="field">
          <label for="rg-mezzo">Mezzo</label>
          <select
            id="rg-mezzo"
            class="p-inputtext w-full"
            [ngModel]="mezzoId()"
            (ngModelChange)="cambiaMezzo($event)"
            data-testid="rg-mezzo"
          >
            <option value="">Tutti i mezzi</option>
            <option *ngFor="let m of mezzi()" [value]="m.id">{{ m.targa }}</option>
          </select>
        </div>
      </div>

      <p *ngIf="caricamento()" class="nota" role="status" data-testid="rg-caricamento">
        Caricamento…
      </p>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rg-errore">{{ e }}</p>
      <p *ngIf="!caricamento() && !errore() && !righe().length" class="nota" data-testid="rg-vuota">
        Nessun ritiro per questo giorno.
      </p>

      <ol class="schede" *ngIf="righe().length">
        <li
          *ngFor="let r of righe(); let i = index"
          class="scheda"
          [attr.data-testid]="'rg-' + r.id"
        >
          <div class="testa">
            <span class="numero" aria-hidden="true">{{ r.ordineGiro ?? i + 1 }}</span>
            <strong>{{ r.produttore.nome }}</strong>
            <app-pillola-stato
              [tono]="tono(r.statoVisibile)"
              [testo]="etichettaStato(r.statoVisibile)"
            />
          </div>
          <a
            class="indirizzo"
            target="_blank"
            rel="noopener noreferrer"
            [href]="mappe(r)"
            [attr.data-testid]="'rg-mappa-' + r.id"
            >{{ r.produttore.indirizzo }}</a
          >
          <p class="dati">
            <span class="cer">{{ r.cerCode }}</span> {{ r.descrizione }} ·
            <strong>{{ quantita(r.quantitaPresunta) }} {{ r.unita }}</strong>
            <span *ngIf="r.fascia"> · {{ fascia(r.fascia) }}</span>
          </p>
          <p class="nota" *ngIf="r.motivo" [attr.data-testid]="'rg-motivo-' + r.id">
            Motivo: {{ r.motivo }}
          </p>
          <div class="azioni" *ngIf="r.stato !== 'ANNULLATO'">
            <p-button
              *ngIf="r.fir"
              label="PDF del FIR"
              icon="pi pi-file-pdf"
              [outlined]="true"
              [loading]="pdfInCorso() === r.id"
              [disabled]="pdfInCorso() !== null"
              (onClick)="apriPdf(r)"
              [attr.data-testid]="'rg-pdf-' + r.id"
            ></p-button>
            <p-button
              *ngIf="puoSegnare() && r.stato === 'PROGRAMMATO' && !r.fir"
              label="Non eseguito"
              icon="pi pi-times"
              severity="secondary"
              [outlined]="true"
              (onClick)="pendente.set(r)"
              [attr.data-testid]="'rg-ne-' + r.id"
            ></p-button>
          </div>
        </li>
      </ol>
    </section>

    <app-non-eseguito-dialog
      *ngIf="pendente() as p"
      [ritiro]="p"
      (eseguito)="segnato()"
      (chiuso)="pendente.set(null)"
    ></app-non-eseguito-dialog>
  `,
  styles: [
    `
      .giorno {
        max-width: 480px;
        margin: 0 auto;
      }
      .scelta {
        display: grid;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .field > label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .schede {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .scheda {
        border: 1px solid var(--border-color, #d6d3d1);
        border-radius: var(--radius-md, 8px);
        padding: var(--spacing-base);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        min-width: 0;
      }
      .testa {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .numero {
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-semibold, 600);
        color: var(--text-secondary);
      }
      .indirizzo {
        overflow-wrap: anywhere;
        padding: 0.5rem 0;
      }
      .dati,
      .nota {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
      .cer {
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-medium);
      }
      .field-error {
        color: var(--color-danger);
        font-size: var(--font-size-sm);
      }
      .azioni {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
    `,
  ],
})
export class RitiriGiornoComponent implements OnInit {
  private readonly servizio = inject(RitiriService)
  private readonly pese = inject(PeseService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly data = signal(oggiIso())
  readonly mezzoId = signal('')
  readonly mezzi = signal<{ id: string; targa: string }[]>([])
  readonly righe = signal<RitiroVista[]>([])
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly pdfInCorso = signal<string | null>(null)
  readonly pendente = signal<RitiroVista | null>(null)
  readonly puoSegnare = computed(() => puoCreareFir(this.auth.currentUser()?.role))

  readonly quantita = quantitaItaliana
  readonly tono = (s: StatoVisibileRitiro) => TONO_STATO_RITIRO[s]
  readonly etichettaStato = (s: StatoVisibileRitiro): string => ETICHETTA_STATO[s]
  readonly fascia = (f: keyof typeof ETICHETTA_FASCIA): string => ETICHETTA_FASCIA[f]

  ngOnInit(): void {
    // Senza il modulo pese l'elenco dei mezzi non c'è: resta «Tutti i mezzi».
    this.pese.elencaAutomezzi().subscribe({
      next: e => this.mezzi.set(e.righe.map(m => ({ id: m.id, targa: m.targa }))),
      error: () => this.mezzi.set([]),
    })
    this.carica()
  }

  cambiaData(d: string | null): void {
    if (!d) return
    this.data.set(d)
    this.carica()
  }

  cambiaMezzo(id: string): void {
    this.mezzoId.set(id ?? '')
    this.carica()
  }

  mappe(r: RitiroVista): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.produttore.indirizzo)}`
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.servizio
      .elenca({
        dal: this.data(),
        al: this.data(),
        automezzoId: this.mezzoId() || undefined,
        dimensione: 100,
      })
      .subscribe({
        next: e => {
          this.caricamento.set(false)
          this.righe.set(ordinaGiro(e.righe.filter(r => r.stato !== 'ANNULLATO')))
        },
        error: err => {
          this.caricamento.set(false)
          this.righe.set([])
          this.errore.set(messaggioErroreRitiri(err, 'Impossibile caricare i ritiri.'))
        },
      })
  }

  segnato(): void {
    this.pendente.set(null)
    this.toast.success('Ritiro segnato come non eseguito.')
    this.carica()
  }

  apriPdf(r: RitiroVista): void {
    if (!r.fir || this.pdfInCorso() !== null) return
    this.pdfInCorso.set(r.id)
    this.servizio.scaricaPdfFir(r.fir.id).subscribe({
      next: risposta => {
        this.pdfInCorso.set(null)
        if (!risposta.body) {
          this.toast.info('PDF non disponibile.')
          return
        }
        const url = URL.createObjectURL(risposta.body)
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener'
        a.download = `FIR-${r.fir?.numero ?? r.fir?.id}.pdf`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      },
      error: err => {
        this.pdfInCorso.set(null)
        this.toast.error(messaggioErroreRitiri(err, 'Impossibile scaricare il PDF.'))
      },
    })
  }
}
