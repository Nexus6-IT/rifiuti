/**
 * Elenco degli accessi all'impianto: in testa i mezzi in impianto (accessi aperti), poi lo
 * storico con filtri (registro solo se l'azienda ne ha piu' d'uno, stato, periodo, targa).
 * Dalla riga si apre il dettaglio. "Nuovo accesso" compare solo se il backend lo consente
 * (`puoOperare`).
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { ToastService } from '../../core/services/toast.service'
import { etichettaRegistro, registroPredefinito } from '../registro/registro-sede'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { AccessoDettaglioComponent } from './accesso-dettaglio.component'
import { ricordaFuoco } from './fuoco'
import { NuovoAccessoDialogComponent } from './nuovo-accesso-dialog.component'
import {
  dataItalianaDa,
  etichettaQualita,
  formattaKg,
  MESSAGGIO_GIA_REGISTRATA,
  messaggioErrorePese,
} from './pese-formato'
import { STILI_PESE } from './pese-stili'
import {
  AccessoRiepilogo,
  AccessoVista,
  Automezzo,
  FiltriAccessi,
  PeseService,
  StatoAccesso,
  StrumentoPesa,
} from './pese.service'

@Component({
  selector: 'app-pese-accessi',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    AccessoDettaglioComponent,
    NuovoAccessoDialogComponent,
  ],
  template: `
    <app-accesso-dettaglio
      *ngIf="selezionato() as id"
      [accessoId]="id"
      [strumenti]="strumenti()"
      (indietro)="chiudiDettaglio()"
      (modificato)="daRicaricare = true"
    ></app-accesso-dettaglio>

    <ng-container *ngIf="!selezionato()">
      <div class="barra">
        <p-button
          *ngIf="puoOperare()"
          label="Nuovo accesso"
          icon="pi pi-plus"
          (onClick)="apriNuovo($event)"
          data-testid="ac-nuovo"
          ariaLabel="Registra un nuovo accesso all'impianto"
        ></p-button>
        <p *ngIf="!puoOperare()" class="nota" data-testid="ac-sola-lettura">
          Hai accesso in sola lettura alle pesate.
        </p>
      </div>

      <section aria-labelledby="ac-aperti-titolo" class="blocco">
        <h2 id="ac-aperti-titolo" class="sezione" tabindex="-1">Mezzi in impianto</h2>
        <p
          class="nota"
          *ngIf="!aperti().length && !caricamentoAperti()"
          data-testid="ac-aperti-vuoti"
        >
          Nessun mezzo in impianto.
        </p>
        <ul class="elenco-aperti" *ngIf="aperti().length" data-testid="ac-aperti">
          <li *ngFor="let r of aperti()">
            <span
              ><strong>{{ r.numero }}</strong> — {{ r.targa || 'senza targa' }} —
              {{ r.verso === 'CARICO' ? 'carico' : 'scarico' }} — entrato il
              {{ dataIt(r.apertoIl) }}</span
            >
            <p-button
              label="Apri"
              [text]="true"
              size="small"
              (onClick)="apri(r.id)"
              [attr.data-testid]="'ac-aperto-' + r.id"
              [ariaLabel]="'Apri l\\'accesso ' + r.numero"
            ></p-button>
          </li>
        </ul>
        <p class="nota" *ngIf="apertiAltri() > 0" data-testid="ac-aperti-altri">
          … e altri {{ apertiAltri() }}: filtrare lo storico per stato «Aperti» per vederli tutti.
        </p>
      </section>

      <section aria-labelledby="ac-storico-titolo" class="blocco">
        <h2 id="ac-storico-titolo" class="sezione">Storico degli accessi</h2>
        <form class="filtri" (submit)="$event.preventDefault(); cerca()" data-testid="ac-filtri">
          <div class="field" *ngIf="registri().length > 1">
            <label for="ac-f-registro">Registro</label>
            <select
              id="ac-f-registro"
              class="p-inputtext"
              [(ngModel)]="filtri.registroId"
              name="registroId"
              data-testid="ac-f-registro"
            >
              <option value="">Tutti</option>
              <option *ngFor="let r of registri()" [value]="r.id">{{ etichetta(r) }}</option>
            </select>
          </div>
          <div class="field">
            <label for="ac-f-stato">Stato</label>
            <select
              id="ac-f-stato"
              class="p-inputtext"
              [(ngModel)]="filtri.stato"
              name="stato"
              data-testid="ac-f-stato"
            >
              <option value="">Tutti</option>
              <option value="APERTO">Aperti</option>
              <option value="CHIUSO">Chiusi</option>
              <option value="ANNULLATO">Annullati</option>
            </select>
          </div>
          <div class="field">
            <label for="ac-f-dal">Dal</label>
            <input
              id="ac-f-dal"
              type="date"
              class="p-inputtext"
              [(ngModel)]="filtri.dal"
              name="dal"
              data-testid="ac-f-dal"
            />
          </div>
          <div class="field">
            <label for="ac-f-al">Al</label>
            <input
              id="ac-f-al"
              type="date"
              class="p-inputtext"
              [(ngModel)]="filtri.al"
              name="al"
              data-testid="ac-f-al"
            />
          </div>
          <div class="field">
            <label for="ac-f-targa">Targa</label>
            <input
              id="ac-f-targa"
              type="text"
              class="p-inputtext"
              [(ngModel)]="filtri.targa"
              name="targa"
              maxlength="40"
              data-testid="ac-f-targa"
            />
          </div>
          <div class="field">
            <p-button
              label="Cerca"
              icon="pi pi-search"
              type="submit"
              data-testid="ac-cerca"
            ></p-button>
          </div>
        </form>

        <p *ngIf="caricamento()" role="status" class="nota">Caricamento…</p>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="ac-errore">
          {{ e }}
        </p>

        <div class="table-responsive">
          <table class="tabella" data-testid="ac-tabella">
            <caption class="solo-lettori">
              Accessi all'impianto
            </caption>
            <thead>
              <tr>
                <th scope="col">Numero</th>
                <th scope="col">Data</th>
                <th scope="col">Verso</th>
                <th scope="col">Targa</th>
                <th scope="col">CER</th>
                <th scope="col">Netto</th>
                <th scope="col">Stato</th>
                <th scope="col"><span class="solo-lettori">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of righe()" [attr.data-testid]="'ac-riga-' + r.id">
                <td>{{ r.numero }}</td>
                <td>{{ dataIt(r.apertoIl) }}</td>
                <td>{{ r.verso === 'CARICO' ? 'Carico' : 'Scarico' }}</td>
                <td>{{ r.targa || '—' }}</td>
                <td>{{ r.cerCode || '—' }}</td>
                <td>
                  <ng-container *ngIf="r.nettoKg != null; else senzaNetto"
                    >{{ kg(r.nettoKg)
                    }}<span class="nota"> {{ qualita(r.qualita) }}</span></ng-container
                  >
                  <ng-template #senzaNetto>—</ng-template>
                </td>
                <td>
                  {{ etichettaStato(r.stato) }}
                  <span class="badge" *ngIf="r.manuale" [attr.data-testid]="'ac-manuale-' + r.id"
                    >Manuale</span
                  >
                  <span class="badge" *ngIf="r.rettificato">Rettificato</span>
                  <span class="badge" *ngIf="r.collegato">Collegato</span>
                </td>
                <td>
                  <p-button
                    label="Apri"
                    [text]="true"
                    size="small"
                    (onClick)="apri(r.id)"
                    [attr.data-testid]="'ac-apri-' + r.id"
                    [ariaLabel]="'Apri l\\'accesso ' + r.numero"
                  ></p-button>
                </td>
              </tr>
              <tr *ngIf="!righe().length && !caricamento()">
                <td colspan="8" data-testid="ac-vuota">Nessun accesso trovato.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav class="paginazione" *ngIf="pagine() > 1" aria-label="Pagine dell'elenco">
          <p-button
            label="Precedente"
            [text]="true"
            [disabled]="pagina() <= 1"
            (onClick)="vaiA(pagina() - 1)"
            data-testid="ac-prec"
          ></p-button>
          <span class="nota" aria-live="polite">Pagina {{ pagina() }} di {{ pagine() }}</span>
          <p-button
            label="Successiva"
            [text]="true"
            [disabled]="pagina() >= pagine()"
            (onClick)="vaiA(pagina() + 1)"
            data-testid="ac-succ"
          ></p-button>
        </nav>
      </section>
    </ng-container>

    <app-nuovo-accesso-dialog
      *ngIf="nuovoAperto()"
      [registri]="registri()"
      [strumenti]="strumenti()"
      [automezzi]="automezzi()"
      (creato)="creato($event)"
      (chiuso)="chiudiNuovo()"
    ></app-nuovo-accesso-dialog>
  `,
  styles: [
    STILI_PESE,
    `
      .barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-base);
      }
      .blocco {
        margin-bottom: var(--spacing-lg, 1.5rem);
      }
      .sezione {
        font-size: var(--font-size-base);
        margin: 0 0 var(--spacing-sm);
      }
      .filtri {
        display: flex;
        gap: var(--spacing-base);
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .elenco-aperti {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .elenco-aperti li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-xs) 0;
        border-bottom: 1px solid var(--border-color);
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
      /* Intestazioni come nelle altre tabelle: 12px, grigio, peso medio, senza tutto nero. */
      .tabella th {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
        white-space: nowrap;
        border-bottom-color: var(--surface-border);
      }
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .badge {
        display: inline-block;
        padding: 0 var(--spacing-sm);
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: var(--font-size-xs);
        margin-left: var(--spacing-xs);
      }
      .paginazione {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-base);
        margin-top: var(--spacing-base);
      }
    `,
  ],
})
export class AccessiComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)

  readonly registri = signal<RegistroVista[]>([])
  readonly strumenti = signal<StrumentoPesa[]>([])
  readonly automezzi = signal<Automezzo[]>([])
  readonly righe = signal<AccessoRiepilogo[]>([])
  readonly aperti = signal<AccessoRiepilogo[]>([])
  readonly puoOperare = signal(false)
  readonly caricamento = signal(false)
  readonly caricamentoAperti = signal(false)
  readonly errore = signal<string | null>(null)
  readonly pagina = signal(1)
  readonly pagine = signal(1)
  readonly selezionato = signal<string | null>(null)
  readonly nuovoAperto = signal(false)
  readonly apertiAltri = signal(0)
  /** Dimensione di pagina del backend, letta dalla prima pagina (non e' scritta qui). */
  private perPagina = 1
  private fuocoSu: string | null = null

  filtri = { registroId: '', stato: '', dal: '', al: '', targa: '' }
  daRicaricare = false

  readonly kg = formattaKg
  readonly qualita = etichettaQualita
  readonly dataIt = dataItalianaDa
  readonly etichetta = etichettaRegistro
  private ripristinaFuoco: (() => void) | null = null

  ngOnInit(): void {
    this.registroService.listRegistri().subscribe({
      next: r => {
        this.registri.set(r)
        if (r.length > 1) this.filtri.registroId = registroPredefinito(r) ?? ''
        this.cerca()
      },
      error: () => this.cerca(),
    })
    this.pese
      .elencaStrumenti()
      .subscribe({ next: e => this.strumenti.set(e.righe), error: () => undefined })
    this.pese
      .elencaAutomezzi()
      .subscribe({ next: e => this.automezzi.set(e.righe), error: () => undefined })
  }

  etichettaStato(s: StatoAccesso): string {
    return s === 'APERTO' ? 'Aperto' : s === 'CHIUSO' ? 'Chiuso' : 'Annullato'
  }

  private filtriRichiesta(pagina: number): FiltriAccessi {
    const f = this.filtri
    return {
      registroId: f.registroId || undefined,
      stato: (f.stato as StatoAccesso) || undefined,
      dal: f.dal || undefined,
      al: f.al || undefined,
      targa: f.targa.trim() || undefined,
      pagina,
    }
  }

  cerca(): void {
    this.vaiA(1)
    this.caricaAperti()
  }

  private caricaAperti(): void {
    this.caricamentoAperti.set(true)
    this.pese
      .elencaAccessi({ stato: 'APERTO', registroId: this.filtri.registroId || undefined })
      .subscribe({
        next: e => {
          this.aperti.set(e.righe)
          this.apertiAltri.set(Math.max(0, e.totale - e.righe.length))
          this.puoOperare.set(e.puoOperare)
          this.caricamentoAperti.set(false)
        },
        error: () => {
          this.aperti.set([])
          this.caricamentoAperti.set(false)
        },
      })
  }

  vaiA(pagina: number): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.pese.elencaAccessi(this.filtriRichiesta(pagina)).subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.puoOperare.set(e.puoOperare)
        this.pagina.set(e.pagina ?? pagina)
        if ((e.pagina ?? pagina) === 1) this.perPagina = Math.max(1, e.righe.length)
        this.pagine.set(Math.max(1, Math.ceil(e.totale / this.perPagina)))
        this.caricamento.set(false)
        if (this.fuocoSu) setTimeout(() => this.tentaFuoco())
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrorePese(err, 'Impossibile leggere gli accessi.'))
      },
    })
  }

  apri(id: string): void {
    // l'elenco sparisce mentre il dettaglio e' aperto: il pulsante si ritrova per id
    this.fuocoSu = id
    this.selezionato.set(id)
  }

  /** Rimette il fuoco sul pulsante «Apri» della riga; se non c'e' (ancora), sul titolo. */
  private tentaFuoco(): void {
    const id = this.fuocoSu
    if (!id || this.selezionato()) return
    const bottone = (nome: string) =>
      document.querySelector<HTMLElement>(
        `[data-testid="${nome}-${id}"] button, button[data-testid="${nome}-${id}"]`
      )
    const el = bottone('ac-apri') ?? bottone('ac-aperto')
    if (el) {
      el.focus()
      this.fuocoSu = null
    } else if (!this.caricamento()) {
      document.getElementById('ac-aperti-titolo')?.focus()
      this.fuocoSu = null
    }
  }

  chiudiDettaglio(): void {
    this.selezionato.set(null)
    setTimeout(() => this.tentaFuoco())
    if (this.daRicaricare) {
      this.daRicaricare = false
      this.cerca()
    }
  }

  apriNuovo(ev?: unknown): void {
    this.ripristinaFuoco = ricordaFuoco(ev)
    this.nuovoAperto.set(true)
  }

  chiudiNuovo(): void {
    this.nuovoAperto.set(false)
    this.ripristinaFuoco?.()
    this.ripristinaFuoco = null
  }

  creato(a: AccessoVista): void {
    this.nuovoAperto.set(false)
    this.ripristinaFuoco = null
    if (a.giaRegistrata) this.toast.info(MESSAGGIO_GIA_REGISTRATA)
    else this.toast.success(`Accesso ${a.numero} registrato.`)
    this.fuocoSu = null
    this.selezionato.set(a.id)
    this.daRicaricare = true
  }
}
