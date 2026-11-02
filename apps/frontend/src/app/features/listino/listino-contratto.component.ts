import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { Subject, takeUntil } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { ClientiService } from '../clienti/clienti.service'
import {
  chiediConferma,
  messaggioErrore,
  permessoScrittura,
} from '../clienti/tabelle/tabella-comune'
import { ETICHETTE_STATO_CONTRATTO } from '../clienti/vocabolario-clienti'
import {
  ContestoListino,
  DatiElenco,
  ElencoAddebiti,
  NuovoElenco,
  RigaAddebito,
} from './listino.model'
import { ListinoService } from './listino.service'

/** Data locale `YYYY-MM-DD`. */
export function oggiIso(adesso: Date = new Date()): string {
  const m = String(adesso.getMonth() + 1).padStart(2, '0')
  const g = String(adesso.getDate()).padStart(2, '0')
  return `${adesso.getFullYear()}-${m}-${g}`
}

/** Un elenco senza date vale sempre; con le date, solo dentro l'intervallo (estremi compresi). */
export function elencoValidoIl(
  e: Pick<DatiElenco, 'validoDal' | 'validoAl'>,
  giorno: string
): boolean {
  if (e.validoDal === null || e.validoAl === null) return true
  return e.validoDal <= giorno && giorno <= e.validoAl
}

const DECIMALI = /^(\d+)(?:\.(\d+))?$/

/** Stringa decimale non negativa come intero scalato a `scala` cifre (taglia le cifre in più). */
function scalato(v: string, scala: number): bigint | null {
  const m = DECIMALI.exec(v.trim())
  if (!m) return null
  const frazione = (m[2] ?? '').padEnd(scala, '0').slice(0, scala)
  return BigInt(m[1] + frazione)
}

/**
 * Totale annuo dei fissi (`TOTFISSI`): per ogni riga `F` quantità (vuota = 1, zero = non
 * fatturare) x prezzo x numero di scadenze "ogni anno" (anno vuoto). Aritmetica intera, due
 * decimali; le righe speciali o senza prezzo non contano. Copia di `totaleFissiAnnuo` del Task 17.
 */
export function totaleFissiAnnuo(
  righe: readonly {
    tipo: string
    quantitaFissa: string | null
    prezzo: string | null
    scadenze: readonly { anno: number | null }[]
  }[]
): string {
  // quantità (3 decimali) x prezzo (6 decimali) = scala 9
  let totale = 0n
  for (const r of righe) {
    if (r.tipo !== 'F' || r.prezzo === null) continue
    const prezzo = scalato(r.prezzo, 6)
    const quantita = r.quantitaFissa === null ? 1000n : scalato(r.quantitaFissa, 3)
    if (prezzo === null || quantita === null) continue
    const ognianno = BigInt(r.scadenze.filter(s => s.anno === null).length)
    totale += prezzo * quantita * ognianno
  }
  // da scala 9 a scala 2, arrotondando per eccesso da metà
  const centesimi = (totale + 5_000_000n) / 10_000_000n
  const intero = centesimi / 100n
  const cent = String(centesimi % 100n).padStart(2, '0')
  return `${intero}.${cent}`
}

/** `1234.50` come `1.234,50` (il locale italiano non è registrato: niente `DecimalPipe`). */
export function importoItaliano(v: string): string {
  const [intero, decimali = '00'] = v.split('.')
  return `${intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimali}`
}

const FORM_VUOTO = (): ModuloElenco => ({
  codice: '',
  descrizione: '',
  nota1: '',
  nota2: '',
  validoDal: '',
  validoAl: '',
  predefinito: false,
  codiceCig: '',
  codiceCup: '',
  idDocumentoPa: '',
  dataDocumentoPa: '',
})

interface ModuloElenco {
  codice: string
  descrizione: string
  nota1: string
  nota2: string
  validoDal: string
  validoAl: string
  predefinito: boolean
  codiceCig: string
  codiceCup: string
  idDocumentoPa: string
  dataDocumentoPa: string
}

const vuotoNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/**
 * Pagina del listino di un contratto (D28): intestazione, elenchi a sinistra e tavola delle righe
 * a destra. In sola lettura (VIEWER o contratto annullato) niente pulsanti di scrittura. Il
 * backend è l'arbitro delle regole: i suoi messaggi si mostrano com'è, il 409 con "Ricarica".
 * Il dialog della riga arriva con il Task 27: qui `apriRiga` memorizza la riga scelta.
 */
@Component({
  selector: 'app-listino-contratto',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    ConfirmDialogModule,
    DialogModule,
    InputTextModule,
    TableModule,
    TagModule,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <a routerLink="/contratti-clienti" class="indietro" data-testid="listino-indietro">
        <i class="pi pi-arrow-left" aria-hidden="true"></i> Contratti dei clienti
      </a>
      <p
        *ngIf="erroreCaricamento() as e"
        role="alert"
        class="field-error"
        data-testid="listino-errore"
      >
        {{ e }}
        <p-button
          label="Ricarica"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="ricarica()"
          data-testid="listino-ricarica"
        />
      </p>

      <header *ngIf="contesto() as c" class="intestazione" data-testid="listino-intestazione">
        <h1>Listino del contratto {{ c.contratto.numero }}</h1>
        <div class="intestazione__dati">
          <span data-testid="listino-cliente" *ngIf="cliente() as cl">{{ cl }}</span>
          <p-tag
            [value]="etichettaStato(c.contratto.stato)"
            [severity]="c.contratto.stato === 'ANNULLATO' ? 'danger' : 'info'"
            data-testid="listino-stato"
          />
          <span *ngIf="c.contratto.contrattoPrincipale as p" data-testid="listino-allegato-a">
            Allegato al contratto {{ p.numero }}
          </span>
        </div>
        <p *ngIf="soloLettura()" class="field-hint" data-testid="listino-sola-lettura">
          {{
            annullato()
              ? 'Il listino di un contratto annullato non si modifica.'
              : 'Hai accesso in sola lettura.'
          }}
        </p>
      </header>

      <div class="colonne" *ngIf="contesto()">
        <aside class="elenchi" aria-label="Elenchi degli addebiti">
          <div class="elenchi__barra">
            <label class="spunta" for="listino-solo-validi">
              <p-checkbox
                inputId="listino-solo-validi"
                [binary]="true"
                [ngModel]="soloValidi()"
                (ngModelChange)="soloValidi.set($event)"
                data-testid="listino-solo-validi"
              />
              Solo validi oggi
            </label>
            <p-button
              *ngIf="!soloLettura()"
              label="Nuovo elenco"
              icon="pi pi-plus"
              size="small"
              (onClick)="apriElenco(null)"
              data-testid="listino-nuovo-elenco"
            />
          </div>
          <p *ngIf="elenchiVisibili().length === 0" data-testid="listino-nessun-elenco">
            Nessun elenco.
          </p>
          <ul class="lista-elenchi">
            <li
              *ngFor="let e of elenchiVisibili()"
              [class.scelto]="e.id === elencoScelto()?.id"
              [attr.data-testid]="'listino-elenco-' + e.id"
            >
              <button
                type="button"
                class="elenco-voce"
                [attr.aria-pressed]="e.id === elencoScelto()?.id"
                (click)="scegliElenco(e)"
                [attr.data-testid]="'listino-scegli-' + e.id"
              >
                <strong>{{ e.codice }}</strong> {{ e.descrizione }}
                <span class="validita" *ngIf="e.validoDal && e.validoAl">
                  dal {{ e.validoDal | date: 'dd/MM/yyyy' }} al
                  {{ e.validoAl | date: 'dd/MM/yyyy' }}
                </span>
              </button>
              <p-tag
                *ngIf="e.predefinito"
                value="Predefinito"
                severity="success"
                [attr.data-testid]="'listino-predefinito-' + e.id"
              />
              <span class="azioni" *ngIf="!soloLettura() && e.modificabile">
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  [ariaLabel]="'Modifica l’elenco ' + e.codice"
                  (onClick)="apriElenco(e)"
                  [attr.data-testid]="'listino-modifica-' + e.id"
                />
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  size="small"
                  [ariaLabel]="'Elimina l’elenco ' + e.codice"
                  (onClick)="eliminaElenco(e)"
                  [attr.data-testid]="'listino-elimina-' + e.id"
                />
              </span>
            </li>
          </ul>
        </aside>

        <div class="righe">
          <p *ngIf="!elencoScelto()" data-testid="listino-scegli-un-elenco">
            Scegli un elenco per vedere le righe.
          </p>
          <ng-container *ngIf="elencoScelto() as el">
            <h2>Elenco {{ el.codice }} - {{ el.descrizione }}</h2>
            <p
              *ngIf="erroreRighe() as e"
              role="alert"
              class="field-error"
              data-testid="listino-errore-righe"
            >
              {{ e }}
            </p>
            <p-table
              [value]="righe()"
              [loading]="caricamentoRighe()"
              styleClass="p-datatable-sm"
              [scrollable]="true"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">CER / addebito</th>
                  <th scope="col">Rif.</th>
                  <th scope="col">Descrizione</th>
                  <th scope="col">U.M.</th>
                  <th scope="col">Quantità</th>
                  <th scope="col">Prezzo</th>
                  <th scope="col">Sconto</th>
                  <th scope="col">IVA</th>
                  <th scope="col">Provvigione</th>
                  <th scope="col">Cond.</th>
                  <th scope="col">Minimo</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Appunti</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-r>
                <tr
                  tabindex="0"
                  (dblclick)="apriRiga(r)"
                  (keydown.enter)="apriRiga(r)"
                  [attr.data-testid]="'listino-riga-' + r.id"
                >
                  <td [attr.title]="r.etichettaTipo">{{ r.tipo }}</td>
                  <td>{{ r.cerCode ?? r.addebito?.codice }}</td>
                  <td>{{ r.riferimento }}</td>
                  <td>{{ r.descrizione ?? r.addebito?.descrizione }}</td>
                  <td>{{ r.unitaMisura }}</td>
                  <td>{{ quantita(r) }}</td>
                  <td>{{ r.prezzoSpeciale ? 'speciale' : r.prezzo }}</td>
                  <td>{{ r.sconto }}</td>
                  <td>{{ r.codiceIva.codice }}</td>
                  <td>{{ r.provvigione }}</td>
                  <td>{{ r.condizione }}</td>
                  <td>{{ r.minimoFatturabile }}</td>
                  <td>{{ r.categoria?.descrizione }}</td>
                  <td>{{ r.appunti }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="14">Nessuna riga.</td>
                </tr>
              </ng-template>
            </p-table>
            <p class="totale" data-testid="listino-totale-fissi">
              Totale fissi: {{ totaleFissiTesto() }}
            </p>
          </ng-container>
        </div>
      </div>

      <p-dialog
        [visible]="elencoDialogAperto()"
        (visibleChange)="chiudiElenco()"
        [modal]="true"
        [style]="{ width: '40rem', maxWidth: '95vw' }"
        [header]="elencoInModifica() ? 'Modifica elenco' : 'Nuovo elenco'"
        [closable]="!inCorso()"
      >
        <form class="modulo" (ngSubmit)="salvaElenco()" id="listino-elenco-form">
          <label for="el-codice">Codice</label>
          <input
            pInputText
            id="el-codice"
            name="codice"
            maxlength="3"
            [(ngModel)]="modulo.codice"
          />
          <label for="el-descrizione">Descrizione</label>
          <input
            pInputText
            id="el-descrizione"
            name="descrizione"
            maxlength="45"
            [(ngModel)]="modulo.descrizione"
            required
          />
          <label for="el-nota1">Nota 1</label>
          <input pInputText id="el-nota1" name="nota1" maxlength="45" [(ngModel)]="modulo.nota1" />
          <label for="el-nota2">Nota 2</label>
          <input pInputText id="el-nota2" name="nota2" maxlength="45" [(ngModel)]="modulo.nota2" />
          <label for="el-dal">Valido dal</label>
          <input pInputText id="el-dal" name="dal" type="date" [(ngModel)]="modulo.validoDal" />
          <label for="el-al">Valido al</label>
          <input pInputText id="el-al" name="al" type="date" [(ngModel)]="modulo.validoAl" />
          <label for="el-cig">CIG</label>
          <input pInputText id="el-cig" name="cig" maxlength="10" [(ngModel)]="modulo.codiceCig" />
          <label for="el-cup">CUP</label>
          <input pInputText id="el-cup" name="cup" maxlength="15" [(ngModel)]="modulo.codiceCup" />
          <label for="el-idpa">Id documento PA</label>
          <input pInputText id="el-idpa" name="idpa" [(ngModel)]="modulo.idDocumentoPa" />
          <label for="el-datapa">Data documento PA</label>
          <input
            pInputText
            id="el-datapa"
            name="datapa"
            type="date"
            [(ngModel)]="modulo.dataDocumentoPa"
          />
          <label class="spunta" for="el-predefinito">
            <input
              type="checkbox"
              id="el-predefinito"
              name="predefinito"
              [(ngModel)]="modulo.predefinito"
              data-testid="listino-elenco-predefinito"
            />
            Elenco predefinito
          </label>
        </form>
        <p
          *ngIf="erroreElenco() as e"
          role="alert"
          class="field-error"
          data-testid="listino-elenco-errore"
        >
          {{ e }}
        </p>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            [disabled]="inCorso()"
            (onClick)="chiudiElenco()"
          />
          <p-button
            label="Salva"
            icon="pi pi-check"
            [disabled]="inCorso() || modulo.descrizione.trim() === ''"
            (onClick)="salvaElenco()"
            data-testid="listino-elenco-salva"
          />
        </ng-template>
      </p-dialog>
      <p-confirmDialog />
    </section>
  `,
  styles: [
    `
      .pagina {
        padding: 1rem;
      }
      .indietro {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .intestazione__dati {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .colonne {
        display: grid;
        grid-template-columns: minmax(16rem, 22rem) 1fr;
        gap: 1rem;
        margin-top: 1rem;
      }
      @media (max-width: 900px) {
        .colonne {
          grid-template-columns: 1fr;
        }
      }
      .elenchi__barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
      }
      .lista-elenchi {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .lista-elenchi li {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
        padding: 0.25rem 0.5rem;
        border-left: 3px solid transparent;
      }
      .lista-elenchi li.scelto {
        border-left-color: var(--primary-color);
        background: var(--surface-100);
      }
      .elenco-voce {
        background: none;
        border: 0;
        text-align: left;
        cursor: pointer;
        flex: 1;
        font: inherit;
      }
      .validita {
        display: block;
        font-size: 0.85em;
        color: var(--text-color-secondary);
      }
      .modulo {
        display: grid;
        grid-template-columns: 10rem 1fr;
        gap: 0.5rem 0.75rem;
        align-items: center;
      }
      .totale {
        text-align: right;
        font-weight: 600;
      }
    `,
  ],
})
export class ListinoContrattoComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly clienti = inject(ClientiService)
  private readonly rotta = inject(ActivatedRoute)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()

  readonly contrattoId = this.rotta.snapshot.paramMap.get('id') ?? ''
  readonly contesto = signal<ContestoListino | null>(null)
  readonly cliente = signal<string | null>(null)
  readonly elenchi = signal<ElencoAddebiti[]>([])
  readonly soloValidi = signal(false)
  readonly elencoScelto = signal<ElencoAddebiti | null>(null)
  readonly righe = signal<RigaAddebito[]>([])
  readonly caricamentoRighe = signal(false)
  readonly erroreCaricamento = signal<string | null>(null)
  readonly erroreRighe = signal<string | null>(null)

  /** La riga su cui si è fatto doppio clic: il dialog arriva con il Task 27. */
  readonly rigaAperta = signal<RigaAddebito | null>(null)

  readonly elencoDialogAperto = signal(false)
  readonly elencoInModifica = signal<ElencoAddebiti | null>(null)
  readonly erroreElenco = signal<string | null>(null)
  readonly inCorso = signal(false)
  modulo: ModuloElenco = FORM_VUOTO()

  readonly annullato = computed(() => this.contesto()?.contratto.stato === 'ANNULLATO')
  /** VIEWER o contratto annullato (D16): niente scritture. */
  readonly soloLettura = computed(() => !this.puoScrivere() || this.annullato())
  readonly elenchiVisibili = computed(() => {
    const oggi = oggiIso()
    return this.soloValidi() ? this.elenchi().filter(e => elencoValidoIl(e, oggi)) : this.elenchi()
  })
  readonly totaleFissi = computed(() => totaleFissiAnnuo(this.righe()))
  readonly totaleFissiTesto = computed(() => importoItaliano(this.totaleFissi()))

  private readonly distrutto = new Subject<void>()
  private annullaRighe = new Subject<void>()

  ngOnInit(): void {
    this.carica()
    this.clienti.contratti
      .get(this.contrattoId)
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: c => this.cliente.set(c.cliente.ragioneSociale),
        error: () => this.cliente.set(null),
      })
  }

  ngOnDestroy(): void {
    this.annullaRighe.next()
    this.distrutto.next()
  }

  etichettaStato(stato: string): string {
    return (ETICHETTE_STATO_CONTRATTO as Record<string, string>)[stato] ?? stato
  }

  quantita(r: RigaAddebito): string {
    if (r.tipo === 'F') return r.quantitaFissa ?? '1'
    return r.tipoQuantita ?? ''
  }

  /** Ricarica elenchi e righe: dopo un 409 la vista è vecchia. */
  ricarica(): void {
    this.carica()
  }

  carica(): void {
    this.servizio.elenchi
      .delContratto(this.contrattoId)
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: r => {
          this.contesto.set(r.contesto)
          this.elenchi.set(r.elenchi)
          this.erroreCaricamento.set(null)
          const scelto = this.elencoScelto()
          const aggiornato = scelto ? (r.elenchi.find(e => e.id === scelto.id) ?? null) : null
          this.elencoScelto.set(aggiornato)
          if (aggiornato) this.caricaRighe(aggiornato)
          else this.righe.set([])
        },
        error: err =>
          this.erroreCaricamento.set(messaggioErrore(err, 'Impossibile caricare il listino.')),
      })
  }

  scegliElenco(e: ElencoAddebiti): void {
    this.elencoScelto.set(e)
    this.caricaRighe(e)
  }

  private caricaRighe(e: ElencoAddebiti): void {
    this.annullaRighe.next()
    this.caricamentoRighe.set(true)
    this.erroreRighe.set(null)
    this.servizio.righe
      .list(e.id)
      .pipe(takeUntil(this.annullaRighe), takeUntil(this.distrutto))
      .subscribe({
        next: r => {
          this.righe.set(r)
          this.caricamentoRighe.set(false)
        },
        error: err => {
          this.righe.set([])
          this.caricamentoRighe.set(false)
          this.erroreRighe.set(messaggioErrore(err, 'Impossibile caricare le righe.'))
        },
      })
  }

  apriRiga(r: RigaAddebito): void {
    this.rigaAperta.set(r)
  }

  // --- elenchi ------------------------------------------------------------------------------

  apriElenco(e: ElencoAddebiti | null): void {
    if (this.soloLettura()) return
    this.erroreElenco.set(null)
    this.elencoInModifica.set(e)
    this.modulo = e
      ? {
          codice: e.codice,
          descrizione: e.descrizione,
          nota1: e.nota1 ?? '',
          nota2: e.nota2 ?? '',
          validoDal: e.validoDal ?? '',
          validoAl: e.validoAl ?? '',
          predefinito: e.predefinito,
          codiceCig: e.codiceCig ?? '',
          codiceCup: e.codiceCup ?? '',
          idDocumentoPa: e.idDocumentoPa ?? '',
          dataDocumentoPa: e.dataDocumentoPa ?? '',
        }
      : FORM_VUOTO()
    this.elencoDialogAperto.set(true)
    if (!e) {
      // Il codice proposto è informativo: il server assegna il primo libero se resta vuoto.
      this.servizio.elenchi
        .prossimoCodice(this.contrattoId)
        .pipe(takeUntil(this.distrutto))
        .subscribe({
          next: codice => {
            if (this.modulo.codice === '' && this.elencoDialogAperto()) this.modulo.codice = codice
          },
          error: () => undefined,
        })
    }
  }

  chiudiElenco(): void {
    if (this.inCorso()) return
    this.elencoDialogAperto.set(false)
  }

  salvaElenco(): void {
    if (this.inCorso() || this.soloLettura() || this.modulo.descrizione.trim() === '') return
    const m = this.modulo
    const dati: NuovoElenco = {
      codice: m.codice.trim(),
      descrizione: m.descrizione.trim(),
      nota1: vuotoNull(m.nota1),
      nota2: vuotoNull(m.nota2),
      validoDal: vuotoNull(m.validoDal),
      validoAl: vuotoNull(m.validoAl),
      predefinito: m.predefinito,
      codiceCig: vuotoNull(m.codiceCig),
      codiceCup: vuotoNull(m.codiceCup),
      idDocumentoPa: vuotoNull(m.idDocumentoPa),
      dataDocumentoPa: vuotoNull(m.dataDocumentoPa),
    }
    const esistente = this.elencoInModifica()
    this.inCorso.set(true)
    this.erroreElenco.set(null)
    const richiesta = esistente
      ? this.servizio.elenchi.modifica(esistente.id, { ...dati, versione: esistente.versione })
      : this.servizio.elenchi.crea(this.contrattoId, dati)
    richiesta.pipe(takeUntil(this.distrutto)).subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.elencoDialogAperto.set(false)
        this.elencoScelto.set(salvato)
        this.carica()
      },
      error: err => {
        this.inCorso.set(false)
        this.erroreElenco.set(messaggioErrore(err, "Impossibile salvare l'elenco."))
        // Dopo un conflitto di versione l'elenco in modifica è vecchio: si rilegge sotto.
        if (esistente && err?.status === 409) this.carica()
      },
    })
  }

  eliminaElenco(e: ElencoAddebiti): void {
    if (this.soloLettura()) return
    chiediConferma(this.conferma, `Eliminare l’elenco ${e.codice} e le sue ${e.righe} righe?`, () =>
      this.eliminaConfermato(e)
    )
  }

  eliminaConfermato(e: ElencoAddebiti): void {
    this.servizio.elenchi
      .elimina(e.id, e.versione)
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: () => {
          if (this.elencoScelto()?.id === e.id) this.elencoScelto.set(null)
          this.carica()
        },
        error: err => {
          const messaggio = messaggioErrore(err, "Impossibile eliminare l'elenco.")
          if (err?.status === 409) {
            // Versione vecchia: si mostra il messaggio con "Ricarica", senza rileggere di nascosto.
            this.erroreCaricamento.set(messaggio)
            return
          }
          this.toast.error(messaggio)
          this.carica()
        },
      })
  }
}
