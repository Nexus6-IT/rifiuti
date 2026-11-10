/**
 * Esito della generazione dei FIR in bozza, riga per riga: creato, già generato (un lotto
 * rilanciato non crea doppioni) oppure errore col motivo. Nessuna emissione e nessuna
 * trasmissione a RENTRI in questo passo: le bozze si correggono dal FIR e si emettono dopo.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { PillolaStatoComponent } from '../../shared/components/pillola-stato.component'
import { TonoStato } from '../../shared/models/stati-fir'
import {
  dataItaliana,
  EsitoGenerazione,
  EsitoGenerazioneRiga,
  MESSAGGI_CODICE_ESITO,
  RitiroVista,
} from './ritiri.model'

const TESTO_ESITO: Record<EsitoGenerazione, string> = {
  CREATO: 'Bozza creata',
  GIA_GENERATO: 'Già generato',
  ERRORE: 'Errore',
}
const TONO_ESITO: Record<EsitoGenerazione, TonoStato> = {
  CREATO: 'ok',
  GIA_GENERATO: 'none',
  ERRORE: 'err',
}

@Component({
  selector: 'app-esito-generazione-dialog',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonModule, DialogModule, PillolaStatoComponent],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      header="Esito della generazione dei FIR"
      [modal]="true"
      [style]="{ width: '860px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi l'esito della generazione"
    >
      <p class="riepilogo" role="status" data-testid="eg-riepilogo">
        {{ conteggi().CREATO }} bozze create, {{ conteggi().GIA_GENERATO }} già generate,
        {{ conteggi().ERRORE }} con errore.
      </p>
      <div class="table-responsive">
        <table class="tabella" data-testid="eg-tabella">
          <caption class="solo-lettori">
            Esito per ritiro
          </caption>
          <thead>
            <tr>
              <th scope="col">Ritiro</th>
              <th scope="col">Esito</th>
              <th scope="col">Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let e of esiti" [attr.data-testid]="'eg-riga-' + e.ritiroId">
              <td>{{ descrizione(e.ritiroId) }}</td>
              <td>
                <app-pillola-stato [tono]="tono(e)" [testo]="testo(e)" />
              </td>
              <td>
                <a
                  *ngIf="e.firId"
                  [routerLink]="['/fir', e.firId]"
                  [attr.data-testid]="'eg-fir-' + e.ritiroId"
                  [attr.aria-label]="'Apri la bozza del FIR del ritiro ' + descrizione(e.ritiroId)"
                  >Apri il FIR</a
                >
                <span *ngIf="e.esito === 'ERRORE'" class="errore">{{ messaggio(e) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="azioni">
        <p-button
          label="Chiudi"
          styleClass="wf-primario"
          (onClick)="chiuso.emit()"
          data-testid="eg-chiudi"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .riepilogo {
        margin: 0 0 var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .tabella th,
      .tabella td {
        text-align: left;
        padding: var(--spacing-sm);
        border-bottom: 1px solid var(--rule);
        vertical-align: middle;
      }
      .tabella th {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
        border-bottom-color: var(--surface-border);
      }
      .errore {
        color: var(--color-danger);
        font-weight: var(--font-weight-medium);
      }
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .azioni {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--spacing-base);
      }
    `,
  ],
})
export class EsitoGenerazioneDialogComponent {
  @Input({ required: true }) set esiti(v: EsitoGenerazioneRiga[]) {
    this._esiti = v
    this.conteggi.set({
      CREATO: v.filter(e => e.esito === 'CREATO').length,
      GIA_GENERATO: v.filter(e => e.esito === 'GIA_GENERATO').length,
      ERRORE: v.filter(e => e.esito === 'ERRORE').length,
    })
  }
  get esiti(): EsitoGenerazioneRiga[] {
    return this._esiti
  }
  /** I ritiri dell'elenco, per mostrare data, produttore e CER invece dell'id. */
  @Input() ritiri: RitiroVista[] = []
  @Output() chiuso = new EventEmitter<void>()

  private _esiti: EsitoGenerazioneRiga[] = []
  readonly conteggi = signal<Record<EsitoGenerazione, number>>({
    CREATO: 0,
    GIA_GENERATO: 0,
    ERRORE: 0,
  })
  readonly totale = computed(() => this._esiti.length)

  testo(e: EsitoGenerazioneRiga): string {
    return TESTO_ESITO[e.esito]
  }
  tono(e: EsitoGenerazioneRiga): TonoStato {
    return TONO_ESITO[e.esito]
  }

  /** Il messaggio del backend, altrimenti la frase del codice, mai l'id. */
  messaggio(e: EsitoGenerazioneRiga): string {
    return (
      e.messaggio?.trim() || MESSAGGI_CODICE_ESITO[e.codice ?? ''] || 'Errore nella generazione.'
    )
  }

  descrizione(id: string): string {
    const r = this.ritiri.find(x => x.id === id)
    return r
      ? `${dataItaliana(r.dataPrevista)} · ${r.produttore.nome} · CER ${r.cerCode}`
      : 'Ritiro'
  }
}
