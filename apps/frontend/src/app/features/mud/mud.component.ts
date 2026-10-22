import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { HttpErrorResponse } from '@angular/common/http'
import { ActivatedRoute } from '@angular/router'
import { AccordionModule } from 'primeng/accordion'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputSwitchModule } from 'primeng/inputswitch'
import { InputTextModule } from 'primeng/inputtext'
import { RadioButtonModule } from 'primeng/radiobutton'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ToastService } from '../../core/services/toast.service'
import { formattaQuantita } from '../../shared/format/formatta-quantita'
import {
  EsportazioneMud,
  MotivoAnnullamento,
  MudControllo,
  MudMovimentoSegnalato,
  MudRiepilogo,
  MudService,
  MudVersion,
  ObbligoMud,
  RigaIntegrazione,
  StatoPresentazioneMud,
  VoceRiepilogoAvvisi,
  codiceDellAzienda,
  codiciAvvisi,
  corpoIntegrazioni,
  eAmministratore,
  intervalloPesoSpecifico,
  pesoSpecificoPlausibile,
  puoGenerareConAvvisi,
  righeIntegrazioni,
  testoConferma,
} from './mud.service'

type Dialogo = 'download' | 'segnatura' | 'annullamento'

/** Corpo di un errore HTTP (`{ message, error, details }` del filtro globale), anche se Blob. */
async function corpoErrore(err: unknown): Promise<{ message?: string; error?: string }> {
  const corpo = err instanceof HttpErrorResponse ? err.error : null
  if (corpo instanceof Blob) {
    try {
      return JSON.parse(await corpo.text())
    } catch {
      return {}
    }
  }
  return corpo && typeof corpo === 'object' ? corpo : {}
}

const formatoData = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Rome',
})
const formatoDataOra = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Rome',
})

