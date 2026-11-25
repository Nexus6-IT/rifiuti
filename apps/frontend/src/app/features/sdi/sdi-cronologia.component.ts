import { CommonModule } from '@angular/common'
import { Component, DestroyRef, Input, OnChanges, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { pollingTransitorio } from '../fatturazione/elaborazioni/polling-transitorio'
import { erroreDaBlob, salvaFile } from '../fatturazione/download-fatturazione'
import { FatturazioneService } from '../fatturazione/fatturazione.service'
import { messaggioDaCodice } from '../fatturazione/messaggio-da-codice'
import {
  AVVISI_TRASMISSIONE_ETICHETTE,
  ESITI_COMMITTENTE_ETICHETTE,
  ESITI_FISCALI_SDI_ETICHETTE,
  FONTI_NOTIFICA_ETICHETTE,
  NotificaSdi,
  STATI_SDI_DA_SEGUIRE,
  STATI_SDI_VOCI,
  StatoSdiDocumento,
  TIPI_NOTIFICA_SDI_ETICHETTE,
  TrasmissioneSdi,
} from './sdi.model'

export const MSG_SDI_NON_CARICATO = 'Impossibile caricare lo stato dell’invio allo SDI.'
export const MSG_RICEVUTA_NON_SCARICATA = 'Impossibile scaricare la ricevuta.'
/** Attesa fra due letture mentre l'invio e' in corso. */
export const INTERVALLO_POLLING_CRONOLOGIA_MS = 5000
/** Letture automatiche al massimo (dieci minuti): poi serve «Aggiorna», una fattura puo' restare «Inviata» per ore. */
export const MAX_LETTURE_CRONOLOGIA = 120

type SeveritaTag = 'success' | 'info' | 'warning' | 'danger'
const SEVERITA_TAG = {
  successo: 'success',
  info: 'info',
  avviso: 'warning',
  errore: 'danger',
} as const satisfies Record<string, SeveritaTag>

/**
 * Cronologia dell'invio allo SDI di un documento (4.5c): stato, esito fiscale, avvisi e la tabella
 * delle notifiche ricevute con il download dell'XML di ogni ricevuta. Si vede solo con il modulo
 * `sdi`; si rilegge da sola finche' la trasmissione non ha una ricevuta (con un tetto di letture).
 */
@Component({
  selector: 'app-sdi-cronologia',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, TagModule],
  template: `
    <section *ngIf="attivo()" class="sc" aria-labelledby="sc-titolo" data-testid="sc">
      <div class="sc__testata">
        <h2 id="sc-titolo" class="sc__titolo">Invio allo SDI</h2>
        <p-button
          label="Aggiorna"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          [disabled]="caricamento()"
          (onClick)="leggi()"
          data-testid="sc-aggiorna"
        />
      </div>
      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="sc-errore">{{ e }}</p>
      <p *ngIf="esito() as e" role="alert" class="field-error" data-testid="sc-esito">{{ e }}</p>
      <p
        *ngIf="stato() && stato()!.trasmissioni.length === 0"
        class="text-secondary"
        data-testid="sc-vuoto"
      >
        Il documento non è mai stato inviato allo SDI.
      </p>

      <article
        *ngFor="let t of stato()?.trasmissioni; let primo = first"
        class="sc__trasmissione"
        [attr.data-testid]="'sc-trasmissione'"
      >
        <header class="sc__riga">
          <p-tag [value]="voce(t).etichetta" [severity]="severita(t)" data-testid="sc-stato" />
          <span class="sc__esito" data-testid="sc-esito-fiscale">{{ esitoFiscale(t) }}</span>
          <small class="text-secondary" data-testid="sc-file">
            {{ t.nomeFile }}<ng-container *ngIf="!primo"> · tentativo precedente</ng-container>
          </small>
        </header>
        <ul class="sc__avvisi" *ngIf="t.avvisi.length" data-testid="sc-avvisi">
          <li *ngFor="let a of t.avvisi">
            <p-tag severity="warning" [value]="avviso(a)" />
          </li>
        </ul>
        <p
          *ngIf="t.stato === 'ERRORE_INVIO' && t.ultimoErroreCodice"
          class="text-secondary"
          data-testid="sc-errore-invio"
        >
          Invio non riuscito (codice {{ t.ultimoErroreCodice }}).
          <ng-container *ngIf="t.ultimoErroreMessaggio">{{ t.ultimoErroreMessaggio }}</ng-container>
        </p>

        <p-table
          *ngIf="t.notifiche.length"
          [value]="t.notifiche"
          styleClass="p-datatable-sm"
          aria-label="Notifiche ricevute dallo SDI"
          data-testid="sc-notifiche"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Data SDI</th>
              <th scope="col">Notifica</th>
              <th scope="col">Dettaglio</th>
              <th scope="col">Fonte</th>
              <th scope="col"><span class="sr-only">Ricevuta</span></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-n>
            <tr>
              <td>{{ n.dataRicezioneSdi ?? n.ricevutaIl | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ tipo(n) }}</td>
              <td>
                <span *ngIf="n.esitoCommittente">{{ esitoCommittente(n) }}</span>
                <ul class="sc__codici" *ngIf="n.codiciErrore.length">
                  <li *ngFor="let c of n.codiciErrore">
                    <strong>{{ c.codice }}</strong> — {{ c.descrizione }}
                  </li>
                </ul>
              </td>
              <td>{{ fonte(n) }}</td>
              <td>
                <p-button
                  *ngIf="n.haFile"
                  label="XML"
                  icon="pi pi-download"
                  [text]="true"
                  size="small"
                  [disabled]="inScarico()"
                  (onClick)="scarica(n)"
                  data-testid="sc-ricevuta"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
        <p
          *ngIf="!t.notifiche.length && t.stato === 'INVIATA'"
          class="text-secondary"
          data-testid="sc-in-attesa"
        >
          In attesa della ricevuta dallo SDI.
        </p>
      </article>
    </section>
  `,
  styles: [
    `
      .sc {
        margin-top: var(--spacing-lg);
      }
      .sc__testata,
      .sc__riga {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .sc__titolo {
        margin: 0;
        font-size: 1rem;
      }
      .sc__trasmissione {
        margin-top: var(--spacing-sm);
      }
      .sc__avvisi,
      .sc__codici {
        list-style: none;
        padding: 0;
        margin: var(--spacing-xs) 0;
      }
    `,
  ],
})
export class SdiCronologiaComponent implements OnChanges {
  private readonly servizio = inject(FatturazioneService)
  private readonly funzioni = inject(FeatureFlagsService)
  private readonly destroyRef = inject(DestroyRef)

