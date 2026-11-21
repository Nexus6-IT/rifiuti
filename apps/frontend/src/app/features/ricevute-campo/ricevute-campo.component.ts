/**
 * «Ricevute di ritiro» (app campo, P6): le ricevute che i clienti hanno firmato sullo schermo del
 * telefono dell'autista. Archivio in sola lettura: l'ufficio scarica il PDF archiviato (lo stesso
 * file firmato, con la sua impronta SHA-256).
 *
 * Valore: firma elettronica SEMPLICE (immagine del tratto), prova commerciale. Non e' una firma
 * qualificata e la ricevuta NON sostituisce il FIR: la pagina lo dice, come il PDF.
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { messaggioErroreRitiri } from '../ritiri/ritiri.model'
import { RicevuteCampoService, RicevutaCampo } from './ricevute-campo.service'

const PER_PAGINA = 50

@Component({
  selector: 'app-ricevute-campo',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule],
  template: `
    <div class="rc-pagina">
      <div>
        <h1 class="rc-titolo">Ricevute di ritiro</h1>
        <p class="rc-nota" data-testid="rc-avviso">
          Le ricevute firmate dai clienti sul telefono dell'autista.
          <strong>Non sostituiscono il FIR.</strong> La firma è un'immagine del tratto con nome e
          ora (firma elettronica semplice, non qualificata): vale come prova commerciale del ritiro.
          Ogni PDF ha la sua impronta SHA-256, che il sistema ricontrolla a ogni scarico.
        </p>
      </div>

      <p *ngIf="caricamento()" role="status" class="rc-nota">Caricamento…</p>
      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="rc-errore">{{ e }}</p>

      <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="rc-tabella">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Ricevuta</th>
            <th scope="col">Ritiro</th>
            <th scope="col">Firmata da</th>
            <th scope="col">Copia al cliente</th>
            <th scope="col">PDF</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr [attr.data-testid]="'rc-riga-' + r.id">
            <td>
              {{ r.ricevutoIl | date: 'dd/MM/yyyy HH:mm' }}
              <div class="rc-nota">
                firmata sul telefono: {{ r.firmatoIl | date: 'dd/MM HH:mm' }}
              </div>
            </td>
            <td>
              <strong>{{ r.cliente }}</strong>
              <div class="rc-nota">
                {{ r.dataRitiro | date: 'dd/MM/yyyy' }} · {{ r.cerCode }} · {{ r.descrizione }}
              </div>
              <div class="rc-nota">Autista: {{ r.autista }}</div>
            </td>
            <td>
              {{ r.firmatarioNome }}
              <div class="rc-nota">firma elettronica semplice</div>
            </td>
            <td [attr.data-testid]="'rc-invio-' + r.id">
              <ng-container *ngIf="r.invio as i; else nonInviata">
                <span class="rc-badge" [class.rc-badge-attenzione]="i.esito === 'FALLITO'">
                  {{ i.esito === 'INVIATO' ? 'Inviata' : 'Invio non riuscito' }}
                </span>
                <div class="rc-nota">{{ i.destinatario }}</div>
              </ng-container>
              <ng-template #nonInviata><span class="rc-nota">Non inviata</span></ng-template>
            </td>
            <td>
              <p-button
                label="Scarica"
                icon="pi pi-download"
                [text]="true"
                (onClick)="scarica(r)"
                [attr.data-testid]="'rc-scarica-' + r.id"
              ></p-button>
              <div
                class="rc-nota rc-impronta"
                [attr.title]="r.pdfSha256"
                [attr.data-testid]="'rc-impronta-' + r.id"
              >
                SHA-256 {{ r.pdfSha256.slice(0, 12) }}… · {{ kb(r.dimensionePdf) }} kB
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5">
              <span data-testid="rc-vuota">Nessuna ricevuta firmata dal campo.</span>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <div class="rc-paginazione" *ngIf="totale() > perPagina">
        <p-button
          label="Precedente"
          icon="pi pi-chevron-left"
          [text]="true"
          [disabled]="pagina() <= 1"
          (onClick)="vai(pagina() - 1)"
          data-testid="rc-precedente"
        ></p-button>
        <span class="rc-nota" data-testid="rc-pagina">
          Pagina {{ pagina() }} di {{ pagine() }} · {{ totale() }} ricevute
        </span>
        <p-button
          label="Successiva"
          icon="pi pi-chevron-right"
          iconPos="right"
          [text]="true"
          [disabled]="pagina() >= pagine()"
          (onClick)="vai(pagina() + 1)"
          data-testid="rc-successiva"
        ></p-button>
      </div>
    </div>
  `,
  styles: [
    `
      .rc-pagina {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .rc-titolo {
        margin: 0;
      }
      .rc-nota {
        margin: 0;
        color: var(--text-secondary, #555);
        font-size: 0.875rem;
      }
      .rc-impronta {
        font-family: monospace;
      }
      .rc-badge {
        display: inline-block;
        padding: 0.1rem 0.6rem;
        border-radius: 999px;
        background: #e5f1e8;
        color: #14532d;
        font-weight: 600;
        font-size: 0.8rem;
      }
      .rc-badge-attenzione {
        background: #fff4d6;
        color: #5c3d00;
        border: 1px solid #c58b00;
      }
      .rc-paginazione {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-base);
      }
    `,
  ],
})
export class RicevuteCampoComponent implements OnInit {
  private readonly servizio = inject(RicevuteCampoService)

  readonly perPagina = PER_PAGINA
  readonly righe = signal<RicevutaCampo[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  vai(pagina: number): void {
    this.pagina.set(Math.min(Math.max(pagina, 1), this.pagine()))
    this.carica()
  }

  pagine(): number {
    return Math.max(1, Math.ceil(this.totale() / PER_PAGINA))
  }

  kb(byte: number): string {
    return (byte / 1024).toFixed(0)
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.servizio.elenca(this.pagina()).subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.totale.set(e.totale)
        this.caricamento.set(false)
      },
      error: err => {
        this.righe.set([])
        this.totale.set(0)
        this.caricamento.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Impossibile leggere le ricevute di ritiro.'))
      },
    })
  }

  scarica(r: RicevutaCampo): void {
    this.errore.set(null)
    this.servizio.scarica(r.id).subscribe({
      next: f => this.salva(f.blob, f.nomeFile),
      error: () =>
        this.errore.set(
          'Download non riuscito: il file potrebbe non essere integro. Riprova o avvisa l’assistenza.'
        ),
    })
  }

  /** Salva il blob; separato per poterlo sostituire nei test. */
  protected salva(blob: Blob, nome: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.rel = 'noopener'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