/** Data di oggi come `yyyy-MM-dd` (valore del campo data). */
function oggiIso(): string {
  const d = new Date()
  const due = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`
}

/**
 * Pagina MUD: riepilogo dell'anno dei dati con i controlli, file telematico (versionato per
 * anno) con la conferma degli avvisi, stato della presentazione e obbligo dell'azienda.
 */
@Component({
  selector: 'app-mud',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AccordionModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    RadioButtonModule,
    TableModule,
    TagModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">MUD — Dichiarazione Ambientale</h1>
          <p class="page-subtitle">
            Report annuale ed export telematico, versionato per anno (tracciato Unioncamere)
          </p>
        </div>
      </header>

      <!-- Pannello selezione anno + azioni -->
      <section class="surface-card mb-4">
        <div class="mud-toolbar">
          <div class="mud-toolbar__field">
            <label for="mud-year" class="block mb-2">Anno dei dati</label>
            <p-dropdown
              inputId="mud-year"
              [options]="years()"
              [(ngModel)]="selectedYear"
              (onChange)="onYearChange()"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              placeholder="Seleziona anno"
              ariaLabel="Anno dei dati"
              [disabled]="!supportedYears().length"
            ></p-dropdown>
          </div>
          <div class="mud-toolbar__actions">
            <p-button
              label="Genera report"
              icon="pi pi-chart-bar"
              [loading]="loadingReport()"
              [disabled]="!selectedYear"
              (onClick)="loadReport()"
              ariaLabel="Genera il report MUD per l'anno selezionato"
            ></p-button>
            <p-button
              *ngIf="downloadVisibile()"
              data-testid="mud-download"
              label="Scarica file MUD"
              icon="pi pi-download"
              [outlined]="true"
              [loading]="downloading()"
              [disabled]="!selectedYear"
              (onClick)="download()"
              ariaLabel="Scarica il file telematico MUD per l'anno selezionato"
            ></p-button>
          </div>
        </div>
        <small *ngIf="versionForSelected() as v" class="block mt-1 text-tertiary"
          >Tracciato: {{ v }}</small
        >
        <p *ngIf="!downloadVisibile()" class="mt-3 mb-0">
          Il file ha avvisi da confermare: chiedi a un amministratore di generarlo.
        </p>

        <div *ngIf="!supportedYears().length" class="mt-3">
          <p-tag
            severity="warning"
            value="Nessun tracciato disponibile"
            icon="pi pi-exclamation-triangle"
          ></p-tag>
        </div>

        <!-- Stato della presentazione -->
        <div *ngIf="presentazione() as p" class="mud-presentazione mt-3">
          <p-tag
            *ngIf="p.status === 'SUBMITTED'"
            severity="success"
            icon="pi pi-check"
            [value]="'Presentato il ' + data(p.submittedAt)"
          ></p-tag>
          <p-tag
            *ngIf="p.datiModificatiDopoPresentazione"
            severity="warning"
            value="Dati modificati dopo la presentazione: se serve, genera la dichiarazione sostitutiva."
          ></p-tag>
          <p-tag
            *ngIf="p.fileTracciato === false"
            severity="info"
            value="Presentazione dichiarata dall'utente: il file non è stato generato da questa versione dell'applicazione."
          ></p-tag>
          <ng-container *ngIf="amministratore()">
            <p-button
              *ngIf="p.status !== 'SUBMITTED'"
              label="Segna come presentato"
              icon="pi pi-send"
              [text]="true"
              (onClick)="apriSegnatura()"
            ></p-button>
            <p-button
              *ngIf="p.status === 'SUBMITTED'"
              label="Annulla presentazione"
              icon="pi pi-undo"
              severity="secondary"
              [text]="true"
              (onClick)="apriAnnullamento()"
            ></p-button>
          </ng-container>
        </div>
      </section>

      <!-- Obbligo del MUD (A-W-10): solo chi può modificarlo secondo il backend -->
      <section *ngIf="obbligo()?.puoModificare" class="surface-card mb-4">
        <div class="mud-obbligo">
          <p-inputSwitch inputId="mud-non-dovuto" [(ngModel)]="obbligoNonDovuto"></p-inputSwitch>
          <label for="mud-non-dovuto">Questa azienda non è tenuta a presentare il MUD</label>
        </div>
        <div *ngIf="obbligoNonDovuto" class="mt-3">
          <label for="mud-motivo" class="block mb-2">Motivo</label>
          <input
            id="mud-motivo"
            pInputText
            class="w-full"
            maxlength="500"
            [(ngModel)]="obbligoMotivo"
            [required]="true"
          />
        </div>
        <p-button
          class="block mt-3"
          label="Salva"
          icon="pi pi-save"
          [outlined]="true"
          [disabled]="!obbligoValido()"
          (onClick)="salvaObbligo()"
        ></p-button>
      </section>

      <!-- Report -->
      <ng-container *ngIf="report() as r">
        <h2 class="mud-section-title">Riepilogo {{ r.year }}</h2>

        <div *ngIf="r.mudNonDovuto" class="mb-3">
          <p-tag severity="info" value="Azienda segnata come non tenuta al MUD"></p-tag>
        </div>

        <div class="stat-grid mb-4">
          <div class="stat-card">
            <span class="stat-card__label">Prodotto</span>
            <span class="stat-card__value">{{ kg(r.totals.produced) }}</span>
            <span class="stat-card__hint">kg di rifiuto prodotto</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Recupero</span>
            <span class="stat-card__value">{{ kg(r.totals.recovery) }}</span>
            <span class="stat-card__hint">kg avviati a recupero</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Smaltimento</span>
            <span class="stat-card__value">{{ kg(r.totals.disposal) }}</span>
            <span class="stat-card__hint">kg avviati a smaltimento</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Tasso di recupero</span>
            <span class="stat-card__value">{{ percentuale(r.totals.recyclingRate) }}%</span>
            <span class="stat-card__hint">quota avviata a recupero</span>
          </div>
        </div>

        <p class="text-tertiary mb-3">
          I rifiuti prodotti fuori dall'unità locale (cantieri, manutenzioni: modulo RE) non sono
          distinti: il file li attribuisce all'unità locale.
        </p>

        <!-- Controlli: prima i bloccanti, poi gli avvisi raggruppati per codice -->
        <section *ngIf="bloccanti().length || avvisiPresenti()" class="surface-card mb-4">
          <ul *ngIf="bloccanti().length" class="mud-bloccanti">
            <li *ngFor="let c of bloccanti()">
              <p-tag severity="danger" value="Da correggere"></p-tag>
              <span>{{ c.messaggio }}</span>
              <p-button
                *ngIf="c.integrazione"
                label="Completa nelle integrazioni"
                [link]="true"
                (onClick)="vaiAlleIntegrazioni()"
              ></p-button>
            </li>
          </ul>
          <ng-container *ngIf="avvisiPresenti()">
            <ng-container *ngTemplateOutlet="vociAvvisi; context: { $implicit: r }"></ng-container>
          </ng-container>
        </section>

        <!-- Integrazioni dell'anno (Decisione 18): i bloccanti rimandano qui -->
        <section *ngIf="righe.length" id="mud-integrazioni" class="surface-card mb-4">
          <h3 class="mud-section-title mb-2">Integrazioni {{ r.year }}</h3>
          <p class="text-tertiary mb-3">
            Questi dati completano il MUD dell'anno senza modificare il registro, che resta com'è.
          </p>
          <div *ngFor="let riga of righe; let i = index" class="mud-integrazione">
            <strong class="mud-integrazione__etichetta">{{ riga.etichetta }}</strong>

            <!-- Peso specifico: kg per unità, conversione e intervallo consueto -->
            <ng-container *ngIf="riga.tipo === 'PESO_SPECIFICO'; else soggetto">
              <div class="mud-integrazione__campo">
                <label [for]="'mud-int-kg-' + i">kg per {{ riga.unita }}</label>
                <p-inputNumber
                  [inputId]="'mud-int-kg-' + i"
                  [(ngModel)]="riga.kgPerUnita"
                  mode="decimal"
                  locale="it-IT"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  [min]="0"
                  [disabled]="!amministratore()"
                ></p-inputNumber>
              </div>
              <small *ngIf="conversione(riga) as c" class="block">{{ c }}</small>
              <small class="block text-tertiary">{{ testoIntervallo(riga) }}</small>
              <div *ngIf="fuoriIntervallo(riga)" class="mud-conferma">
                <p-checkbox
                  [inputId]="'mud-int-fuori-' + i"
                  [binary]="true"
                  [(ngModel)]="riga.confermaFuoriIntervallo"
                  [disabled]="!amministratore()"
                ></p-checkbox>
                <label [for]="'mud-int-fuori-' + i"
                  >Confermo questo peso specifico, anche se è fuori dall'intervallo consueto</label
                >
              </div>
            </ng-container>

            <!-- Soggetti: destinatario, destinatario del movimento, trasportatore -->
            <ng-template #soggetto>
              <div *ngIf="riga.tipo === 'DESTINATARIO_MOVIMENTO'" class="mud-integrazione__campo">
                <label [for]="'mud-int-rs-' + i">Destinatario</label>
                <input
                  [id]="'mud-int-rs-' + i"
                  pInputText
                  maxlength="255"
                  [(ngModel)]="riga.ragioneSociale"
                  [disabled]="!amministratore()"
                />
              </div>
              <div *ngIf="riga.tipo === 'CF_DESTINATARIO'" class="mud-conferma">
                <p-checkbox
                  [inputId]="'mud-int-estero-' + i"
                  [binary]="true"
                  [(ngModel)]="riga.estero"
                  [disabled]="!amministratore()"
                ></p-checkbox>
                <label [for]="'mud-int-estero-' + i">Destinatario estero</label>
              </div>
              <div *ngIf="riga.estero; else campoCf" class="mud-integrazione__campo">
                <label [for]="'mud-int-nazione-' + i">Nazione</label>
                <input
                  [id]="'mud-int-nazione-' + i"
                  pInputText
                  maxlength="20"
                  [(ngModel)]="riga.nazione"
                  [disabled]="!amministratore()"
                />
              </div>
              <ng-template #campoCf>
                <div class="mud-integrazione__campo">
                  <label [for]="'mud-int-cf-' + i">Codice fiscale o partita IVA</label>
                  <input
                    [id]="'mud-int-cf-' + i"
                    pInputText
                    maxlength="18"
                    [(ngModel)]="riga.codiceFiscale"
                    [disabled]="!amministratore()"
                  />
                </div>
                <div *ngIf="chiedeConfermaPropriaAzienda(riga)" class="mud-conferma">
                  <p-checkbox
                    [inputId]="'mud-int-propria-' + i"
                    [binary]="true"
                    [(ngModel)]="riga.confermaPropriaAzienda"
                    [disabled]="!amministratore()"
                  ></p-checkbox>
                  <label [for]="'mud-int-propria-' + i"
                    >Confermo: il destinatario è un impianto della nostra azienda</label
                  >
                </div>
              </ng-template>
            </ng-template>
          </div>
          <p-button
            *ngIf="amministratore()"
            label="Salva integrazioni"
            icon="pi pi-save"
            [loading]="salvataggioIntegrazioni()"
            (onClick)="salvaIntegrazioni()"
          ></p-button>
        </section>

        <section class="surface-card">
          <h3 class="mud-section-title mb-3">Rifiuti prodotti per codice CER</h3>
          <div class="table-responsive">
            <p-table [value]="r.wasteProduced || []" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">CER</th>
                  <th scope="col" class="text-right">Quantità (kg)</th>
                  <th scope="col" class="text-right">N. movimenti</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-w>
                <tr>
                  <td>
                    <strong>{{ w.cerCode }}</strong>
                  </td>
                  <td class="text-right">{{ kg(w.totalQuantity) }}</td>
                  <td class="text-right">{{ w.count }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="3">
                    <div class="empty-state">
                      <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessun rifiuto registrato</span>
                      <p>Non risultano rifiuti per l'anno selezionato.</p>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </section>
      </ng-container>

      <!-- Stato iniziale: nessun report ancora generato -->
      <section *ngIf="!report() && supportedYears().length" class="surface-card">
        <div class="empty-state">
          <i class="pi pi-file-export empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Nessun report generato</span>
          <p>Seleziona un anno e premi "Genera report" per visualizzare il riepilogo MUD.</p>
        </div>
      </section>
    </div>

    <!-- Avvisi raggruppati per codice, nell'ordine del riepilogo; aperti se cambiano i kg -->
    <ng-template #vociAvvisi let-r>
      <p class="mud-avvisi-testo">{{ r.riepilogoAvvisi.testo }}</p>
      <p-accordion [multiple]="true">
        <p-accordionTab
          *ngFor="let v of r.riepilogoAvvisi.voci"
          [selected]="cambiaKg(v)"
          [header]="intestazione(v)"
        >
          <ng-template pTemplate="header">
            <p-tag [severity]="cambiaKg(v) ? 'warning' : 'info'" [value]="intestazione(v)"></p-tag>
          </ng-template>
          <div *ngFor="let c of avvisiDelCodice(r, v.codice)" class="mud-avviso">
            <p class="mb-2">{{ c.messaggio }}</p>
            <ul *ngIf="c.movimenti?.length" class="mud-movimenti">
              <li *ngFor="let m of c.movimenti">{{ movimento(m) }}</li>
            </ul>
          </div>
        </p-accordionTab>
      </p-accordion>
    </ng-template>

    <p-dialog
      [visible]="dialogo() !== null"
      (visibleChange)="!$event && chiudiDialogo()"
      [modal]="true"
      [header]="titoloDialogo()"
      [style]="{ width: '44rem', maxWidth: '95vw' }"
    >
      <!-- Download: dichiarazione sostitutiva e conferma degli avvisi -->
      <ng-container *ngIf="dialogo() === 'download' && report() as r">
        <p *ngIf="presentazione()?.prossimoFileSostituisce as sostituita">
          Il file sostituisce la dichiarazione presentata il {{ data(sostituita) }}.
        </p>
        <ng-container *ngIf="avvisiPresenti()">
          <ng-container *ngTemplateOutlet="vociAvvisi; context: { $implicit: r }"></ng-container>
          <div class="mud-conferma mt-3">
            <p-checkbox
              inputId="mud-conferma"
              [binary]="true"
              [(ngModel)]="confermaSpuntata"
            ></p-checkbox>
            <label for="mud-conferma">{{ testoConfermaDownload() }}</label>
          </div>
        </ng-container>
      </ng-container>

      <!-- Segnatura: si lega a un file esportato (A-W-03) -->
      <ng-container *ngIf="dialogo() === 'segnatura'">
        <div class="mb-3">
          <label for="mud-data-presentazione" class="block mb-2">Data della presentazione</label>
          <input
            id="mud-data-presentazione"
            type="date"
            pInputText
            [max]="oggi"
            [(ngModel)]="dataPresentazione"
          />
        </div>
        <ng-container *ngIf="esportazioni().length; else senzaEsportazioni">
          <label for="mud-esportazione" class="block mb-2">File presentato</label>
          <p-dropdown
            inputId="mud-esportazione"
            [options]="opzioniEsportazioni()"
            [(ngModel)]="esportazioneScelta"
            (onChange)="confermaSpuntata = false"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            ariaLabel="File presentato"
          ></p-dropdown>
          <div
            *ngIf="esportazioneSelezionata()?.avvisiConfermati?.length"
            class="mud-conferma mt-3"
          >
            <p-checkbox
              inputId="mud-conferma-segnatura"
              [binary]="true"
              [(ngModel)]="confermaSpuntata"
            ></p-checkbox>
            <label for="mud-conferma-segnatura">{{ testoConfermaSegnatura() }}</label>
          </div>
        </ng-container>
        <ng-template #senzaEsportazioni>
          <p>
            Presentazione dichiarata dall'utente: il file non è stato generato da questa versione
            dell'applicazione.
          </p>
        </ng-template>
      </ng-container>

      <!-- Annullamento: il motivo decide se il prossimo file è sostitutivo (A-W-04) -->
      <ng-container *ngIf="dialogo() === 'annullamento'">
        <div class="mud-motivo">
          <p-radioButton
            inputId="motivo-errata"
            name="motivo"
            value="SEGNATURA_ERRATA"
            [(ngModel)]="motivoAnnullamento"
          ></p-radioButton>
          <label for="motivo-errata"
            >Segnatura errata: la segnatura annullata non era una presentazione.</label
          >
        </div>
        <div class="mud-motivo mt-3">
          <p-radioButton
            inputId="motivo-sostituire"
            name="motivo"
            value="DICHIARAZIONE_DA_SOSTITUIRE"
            [(ngModel)]="motivoAnnullamento"
          ></p-radioButton>
          <label for="motivo-sostituire"
            >Dichiarazione da sostituire: il prossimo file annulla e sostituisce quella
            presentata.</label
          >
        </div>
      </ng-container>

      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          severity="secondary"
          [text]="true"
          (onClick)="chiudiDialogo()"
        ></p-button>
        <p-button
          [label]="etichettaConferma()"
          [disabled]="!puoConfermare()"
          (onClick)="conferma()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .mud-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      /* Toolbar: dropdown anno + azioni allineati sulla linea del controllo (40px) */
      .mud-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--spacing-md);
      }
      .mud-toolbar__field {
        flex: 1 1 220px;
        min-width: 200px;
        max-width: 320px;
      }
      .mud-toolbar__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
      }
      .mud-toolbar__field label {
        font-weight: var(--font-weight-medium);
      }
      @media (max-width: 576px) {
        .mud-toolbar__field {
          max-width: none;
          flex-basis: 100%;
        }
        .mud-toolbar__actions {
          width: 100%;
        }
        .mud-toolbar__actions .p-button {
          flex: 1 1 auto;
        }
      }
      .mud-presentazione,
      .mud-obbligo,
      .mud-conferma,
      .mud-motivo {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .mud-conferma,
      .mud-motivo {
        flex-wrap: nowrap;
        align-items: flex-start;
      }
      .mud-bloccanti {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--spacing-base);
      }
      .mud-bloccanti li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }
      .mud-avvisi-testo {
        font-weight: var(--font-weight-medium);
        background: var(--color-warning-bg);
        color: var(--color-warning);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md, 6px);
      }
      .mud-integrazione {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) 0;
        margin-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--surface-border, transparent);
      }
      .mud-integrazione__campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        max-width: 320px;
      }
      .mud-movimenti {
        margin: 0 0 var(--spacing-base);
        padding-left: var(--spacing-xl);
        font-size: var(--font-size-sm);
      }
      .text-right {
        text-align: right;
      }
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mb-0 {
        margin-bottom: 0;
      }
      .mt-3 {
        margin-top: var(--spacing-base);
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
    `,
  ],
})
export class MudComponent implements OnInit {
  private readonly mudService = inject(MudService)
  private readonly toast = inject(ToastService)
  private readonly route = inject(ActivatedRoute)