  @Input({ required: true }) documentoId = ''

  readonly attivo = computed(() => this.funzioni.has('sdi'))
  readonly stato = signal<StatoSdiDocumento | null>(null)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly esito = signal<string | null>(null)
  readonly inScarico = signal(false)

  readonly voce = (t: TrasmissioneSdi) => STATI_SDI_VOCI[t.stato]
  readonly severita = (t: TrasmissioneSdi): SeveritaTag =>
    SEVERITA_TAG[STATI_SDI_VOCI[t.stato].severita]
  readonly esitoFiscale = (t: TrasmissioneSdi): string =>
    ESITI_FISCALI_SDI_ETICHETTE[t.esitoFiscale]
  readonly avviso = (a: keyof typeof AVVISI_TRASMISSIONE_ETICHETTE): string =>
    AVVISI_TRASMISSIONE_ETICHETTE[a]
  readonly tipo = (n: NotificaSdi): string => TIPI_NOTIFICA_SDI_ETICHETTE[n.tipo]
  readonly esitoCommittente = (n: NotificaSdi): string =>
    n.esitoCommittente ? ESITI_COMMITTENTE_ETICHETTE[n.esitoCommittente] : ''
  readonly fonte = (n: NotificaSdi): string => FONTI_NOTIFICA_ETICHETTE[n.fonte]
  /** Salvataggio del file: sostituibile nei test. */
  salva = salvaFile

  private lettura: Subscription | null = null

  constructor() {
    this.destroyRef.onDestroy(() => this.lettura?.unsubscribe())
  }

  ngOnChanges(): void {
    this.stato.set(null)
    this.esito.set(null)
    this.leggi()
  }

  /** Legge e, finche' l'invio e' in corso, rilegge ogni 5 secondi (al massimo 10 minuti). */
  leggi(): void {
    this.lettura?.unsubscribe()
    if (!this.attivo() || this.documentoId === '') return
    this.caricamento.set(true)
    this.errore.set(null)
    let letture = 0
    this.lettura = pollingTransitorio(
      () => this.servizio.statoSdi(this.documentoId),
      s => ++letture < MAX_LETTURE_CRONOLOGIA && this.daSeguire(s),
      { intervalloMs: INTERVALLO_POLLING_CRONOLOGIA_MS }
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: s => {
          this.stato.set(s)
          this.caricamento.set(false)
        },
        error: err => {
          this.caricamento.set(false)
          this.errore.set(messaggioDaCodice(err, MSG_SDI_NON_CARICATO))
        },
      })
  }

  /** Vero se la trasmissione piu' recente non ha ancora una ricevuta. */
  private daSeguire(s: StatoSdiDocumento): boolean {
    const t = s.trasmissioni[0]
    return t !== undefined && STATI_SDI_DA_SEGUIRE.includes(t.stato)
  }

  scarica(n: NotificaSdi): void {
    if (this.inScarico()) return
    this.inScarico.set(true)
    this.esito.set(null)
    this.servizio
      .scaricaRicevutaSdi(this.documentoId, n.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: file => {
          this.inScarico.set(false)
          this.salva(file, `ricevuta-${n.tipo}.xml`)
        },
        error: (err: unknown) =>
          void erroreDaBlob(err).then(e => {
            this.inScarico.set(false)
            this.esito.set(messaggioDaCodice(e, MSG_RICEVUTA_NON_SCARICATA))
          }),
      })
  }
}
