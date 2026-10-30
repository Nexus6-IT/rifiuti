import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Subscription, forkJoin, of } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { DropdownModule } from 'primeng/dropdown'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { formattaQuantita } from '../../shared/format/formatta-quantita'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { etichettaRegistro, registroPredefinito } from '../registro/registro-sede'
import {
  GiacenzeService,
  Giacenza,
  ConfigurazioneSoglie,
  DepositoCer,
  DepositoRegistro,
  DepositoTemporaneoVista,
  SoglieApplicate,
} from './giacenze.service'
import { formattaGiorno } from './giorno'
import { SoglieDepositoDialogComponent } from './soglie-deposito-dialog.component'

/** Il dropdown non seleziona le voci con valore `null`: "tutte le sedi" è la stringa vuota. */
const TUTTE_LE_SEDI = ''

/**
 * Pagina Giacenze e deposito temporaneo: giacenze aggregate per CER e, per ogni registro
 * (sede), soglie applicate, avvisi e residuo per CER con i lotti ancora in deposito
 * (art. 185-bis D.Lgs. 152/2006). Il backend calcola tutto: qui si mostra soltanto.
 */
@Component({
  selector: 'app-giacenze',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DropdownModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    SoglieDepositoDialogComponent,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Giacenze e deposito temporaneo</h1>
          <p class="page-subtitle">
            Riepilogo delle giacenze per codice CER e controllo dei limiti di deposito temporaneo,
            sede per sede
          </p>
        </div>
        <div class="page-actions">
          <p-button
            *ngIf="soglieConfigurate()?.puoImpostare"
            label="Soglie"
            icon="pi pi-sliders-h"
            [outlined]="true"
            (onClick)="soglieAperte.set(true)"
            data-testid="soglie-apri"
            ariaLabel="Configura le soglie del deposito temporaneo"
          ></p-button>
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="reload()"
            ariaLabel="Aggiorna giacenze e deposito temporaneo"
          ></p-button>
        </div>
      </header>

      <section *ngIf="piuRegistri()" class="surface-card mb-4" aria-label="Sede">
        <label class="giacenze-label" for="giacenze-sede">Sede</label>
        <p-dropdown
          inputId="giacenze-sede"
          data-testid="giacenze-sede"
          [options]="opzioniRegistro()"
          [ngModel]="registroSel() ?? ''"
          (onChange)="cambiaRegistro($event.value)"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full"
          ariaLabel="Sede"
        ></p-dropdown>
      </section>

      <!-- Stato di errore -->
      <section *ngIf="error()" class="surface-card mb-4">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger"
            aria-hidden="true"
          ></i>
          <span class="empty-state__title">{{ error() }}</span>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="reload()"
          ></p-button>
        </div>
      </section>

      <!-- Stato di caricamento -->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner
            strokeWidth="4"
            [style]="{ width: '48px', height: '48px' }"
            ariaLabel="Caricamento giacenze"
          ></p-progressSpinner>
        </div>
      </section>

      <ng-container *ngIf="!loading() && !error()">
        <!-- KPI -->
        <div class="stat-grid mb-4">
          <div class="stat-card">
            <span class="stat-card__label">Codici CER in giacenza</span>
            <span class="stat-card__value">{{ giacenze().length | number }}</span>
            <span class="stat-card__hint">codici con movimenti registrati</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Giacenza totale</span>
            <span class="stat-card__value">{{ totalGiacenzaKg() | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg attualmente in deposito</span>
          </div>
          <div
            class="stat-card"
            [class.stat-card--alert]="superamenti()"
            data-testid="kpi-superamenti"
          >
            <span class="stat-card__label">Superamenti</span>
            <span class="stat-card__value">{{ superamenti() | number }}</span>
            <span class="stat-card__hint">limiti del deposito superati</span>
          </div>
          <div class="stat-card" [class.stat-card--alert]="preavvisi()" data-testid="kpi-preavvisi">
            <span class="stat-card__label">Preavvisi</span>
            <span class="stat-card__value">{{ preavvisi() | number }}</span>
            <span class="stat-card__hint">limiti in avvicinamento</span>
          </div>
        </div>

        <!-- Deposito temporaneo, un blocco per registro -->
        <section
          *ngFor="let reg of deposito()?.registri; trackBy: trackRegistro"
          class="surface-card mb-4"
          [attr.data-testid]="'deposito-' + reg.registroId"
          [attr.aria-label]="'Deposito temporaneo ' + reg.registroDescrizione"
        >
          <h2 class="giacenze-section-title mb-3">
            Deposito temporaneo: {{ reg.registroDescrizione }}
            <p-tag *ngIf="!reg.attivo" severity="secondary" value="Disattivato"></p-tag>
          </h2>

          <div class="soglie-box mb-3" data-testid="soglie-applicate">
            <strong>Soglie applicate</strong>
            ({{ testoOrigine(reg.soglie) }})
            <div data-testid="soglie-criterio">{{ testoCriterio(reg.soglie) }}</div>
            <div class="giacenze-nota">
              Preavviso a {{ reg.soglie.preavvisoGiorni }} giorni dalla scadenza e all'{{
                reg.soglie.preavvisoPercentuale
              }}% dei kg.
            </div>
            <div class="giacenze-nota" data-testid="soglie-conversione">
              {{ testoConversione(reg.soglie) }}
            </div>
            <div *ngIf="noteSoglie(reg) as nota" class="giacenze-nota" data-testid="soglie-note">
              Note dell'azienda: {{ nota }}
            </div>
          </div>

          <div *ngIf="!reg.avvisi.length" class="giacenze-nota mb-3" data-testid="nessun-avviso">
            Nessun superamento né preavviso per questa sede.
          </div>
          <div
            *ngFor="let a of reg.avvisi"
            class="alert-banner mb-2"
            [class.alert-banner--danger]="a.livello === 'SUPERATO'"
            data-testid="avviso"
          >
            <div class="alert-header">
              <p-tag
                [value]="a.livello === 'SUPERATO' ? 'Superato' : 'Preavviso'"
                [severity]="a.livello === 'SUPERATO' ? 'danger' : 'warning'"
                [icon]="a.livello === 'SUPERATO' ? 'pi pi-exclamation-triangle' : 'pi pi-clock'"
              ></p-tag>
              <span class="alert-cer" *ngIf="a.cerCode"
                ><strong>CER {{ a.cerCode }}</strong></span
              >
            </div>
            <div data-testid="avviso-messaggio">{{ a.messaggio }}</div>
          </div>

          <div class="table-responsive">
            <p-table [value]="reg.cer" styleClass="p-datatable-sm" dataKey="cerCode">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" style="width: 3rem"></th>
                  <th scope="col">CER</th>
                  <th scope="col" class="text-right">Residuo</th>
                  <th scope="col">In deposito dal</th>
                  <th scope="col">Da avviare entro</th>
                  <th scope="col" class="text-right">Giorni</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-c>
                <tr [attr.data-testid]="'cer-' + reg.registroId + '-' + c.cerCode">
                  <td>
                    <button
                      type="button"
                      class="p-button p-button-text p-button-sm"
                      data-testid="lotti-toggle"
                      [attr.aria-expanded]="espanso(reg, c)"
                      [attr.aria-label]="'Lotti residui del CER ' + c.cerCode"
                      (click)="toggleLotti(reg, c)"
                    >
                      <i
                        class="pi"
                        [ngClass]="espanso(reg, c) ? 'pi-chevron-down' : 'pi-chevron-right'"
                        aria-hidden="true"
                      ></i>
                    </button>
                  </td>
                  <td>
                    <strong>{{ c.cerCode }}</strong>
                    <p-tag
                      *ngIf="c.pericoloso"
                      class="ml-2"
                      severity="danger"
                      value="Pericoloso"
                    ></p-tag>
                  </td>
                  <td class="text-right">
                    <strong>{{ formattaQuantita(c.residuoKg) }} kg</strong>
                    <ng-container *ngFor="let f of c.famiglie">
                      <div *ngIf="f.unita !== 'KG'" class="giacenze-altra-unita">
                        {{ formattaQuantita(f.residuo) }} {{ f.unita }}
                      </div>
                    </ng-container>
                  </td>
                  <td data-testid="cer-dal">{{ formattaGiorno(c.giornoPiuVecchio) }}</td>
                  <td data-testid="cer-entro">{{ formattaGiorno(c.scadenza) }}</td>
                  <td class="text-right">{{ c.etaGiorni ?? '-' }}</td>
                </tr>
                <tr *ngIf="espanso(reg, c)" data-testid="lotti">
                  <td></td>
                  <td colspan="5">
                    <ng-container *ngFor="let f of c.famiglie">
                      <div class="giacenze-nota mb-2">
                        Lotti residui in {{ f.unita === 'KG' ? 'kg' : f.unita }}
                        <span *ngIf="f.scoperto > 0">
                          (scarichi senza carico: {{ formattaQuantita(f.scoperto) }})</span
                        >
                      </div>
                      <ul class="lotti-lista">
                        <li *ngFor="let l of f.lotti" data-testid="lotto">
                          {{ formattaGiorno(l.giorno) }}:
                          {{
                            l.origine === 'APERTURA'
                              ? 'giacenza iniziale'
                              : (l.riferimento.numero ?? 'movimento')
                          }}
                          &ndash; residuo {{ formattaQuantita(l.residuo) }} di
                          {{ formattaQuantita(l.quantita) }}
                          {{ f.unita === 'KG' ? 'kg' : f.unita }}
                        </li>
                      </ul>
                      <div *ngIf="f.lottiOmessi > 0" class="giacenze-nota">
                        Altri {{ f.lottiOmessi }} lotti più recenti non mostrati.
                      </div>
                    </ng-container>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="6">
                    <div class="empty-state empty-state--compact">
                      <i class="pi pi-check-circle empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessun rifiuto in deposito</span>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>

          <p *ngIf="reg.quantitaParziale" class="giacenze-nota mt-2" data-testid="nota-parziale">
            Il controllo quantitativo considera solo le quantità in kg: m³ e litri restano fuori.
          </p>
          <p *ngIf="reg.scopertoPresente" class="giacenze-nota mt-2" data-testid="nota-scoperto">
            Ci sono scarichi senza un carico corrispondente: vedi Anomalie.
          </p>
        </section>

        <p class="giacenze-nota mb-4" data-testid="nota-gestori">
          Il deposito temporaneo riguarda i rifiuti prodotti dall'azienda. I carichi ricevuti da
          terzi da un gestore (R13/D15) sono stoccaggio autorizzato, con i limiti
          dell'autorizzazione: qui si conta comunque tutta la giacenza fisica del registro.
        </p>

        <!-- Tabella giacenze -->
        <section class="surface-card">
          <h2 class="giacenze-section-title mb-3">Giacenze per codice CER</h2>
          <div class="table-responsive">
            <p-table [value]="giacenze()" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" style="width: 140px">CER</th>
                  <th scope="col" class="text-right">Carico (kg)</th>
                  <th scope="col" class="text-right">Scarico (kg)</th>
                  <th scope="col" class="text-right">Giacenza (kg)</th>
                  <th scope="col" style="width: 180px">In deposito dal</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-g>
                <tr>
                  <td>
                    <strong>{{ g.cerCode }}</strong>
                    <div *ngFor="let s of g.scarichiSuFirAnnullati" class="mt-1">
                      <p-tag
                        severity="warning"
                        value="Scarico {{ s.numero }} ({{ formattaQuantita(s.quantita) }} {{
                          s.unita
                        }}) collegato al FIR {{
                          s.fir
                        }}, poi annullato: la giacenza lo conta ancora."
                      ></p-tag>
                    </div>
                  </td>
                  <td class="text-right">
                    {{ g.caricoKg | number: '1.0-2' }}
                    <div
                      *ngIf="g.inizialeKg > 0"
                      class="giacenze-altra-unita"
                      data-testid="giacenza-iniziale-kg"
                    >
                      di cui iniziale {{ g.inizialeKg | number: '1.0-2' }}
                    </div>
                  </td>
                  <td class="text-right">{{ g.scaricoKg | number: '1.0-2' }}</td>
                  <td class="text-right">
                    <strong>{{ g.giacenzaKg | number: '1.0-2' }}</strong>
                    <div *ngFor="let a of g.altreUnita" class="giacenze-altra-unita">
                      {{ formattaQuantita(a.giacenza) }} {{ a.unita }}
                      <span *ngIf="a.iniziale > 0" data-testid="giacenza-iniziale-altra-unita"
                        >(di cui iniziale {{ formattaQuantita(a.iniziale) }})</span
                      >
                    </div>
                  </td>
                  <td data-testid="giacenza-dal">
                    {{
                      g.oldestCaricoDate ? (g.oldestCaricoDate | date: 'dd/MM/yyyy' : 'UTC') : '-'
                    }}
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="5">
                    <div class="empty-state">
                      <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessuna giacenza</span>
                      <p>Non risultano movimenti di carico/scarico registrati.</p>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </section>
      </ng-container>

      <app-soglie-deposito-dialog
        [visible]="soglieAperte()"
        (visibleChange)="soglieAperte.set($event)"
        [configurazione]="soglieConfigurate()"
        [registroIniziale]="registroSel()"
        (salvato)="reload()"
      ></app-soglie-deposito-dialog>
    </div>
  `,
  styles: [
    `
      .giacenze-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }

      .stat-card--alert {
        border-color: var(--color-warning);
        background: var(--color-warning-bg);
      }

      .empty-state--compact {
        padding: var(--spacing-lg);
      }
      .empty-state__icon--danger {
        color: var(--color-danger);
      }
      .empty-state__icon--success {
        color: var(--color-success);
      }

      .alert-banner {
        border: 1px solid var(--surface-border);
        border-left: 4px solid var(--color-warning);
        border-radius: var(--radius-md);
        padding: var(--spacing-md) var(--spacing-base);
        background: var(--color-gray-50);
      }

      .alert-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }

      .alert-cer {
        font-size: var(--font-size-base);
      }
      .alert-qty {
        color: var(--text-secondary);
      }

      .alert-tags {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .alert-days {
        color: var(--text-tertiary);
        font-size: var(--font-size-sm);
      }

      .giacenze-label {
        display: block;
        margin-bottom: var(--spacing-xs, 0.25rem);
        font-weight: 600;
      }
      .giacenze-nota {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .soglie-box {
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md) var(--spacing-base);
        background: var(--color-gray-50);
      }
      .alert-banner--danger {
        border-left-color: var(--color-danger);
      }
      .lotti-lista {
        margin: 0 0 var(--spacing-sm);
        padding-left: var(--spacing-lg, 1.25rem);
      }
      .ml-2 {
        margin-left: var(--spacing-sm);
      }
      .mt-2 {
        margin-top: var(--spacing-sm);
      }

      .giacenze-altra-unita {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }

      .mt-1 {
        margin-top: var(--spacing-xs, 0.25rem);
      }

      .text-right {
        text-align: right;
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
    `,
  ],
})
export class GiacenzeComponent implements OnInit, OnDestroy {
  private readonly giacenzeService = inject(GiacenzeService)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)

  readonly giacenze = signal<Giacenza[]>([])
  readonly deposito = signal<DepositoTemporaneoVista | null>(null)
  readonly soglieConfigurate = signal<ConfigurazioneSoglie | null>(null)
  readonly soglieAperte = signal(false)
  readonly registri = signal<RegistroVista[]>([])
  /** Registro scelto; null = tutte le sedi. */
  readonly registroSel = signal<string | null>(null)
  readonly loading = signal(false)
  readonly error = signal<string | null>(null)
  /** Caricamento in corso: va annullato prima di un altro, o la risposta vecchia vincerebbe. */
  private caricamento?: Subscription
  private readonly lottiAperti = signal<ReadonlySet<string>>(new Set())

  readonly piuRegistri = computed(() => this.registri().length > 1)
  readonly opzioniRegistro = computed(() => [
    { label: 'Tutte le sedi', value: TUTTE_LE_SEDI },
    ...this.registri().map(r => ({ label: etichettaRegistro(r), value: r.id })),
  ])

  /** Somma delle giacenze (kg) su tutti i codici CER. */
  readonly totalGiacenzaKg = computed(() =>
    this.giacenze().reduce((sum, g) => sum + (g.giacenzaKg ?? 0), 0)
  )

  private contaAvvisi(livello: 'SUPERATO' | 'PREAVVISO'): number {
    return (this.deposito()?.registri ?? []).reduce(
      (n, r) => n + r.avvisi.filter(a => a.livello === livello).length,
      0
    )
  }
  readonly superamenti = computed(() => this.contaAvvisi('SUPERATO'))
  readonly preavvisi = computed(() => this.contaAvvisi('PREAVVISO'))

  readonly formattaQuantita = formattaQuantita
  readonly formattaGiorno = formattaGiorno

  ngOnInit(): void {
    this.loading.set(true)
    this.registroService.listRegistri().subscribe({
      next: registri => {
        this.registri.set(registri ?? [])
        this.registroSel.set(this.piuRegistri() ? (registroPredefinito(registri) ?? null) : null)
        this.reload()
      },
      error: () => {
        this.loading.set(false)
        this.error.set('Impossibile caricare i registri.')
        this.toast.error('Errore nel caricamento dei registri')
      },
    })
  }

  ngOnDestroy(): void {
    this.caricamento?.unsubscribe()
  }

  cambiaRegistro(valore: string | null): void {
    this.registroSel.set(valore || null)
    this.reload()
  }

  reload(): void {
    const registroId = this.registroSel() ?? undefined
    this.caricamento?.unsubscribe()
    this.loading.set(true)
    this.error.set(null)
    this.caricamento = forkJoin({
      giacenze: this.giacenzeService.getGiacenze(registroId),
      deposito: this.giacenzeService.getDepositoTemporaneo(registroId),
      // Le note delle soglie sono accessorie: se mancano la pagina funziona lo stesso.
      soglie: this.giacenzeService.getSoglie().pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ giacenze, deposito, soglie }) => {
        this.giacenze.set(giacenze ?? [])
        this.deposito.set(deposito)
        this.soglieConfigurate.set(soglie)
        this.lottiAperti.set(new Set())
        this.loading.set(false)
      },
      error: () => {
        this.error.set('Impossibile caricare le giacenze e il deposito temporaneo.')
        this.toast.error('Errore nel caricamento delle giacenze')
        this.loading.set(false)
      },
    })
  }

  trackRegistro = (_: number, r: DepositoRegistro): string => r.registroId

  private chiave(reg: DepositoRegistro, c: DepositoCer): string {
    return `${reg.registroId}|${c.cerCode}`
  }
  espanso(reg: DepositoRegistro, c: DepositoCer): boolean {
    return this.lottiAperti().has(this.chiave(reg, c))
  }
  toggleLotti(reg: DepositoRegistro, c: DepositoCer): void {
    const k = this.chiave(reg, c)
    const nuovo = new Set(this.lottiAperti())
    if (!nuovo.delete(k)) nuovo.add(k)
    this.lottiAperti.set(nuovo)
  }

  testoOrigine(s: SoglieApplicate): string {
    switch (s.origine) {
      case 'REGISTRO':
        return 'di questa sede'
      case 'AZIENDA':
        return "dell'azienda"
      default:
        return 'predefinite'
    }
  }

  testoCriterio(s: SoglieApplicate): string {
    if (s.criterio === 'TEMPORALE') {
      const extra = s.giorniMax ? ` e comunque entro ${s.giorniMax} giorni` : ''
      return `Temporale: avvio entro tre mesi di calendario${extra}`
    }
    if (s.criterio === 'QUANTITATIVO') {
      return (
        `Quantitativo: ${formattaQuantita(s.kgMaxTotale)} kg complessivi, di cui ` +
        `${formattaQuantita(s.kgMaxPericolosi)} kg pericolosi, e comunque entro un anno`
      )
    }
    return 'Criterio non scelto: si controllano entrambi'
  }

  testoConversione(s: SoglieApplicate): string {
    const base =
      'I limiti di legge sono in m³ (30 m³, di cui 10 m³ di rifiuti pericolosi): i controlli usano i kg indicati qui sopra.'
    return s.origine === 'PREDEFINITA'
      ? `${base} I valori predefiniti convertono 1 m³ in 1.000 kg.`
      : `${base} La conversione è stata indicata dall'azienda.`
  }

  /** Nota inserita dall'azienda per le soglie che valgono per il registro, se c'è. */
  noteSoglie(reg: DepositoRegistro): string | null {
    const conf = this.soglieConfigurate()
    if (!conf) return null
    if (reg.soglie.origine === 'REGISTRO') {
      return conf.registri.find(r => r.registroId === reg.registroId)?.soglie?.note || null
    }
    if (reg.soglie.origine === 'AZIENDA') return conf.azienda?.note || null
    return null
  }
}