  readonly supportedYears = signal<MudVersion[]>([])
  readonly report = signal<MudRiepilogo | null>(null)
  readonly presentazione = signal<StatoPresentazioneMud | null>(null)
  readonly obbligo = signal<ObbligoMud | null>(null)
  readonly loadingReport = signal(false)
  /** Richiesta di riepilogo in corso: una risposta di una richiesta superata si scarta. */
  private richiestaReport = 0
  readonly downloading = signal(false)
  readonly dialogo = signal<Dialogo | null>(null)

  selectedYear: number | null = null
  readonly oggi = oggiIso()

  // Stato dei dialoghi
  confermaSpuntata = false
  dataPresentazione = this.oggi
  esportazioneScelta: string | null = null
  motivoAnnullamento: MotivoAnnullamento | null = null

  // Modulo dell'obbligo
  obbligoNonDovuto = false
  obbligoMotivo = ''

  // Integrazioni dell'anno: righe modificabili, ricostruite a ogni riepilogo
  righe: RigaIntegrazione[] = []
  private codiciAzienda: string[] = []
  readonly salvataggioIntegrazioni = signal(false)

  readonly bloccanti = computed(() =>
    (this.report()?.controlli ?? []).filter(c => c.gravita === 'BLOCCANTE')
  )
  readonly codiciAvvisiReport = computed(() => codiciAvvisi(this.report()?.controlli ?? []))
  readonly avvisiPresenti = computed(() => this.codiciAvvisiReport().length > 0)

