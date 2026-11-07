import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { Observable, Subject, catchError, map, of, switchMap } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { leggiErroriAzione } from '../../listino/errori-azione'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import {
  AdattatoreVista,
  ChiaveMancante,
  MAX_VALORE_MAPPATURA,
  MAX_VOCI_MAPPATURE,
  MappaturaVista,
  TIPI_MAPPATURA,
  TipoMappatura,
  VoceMappatura,
} from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { permessiFatturazione } from '../permessi-fatturazione'
import { ERRORI_HTTP_VOCI } from '../vocabolario-fatturazione'

/** Titoli delle sezioni, nell'ordine in cui compaiono. */
export const TITOLI_TIPI_MAPPATURA: Readonly<Record<TipoMappatura, string>> = {
  CODICE_IVA: 'Codici IVA',
  CONTO_RICAVI: 'Conti ricavi',
  CLIENTE: 'Clienti',
  PAGAMENTO: 'Condizioni di pagamento',
  REGISTRO: 'Registri IVA',
}

const MESSAGGIO_SALVATO = 'Mappature salvate.'
const MESSAGGIO_VERSIONE_SUPERATA = ERRORI_HTTP_VOCI.VERSIONE_SUPERATA.etichetta

/** Una riga della pagina: una voce salvata oppure una chiave mancante ancora da compilare. */
export interface RigaMappatura {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** Solo per le chiavi arrivate da un export respinto (`MAPPATURE_MANCANTI`). */
  etichetta: string | null
  /** Valore salvato sul server; `null` = voce mai salvata. */
  salvato: string | null
  /** Valore nel campo. */
  valore: string
}

interface Richiesta {
  adattatore: string | null
  messaggio: string | null
}

interface Caricamento {
  adattatori: AdattatoreVista[]
  mappature: MappaturaVista[]
}

/** Chiavi mancanti passate dalla pagina dei documenti (`history.state`); ignora il resto. */
export function mancantiDaStato(stato: unknown): ChiaveMancante[] {
  const elenco = (stato as { mancanti?: unknown } | null)?.mancanti
  if (!Array.isArray(elenco)) return []
  return elenco.filter(
    (x): x is ChiaveMancante =>
      typeof x === 'object' &&
      x !== null &&
      (TIPI_MAPPATURA as readonly string[]).includes((x as ChiaveMancante).tipo) &&
      typeof (x as ChiaveMancante).chiaveWasteflow === 'string' &&
      (x as ChiaveMancante).chiaveWasteflow.length > 0 &&
      typeof (x as ChiaveMancante).etichetta === 'string'
  )
}

const chiaveRiga = (r: { tipo: TipoMappatura; chiaveWasteflow: string }): string =>
  `${r.tipo}:${r.chiaveWasteflow}`

/**
 * Pagina «Export contabile»: le mappature fra le chiavi di WasteFlow (codici IVA, conti ricavi,
 * clienti, pagamenti, registri) e i codici del gestionale scelto. Solo ADMIN e SUPER_ADMIN, come
 * le rotte del backend. Le chiavi mancanti arrivano da un export respinto (`history.state`).
 */
