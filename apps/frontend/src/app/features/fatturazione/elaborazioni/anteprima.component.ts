import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { EMPTY, Observable, Subject, concat, of, timer } from 'rxjs'
import { catchError, finalize, switchMap, tap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { PaginatorModule, PaginatorState } from 'primeng/paginator'
import { TableModule } from 'primeng/table'
import { TabViewModule } from 'primeng/tabview'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'
import { AuthService } from '../../../core/services/auth.service'
import { formattaGiorno } from '../../giacenze/giorno'
import { importoItaliano } from '../../listino/listino-calcoli'
import { codiceErrore } from '../../listino/errori-azione'
import { messaggioDaCodice } from '../messaggio-da-codice'
import { DocumentoRiga, ElaborazioneDettaglio, StatoElaborazione } from '../fatturazione.model'
import { DIMENSIONE_MASSIMA, FatturazioneService } from '../fatturazione.service'
import { permessiFatturazione } from '../permessi-fatturazione'
import {
  ERRORI_HTTP_VOCI,
  SeveritaFatturazione,
  STATI_ELABORAZIONE_VOCI,
  VoceVocabolario,
  eMotivoDaCollegare,
  voceSegnalazione,
} from '../vocabolario-fatturazione'
import {
  ConfermaDefinitivaDialogComponent,
  RiepilogoConferma,
} from './conferma-definitiva-dialog.component'
import { DocumentoAnteprimaDialogComponent } from './documento-anteprima-dialog.component'

/** Ogni quanto si rilegge l'elaborazione finché è in calcolo o in emissione. */
export const INTERVALLO_AGGIORNAMENTO_MS = 3000

/** Stati in cui il lavoro prosegue sul server: la pagina si aggiorna da sola. */
export const STATI_TRANSITORI: readonly StatoElaborazione[] = [
  'IN_CODA',
  'IN_CORSO',
  'IN_DEFINITIVA',
]

const STATI_CON_DOCUMENTI: readonly StatoElaborazione[] = [
  'ANTEPRIMA_PRONTA',
  'IN_DEFINITIVA',
  'DEFINITIVA',
]

/** 409 che dicono «lo stato non è più quello che vedi». */
const RILEGGI_DOPO = ['VERSIONE_SUPERATA', 'ELABORAZIONE_GIA_IN_DEFINITIVA']

export const MSG_FALLITA =
  'L’elaborazione non è riuscita. Torna all’elenco e avvia una nuova anteprima; se succede ancora, contatta l’assistenza.'
export const MSG_NON_CARICATA = 'Impossibile caricare l’elaborazione.'
export const MSG_DOCUMENTI_NON_CARICATI = 'Impossibile caricare i documenti.'
export const MSG_BLOCCO_GENERALE = 'Correggi gli errori generali dell’elaborazione.'
export const MSG_ANTEPRIMA_INCOMPLETA = 'L’anteprima non è completa: ricalcola.'

type SeveritaTag = 'success' | 'info' | 'warning' | 'danger'
const SEVERITA_TAG: Record<SeveritaFatturazione, SeveritaTag> = {
  successo: 'success',
  info: 'info',
  avviso: 'warning',
  errore: 'danger',
}

/** Esito da mostrare in cima: l'ultimo errore dell'elaborazione o di un'azione appena fatta. */
interface EsitoVista {
  messaggio: string
  differenze: string | null
  /** «Ricalcola» è la via d'uscita (anteprima superata, doppia fatturazione). */
  ricalcola: boolean
}

interface Differenze {
  nuovi: number
  cambiati: number
  fatturatiDaAltri: number
}

function leggiDifferenze(x: unknown): Differenze | null {
  const o = x as { differenze?: unknown } | null
  const d = (o?.differenze ?? x) as Partial<Differenze> | null
  return d &&
    typeof d.nuovi === 'number' &&
    typeof d.cambiati === 'number' &&
    typeof d.fatturatiDaAltri === 'number'
    ? { nuovi: d.nuovi, cambiati: d.cambiati, fatturatiDaAltri: d.fatturatiDaAltri }
    : null
}

const testoDifferenze = (d: Differenze): string =>
  `Differenze: ${d.nuovi} nuovi, ${d.cambiati} cambiati, ${d.fatturatiDaAltri} già fatturati da altri.`

/** Gruppo della scheda «Errori del periodo»: stesso motivo, contratti diversi. */
interface GruppoErrori {
  motivo: string
  quanti: number
  /** `true` se il motivo è uno stato della lista «da collegare»: solo allora c'è il link. */
  conLink: boolean
  /** Una voce per contratto; `contrattoId` nullo = movimenti senza contratto. */
  voci: { contrattoId: string | null; quanti: number }[]
}

/**
 * Anteprima dell'elaborazione e definitiva (4.4c, Task 32): schede «Documenti», «Errori del
 * periodo» e «Numerazione prevista», barra «Ricalcola», «Scarta», «Rendi definitiva». Finché lo
 * stato è `IN_CODA`, `IN_CORSO` o `IN_DEFINITIVA` rilegge ogni 3 secondi, senza richieste
 * sovrapposte, e smette quando la pagina viene distrutta.
 */
@Component({
  selector: 'app-anteprima',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    PaginatorModule,
    TableModule,
    TabViewModule,
    TagModule,
    TooltipModule,
    ConfermaDefinitivaDialogComponent,
    DocumentoAnteprimaDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <a routerLink="/fatturazione/elaborazioni" class="an-indietro" data-testid="an-indietro"
            >← Elaborazioni</a
          >
          <h1 class="page-title">Anteprima dell'elaborazione</h1>
          <p class="page-subtitle" *ngIf="dettaglio() as d" data-testid="an-periodo">
            Periodo dal {{ giorno(d.periodoDal) }} al {{ giorno(d.periodoAl) }} · documenti del
            {{ giorno(d.dataDocumento) }}
          </p>
        </div>
        <div class="page-actions" *ngIf="dettaglio() as d" data-testid="an-barra">
          <p-tag
            [value]="voceStato(d.stato).etichetta"
            [severity]="severita(voceStato(d.stato))"
            data-testid="an-stato"
          />
          <p-button
            *ngIf="puoPreparare()"
            label="Ricalcola"
            icon="pi pi-refresh"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="ricalcola()"
            data-testid="btn-ricalcola"
          />
          <p-button
            *ngIf="puoPreparare()"
            label="Scarta"
            icon="pi pi-trash"
            severity="danger"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="scartaAperta.set(true)"
            data-testid="btn-scarta"
          />
          <span
            *ngIf="puoRendereDefinitiva()"
            [pTooltip]="motivoDefinitiva() ?? ''"
            [tooltipDisabled]="motivoDefinitiva() === null"
            tooltipPosition="bottom"
            data-testid="definitiva-wrap"
          >
            <p-button
              label="Rendi definitiva"
              icon="pi pi-check"
              [disabled]="motivoDefinitiva() !== null || inAzione()"
              (onClick)="confermaAperta.set(true)"
              data-testid="btn-definitiva"
            />
          </span>
        </div>
      </header>

      <p
        *ngIf="puoRendereDefinitiva() && motivoDefinitiva() as m"
        class="text-secondary"
        data-testid="motivo-definitiva"
      >
        {{ m }}
      </p>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="an-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="an-riprova"
        />
      </p>

      <ng-container *ngIf="dettaglio() as d">
        <p *ngIf="inAttesa()" class="an-attesa" role="status" data-testid="an-attesa">
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          {{
            d.stato === 'IN_DEFINITIVA'
              ? 'Emissione in corso: la pagina si aggiorna da sola.'
              : 'Calcolo dell’anteprima in corso: la pagina si aggiorna da sola.'
          }}
        </p>

        <p *ngIf="d.stato === 'FALLITA'" role="alert" class="field-error" data-testid="an-fallita">
          {{ msgFallita }}
        </p>
        <p *ngIf="d.stato === 'SCARTATA'" class="text-secondary" data-testid="an-scartata">
          Questa anteprima è stata scartata.
        </p>
        <p *ngIf="d.stato === 'DEFINITIVA'" class="an-ok" role="status" data-testid="an-definitiva">
          Le fatture sono state emesse.
        </p>

        <div *ngIf="esito() as e" class="an-esito" role="alert" data-testid="an-esito">
          <p data-testid="an-esito-messaggio">{{ e.messaggio }}</p>
          <p *ngIf="e.differenze" data-testid="an-esito-differenze">{{ e.differenze }}</p>
          <p-button
            *ngIf="e.ricalcola && puoPreparare()"
            label="Ricalcola"
            icon="pi pi-refresh"
            size="small"
            [disabled]="inAzione()"
            (onClick)="ricalcola()"
            data-testid="esito-ricalcola"
          />
        </div>

        <ul class="an-generali" *ngIf="d.erroriGenerali.length" data-testid="an-errori-generali">
          <li *ngFor="let s of d.erroriGenerali">
            <p-tag [severity]="severita(voce(s.codice))" [value]="voce(s.codice).etichetta" />
          </li>
        </ul>

        <ng-container *ngIf="conTabelle()">
          <dl class="an-riepilogo" data-testid="an-riepilogo">
            <div>
              <dt>Documenti</dt>
              <dd>{{ d.documenti }}</dd>
            </div>
            <div>
              <dt>Totale</dt>
              <dd>{{ importo(d.totale) }}</dd>
            </div>
            <div>
              <dt>Con errori</dt>
              <dd>{{ d.errori }}</dd>
            </div>
            <div>
              <dt>Con avvisi</dt>
              <dd>{{ d.avvisi }}</dd>
            </div>
          </dl>

          <p-tabView>
            <p-tabPanel [header]="'Documenti (' + d.documenti + ')'">
              <div class="table-card" data-testid="tab-documenti">
                <p
                  *ngIf="erroreDocumenti() as e"
                  role="alert"
                  class="field-error"
                  data-testid="documenti-errore"
                >
                  {{ e }}
                </p>
                <p-table
                  [value]="documenti()"
                  [loading]="caricamentoDocumenti()"
                  dataKey="id"
                  styleClass="p-datatable-sm"
                  aria-label="Documenti dell'anteprima"
                >
                  <ng-template pTemplate="header">
                    <tr>
                      <th scope="col">Cliente</th>
                      <th scope="col">Contratto</th>
                      <th scope="col">Registro</th>
                      <th scope="col" class="num-col">Imponibile</th>
                      <th scope="col" class="num-col">IVA</th>
                      <th scope="col" class="num-col">Totale</th>
                      <th scope="col">Segnalazioni</th>
                      <th scope="col"><span class="sr-only">Azioni</span></th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-r>
                    <tr
                      [attr.data-testid]="'documento-' + r.id"
                      [class.an-escluso]="r.esclusoDaDefinitiva"
                    >
                      <td>
                        {{ r.cliente.denominazione }}
                        <p-tag
                          *ngIf="r.esclusoDaDefinitiva"
                          severity="warning"
                          value="Escluso"
                          data-testid="doc-escluso"
                        />
                      </td>
                      <td class="cell-nowrap">{{ r.contratto.numero }}</td>
                      <td>{{ r.registro.codice }}</td>
                      <td class="num-col" data-testid="doc-imponibile">
                        {{ importo(r.totaleImponibile) }}
                      </td>
                      <td class="num-col" data-testid="doc-iva">{{ importo(r.totaleIva) }}</td>
                      <td class="num-col" data-testid="doc-totale">
                        {{ importo(r.totaleDocumento) }}
                      </td>
                      <td data-testid="doc-segnalazioni">
                        <ul class="an-segnalazioni">
                          <li *ngFor="let s of r.errori">
                            <p-tag severity="danger" [value]="voce(s.codice).etichetta" />
                          </li>
                          <li *ngFor="let s of r.avvisi">
                            <p-tag severity="warning" [value]="voce(s.codice).etichetta" />
                          </li>
                        </ul>
                      </td>
                      <td class="cell-nowrap">
                        <p-button
                          label="Dettaglio"
                          icon="pi pi-eye"
                          [text]="true"
                          size="small"
                          (onClick)="documentoAperto.set(r.id)"
                          [attr.data-testid]="'dettaglio-' + r.id"
                        />
                        <ng-container *ngIf="puoModificareDocumenti()">
                          <p-button
                            *ngIf="!r.esclusoDaDefinitiva"
                            label="Escludi"
                            icon="pi pi-minus-circle"
                            [text]="true"
                            size="small"
                            [disabled]="inEsclusione().has(r.id)"
                            (onClick)="escludi(r)"
                            [attr.data-testid]="'escludi-' + r.id"
                          />
                          <p-button
                            *ngIf="r.esclusoDaDefinitiva"
                            label="Riammetti"
                            icon="pi pi-plus-circle"
                            [text]="true"
                            size="small"
                            [disabled]="inEsclusione().has(r.id)"
                            (onClick)="riammetti(r)"
                            [attr.data-testid]="'riammetti-' + r.id"
                          />
                        </ng-container>
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr>
                      <td colspan="8">
                        <div class="empty-state" data-testid="documenti-vuoti">
                          <span class="empty-state__title">Nessun documento.</span>
                        </div>
                      </td>
                    </tr>
                  </ng-template>
                </p-table>
                <p-paginator
                  [first]="(paginaDocumenti() - 1) * dimensione"
                  [rows]="dimensione"
                  [totalRecords]="totaleDocumenti()"
                  (onPageChange)="cambiaPagina($event)"
                  data-testid="documenti-paginatore"
                />

                <section *ngIf="d.documentiNonGenerati.length" data-testid="non-generati">
                  <h3 class="an-titolo">Contratti senza documento</h3>
                  <ul class="an-non-generati">
                    <li *ngFor="let n of d.documentiNonGenerati">
                      {{ n.denominazione }} · contratto {{ n.contrattoNumero }}:
                      <span *ngFor="let s of n.errori; let ultimo = last"
                        >{{ voce(s.codice).etichetta }}{{ ultimo ? '' : ' · ' }}</span
                      >
                    </li>
                  </ul>
                </section>
              </div>
            </p-tabPanel>

            <p-tabPanel [header]="'Errori del periodo (' + totaleErroriPeriodo() + ')'">
              <div data-testid="tab-errori-periodo">
                <p *ngIf="!gruppiErrori().length" class="text-secondary" data-testid="errori-vuoti">
                  Nessun errore nel periodo.
                </p>
                <section
                  *ngFor="let g of gruppiErrori()"
                  class="an-gruppo"
                  data-testid="errori-gruppo"
                >
                  <h3 class="an-titolo">
                    <span data-testid="errori-motivo">{{ voce(g.motivo).etichetta }}</span>
                    <p-tag severity="danger" [value]="'' + g.quanti" data-testid="errori-quanti" />
                  </h3>
                  <ul *ngIf="g.conLink">
                    <li *ngFor="let c of g.voci; let i = index">
                      <a
                        routerLink="/legami/da-collegare"
                        [queryParams]="parametriDaCollegare(g.motivo, c.contrattoId, d)"
                        data-testid="errori-link"
                        >{{ testoLink(c.contrattoId, i, c.quanti) }}</a
                      >
                    </li>
                  </ul>
                </section>
              </div>
            </p-tabPanel>

            <p-tabPanel header="Numerazione prevista">
              <div data-testid="tab-numerazione">
                <p
                  *ngIf="!d.numerazionePrevista.length"
                  class="text-secondary"
                  data-testid="numerazione-vuota"
                >
                  Nessun documento da numerare.
                </p>
                <p-table
                  *ngIf="d.numerazionePrevista.length"
                  [value]="d.numerazionePrevista"
                  styleClass="p-datatable-sm"
                  aria-label="Numerazione prevista"
                >
                  <ng-template pTemplate="header">
                    <tr>
                      <th scope="col">Registro</th>
                      <th scope="col">Numeri</th>
                      <th scope="col" class="num-col">Imponibile</th>
                      <th scope="col" class="num-col">IVA</th>
                      <th scope="col" class="num-col">Totale</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-n>
                    <tr [attr.data-testid]="'numerazione-' + n.registroIvaId">
                      <td>{{ n.codiceRegistro }}</td>
                      <td data-testid="numerazione-intervallo">da {{ n.da }} a {{ n.a }}</td>
                      <td class="num-col">{{ importo(totale(n.registroIvaId, d).imponibile) }}</td>
                      <td class="num-col">{{ importo(totale(n.registroIvaId, d).iva) }}</td>
                      <td class="num-col">{{ importo(totale(n.registroIvaId, d).totale) }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              </div>
            </p-tabPanel>
          </p-tabView>
        </ng-container>
      </ng-container>

      <app-documento-anteprima-dialog
        [visible]="documentoAperto() !== null"
        [documentoId]="documentoAperto()"
        (chiuso)="documentoAperto.set(null)"
      />

      <app-conferma-definitiva-dialog
        *ngIf="puoRendereDefinitiva()"
        [visible]="confermaAperta()"
        [riepilogo]="riepilogoConferma()"
        [inCorso]="inAzione()"
        (confermato)="rendiDefinitiva()"
        (chiuso)="confermaAperta.set(false)"
      />

      <p-dialog
        [visible]="scartaAperta()"
        (visibleChange)="$event ? null : chiudiScarta()"
        header="Scarta l'anteprima"
        [modal]="true"
        [draggable]="false"
        [closable]="!inAzione()"
        [closeOnEscape]="!inAzione()"
        [style]="{ width: '30rem', maxWidth: '96vw' }"
        data-testid="scarta-dialog"
      >
        <p>L'anteprima verrà scartata e i documenti in bozza non saranno più disponibili.</p>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            [disabled]="inAzione()"
            (onClick)="chiudiScarta()"
            data-testid="scarta-annulla"
          />
          <p-button
            label="Scarta"
            severity="danger"
            [disabled]="inAzione()"
            [loading]="inAzione()"
            (onClick)="scarta()"
            data-testid="scarta-conferma"
          />
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      .an-indietro {
        font-size: 0.875rem;
      }
      .an-attesa,
      .an-ok {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .an-esito {
        border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-danger);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
      .an-esito p {
        margin: 0 0 var(--spacing-xs);
      }
      .an-generali,
      .an-segnalazioni {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        list-style: none;
        padding: 0;
        margin: 0 0 var(--spacing-sm);
      }
      .an-riepilogo {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-lg);
        margin: 0 0 var(--spacing-md);
      }
      .an-riepilogo dt {
        font-size: 0.8125rem;
        color: var(--text-secondary);
      }
      .an-riepilogo dd {
        margin: 0;
        font-size: 1.125rem;
        font-variant-numeric: tabular-nums;
      }
      .an-titolo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 1rem;
        margin: var(--spacing-md) 0 var(--spacing-xs);
      }
      .an-escluso td {
        color: var(--text-secondary);
      }
    `,
  ],
})
export class AnteprimaComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly route = inject(ActivatedRoute)
  private readonly auth = inject(AuthService)
  private readonly destroyRef = inject(DestroyRef)

  private readonly id = this.route.snapshot.paramMap.get('id') ?? ''

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly dettaglio = signal<ElaborazioneDettaglio | null>(null)
  readonly errore = signal<string | null>(null)
  readonly esitoAzione = signal<EsitoVista | null>(null)
  readonly inAzione = signal(false)

  readonly documenti = signal<DocumentoRiga[]>([])
  readonly totaleDocumenti = signal(0)
  readonly paginaDocumenti = signal(1)
  /** Mai oltre 100: il backend risponde 400 sopra il tetto. */
  readonly dimensione = Math.min(50, DIMENSIONE_MASSIMA)
  readonly caricamentoDocumenti = signal(false)
  readonly erroreDocumenti = signal<string | null>(null)
  readonly inEsclusione = signal<ReadonlySet<string>>(new Set())

  readonly documentoAperto = signal<string | null>(null)
  readonly confermaAperta = signal(false)
  readonly scartaAperta = signal(false)

  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  readonly msgFallita = MSG_FALLITA
  readonly voce = (codice: string): VoceVocabolario => voceSegnalazione(codice)
  readonly voceStato = (s: StatoElaborazione): VoceVocabolario =>
    STATI_ELABORAZIONE_VOCI[s] ?? { etichetta: s, severita: 'info' }
  readonly severita = (v: VoceVocabolario): SeveritaTag => SEVERITA_TAG[v.severita]

  readonly inAttesa = computed(() => {
    const d = this.dettaglio()
    return d !== null && STATI_TRANSITORI.includes(d.stato)
  })
  /** Le schede ci sono solo quando l'elaborazione ha prodotto qualcosa da mostrare. */
  readonly conTabelle = computed(() => {
    const d = this.dettaglio()
    return d !== null && d.stato !== 'IN_CODA' && d.stato !== 'IN_CORSO' && d.stato !== 'FALLITA'
  })
  readonly puoPreparare = computed(
    () => this.permessi().prepara && this.dettaglio()?.stato === 'ANTEPRIMA_PRONTA'
  )
  readonly puoModificareDocumenti = this.puoPreparare
  readonly puoRendereDefinitiva = computed(
    () => this.permessi().rendeDefinitiva && this.dettaglio()?.stato === 'ANTEPRIMA_PRONTA'
  )

  /** Perché «Rendi definitiva» è disattivato; `null` se si può. */
  readonly motivoDefinitiva = computed<string | null>(() => {
    const d = this.dettaglio()
    if (d === null) return null
    // Il campo può mancare in una risposta di un backend più vecchio: spento.
    if ((d.definitiveAttive as boolean | undefined) !== true) {
      return ERRORI_HTTP_VOCI.DEFINITIVE_NON_ATTIVE.etichetta
    }
    // L'impronta salvata non cambia: la richiesta ricadrebbe nello stesso esito.
    if (d.errore?.codice === 'ANTEPRIMA_SUPERATA') {
      return ERRORI_HTTP_VOCI.ANTEPRIMA_SUPERATA.etichetta
    }
    if (d.impronta === null) return MSG_ANTEPRIMA_INCOMPLETA
    if (d.erroriGenerali.some(e => e.codice !== 'LEGAMI_SENZA_CONTRATTO')) {
      return MSG_BLOCCO_GENERALE
    }
    if (d.numerazionePrevista.length === 0) {
      return ERRORI_HTTP_VOCI.NESSUN_DOCUMENTO_DEFINIBILE.etichetta
    }
    return null
  })

  readonly riepilogoConferma = computed<RiepilogoConferma | null>(() => {
    const d = this.dettaglio()
    if (d === null) return null
    // `quanti` lo calcola il backend alla lettura, con i candidati reali della definitiva.
    let documenti: number | null = 0
    for (const n of d.numerazionePrevista) {
      documenti = documenti !== null && typeof n.quanti === 'number' ? documenti + n.quanti : null
    }
    return {
      documenti,
      registri: d.numerazionePrevista.map(n => ({ codice: n.codiceRegistro, da: n.da, a: n.a })),
      dataDocumento: d.dataDocumento,
    }
  })

  /** Errore di un'azione appena fatta; altrimenti l'esito salvato nell'elaborazione. */
  readonly esito = computed<EsitoVista | null>(() => {
    const azione = this.esitoAzione()
    if (azione !== null) return azione
    const d = this.dettaglio()
    if (d === null || d.stato === 'FALLITA' || d.errore === null) return null
    const voce = voceSegnalazione(d.errore.codice)
    return {
      messaggio:
        d.errore.ultimaData !== undefined
          ? `${voce.etichetta} (ultima fattura del ${formattaGiorno(d.errore.ultimaData)}).`
          : voce.etichetta,
      differenze: d.errore.differenze ? testoDifferenze(d.errore.differenze) : null,
      ricalcola:
        d.errore.codice === 'ANTEPRIMA_SUPERATA' || d.errore.codice === 'DOPPIA_FATTURAZIONE',
    }
  })

  /** Una riga per motivo: i contratti con lo stesso motivo stanno insieme. */
  readonly gruppiErrori = computed<GruppoErrori[]>(() => {
    const per = new Map<string, GruppoErrori>()
    for (const e of this.dettaglio()?.erroriPeriodo ?? []) {
      const g = per.get(e.motivo) ?? {
        motivo: e.motivo,
        quanti: 0,
        conLink: eMotivoDaCollegare(e.motivo),
        voci: [],
      }
      g.quanti += e.quanti
      g.voci.push({ contrattoId: e.contrattoId, quanti: e.quanti })
      per.set(e.motivo, g)
    }
    return [...per.values()]
  })
  readonly totaleErroriPeriodo = computed(() =>
    this.gruppiErrori().reduce((somma, g) => somma + g.quanti, 0)
  )

  /** Una lettura nuova annulla quella pendente (e il suo giro di aggiornamento). */
  private readonly lettura$ = new Subject<void>()
  private readonly documenti$ = new Subject<number>()
  private chiaveDocumenti = ''

  constructor() {
    this.lettura$
      .pipe(
        switchMap(() =>
          this.ciclo().pipe(
            catchError(err => {
              this.errore.set(messaggioDaCodice(err, MSG_NON_CARICATA))
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(d => this.applica(d))

    this.documenti$
      .pipe(
        tap(() => {
          this.caricamentoDocumenti.set(true)
          this.erroreDocumenti.set(null)
        }),
        switchMap(pagina =>
          this.servizio
            .documentiElaborazione(this.id, { pagina, dimensione: this.dimensione })
            .pipe(
              catchError(err => {
                this.caricamentoDocumenti.set(false)
                this.erroreDocumenti.set(messaggioDaCodice(err, MSG_DOCUMENTI_NON_CARICATI))
                return EMPTY
              })
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe(p => {
        this.documenti.set(p.elementi)
        this.totaleDocumenti.set(p.totale)
        this.caricamentoDocumenti.set(false)
      })

    this.carica()
  }

  /** Legge il dettaglio; finché lo stato è transitorio aspetta 3 s dalla risposta e rilegge. */
  private ciclo(): Observable<ElaborazioneDettaglio> {
    return this.servizio
      .dettaglio(this.id)
      .pipe(
        switchMap(d =>
          STATI_TRANSITORI.includes(d.stato)
            ? concat(of(d), timer(INTERVALLO_AGGIORNAMENTO_MS).pipe(switchMap(() => this.ciclo())))
            : of(d)
        )
      )
  }

  private applica(d: ElaborazioneDettaglio): void {
    this.errore.set(null)
    this.dettaglio.set(d)
    const chiave = `${d.stato}:${d.versione}`
    if (chiave !== this.chiaveDocumenti) {
      this.chiaveDocumenti = chiave
      if (STATI_CON_DOCUMENTI.includes(d.stato)) this.documenti$.next(this.paginaDocumenti())
    }
  }

  carica(): void {
    this.lettura$.next()
  }

  cambiaPagina(e: PaginatorState): void {
    this.paginaDocumenti.set((e.page ?? 0) + 1)
    this.documenti$.next(this.paginaDocumenti())
  }

  totale(
    registroIvaId: string,
    d: ElaborazioneDettaglio
  ): { imponibile: string; iva: string; totale: string } {
    return (
      d.totaliPerRegistro.find(t => t.registroIvaId === registroIvaId) ?? {
        imponibile: '0',
        iva: '0',
        totale: '0',
      }
    )
  }

  /** Filtri della pagina «Da collegare»: periodo (`dal`/`al`), stato e, se c'è, contratto. */
  parametriDaCollegare(
    motivo: string,
    contrattoId: string | null,
    d: ElaborazioneDettaglio
  ): Record<string, string> {
    return {
      stato: motivo,
      dal: d.periodoDal,
      al: d.periodoAl,
      ...(contrattoId !== null ? { contrattoId } : {}),
    }
  }

  /** Testo del link, distinto per ogni voce del gruppo. */
  testoLink(contrattoId: string | null, indice: number, quanti: number): string {
    return contrattoId === null
      ? `Apri i movimenti senza contratto (${quanti})`
      : `Apri i movimenti del contratto ${indice + 1} (${quanti})`
  }

  // --- Azioni -------------------------------------------------------------------------------

  private daErrore(err: unknown, ripiego: string): EsitoVista {
    const codice = codiceErrore(err)
    const details = (err as { error?: { details?: unknown } } | null)?.error?.details
    const differenze = codice === 'ANTEPRIMA_SUPERATA' ? leggiDifferenze(details) : null
    return {
      messaggio: messaggioDaCodice(err, ripiego),
      differenze: differenze ? testoDifferenze(differenze) : null,
      ricalcola: codice === 'ANTEPRIMA_SUPERATA' || codice === 'DOPPIA_FATTURAZIONE',
    }
  }

  /** Esegue un'azione sull'elaborazione: una alla volta, poi rilegge lo stato. */
  private esegui(azione: () => Observable<unknown>, ripiego: string, dopo?: () => void): void {
    if (this.inAzione()) return
    this.inAzione.set(true)
    this.esitoAzione.set(null)
    azione()
      .pipe(
        finalize(() => this.inAzione.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          dopo?.()
          this.carica()
        },
        error: err => {
          dopo?.()
          this.esitoAzione.set(this.daErrore(err, ripiego))
          // Stato cambiato altrove: la pagina si riallinea (e riprende il giro se serve).
          if (RILEGGI_DOPO.includes(codiceErrore(err) ?? '')) this.carica()
        },
      })
  }

  ricalcola(): void {
    const d = this.dettaglio()
    if (d)
      this.esegui(() => this.servizio.ricalcola(this.id, d.versione), 'Impossibile ricalcolare.')
  }

  scarta(): void {
    const d = this.dettaglio()
    if (d) {
      this.esegui(
        () => this.servizio.scarta(this.id, d.versione),
        'Impossibile scartare l’anteprima.',
        () => this.scartaAperta.set(false)
      )
    }
  }

  chiudiScarta(): void {
    if (!this.inAzione()) this.scartaAperta.set(false)
  }

  rendiDefinitiva(): void {
    const d = this.dettaglio()
    if (d?.impronta == null || this.motivoDefinitiva() !== null) return
    this.esegui(
      () => this.servizio.definitiva(this.id, d.impronta as string, d.versione),
      'Impossibile rendere definitiva l’elaborazione.',
      () => this.confermaAperta.set(false)
    )
  }

  escludi(r: DocumentoRiga): void {
    this.cambiaInclusione(
      r,
      this.servizio.escludi(this.id, r.id),
      'Impossibile escludere il documento.'
    )
  }

  riammetti(r: DocumentoRiga): void {
    this.cambiaInclusione(
      r,
      this.servizio.riammetti(this.id, r.id),
      'Impossibile riammettere il documento.'
    )
  }

  private cambiaInclusione(
    r: DocumentoRiga,
    richiesta: Observable<DocumentoRiga>,
    ripiego: string
  ): void {
    if (this.inEsclusione().has(r.id)) return
    this.inEsclusione.update(s => new Set(s).add(r.id))
    this.esitoAzione.set(null)
    richiesta
      .pipe(
        finalize(() =>
          this.inEsclusione.update(s => {
            const n = new Set(s)
            n.delete(r.id)
            return n
          })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: nuovo => {
          this.documenti.update(righe => righe.map(x => (x.id === nuovo.id ? nuovo : x)))
          // La numerazione prevista dipende dagli esclusi: il backend la ricalcola a ogni lettura.
          this.carica()
        },
        error: err => this.esitoAzione.set(this.daErrore(err, ripiego)),
      })
  }
}