  /**
   * Amministratore nell'azienda selezionata: dal ruolo effettivo del riepilogo; prima di
   * generarlo, dal flag dell'obbligo, che il backend calcola con la stessa regola
   * (ADMIN o SUPER_ADMIN effettivo, RUOLI_OBBLIGO_MUD e RUOLI_PRESENTAZIONE_MUD del controller).
   */
  readonly amministratore = computed(() => {
    const r = this.report()
    return r ? eAmministratore(r.ruoloEffettivo) : this.obbligo()?.puoModificare === true
  })

  /** Il download con avvisi che cambiano le quantità è solo per gli amministratori effettivi. */
  readonly downloadVisibile = computed(() => {
    const r = this.report()
    if (!r || !this.avvisiPresenti()) return true
    return puoGenerareConAvvisi(r.riepilogoAvvisi, r.ruoloEffettivo)
  })

  readonly esportazioni = computed(() => this.presentazione()?.esportazioni ?? [])

  years() {
    return this.supportedYears().map(v => ({
      label: `${v.year} (MUD ${v.year + 1})`,
      value: v.year,
    }))
  }

  versionForSelected(): string | null {
    return this.supportedYears().find(v => v.year === this.selectedYear)?.version ?? null
  }

  ngOnInit(): void {
    this.mudService.getVersions().subscribe({
      next: res => {
        const versions = res.versions || []
        this.supportedYears.set(versions)
        // ?anno= è il link dei promemoria del MUD: vale solo se è un anno disponibile
        const richiesto = Number(this.route.snapshot.queryParamMap.get('anno'))
        const scelto = versions.find(v => v.year === richiesto) ?? versions[0]
        if (scelto) {
          this.selectedYear = scelto.year
          this.loadPresentazione()
        }
      },
      error: () => this.toast.error('Impossibile caricare le versioni MUD'),
    })
    this.loadObbligo()
  }