@Component({
  selector: 'app-mappature',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, InputTextModule],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Export contabile</h1>
          <p class="page-subtitle">
            <ng-container *ngIf="adattatore() as a; else sottotitolo"
              >Mappature per {{ a.nome }}: i codici di WasteFlow e i loro corrispondenti nel
              gestionale.</ng-container
            >
            <ng-template #sottotitolo>Le mappature per il gestionale contabile.</ng-template>
          </p>
        </div>
        <div class="page-actions">
          <p-button
            *ngIf="adattatore() && permessi().imposta"
            label="Salva"
            icon="pi pi-check"
            [disabled]="!puoSalvare()"
            [loading]="inCorso()"
            (onClick)="salva()"
            data-testid="mappature-salva"
          />
        </div>
      </header>

      <p
        *ngIf="!permessi().imposta"
        class="surface-card nota-pagina"
        role="status"
        data-testid="mappature-non-autorizzato"
      >
        Solo gli amministratori possono gestire le mappature dell'export contabile.
      </p>

      <ng-container *ngIf="permessi().imposta">
        <div
          *ngIf="adattatore() && !adattatore()!.verificato"
          class="avviso-tracciato"
          role="note"
          data-testid="mappature-non-verificato"
        >
          <strong>Tracciato non verificato su un'installazione reale.</strong>
          Prima di usare il file in produzione, fallo controllare dal tuo gestionale o dal
          commercialista.
        </div>

        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="mappature-errore">
          {{ e }}
          <p-button
            *ngIf="puoRiprovare()"
            label="Riprova"
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="ricarica()"
            data-testid="mappature-riprova"
          />
        </p>

        <p
          *ngIf="caricamento()"
          class="surface-card"
          role="status"
          data-testid="mappature-caricamento"
        >
          Caricamento in corso...
        </p>

        <section *ngIf="vuoto()" class="surface-card empty-state" data-testid="mappature-vuoto">
          <p>Nessun gestionale contabile è ancora disponibile per questa azienda.</p>
        </section>

        <section
          *ngIf="!adattatore() && adattatori().length > 0 && !caricamento()"
          class="surface-card"
          data-testid="mappature-adattatori"
        >
          <h2 class="titolo-sezione">Gestionali disponibili</h2>
          <ul class="elenco-adattatori">
            <li *ngFor="let a of adattatori(); trackBy: perCodice">
              <a
                [routerLink]="['/fatturazione/export-contabile', a.codice]"
                [attr.data-testid]="'mappature-adattatore-' + a.codice"
                >{{ a.nome }}</a
              >
            </li>
          </ul>
        </section>

        <ng-container *ngIf="adattatore() && !caricamento()">
          <section
            *ngIf="mancanti().length > 0"
            class="surface-card mancanti"
            role="status"
            data-testid="mappature-mancanti"
          >
            <h2 class="titolo-sezione">Mappature mancanti</h2>
            <p>Per esportare servono ancora questi corrispondenti:</p>
            <ul>
              <li *ngFor="let r of mancanti(); trackBy: perRiga">
                {{ titoli[r.tipo] }}: {{ r.etichetta || r.chiaveWasteflow }}
              </li>
            </ul>
          </section>

          <p
            *ngIf="righe().length === 0"
            class="surface-card nota-pagina"
            data-testid="mappature-nessuna"
          >
            Nessuna mappatura: compariranno quando un export ne richiederà.
          </p>

          <section
            *ngFor="let s of sezioni(); trackBy: perSezione"
            class="surface-card"
            [attr.data-testid]="'mappature-sezione-' + s.tipo"
          >
            <h2 class="titolo-sezione">{{ titoli[s.tipo] }}</h2>
            <table class="mappature">
              <caption class="sr-only">
                {{
                  titoli[s.tipo]
                }}: chiave di WasteFlow e valore nel gestionale
              </caption>
              <thead>
                <tr>
                  <th scope="col">Chiave WasteFlow</th>
                  <th scope="col">Descrizione</th>
                  <th scope="col">Valore nel gestionale</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let r of s.righe; trackBy: perRiga"
                  [attr.data-testid]="'mappature-riga-' + r.tipo + '-' + r.chiaveWasteflow"
                >
                  <th scope="row">{{ r.chiaveWasteflow }}</th>
                  <td>{{ r.etichetta || '—' }}</td>
                  <td>
                    <input
                      pInputText
                      type="text"
                      [id]="'mappatura-' + r.tipo + '-' + r.chiaveWasteflow"
                      [attr.aria-label]="
                        'Valore nel gestionale per ' +
                        titoli[r.tipo] +
                        ' ' +
                        (r.etichetta || r.chiaveWasteflow)
                      "
                      [maxLength]="maxValore"
                      [ngModel]="r.valore"
                      (ngModelChange)="modifica(r, $event)"
                      autocomplete="off"
                      [attr.data-testid]="'mappature-valore-' + r.tipo + '-' + r.chiaveWasteflow"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </ng-container>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .avviso-tracciato {
        border: 1px solid var(--yellow-500, #eab308);
        background: color-mix(in srgb, var(--yellow-500, #eab308) 12%, transparent);
        border-radius: var(--border-radius, 6px);
        padding: var(--spacing-base) var(--spacing-lg, 1rem);
        margin-bottom: var(--spacing-base);
      }
      .titolo-sezione {
        font-size: 1.05rem;
        margin: 0 0 var(--spacing-sm, 0.5rem);
      }
      .surface-card + .surface-card {
        margin-top: var(--spacing-base);
      }
      .mappature {
        border-collapse: collapse;
        width: 100%;
        position: relative;
      }
      .mappature th,
      .mappature td {
        text-align: left;
        padding: 0.35rem 0.75rem 0.35rem 0;
        border-bottom: 1px solid var(--surface-border);
      }
      .mappature input {
        width: 100%;
        max-width: 16rem;
      }
      .elenco-adattatori {
        margin: 0;
        padding-left: 1.25rem;
      }
    `,
  ],
})
export class MappatureComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly route = inject(ActivatedRoute)
  private readonly distruzione = inject(DestroyRef)

  readonly titoli = TITOLI_TIPI_MAPPATURA
  readonly maxValore = MAX_VALORE_MAPPATURA

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly adattatori = signal<AdattatoreVista[]>([])
  readonly adattatore = signal<AdattatoreVista | null>(null)
  readonly righe = signal<RigaMappatura[]>([])
  readonly caricamento = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  /** Dopo un errore di caricamento si offre «Riprova». */
  readonly puoRiprovare = signal(false)
  /** Nessun adattatore registrato (dopo il caricamento). */
  readonly vuoto = signal(false)

  /** Chiavi richieste da un export respinto: restano finché non hanno un valore. */
  private mancantiRicevute: ChiaveMancante[] = mancantiDaStato(history.state)
  private codiceCorrente: string | null = null
  private readonly richieste$ = new Subject<Richiesta>()

  readonly mancanti = computed(() =>
    this.righe().filter(r => r.etichetta !== null && r.valore.trim() === '' && r.salvato === null)
  )

  readonly sezioni = computed(() =>
    TIPI_MAPPATURA.map(tipo => ({ tipo, righe: this.righe().filter(r => r.tipo === tipo) })).filter(
      s => s.righe.length > 0
    )
  )

  private readonly voci = computed<VoceMappatura[]>(() => {
    const voci: VoceMappatura[] = []
    for (const r of this.righe()) {
      const nuovo = r.valore.trim()
      if (nuovo === (r.salvato ?? '')) continue
      voci.push({
        tipo: r.tipo,
        chiaveWasteflow: r.chiaveWasteflow,
        valore: nuovo === '' ? null : nuovo,
      })
    }
    return voci
  })

  readonly puoSalvare = computed(() => this.voci().length > 0 && !this.inCorso())

  constructor() {
    this.richieste$
      .pipe(
        switchMap(r => this.carica$(r)),
        takeUntilDestroyed()
      )
      .subscribe()
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(p => {
      this.codiceCorrente = p.get('adattatore')
      this.richieste$.next({ adattatore: this.codiceCorrente, messaggio: null })
    })
  }

  perCodice = (_: number, a: AdattatoreVista): string => a.codice
  perRiga = (
    _: number,
    r: RigaMappatura | { tipo: TipoMappatura; chiaveWasteflow: string }
  ): string => chiaveRiga(r)
  perSezione = (_: number, s: { tipo: TipoMappatura }): string => s.tipo

  /** Rilegge adattatori e mappature; un eventuale messaggio resta visibile dopo la rilettura. */
  ricarica(messaggio: string | null = null): void {
    this.richieste$.next({ adattatore: this.codiceCorrente, messaggio })
  }

  modifica(riga: RigaMappatura, valore: string | null): void {
    this.righe.update(l => l.map(r => (r === riga ? { ...r, valore: valore ?? '' } : r)))
  }

  salva(): void {
    const codice = this.adattatore()?.codice
    const voci = this.voci()
    if (!codice || voci.length === 0 || this.inCorso()) return
    if (voci.length > MAX_VOCI_MAPPATURE) {
      this.errore.set(ERRORI_HTTP_VOCI.TROPPE_VOCI.etichetta)
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio
      .salvaMappature(codice, voci)
      .pipe(takeUntilDestroyed(this.distruzione))
      .subscribe({
        next: salvate => {
          this.inCorso.set(false)
          this.righe.set(this.costruisciRighe(salvate, this.righe()))
          this.toast.success(MESSAGGIO_SALVATO, 'Export contabile')
        },
        error: err => {
          this.inCorso.set(false)
          if (leggiErroriAzione(err, '').rilettura) {
            this.ricarica(MESSAGGIO_VERSIONE_SUPERATA)
            return
          }
          this.errore.set(
            messaggiErroreFatturazione(err, 'Impossibile salvare le mappature.').join(' ')
          )
        },
      })
  }

  private carica$(r: Richiesta): Observable<null> {
    this.errore.set(r.messaggio)
    this.puoRiprovare.set(false)
    this.vuoto.set(false)
    if (!this.permessi().imposta) return of(null)
    this.caricamento.set(true)
    return this.servizio.adattatori().pipe(
      // Le mappature si chiedono solo per un adattatore che esiste.
      switchMap(adattatori =>
        r.adattatore && adattatori.some(a => a.codice === r.adattatore)
          ? this.servizio
              .mappature(r.adattatore)
              .pipe(map((mappature): Caricamento => ({ adattatori, mappature })))
          : of<Caricamento>({ adattatori, mappature: [] })
      ),
      map(esito => {
        this.applica(r, esito)
        return null
      }),
      catchError(err => {
        this.caricamento.set(false)
        this.errore.set(
          messaggiErroreFatturazione(err, 'Impossibile caricare le mappature.').join(' ')
        )
        this.puoRiprovare.set(true)
        return of(null)
      })
    )
  }

  private applica(r: Richiesta, esito: Caricamento): void {
    this.caricamento.set(false)
    this.adattatori.set(esito.adattatori)
    this.vuoto.set(esito.adattatori.length === 0)
    const scelto = r.adattatore
      ? (esito.adattatori.find(a => a.codice === r.adattatore) ?? null)
      : null
    this.adattatore.set(scelto)
    if (r.adattatore && !scelto && esito.adattatori.length > 0) {
      this.errore.set(ERRORI_HTTP_VOCI.ADATTATORE_SCONOSCIUTO.etichetta)
    }
    this.righe.set(scelto ? this.costruisciRighe(esito.mappature, []) : [])
  }

  /**
   * Righe = voci salvate + chiavi mancanti non ancora salvate. Nella rilettura dopo un salvataggio
   * le etichette note si conservano e i valori scritti ma non salvati (voci vuote) si perdono.
   */
  private costruisciRighe(salvate: MappaturaVista[], precedenti: RigaMappatura[]): RigaMappatura[] {
    const etichette = new Map<string, string>()
    for (const m of this.mancantiRicevute) etichette.set(chiaveRiga(m), m.etichetta)
    for (const p of precedenti) if (p.etichetta) etichette.set(chiaveRiga(p), p.etichetta)
    const righe: RigaMappatura[] = salvate.map(m => ({
      tipo: m.tipo,
      chiaveWasteflow: m.chiaveWasteflow,
      etichetta: etichette.get(chiaveRiga(m)) ?? null,
      salvato: m.valore,
      valore: m.valore,
    }))
    const presenti = new Set(righe.map(chiaveRiga))
    for (const m of this.mancantiRicevute) {
      if (presenti.has(chiaveRiga(m))) continue
      righe.push({
        tipo: m.tipo,
        chiaveWasteflow: m.chiaveWasteflow,
        etichetta: m.etichetta,
        salvato: null,
        valore: '',
      })
    }
    return righe.sort(
      (a, b) =>
        TIPI_MAPPATURA.indexOf(a.tipo) - TIPI_MAPPATURA.indexOf(b.tipo) ||
        a.chiaveWasteflow.localeCompare(b.chiaveWasteflow, 'it')
    )
  }
}
