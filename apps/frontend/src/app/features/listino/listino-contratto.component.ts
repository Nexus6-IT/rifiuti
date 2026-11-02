import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
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
import { ElencoDialogComponent } from './elenco-dialog.component'
import { ElenchiPannelloComponent } from './elenchi-pannello.component'
import { elenchiValidiAl, oggiIso, righeInTesto } from './listino-calcoli'
import { ContestoListino, ElencoAddebiti, RigaAddebito } from './listino.model'
import { ListinoService } from './listino.service'
import { RigheTavolaComponent } from './righe-tavola.component'

/**
 * Pagina del listino di un contratto (D28): intestazione, elenchi a sinistra e tavola delle righe
 * a destra. In sola lettura (VIEWER o contratto annullato) niente pulsanti di scrittura. Il
 * backend è l'arbitro delle regole: i suoi messaggi si mostrano com'è, il 409 con "Ricarica".
 * La pagina orchestra la lettura (`carica`) e l'eliminazione; elenchi, dialog e tavola sono
 * componenti a parte. Il dialog della riga arriva con il Task 27: `apriRiga` memorizza la scelta.
 */
@Component({
  selector: 'app-listino-contratto',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    ConfirmDialogModule,
    TagModule,
    ElenchiPannelloComponent,
    ElencoDialogComponent,
    RigheTavolaComponent,
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
        <aside aria-label="Elenchi degli addebiti">
          <app-elenchi-pannello
            [elenchi]="elenchiVisibili()"
            [scelto]="elencoMostrato()"
            [soloValidi]="soloValidi()"
            [soloLettura]="soloLettura()"
            (soloValidiChange)="soloValidi.set($event)"
            (scegli)="scegliElenco($event)"
            (nuovo)="apriElenco(null)"
            (modifica)="apriElenco($event)"
            (elimina)="eliminaElenco($event)"
          />
        </aside>
        <div class="righe">
          <p *ngIf="!elencoMostrato()" data-testid="listino-scegli-un-elenco">
            Scegli un elenco per vedere le righe.
          </p>
          <ng-container *ngIf="elencoMostrato() as el">
            <h2>Elenco {{ el.codice }} - {{ el.descrizione }}</h2>
            <app-righe-tavola
              [elementi]="righe()"
              [caricamento]="caricamentoRighe()"
              [errore]="erroreRighe()"
              (apri)="apriRiga($event)"
            />
          </ng-container>
        </div>
      </div>

      <app-elenco-dialog
        [visible]="dialogoAperto()"
        [contrattoId]="contrattoId"
        [elenco]="elencoInModifica()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="dopoSalvataggio($event)"
        (ricarica)="dopoRicarica()"
      />
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

  /** La riga aperta (doppio clic o "Apri"): il dialog arriva con il Task 27. */
  readonly rigaAperta = signal<RigaAddebito | null>(null)

  readonly dialogoAperto = signal(false)
  readonly elencoInModifica = signal<ElencoAddebiti | null>(null)

  readonly annullato = computed(() => this.contesto()?.contratto.stato === 'ANNULLATO')
  /** VIEWER o contratto annullato (D16): niente scritture. */
  readonly soloLettura = computed(() => !this.puoScrivere() || this.annullato())
  /** "Solo validi oggi" = elenchi non scaduti, come `?validiAl=` e l'elenco proposto del backend. */
  readonly elenchiVisibili = computed(() =>
    this.soloValidi() ? elenchiValidiAl(this.elenchi(), oggiIso()) : this.elenchi()
  )
  /** L'elenco scelto, se è ancora fra quelli visibili: filtrato via, la tavola si svuota. */
  readonly elencoMostrato = computed(() => {
    const scelto = this.elencoScelto()
    return scelto && this.elenchiVisibili().some(e => e.id === scelto.id) ? scelto : null
  })

  private readonly distrutto = new Subject<void>()
  private readonly annullaRighe = new Subject<void>()

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
    this.elencoInModifica.set(e)
    this.dialogoAperto.set(true)
  }

  dopoSalvataggio(salvato: ElencoAddebiti): void {
    this.dialogoAperto.set(false)
    this.elencoScelto.set(salvato)
    this.carica()
  }

  /** "Ricarica" dopo un 409 nel dialog: si rilegge e si chiude, la modifica riparte dal nuovo. */
  dopoRicarica(): void {
    this.dialogoAperto.set(false)
    this.carica()
  }

  eliminaElenco(e: ElencoAddebiti): void {
    if (this.soloLettura()) return
    chiediConferma(this.conferma, `Eliminare l’elenco ${e.codice} ${righeInTesto(e.righe)}?`, () =>
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
            // Versione vecchia: messaggio con "Ricarica", senza rileggere di nascosto.
            this.erroreCaricamento.set(messaggio)
            return
          }
          this.toast.error(messaggio)
          this.carica()
        },
      })
  }
}