  onYearChange(): void {
    // un riepilogo ancora in arrivo è dell'anno precedente
    this.richiestaReport++
    this.loadingReport.set(false)
    this.report.set(null)
    this.presentazione.set(null)
    this.righe = []
    this.loadPresentazione()
  }

  loadReport(onLoaded?: (r: MudRiepilogo) => void): void {
    if (!this.selectedYear) return
    const richiesta = ++this.richiestaReport
    this.loadingReport.set(true)
    this.mudService.getReport(this.selectedYear).subscribe({
      next: r => {
        if (richiesta !== this.richiestaReport) return
        this.report.set(r)
        this.loadingReport.set(false)
        this.loadIntegrazioni(r)
        onLoaded?.(r)
      },
      error: () => {
        if (richiesta !== this.richiestaReport) return
        this.loadingReport.set(false)
        this.toast.error('Errore nella generazione del report MUD')
      },
    })
  }

  /**
   * Scarica il file: con avvisi, o se il file sarà una dichiarazione sostitutiva (MUD presentato,
   * o presentazione annullata per sostituirla), prima il dialogo di conferma.
   * Senza riepilogo dell'anno lo carica prima, perché gli avvisi da confermare vengono da lì.
   */
  download(): void {
    if (!this.selectedYear) return
    const r = this.report()
    if (!r || r.year !== this.selectedYear) {
      this.loadReport(() => this.download())
      return
    }
    // il riepilogo appena caricato può riservare il file agli amministratori: resta il testo
    if (!this.downloadVisibile()) return
    if (this.avvisiPresenti() || this.presentazione()?.prossimoFileSostituisce) {
      this.apriDialogo('download')
      return
    }
    this.eseguiDownload([])
  }

