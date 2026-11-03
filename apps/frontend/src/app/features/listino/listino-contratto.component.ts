import { CommonModule } from '@angular/common'
import {
  Component,
  OnDestroy,
  OnInit,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core'
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
import { AggiungiRigheDialogComponent } from './aggiungi-righe-dialog.component'
import { AllegatiElencoComponent } from './allegati-elenco.component'
import { CopiaElencoDialogComponent } from './copia-elenco-dialog.component'
import { ElencoDialogComponent } from './elenco-dialog.component'
import { ElenchiPannelloComponent } from './elenchi-pannello.component'
import { MESSAGGIO_CONCORRENTE, naturaConflitto } from './errori-azione'
import { elenchiValidiAl, oggiIso, righeInTesto } from './listino-calcoli'
import { ContestoListino, ElencoAddebiti, RigaAddebito } from './listino.model'
import { ListinoService } from './listino.service'
import { ProvvigioniScontiDialogComponent } from './provvigioni-sconti-dialog.component'
import { RigaAddebitoDialogComponent } from './riga-addebito-dialog.component'
import { RigheTavolaComponent } from './righe-tavola.component'

/**
 * Pagina del listino di un contratto (D28): intestazione, elenchi a sinistra e tavola delle righe
 * a destra. In sola lettura (VIEWER o contratto annullato) niente pulsanti di scrittura. Il
 * backend è l'arbitro delle regole: i suoi messaggi si mostrano com'è, il 409 con "Ricarica".
 * La pagina orchestra la lettura (`carica`) e l'eliminazione; elenchi, dialog e tavola sono
 * componenti a parte. Il dialog della riga (Task 27) si apre dalla riga o da "Nuova riga" e si
 * monta solo quando serve.
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
    RigaAddebitoDialogComponent,
    CopiaElencoDialogComponent,
    AggiungiRigheDialogComponent,
    ProvvigioniScontiDialogComponent,
    AllegatiElencoComponent,
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
        <p-button
          *ngIf="!soloLettura()"
          label="Provvigioni e sconti"
          icon="pi pi-percentage"
          [outlined]="true"
          size="small"
          (onClick)="provvigioniAperte.set(true)"
          data-testid="listino-provvigioni-sconti"
        />
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
            <div class="azioni-elenco" *ngIf="!soloLettura() && el.modificabile">
              <p-button
                label="Nuova riga"
                icon="pi pi-plus"
                (onClick)="nuovaRiga()"
                data-testid="listino-nuova-riga"
              />
              <p-button
                label="Copia da un altro elenco"
                icon="pi pi-copy"
                [outlined]="true"
                (onClick)="copiaAperta.set(true)"
                data-testid="listino-copia"
              />
              <p-button
                label="Aggiungi righe da un altro elenco"
                icon="pi pi-clone"
                [outlined]="true"
                (onClick)="aggiungiAperto.set(true)"
                data-testid="listino-aggiungi-righe"
              />
            </div>
            <app-righe-tavola
              [elementi]="righe()"
              [caricamento]="caricamentoRighe()"
              [errore]="erroreRighe()"
              [puoEliminare]="!soloLettura() && el.eliminabile"
              (apri)="apriRiga($event)"
              (elimina)="eliminaRiga($event)"
            />
            <!-- Gli allegati si gestiscono anche con il contratto annullato (R47): conta solo il permesso. -->
            <h3>Allegati dell'elenco</h3>
            <app-allegati-elenco [elencoId]="el.id" [soloLettura]="!puoScrivere()" />
          </ng-container>
        </div>
      </div>

      <app-elenco-dialog
        [visible]="dialogoAperto()"
        [contrattoId]="contrattoId"
        [elenco]="elencoInModifica()"
        [soloLettura]="soloLettura()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="dopoSalvataggio($event)"
        (ricarica)="dopoRicarica()"
      />
      <app-riga-addebito-dialog
        *ngIf="rigaDialogMontato()"
        [visible]="rigaDialogAperto()"
        [contrattoId]="contrattoId"
        [elencoId]="elencoMostrato()?.id ?? ''"
        [riga]="rigaAperta()"
        [soloLettura]="soloLettura() || !elencoMostrato()?.modificabile"
        (visibleChange)="chiudiRiga($event)"
        (salvato)="dopoSalvataggioRiga()"
        (ricarica)="dopoRicaricaRiga()"
      />
      <app-copia-elenco-dialog
        [visible]="copiaAperta()"
        [elenco]="elencoMostrato()"
        (visibleChange)="copiaAperta.set($event)"
        (copiato)="carica()"
        (ricarica)="chiudiERicarica(copiaAperta)"
      />
      <app-aggiungi-righe-dialog
        [visible]="aggiungiAperto()"
        [elenco]="elencoMostrato()"
        (visibleChange)="aggiungiAperto.set($event)"
        (aggiunte)="carica()"
        (ricarica)="chiudiERicarica(aggiungiAperto)"
      />
      <app-provvigioni-sconti-dialog
        [visible]="provvigioniAperte()"
        [contrattoId]="contrattoId"
        (visibleChange)="provvigioniAperte.set($event)"
        (applicata)="carica()"
        (ricarica)="chiudiERicarica(provvigioniAperte)"
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
      .azioni-elenco {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
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

  /** La riga aperta (doppio clic o "Apri"); null = nuova riga. */
  readonly rigaAperta = signal<RigaAddebito | null>(null)
  readonly rigaDialogAperto = signal(false)
  /** Il dialog si crea alla prima apertura: prima non serve né il catalogo né le codifiche. */
  readonly rigaDialogMontato = signal(false)

  readonly copiaAperta = signal(false)
  readonly aggiungiAperto = signal(false)
  readonly provvigioniAperte = signal(false)

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
    this.rigaDialogMontato.set(true)
    this.rigaDialogAperto.set(true)
  }

  nuovaRiga(): void {
    if (this.soloLettura()) return
    this.rigaAperta.set(null)
    this.rigaDialogMontato.set(true)
    this.rigaDialogAperto.set(true)
  }

  chiudiRiga(visibile: boolean): void {
    this.rigaDialogAperto.set(visibile)
  }

  /** Salvata la riga si rilegge tutto: cambiano anche i conteggi degli elenchi. */
  dopoSalvataggioRiga(): void {
    this.rigaDialogAperto.set(false)
    this.carica()
  }

  /** "Ricarica" dopo un 409 nel dialog: si rilegge e si chiude. */
  dopoRicaricaRiga(): void {
    this.rigaDialogAperto.set(false)
    this.carica()
  }

  /** "Ricarica" dopo un 409 in un dialog di azione: si chiude e si rilegge la vista. */
  chiudiERicarica(aperto: WritableSignal<boolean>): void {
    aperto.set(false)
    this.carica()
  }

  // --- eliminazione della riga --------------------------------------------------------------

  eliminaRiga(r: RigaAddebito): void {
    if (this.soloLettura() || !this.elencoMostrato()?.eliminabile) return
    const nome = r.cerCode ?? r.addebito?.codice ?? r.tipo
    chiediConferma(this.conferma, `Eliminare la riga ${nome}?`, () => this.eliminaRigaConfermata(r))
  }

  eliminaRigaConfermata(r: RigaAddebito): void {
    this.servizio.righe
      .elimina(r.id, r.versione)
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: () => this.carica(),
        error: err => this.dopoErroreEliminazione(err, 'Impossibile eliminare la riga.'),
      })
  }

  /**
   * 404: già eliminata da altri, si rilegge. 409 di versione o di listino non più modificabile:
   * messaggio con "Ricarica", senza rileggere di nascosto. 409 di operazione concorrente: si
   * avvisa e si può riprovare. Altro: avviso e si rilegge.
   */
  private dopoErroreEliminazione(err: { status?: number }, ripiego: string): void {
    const natura = naturaConflitto(err)
    if (natura === 'rilettura') {
      this.erroreCaricamento.set(messaggioErrore(err, ripiego))
      return
    }
    if (natura === 'concorrente') {
      this.toast.error(MESSAGGIO_CONCORRENTE)
      return
    }
    this.toast.error(messaggioErrore(err, ripiego))
    this.carica()
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
        error: err => this.dopoErroreEliminazione(err, "Impossibile eliminare l'elenco."),
      })
  }
}
