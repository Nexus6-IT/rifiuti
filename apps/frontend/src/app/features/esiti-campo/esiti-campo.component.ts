/**
 * «Esiti dal campo» (app campo, P4): gli esiti inviati dagli autisti dal telefono. In evidenza i
 * «da riconciliare»: esiti veri, registrati e mai persi, che non si sono potuti applicare al ritiro
 * (annullato, modificato o riassegnato in ufficio mentre l'autista era in giro). Sola lettura:
 * la decisione su cosa fare del ritiro resta all'ufficio.
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { messaggioErroreRitiri } from '../ritiri/ritiri.model'
import {
  EsitiCampoService,
  EsitoCampo,
  EsitoEventoCampo,
  spiegaConflitto,
} from './esiti-campo.service'

const PER_PAGINA = 50

@Component({
  selector: 'app-esiti-campo',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule],
  template: `
    <div class="ec-pagina">
      <div>
        <h1 class="ec-titolo">Esiti dal campo</h1>
        <p class="ec-nota">
          Gli esiti che gli autisti hanno inviato dall'app. I <strong>da riconciliare</strong> non
          si sono potuti applicare al ritiro perché in ufficio è cambiato qualcosa nel frattempo:
          l'esito è registrato, decidi tu cosa farne.
        </p>
      </div>

      <div class="ec-filtri" role="group" aria-label="Filtra gli esiti">
        <button
          type="button"
          class="ec-filtro"
          [class.attivo]="filtro() === 'DA_RICONCILIARE'"
          [attr.aria-pressed]="filtro() === 'DA_RICONCILIARE'"
          (click)="imposta('DA_RICONCILIARE')"
          data-testid="ec-filtro-riconciliare"
        >
          Da riconciliare
        </button>
        <button
          type="button"
          class="ec-filtro"
          [class.attivo]="filtro() === 'APPLICATO'"
          [attr.aria-pressed]="filtro() === 'APPLICATO'"
          (click)="imposta('APPLICATO')"
          data-testid="ec-filtro-applicati"
        >
          Applicati
        </button>
        <button
          type="button"
          class="ec-filtro"
          [class.attivo]="filtro() === null"
          [attr.aria-pressed]="filtro() === null"
          (click)="imposta(null)"
          data-testid="ec-filtro-tutti"
        >
          Tutti
        </button>
      </div>

      <p *ngIf="caricamento()" role="status" class="ec-nota">Caricamento…</p>
      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="ec-errore">{{ e }}</p>

      <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="ec-tabella">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Ricevuto</th>
            <th scope="col">Autista</th>
            <th scope="col">Ritiro</th>
            <th scope="col">Esito dichiarato</th>
            <th scope="col">Stato</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr [attr.data-testid]="'ec-riga-' + e.id">
            <td>
              {{ e.ricevutoIl | date: 'dd/MM/yyyy HH:mm' }}
              <div class="ec-nota">sul telefono: {{ e.rilevatoIl | date: 'dd/MM HH:mm' }}</div>
            </td>
            <td>{{ e.autista.nome }}</td>
            <td>
              <strong>{{ e.ritiro.produttore }}</strong>
              <div class="ec-nota">
                {{ e.ritiro.dataPrevista | date: 'dd/MM/yyyy' }} · {{ e.ritiro.cerCode }} ·
                {{ e.ritiro.descrizione }}
              </div>
              <div class="ec-nota" [attr.data-testid]="'ec-stato-ritiro-' + e.id">
                Ora in ufficio: {{ statoRitiro(e.ritiro.stato) }}
              </div>
            </td>
            <td>
              {{ e.tipo === 'RITIRO_ESEGUITO' ? 'Ritiro eseguito' : 'Ritiro non eseguito' }}
              <div class="ec-nota" *ngIf="e.dati.motivo">Motivo: {{ e.dati.motivo }}</div>
              <div class="ec-nota" *ngIf="e.dati.nota">Nota: {{ e.dati.nota }}</div>
            </td>
            <td [attr.data-testid]="'ec-esito-' + e.id">
              <ng-container *ngIf="e.esito === 'DA_RICONCILIARE'; else applicato">
                <span class="ec-badge ec-badge-attenzione">Da riconciliare</span>
                <div class="ec-nota">{{ spiega(e.motivoConflitto) }}</div>
              </ng-container>
              <ng-template #applicato>
                <span class="ec-badge">Applicato</span>
              </ng-template>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5">
              <span data-testid="ec-vuota">{{ messaggioVuoto() }}</span>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <div class="ec-paginazione" *ngIf="totale() > perPagina">
        <p-button
          label="Precedente"
          icon="pi pi-chevron-left"
          [text]="true"
          [disabled]="pagina() <= 1"
          (onClick)="vai(pagina() - 1)"
          data-testid="ec-precedente"
        ></p-button>
        <span class="ec-nota" data-testid="ec-pagina">
          Pagina {{ pagina() }} di {{ pagine() }} · {{ totale() }} esiti
        </span>
        <p-button
          label="Successiva"
          icon="pi pi-chevron-right"
          iconPos="right"
          [text]="true"
          [disabled]="pagina() >= pagine()"
          (onClick)="vai(pagina() + 1)"
          data-testid="ec-successiva"
        ></p-button>
      </div>
    </div>
  `,
  styles: [
    `
      .ec-pagina {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .ec-titolo {
        margin: 0;
      }
      .ec-nota {
        margin: 0;
        color: var(--text-secondary, #555);
        font-size: 0.875rem;
      }
      .ec-filtri {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .ec-filtro {
        min-height: 40px;
        padding: 0 1rem;
        border: 1px solid var(--surface-border, #ccc);
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ec-filtro.attivo {
        background: var(--primary-color, #14532d);
        border-color: var(--primary-color, #14532d);
        color: var(--primary-color-text, #fff);
      }
      .ec-badge {
        display: inline-block;
        padding: 0.1rem 0.6rem;
        border-radius: 999px;
        background: #e5f1e8;
        color: #14532d;
        font-weight: 600;
        font-size: 0.8rem;
      }
      .ec-badge-attenzione {
        background: #fff4d6;
        color: #5c3d00;
        border: 1px solid #c58b00;
      }
      .ec-paginazione {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-base);
      }
    `,
  ],
})
export class EsitiCampoComponent implements OnInit {
  private readonly servizio = inject(EsitiCampoService)

  readonly perPagina = PER_PAGINA
  readonly righe = signal<EsitoCampo[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  readonly filtro = signal<EsitoEventoCampo | null>('DA_RICONCILIARE')
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly spiega = spiegaConflitto

  ngOnInit(): void {
    this.carica()
  }

  imposta(filtro: EsitoEventoCampo | null): void {
    this.filtro.set(filtro)
    this.pagina.set(1)
    this.carica()
  }

  vai(pagina: number): void {
    this.pagina.set(Math.min(Math.max(pagina, 1), this.pagine()))
    this.carica()
  }

  pagine(): number {
    return Math.max(1, Math.ceil(this.totale() / PER_PAGINA))
  }

  messaggioVuoto(): string {
    return this.filtro() === 'DA_RICONCILIARE'
      ? 'Nessun esito da riconciliare.'
      : 'Nessun esito ricevuto dal campo.'
  }

  statoRitiro(stato: string): string {
    switch (stato) {
      case 'PROGRAMMATO':
        return 'programmato'
      case 'NON_ESEGUITO':
        return 'non eseguito'
      case 'ANNULLATO':
        return 'annullato'
      default:
        return stato.toLowerCase()
    }
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.servizio.elenca(this.filtro(), this.pagina()).subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.totale.set(e.totale)
        this.caricamento.set(false)
      },
      error: err => {
        this.righe.set([])
        this.totale.set(0)
        this.caricamento.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Impossibile leggere gli esiti dal campo.'))
      },
    })
  }
}