  apriSegnatura(): void {
    const esportazioni = this.esportazioni()
    this.esportazioneScelta = esportazioni.length
      ? esportazioni[esportazioni.length - 1].generatoIl
      : null
    this.dataPresentazione = this.oggi
    this.apriDialogo('segnatura')
  }

  apriAnnullamento(): void {
    this.motivoAnnullamento = null
    this.apriDialogo('annullamento')
  }

  chiudiDialogo(): void {
    this.dialogo.set(null)
  }

  puoConfermare(): boolean {
    switch (this.dialogo()) {
      case 'download':
        return !this.avvisiPresenti() || this.confermaSpuntata
      case 'segnatura':
        return !this.esportazioneSelezionata()?.avvisiConfermati.length || this.confermaSpuntata
      case 'annullamento':
        return this.motivoAnnullamento !== null
      default:
        return false
    }
  }

  conferma(): void {
    const dialogo = this.dialogo()
    if (!dialogo || !this.puoConfermare()) return
    this.chiudiDialogo()
    if (dialogo === 'download') this.eseguiDownload(this.codiciAvvisiReport())
    else if (dialogo === 'segnatura') this.eseguiSegnatura()
    else this.eseguiAnnullamento()
  }

  titoloDialogo(): string {
    switch (this.dialogo()) {
      case 'download':
        return this.avvisiPresenti() ? 'Conferma degli avvisi' : 'Dichiarazione sostitutiva'
      case 'segnatura':
        return 'Segna come presentato'
      case 'annullamento':
        return 'Annulla presentazione'
      default:
        return ''
    }
  }

  etichettaConferma(): string {
    switch (this.dialogo()) {
      case 'download':
        return 'Genera il file'
      case 'segnatura':
        return 'Segna come presentato'
      default:
        return 'Annulla presentazione'
    }
  }

  testoConfermaDownload(): string {
    const r = this.report()
    return r ? testoConferma(r.riepilogoAvvisi, 'generare il file') : ''
  }

  esportazioneSelezionata(): EsportazioneMud | null {
    return this.esportazioni().find(e => e.generatoIl === this.esportazioneScelta) ?? null
  }

  testoConfermaSegnatura(): string {
    const e = this.esportazioneSelezionata()
    return e ? testoConferma(e, 'segnare il MUD come presentato') : ''
  }

  opzioniEsportazioni() {
    return this.esportazioni().map(e => ({
      label:
        `File del ${formatoDataOra.format(new Date(e.generatoIl))}` +
        (e.versione ? ` · tracciato ${e.versione}` : ''),
      value: e.generatoIl,
    }))
  }

  obbligoValido(): boolean {
    return !this.obbligoNonDovuto || this.obbligoMotivo.trim().length > 0
  }

