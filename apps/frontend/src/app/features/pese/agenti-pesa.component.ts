/**
 * Scheda «Agenti» delle pese: i PC della pesa con il programma agente, il loro stato (in linea,
 * coda, orologio) e gli strumenti assegnati. La gestione (nuovo agente, nuovo codice, revoca,
 * assegnazione degli strumenti) e' degli amministratori: `puoGestire` arriva dal backend. Il
 * backend nasconde nome host e IP agli altri ruoli.
 */
import { CommonModule } from '@angular/common'
import { Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { MotivoDialogComponent } from './motivo-dialog.component'
import { NuovoAgenteDialogComponent } from './nuovo-agente-dialog.component'
import { messaggioErrorePese, scartoOrologioTesto, tempoDa, tempoTrascorso } from './pese-formato'
import { AgenteVista, PeseService, StrumentoPesa } from './pese.service'

const ETICHETTA_STATO_STRUMENTO: Record<string, string> = {
  OK: 'risponde',
  ERRORE: 'errore',
  NON_CONFIGURATO: 'non configurato',
}
const AGGIORNAMENTO_MS = 30_000

@Component({
  selector: 'app-pese-agenti',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    TableModule,
    NuovoAgenteDialogComponent,
    MotivoDialogComponent,
  ],
  template: `
    <div class="ag-barra">
      <p *ngIf="!puoGestire()" class="nota" data-testid="ag-sola-lettura">
        Gli agenti di pesa li gestisce un amministratore dell'azienda.
      </p>
      <p-button
        *ngIf="puoGestire()"
        label="Nuovo agente"
        icon="pi pi-plus"
        (onClick)="nuovo.set(true)"
        data-testid="ag-nuovo"
        ariaLabel="Aggiungi un agente di pesa"
      ></p-button>
    </div>
    <p class="nota ag-guida" data-testid="ag-guida">
      L'agente è il programma che legge la bilancia sul PC della pesa. Si installa con l'eseguibile
      <code>agente-pesa.exe</code>: prima di lanciarlo confronta la sua impronta SHA-256 con quella
      pubblicata nel README della release (file <code>agente-pesa.exe.sha256</code>). Quella della
      chiave di ogni agente la trovi nella tabella.
    </p>

    <p *ngIf="caricamento()" role="status" class="nota">Caricamento…</p>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error" data-testid="ag-errore-elenco">
      {{ e }}
    </p>

    <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="ag-tabella">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Agente</th>
          <th scope="col">Stato</th>
          <th scope="col">Ultimo contatto</th>
          <th scope="col">Coda e scarti</th>
          <th scope="col">Strumenti</th>
          <th scope="col" *ngIf="puoGestire()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-a>
        <tr [attr.data-testid]="'ag-riga-' + a.id">
          <td>
            <strong>{{ a.descrizione }}</strong>
            <div class="nota" *ngIf="a.registro">{{ a.registro.descrizione }}</div>
            <div class="nota" *ngIf="a.versioneAgente">Versione {{ a.versioneAgente }}</div>
            <div class="nota" *ngIf="a.nomeHost">PC: {{ a.nomeHost }}</div>
            <div class="nota" *ngIf="a.improntaChiave" [attr.data-testid]="'ag-impronta-' + a.id">
              Impronta chiave: <code>{{ a.improntaChiave }}</code>
            </div>
          </td>
          <td>
            <span
              class="badge"
              [class.badge-ok]="a.stato === 'ATTIVO' && a.inLinea"
              [class.badge-ko]="a.stato === 'REVOCATO' || (a.stato === 'ATTIVO' && !a.inLinea)"
              [attr.data-testid]="'ag-stato-' + a.id"
              >{{ etichettaStato(a) }}</span
            >
            <div class="nota" *ngIf="a.stato === 'IN_ATTESA' && a.codiceScadeIl">
              Codice valido fino alle {{ ora(a.codiceScadeIl) }}
            </div>
            <div class="nota" *ngIf="a.stato === 'REVOCATO' && a.motivoRevoca">
              {{ a.motivoRevoca }}
            </div>
          </td>
          <td>
            {{ contatto(a) }}
            <div class="avviso" *ngIf="scarto(a) as s" [attr.data-testid]="'ag-orologio-' + a.id">
              {{ s }}
            </div>
          </td>
          <td>
            <ng-container *ngIf="a.stato === 'ATTIVO'; else trattino">
              <span [attr.data-testid]="'ag-coda-' + a.id"
                >{{ a.codaInAttesa ?? 0 }} in attesa</span
              >
              <div class="nota" [class.avviso]="(a.lettureScartate ?? 0) > 0">
                {{ a.lettureScartate ?? 0 }} scartate
              </div>
            </ng-container>
            <ng-template #trattino>—</ng-template>
          </td>
          <td>
            <ul class="elenco-strumenti" *ngIf="a.strumenti.length; else nessuno">
              <li *ngFor="let s of a.strumenti">
                {{ s.descrizione }}
                <span class="nota"> · {{ statoStrumento(s.stato) }}</span>
                <div class="avviso" *ngIf="s.ultimoErrore">{{ s.ultimoErrore }}</div>
                <p-button
                  *ngIf="puoGestire() && a.stato !== 'REVOCATO'"
                  label="Libera"
                  [text]="true"
                  size="small"
                  (onClick)="libera(s.id)"
                  [attr.data-testid]="'ag-libera-' + s.id"
                  [ariaLabel]="'Libera lo strumento ' + s.descrizione"
                ></p-button>
              </li>
            </ul>
            <ng-template #nessuno
              ><span class="nota">Nessuno strumento assegnato</span></ng-template
            >
            <select
              *ngIf="puoGestire() && a.stato !== 'REVOCATO' && liberi(a).length"
              class="p-inputtext assegna"
              [attr.aria-label]="'Assegna uno strumento a ' + a.descrizione"
              [attr.data-testid]="'ag-assegna-' + a.id"
              (change)="assegna(a, $any($event.target))"
            >
              <option value="">Assegna uno strumento…</option>
              <option *ngFor="let s of liberi(a)" [value]="s.id">{{ s.descrizione }}</option>
            </select>
          </td>
          <td *ngIf="puoGestire()">
            <p-button
              *ngIf="a.stato === 'IN_ATTESA'"
              label="Nuovo codice"
              icon="pi pi-key"
              [text]="true"
              size="small"
              (onClick)="codiceDi.set(a)"
              [attr.data-testid]="'ag-codice-' + a.id"
              [ariaLabel]="'Genera un nuovo codice per ' + a.descrizione"
            ></p-button>
            <p-button
              *ngIf="a.stato !== 'REVOCATO'"
              label="Revoca"
              icon="pi pi-ban"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="revocaDi.set(a)"
              [attr.data-testid]="'ag-revoca-' + a.id"
              [ariaLabel]="'Revoca l\\'agente ' + a.descrizione"
            ></p-button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="puoGestire() ? 6 : 5">
            <span data-testid="ag-vuota">Nessun agente di pesa registrato.</span>
          </td>
        </tr>
      </ng-template>
    </p-table>

    <app-nuovo-agente-dialog
      *ngIf="nuovo()"
      [registri]="registri()"
      (fatto)="carica()"
      (chiuso)="nuovo.set(false)"
    ></app-nuovo-agente-dialog>
    <app-nuovo-agente-dialog
      *ngIf="codiceDi() as a"
      [agenteEsistente]="a"
      (fatto)="carica()"
      (chiuso)="codiceDi.set(null)"
    ></app-nuovo-agente-dialog>
    <app-motivo-dialog
      *ngIf="revocaDi() as a"
      titolo="Revoca dell'agente"
      [messaggio]="
        'L\\'agente «' +
        a.descrizione +
        '» non potrà più inviare letture. Le letture già arrivate restano. Per riusare il PC va creato un nuovo agente.'
      "
      etichettaConferma="Revoca"
      [inCorso]="revocaInCorso()"
      [errore]="erroreRevoca()"
      (conferma)="revoca(a, $event)"
      (annulla)="revocaDi.set(null)"
    ></app-motivo-dialog>
  `,
  styles: [
    `
      .ag-barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
      }
      .ag-guida {
        margin-bottom: var(--spacing-base);
      }
      .nota {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .avviso {
        font-size: var(--font-size-xs);
        color: var(--color-warning);
        font-weight: var(--font-weight-medium);
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
      }
      .badge {
        display: inline-block;
        padding: 0 var(--spacing-sm);
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }
      .badge-ok {
        color: var(--stato-ok-ink);
        background: var(--stato-ok-bg);
      }
      .badge-ko {
        color: var(--stato-err-ink);
        background: var(--stato-err-bg);
      }
      .elenco-strumenti {
        list-style: none;
        margin: 0 0 var(--spacing-xs);
        padding: 0;
      }
      .assegna {
        max-width: 100%;
      }
      code {
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class AgentiPesaComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)
  private readonly distrutto = inject(DestroyRef)
  private readonly zona = inject(NgZone)

  readonly righe = signal<AgenteVista[]>([])
  readonly strumenti = signal<StrumentoPesa[]>([])
  readonly registri = signal<RegistroVista[]>([])
  readonly puoGestire = signal(false)
  readonly caricamento = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly nuovo = signal(false)
  readonly codiceDi = signal<AgenteVista | null>(null)
  readonly revocaDi = signal<AgenteVista | null>(null)
  readonly revocaInCorso = signal(false)
  readonly erroreRevoca = signal<string | null>(null)
  /** Ora corrente, aggiornata col ricaricamento: "ultimo contatto" e "non in linea da". */
  private adesso = new Date()

  ngOnInit(): void {
    this.carica()
    this.pese.elencaStrumenti().subscribe({
      next: e => this.strumenti.set(e.righe),
      error: () => this.strumenti.set([]),
    })
    this.registroService.listRegistri().subscribe({
      next: r => this.registri.set(r.filter(x => x.attivo)),
      error: () => this.registri.set([]),
    })
    // Fuori dalla zona: un timer ricorrente non deve tenere l'app "instabile" (test e SSR).
    const timer = this.zona.runOutsideAngular(() =>
      setInterval(() => this.zona.run(() => this.carica(true)), AGGIORNAMENTO_MS)
    )
    this.distrutto.onDestroy(() => clearInterval(timer))
  }

  carica(inSilenzio = false): void {
    if (!inSilenzio) this.caricamento.set(true)
    this.pese.elencaAgenti().subscribe({
      next: e => {
        this.adesso = new Date()
        this.righe.set(e.righe)
        this.puoGestire.set(e.puoGestire)
        this.erroreElenco.set(null)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile caricare gli agenti.'))
      },
    })
  }

  etichettaStato(a: AgenteVista): string {
    if (a.stato === 'IN_ATTESA') return 'In attesa di abbinamento'
    if (a.stato === 'REVOCATO') return 'Revocato'
    return a.inLinea ? 'In linea' : `Non in linea da ${tempoDa(a.ultimoContattoIl, this.adesso)}`
  }

  contatto(a: AgenteVista): string {
    return a.stato === 'ATTIVO' ? tempoTrascorso(a.ultimoContattoIl, this.adesso) : '—'
  }

  scarto = (a: AgenteVista): string | null => scartoOrologioTesto(a.scartoOrologioS)

  statoStrumento = (s: string | null): string =>
    s ? (ETICHETTA_STATO_STRUMENTO[s] ?? s) : 'nessun dato'

  ora(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }

  /** Strumenti attivi non assegnati ad alcun agente non revocato. */
  liberi(_per: AgenteVista): StrumentoPesa[] {
    const presi = new Set(this.righe().flatMap(r => r.strumenti.map(s => s.id)))
    return this.strumenti().filter(s => s.attivo && !presi.has(s.id))
  }

  assegna(a: AgenteVista, sel: HTMLSelectElement): void {
    const id = sel.value
    sel.value = ''
    if (!id) return
    this.pese.assegnaStrumento(id, a.id).subscribe({
      next: () => {
        this.toast.success('Strumento assegnato')
        this.carica(true)
      },
      error: err => this.toast.error(messaggioErrorePese(err, 'Assegnazione non riuscita.')),
    })
  }

  libera(strumentoId: string): void {
    this.pese.assegnaStrumento(strumentoId, null).subscribe({
      next: () => {
        this.toast.success('Strumento liberato')
        this.carica(true)
      },
      error: err => this.toast.error(messaggioErrorePese(err, 'Operazione non riuscita.')),
    })
  }

  revoca(a: AgenteVista, motivo: string): void {
    if (this.revocaInCorso()) return
    this.erroreRevoca.set(null)
    this.revocaInCorso.set(true)
    this.pese.revocaAgente(a.id, motivo).subscribe({
      next: () => {
        this.revocaInCorso.set(false)
        this.revocaDi.set(null)
        this.toast.success('Agente revocato')
        this.carica(true)
      },
      error: err => {
        this.revocaInCorso.set(false)
        this.erroreRevoca.set(messaggioErrorePese(err, 'Revoca non riuscita.'))
      },
    })
  }
}