  salvaObbligo(): void {
    if (!this.obbligoValido()) return
    const nonDovuto = this.obbligoNonDovuto
    this.mudService
      .impostaObbligo(nonDovuto, nonDovuto ? this.obbligoMotivo.trim() : null)
      .subscribe({
        next: o => {
          this.obbligo.set({ ...o, puoModificare: this.obbligo()?.puoModificare })
          this.toast.success(
            nonDovuto
              ? 'Impostazione salvata: promemoria e scadenze del MUD sono disattivati.'
              : 'Impostazione salvata: promemoria e scadenze del MUD sono di nuovo attivi.'
          )
          this.loadReport()
        },
        error: async (err: unknown) => {
          const corpo = await corpoErrore(err)
          this.toast.error(corpo.message ?? "Errore nel salvataggio dell'obbligo del MUD")
        },
      })
  }

  /** Porta alla sezione delle integrazioni della pagina (Task 10). */
  vaiAlleIntegrazioni(): void {
    document.getElementById('mud-integrazioni')?.scrollIntoView({ behavior: 'smooth' })
  }

  /**
   * Salva tutte le righe (il PUT sostituisce le integrazioni dell'anno), poi ricalcola il
   * riepilogo. Gli errori del backend (CF, conferme, CER) arrivano nel messaggio della risposta.
   */
  salvaIntegrazioni(): void {
    const year = this.report()?.year
    if (!year) return
    this.salvataggioIntegrazioni.set(true)
    this.mudService
      .salvaIntegrazioni(year, corpoIntegrazioni(this.righe, this.codiciAzienda))
      .subscribe({
        next: () => {
          this.salvataggioIntegrazioni.set(false)
          this.toast.success('Integrazioni salvate: il riepilogo è stato ricalcolato.')
          this.loadReport()
        },
        error: async (err: unknown) => {
          this.salvataggioIntegrazioni.set(false)
          const corpo = await corpoErrore(err)
          this.toast.error(corpo.message ?? 'Errore nel salvataggio delle integrazioni del MUD')
        },
      })
  }

  /** `{totale} {unita} → {kg} kg` per il peso specifico, dai movimenti del bloccante. */
  conversione(riga: RigaIntegrazione): string | null {
    if (riga.totaleUnita === null || !riga.kgPerUnita) return null
    const kg = Math.round(riga.totaleUnita * riga.kgPerUnita * 1000) / 1000
    return `${formattaQuantita(riga.totaleUnita)} ${riga.unita} → ${formattaQuantita(kg)} kg`
  }

  testoIntervallo(riga: RigaIntegrazione): string {
    const i = intervalloPesoSpecifico(riga.unita ?? '')
    return i
      ? `Intervallo consueto: ${formattaQuantita(i.min)}–${formattaQuantita(i.max)} kg per ${riga.unita}`
      : `Per ${riga.unita} non c'è un intervallo consueto: il valore va confermato.`
  }

  fuoriIntervallo(riga: RigaIntegrazione): boolean {
    return !!riga.kgPerUnita && !pesoSpecificoPlausibile(riga.unita ?? '', riga.kgPerUnita)
  }

  /** Il codice di un destinatario coincide con quello dell'azienda (non per i trasportatori). */
  chiedeConfermaPropriaAzienda(riga: RigaIntegrazione): boolean {
    return (
      riga.tipo !== 'CF_TRASPORTATORE' &&
      !riga.estero &&
      codiceDellAzienda(riga.codiceFiscale, this.codiciAzienda)
    )
  }

  // Formattazione: numeri sempre con formattaQuantita (nessun locale `it` registrato)

  /** Al grammo (fino a 3 decimali), come il PDF e il file: 0,4 kg non si legge «0». */
  kg(n: number | null | undefined): string {
    return formattaQuantita(n ?? 0)
  }

  percentuale(rate: number | null | undefined): string {
    return formattaQuantita(Math.round((rate ?? 0) * 1000) / 10)
  }

  data(iso: string | null): string {
    return iso ? formatoData.format(new Date(iso)) : ''
  }

  cambiaKg(v: VoceRiepilogoAvvisi): boolean {
    return v.kgEsclusi > 0 || v.kgAggiunti > 0
  }

  intestazione(v: VoceRiepilogoAvvisi): string {
    const dettaglio =
      v.kgEsclusi > 0
        ? `${formattaQuantita(v.kgEsclusi)} kg esclusi`
        : v.kgAggiunti > 0
          ? `${formattaQuantita(v.kgAggiunti)} kg aggiunti`
          : 'informativo'
    return `${v.casi} ${v.casi === 1 ? 'caso' : 'casi'} · ${dettaglio}`
  }

  avvisiDelCodice(r: MudRiepilogo, codice: string): MudControllo[] {
    return r.controlli.filter(c => c.gravita === 'AVVISO' && c.codice === codice)
  }

  movimento(m: MudMovimentoSegnalato): string {
    return (
      `n. ${m.numero}/${m.anno} · CER ${m.cerCode} · ${formattaQuantita(m.quantita)} ${m.unita}` +
      ` · ${m.incluso ? 'nel MUD' : 'escluso'}`
    )
  }

  private apriDialogo(d: Dialogo): void {
    this.confermaSpuntata = false
    this.dialogo.set(d)
  }

  private loadPresentazione(): void {
    const year = this.selectedYear
    if (!year) return
    this.mudService.getPresentazione(year).subscribe({
      next: p => {
        // una risposta arrivata dopo un cambio d'anno non vale più
        if (this.selectedYear === year) this.presentazione.set(p)
      },
      error: () => this.toast.error('Impossibile caricare lo stato della presentazione del MUD'),
    })
  }

  /** Integrazioni dell'anno del riepilogo: righe dai bloccanti e dalle voci salvate. */
  private loadIntegrazioni(r: MudRiepilogo): void {
    this.mudService.getIntegrazioni(r.year).subscribe({
      next: i => {
        // una risposta arrivata dopo un cambio d'anno o un altro riepilogo non vale più
        if (this.report() !== r) return
        this.codiciAzienda = i.codiciAzienda ?? []
        this.righe = righeIntegrazioni(r.controlli, i)
      },
      error: () => this.toast.error('Impossibile caricare le integrazioni del MUD'),
    })
  }

  private loadObbligo(): void {
    this.mudService.getObbligo().subscribe({
      next: o => {
        this.obbligo.set(o)
        this.obbligoNonDovuto = o.mudNonDovuto
        this.obbligoMotivo = o.motivo ?? ''
      },
      // l'interruttore resta nascosto; il riepilogo dice comunque se l'azienda non è tenuta
      error: () => this.obbligo.set(null),
    })
  }

  private eseguiDownload(avvisiConfermati: string[]): void {
    const year = this.selectedYear
    if (!year) return
    this.downloading.set(true)
    this.mudService.downloadExport(year, avvisiConfermati).subscribe({
      next: res => {
        this.downloading.set(false)
        const blob = res.body as Blob
        const filename =
          this.filenameFrom(res.headers.get('content-disposition')) || `MUD_${year}.txt`
        this.triggerDownload(blob, filename)
        this.toast.success('File MUD generato')
        // la nuova esportazione entra fra quelle a cui legare la presentazione
        this.loadPresentazione()
      },
      error: async (err: unknown) => {
        this.downloading.set(false)
        const status = err instanceof HttpErrorResponse ? err.status : 0
        const corpo = await corpoErrore(err)
        if (status === 403 && corpo.error === 'MUD_CONFERMA_RISERVATA_AMMINISTRATORI') {
          this.toast.error(corpo.message ?? 'Errore nel download del file MUD')
        } else if (status === 422 && corpo.error === 'MUD_AVVISI_DA_CONFERMARE') {
          this.toast.warn('Gli avvisi sono cambiati: rileggili e conferma di nuovo.')
          this.loadReport()
        } else if (status === 422 && corpo.error === 'MUD_NON_GENERABILE') {
          this.toast.error(
            'Il file MUD non può essere generato: correggi gli errori elencati nel riepilogo.'
          )
          this.loadReport()
        } else {
          this.toast.error('Errore nel download del file MUD')
        }
      },
    })
  }

  private eseguiSegnatura(): void {
    const year = this.selectedYear
    if (!year) return
    this.mudService
      .segnaPresentato(
        year,
        this.dataPresentazione || undefined,
        this.esportazioneScelta ?? undefined
      )
      .subscribe({
        next: p => {
          this.presentazione.set(p)
          this.toast.success('MUD segnato come presentato: i promemoria si fermano.')
        },
        error: err => this.erroreSegnatura(err),
      })
  }

  private eseguiAnnullamento(): void {
    const year = this.selectedYear
    if (!year || !this.motivoAnnullamento) return
    this.mudService.annullaPresentazione(year, this.motivoAnnullamento).subscribe({
      next: p => {
        this.presentazione.set(p)
        this.toast.success('Presentazione annullata: la segnatura precedente resta nello storico.')
      },
      error: err => this.erroreSegnatura(err),
    })
  }

  private async erroreSegnatura(err: unknown): Promise<void> {
    const status = err instanceof HttpErrorResponse ? err.status : 0
    if (status === 403) {
      this.toast.error('Solo un amministratore può segnare la presentazione.')
      return
    }
    const corpo = await corpoErrore(err)
    this.toast.error(corpo.message ?? 'Errore nella segnatura della presentazione del MUD')
  }

  private filenameFrom(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null
    const m = /filename="?([^"]+)"?/.exec(contentDisposition)
    return m ? m[1] : null
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }
}
