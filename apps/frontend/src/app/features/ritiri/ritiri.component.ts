/**
 * Elenco dei ritiri programmati (4.7). Filtri per periodo, stato, CER, mezzo, trasportatore e
 * produttore (i secondari stanno nel pannello «Filtri»). Si spuntano i ritiri «da generare» e
 * «Genera FIR» crea le bozze (nessuna emissione): l'esito va riga per riga in un dialog.
 * Per ogni riga: Modifica, Non eseguito, Riprogramma (solo dai non eseguiti) e Annulla; il
 * backend ricontrolla che non ci sia un FIR attivo (409).
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { TableModule } from 'primeng/table'
import { Observable } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { AzioneRiga, AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { CampoDataComponent } from '../../shared/components/campo-data.component'
import { PillolaStatoComponent } from '../../shared/components/pillola-stato.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { puoCreareFir } from '../fir/fir-permissions'
import { AnagraficaSelectComponent } from '../registry/anagrafica-select.component'
import { EsitoGenerazioneDialogComponent } from './esito-generazione-dialog.component'
import { RitiroDialogComponent } from './ritiro-dialog.component'
import { STILI_RITIRI } from './ritiri-stili'
import {
  dataItaliana,
  ETICHETTA_FASCIA,
  ETICHETTA_STATO,
  EsitoGenerazioneRiga,
  FiltriRitiri,
  generabile,
  MAX_RITIRI_PER_LOTTO,
  messaggioErroreRitiri,
  modificabile,
  quantitaItaliana,
  RisultatoCreazioneRitiri,
  RitiroVista,
  StatoVisibileRitiro,
  TONO_STATO_RITIRO,
} from './ritiri.model'
import { RitiriService } from './ritiri.service'

type TipoAzione = 'ANNULLA' | 'NON_ESEGUITO' | 'RIPROGRAMMA'
interface AzionePendente {
  tipo: TipoAzione
  ritiro: RitiroVista
}

const TESTI_AZIONE: Record<TipoAzione, { titolo: string; bottone: string; pericolosa: boolean }> = {
  ANNULLA: { titolo: 'Annulla il ritiro', bottone: 'Annulla il ritiro', pericolosa: true },
  NON_ESEGUITO: {
    titolo: 'Segna come non eseguito',
    bottone: 'Segna non eseguito',
    pericolosa: false,
  },
  RIPROGRAMMA: { titolo: 'Riprogramma il ritiro', bottone: 'Riprogramma', pericolosa: false },
}

@Component({
  selector: 'app-ritiri',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TableModule,
    AzioniRigaComponent,
    CampoDataComponent,
    PillolaStatoComponent,
    AnagraficaSelectComponent,
    RitiroDialogComponent,
    EsitoGenerazioneDialogComponent,
  ],
  template: `
    <section class="page pagina-lavoro">
      <header class="intestazione">
        <h1>Ritiri</h1>
        <div class="comandi" *ngIf="puoScrivere()">
          <p-button
            label="Genera FIR"
            icon="pi pi-file"
            [outlined]="true"
            [disabled]="!selezionati().length || generazione()"
            [loading]="generazione()"
            (onClick)="generaFir()"
            data-testid="ri-genera"
            [ariaLabel]="
              selezionati().length
                ? 'Genera i FIR in bozza per ' + selezionati().length + ' ritiri'
                : 'Genera FIR: spunta prima uno o più ritiri da generare'
            "
          ></p-button>
          <p-button
            label="Nuovo ritiro"
            icon="pi pi-plus"
            styleClass="wf-primario"
            (onClick)="apriDialog(null)"
            data-testid="ri-nuovo"
          ></p-button>
        </div>
      </header>

      <form class="filtri" (submit)="$event.preventDefault(); cerca()" data-testid="ri-filtri">
        <div class="field">
          <label for="ri-f-dal">Dal</label>
          <app-campo-data
            inputId="ri-f-dal"
            [(ngModel)]="filtri.dal"
            name="dal"
            data-testid="ri-f-dal"
          />
        </div>
        <div class="field">
          <label for="ri-f-al">Al</label>
          <app-campo-data
            inputId="ri-f-al"
            [(ngModel)]="filtri.al"
            name="al"
            data-testid="ri-f-al"
          />
        </div>
        <div class="field">
          <label for="ri-f-stato">Stato</label>
          <select
            id="ri-f-stato"
            class="p-inputtext"
            [(ngModel)]="filtri.statoVisibile"
            name="statoVisibile"
            data-testid="ri-f-stato"
          >
            <option value="">Tutti</option>
            <option *ngFor="let s of stati" [value]="s[0]">{{ s[1] }}</option>
          </select>
        </div>
        <div class="field">
          <p-button
            label="Filtri"
            icon="pi pi-sliders-h"
            [text]="true"
            type="button"
            (onClick)="filtriAperti.set(!filtriAperti())"
            [attr.aria-expanded]="filtriAperti()"
            aria-controls="ri-filtri-extra"
            data-testid="ri-filtri-toggle"
          ></p-button>
        </div>
        <div class="field">
          <p-button
            label="Cerca"
            icon="pi pi-search"
            type="submit"
            data-testid="ri-cerca"
          ></p-button>
        </div>
        <div
          id="ri-filtri-extra"
          class="extra"
          *ngIf="filtriAperti()"
          data-testid="ri-filtri-extra"
        >
          <div class="field">
            <label for="ri-f-cer">CER</label>
            <input
              id="ri-f-cer"
              class="p-inputtext"
              [(ngModel)]="filtri.cerCode"
              name="cerCode"
              maxlength="10"
              data-testid="ri-f-cer"
            />
          </div>
          <div class="field">
            <label for="ri-f-mezzo">Mezzo</label>
            <select
              id="ri-f-mezzo"
              class="p-inputtext"
              [(ngModel)]="filtri.automezzoId"
              name="automezzoId"
              data-testid="ri-f-mezzo"
            >
              <option value="">Tutti</option>
              <option *ngFor="let m of mezzi()" [value]="m.id">{{ m.targa }}</option>
            </select>
          </div>
          <div class="field">
            <label for="ri-f-produttore">Produttore</label>
            <app-anagrafica-select
              registro="produttori"
              inputId="ri-f-produttore"
              ariaLabel="Filtra per produttore"
              [(ngModel)]="filtri.produttoreId"
              name="produttoreId"
              [preselezionaSeUnica]="false"
            />
          </div>
          <div class="field">
            <label for="ri-f-trasportatore">Trasportatore</label>
            <app-anagrafica-select
              registro="trasportatori"
              inputId="ri-f-trasportatore"
              ariaLabel="Filtra per trasportatore"
              [(ngModel)]="filtri.trasportatoreId"
              name="trasportatoreId"
              [preselezionaSeUnica]="false"
            />
          </div>
        </div>
      </form>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="ri-errore">{{ e }}</p>

      <p-table
        [value]="righe()"
        [lazy]="true"
        [lazyLoadOnInit]="false"
        [paginator]="true"
        [alwaysShowPaginator]="false"
        [rows]="dimensione"
        [first]="primo"
        [totalRecords]="totale()"
        [loading]="caricamento()"
        [rowsPerPageOptions]="[25, 50, 100]"
        (onLazyLoad)="cambiaPagina($event)"
        currentPageReportTemplate="{first}-{last} di {totalRecords}"
        [showCurrentPageReport]="totale() > 0"
        styleClass="p-datatable-sm lista-telefono"
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" class="sel-col" *ngIf="puoScrivere()">
              <input
                type="checkbox"
                aria-label="Seleziona tutti i ritiri da generare di questa pagina"
                [checked]="tuttiSelezionati()"
                [disabled]="!generabili().length"
                (change)="selezionaTutti($any($event.target).checked)"
                data-testid="ri-sel-tutti"
              />
            </th>
            <th scope="col">Data</th>
            <th scope="col">Produttore</th>
            <th scope="col" class="m-hide">Destinatario</th>
            <th scope="col" class="m-hide">CER</th>
            <th scope="col" class="num-col">Quantità</th>
            <th scope="col" class="m-hide" *ngIf="visibili().has('mezzo')">Mezzo</th>
            <th scope="col">Stato</th>
            <th scope="col" class="m-hide" *ngIf="visibili().has('fir')">FIR</th>
            <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">
              <span class="solo-lettori">Azioni</span>
            </th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr [attr.data-testid]="'ri-riga-' + r.id">
            <td class="sel-col" *ngIf="puoScrivere()">
              <input
                type="checkbox"
                [checked]="selezione().has(r.id)"
                [disabled]="!generabile(r)"
                (change)="seleziona(r, $any($event.target).checked)"
                [attr.aria-label]="
                  'Seleziona il ritiro del ' + data(r.dataPrevista) + ' di ' + r.produttore.nome
                "
                [attr.data-testid]="'ri-sel-' + r.id"
              />
            </td>
            <td>
              {{ data(r.dataPrevista) }}
              <span class="nota" *ngIf="r.fascia">· {{ fascia(r.fascia) }}</span>
              <span class="nota" *ngIf="r.ordineGiro != null"> · n. {{ r.ordineGiro }}</span>
            </td>
            <td class="chi">
              {{ r.produttore.nome }}
              <span class="solo-tel nota"> · CER {{ r.cerCode }}</span>
            </td>
            <td class="m-hide chi">{{ r.destinatario.nome }}</td>
            <td class="m-hide">
              <span class="mono">{{ r.cerCode }}</span>
              <span class="nota">{{ r.descrizione }}</span>
            </td>
            <td class="num-col">
              <span class="mono">{{ quantita(r.quantitaPresunta) }}</span> {{ r.unita }}
            </td>
            <td class="m-hide" *ngIf="visibili().has('mezzo')">{{ r.automezzo?.targa || '—' }}</td>
            <td>
              <app-pillola-stato
                [tono]="tono(r.statoVisibile)"
                [testo]="etichettaStato(r.statoVisibile)"
                [barrato]="r.stato === 'ANNULLATO'"
              />
              <span class="nota motivo" *ngIf="r.motivo" [attr.data-testid]="'ri-motivo-' + r.id">{{
                r.motivo
              }}</span>
            </td>
            <td class="m-hide" *ngIf="visibili().has('fir')">
              <a
                *ngIf="r.fir as f"
                [routerLink]="['/fir', f.id]"
                [attr.data-testid]="'ri-fir-' + r.id"
                >{{ f.numero || 'Bozza' }}</a
              >
              <ng-container *ngIf="!r.fir">—</ng-container>
            </td>
            <td class="azioni-col" *ngIf="puoScrivere()">
              <app-azioni-riga
                [attr.data-testid]="'ri-azioni-' + r.id"
                [nome]="'ritiro del ' + data(r.dataPrevista) + ' di ' + r.produttore.nome"
                [principale]="azioni(r).principale"
                [altre]="azioni(r).altre"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="colonneTotali()" data-testid="ri-vuota">Nessun ritiro trovato.</td>
          </tr>
        </ng-template>
      </p-table>
    </section>

    <app-ritiro-dialog
      *ngIf="dialogAperto()"
      [ritiro]="inModifica()"
      (salvato)="salvato($event)"
      (chiuso)="chiudiDialog()"
    ></app-ritiro-dialog>

    <app-esito-generazione-dialog
      *ngIf="esiti() as e"
      [esiti]="e"
      [ritiri]="righe()"
      (chiuso)="chiudiEsiti()"
    ></app-esito-generazione-dialog>

    <p-dialog
      *ngIf="pendente() as p"
      [visible]="true"
      (visibleChange)="!$event && chiudiAzione()"
      [header]="testiAzione(p).titolo"
      [modal]="true"
      [style]="{ width: '480px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi senza procedere"
    >
      <p class="nota" data-testid="ri-azione-riepilogo">
        Ritiro del {{ data(p.ritiro.dataPrevista) }} di {{ p.ritiro.produttore.nome }}.
      </p>
      <div class="field" *ngIf="p.tipo !== 'RIPROGRAMMA'">
        <label for="ri-motivo">Motivo <span class="req" aria-hidden="true">*</span></label>
        <textarea
          id="ri-motivo"
          class="p-inputtext w-full"
          rows="3"
          maxlength="500"
          [(ngModel)]="motivo"
          [attr.aria-invalid]="erroreAzione() ? true : null"
          aria-describedby="ri-azione-errore"
          data-testid="ri-motivo"
        ></textarea>
      </div>
      <div class="field" *ngIf="p.tipo === 'RIPROGRAMMA'">
        <label for="ri-nuova-data">Nuova data <span class="req" aria-hidden="true">*</span></label>
        <app-campo-data
          inputId="ri-nuova-data"
          [(ngModel)]="nuovaData"
          name="nuovaData"
          data-testid="ri-nuova-data"
          ariaDescribedby="ri-azione-errore"
        />
      </div>
      <p
        *ngIf="erroreAzione() as e"
        id="ri-azione-errore"
        role="alert"
        class="field-error"
        data-testid="ri-azione-errore"
      >
        {{ e }}
      </p>
      <div class="azioni">
        <!-- Il fuoco parte su «Torna indietro»: Invio non annulla nulla per sbaglio. -->
        <p-button
          label="Torna indietro"
          [text]="true"
          (onClick)="chiudiAzione()"
          data-testid="ri-azione-indietro"
          [autofocus]="true"
        ></p-button>
        <p-button
          [label]="testiAzione(p).bottone"
          [severity]="testiAzione(p).pericolosa ? 'danger' : undefined"
          [styleClass]="testiAzione(p).pericolosa ? 'p-button-danger' : ''"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="confermaAzione()"
          data-testid="ri-azione-conferma"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    STILI_RITIRI,
    `
      .intestazione {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-base);
        flex-wrap: wrap;
      }
      .comandi {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }
      .filtri {
        display: flex;
        gap: var(--spacing-base);
        flex-wrap: wrap;
        align-items: flex-end;
        margin: var(--spacing-base) 0;
      }
      .extra {
        flex-basis: 100%;
        display: flex;
        gap: var(--spacing-base);
        flex-wrap: wrap;
      }
      .sel-col {
        width: 2.5rem;
      }
      .sel-col input {
        width: 1.25rem;
        height: 1.25rem;
      }
      .chi {
        overflow-wrap: anywhere;
      }
      .mono {
        font-family: var(--font-family-mono);
      }
      .motivo {
        display: block;
      }
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline;
        }
      }
    `,
  ],
})
export class RitiriComponent implements OnInit {
  private readonly servizio = inject(RitiriService)
  private readonly toast = inject(ToastService)
  private readonly auth = inject(AuthService)

  readonly puoScrivere = computed(() => puoCreareFir(this.auth.currentUser()?.role))
  readonly stati = Object.entries(ETICHETTA_STATO)
  readonly righe = signal<RitiroVista[]>([])
  readonly totale = signal(0)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly filtriAperti = signal(false)
  readonly selezione = signal<ReadonlySet<string>>(new Set())
  readonly generazione = signal(false)
  readonly esiti = signal<EsitoGenerazioneRiga[] | null>(null)
  readonly dialogAperto = signal(false)
  readonly inModifica = signal<RitiroVista | null>(null)
  readonly pendente = signal<AzionePendente | null>(null)
  readonly erroreAzione = signal<string | null>(null)
  readonly inCorso = signal(false)
  /** Mezzi per il filtro: l'elenco è delle pese, senza il modulo il filtro mostra solo «Tutti». */
  readonly mezzi = signal<{ id: string; targa: string }[]>([])

  dimensione = 25
  primo = 0
  motivo = ''
  nuovaData = ''
  filtri: { [K in keyof FiltriRitiri]-?: string } = {
    dal: '',
    al: '',
    automezzoId: '',
    trasportatoreId: '',
    produttoreId: '',
    cerCode: '',
    statoVisibile: '',
    pagina: '',
    dimensione: '',
  }

  readonly generabili = computed(() => this.righe().filter(generabile))
  readonly tuttiSelezionati = computed(
    () => this.generabili().length > 0 && this.generabili().every(r => this.selezione().has(r.id))
  )
  readonly selezionati = computed(() => this.righe().filter(r => this.selezione().has(r.id)))
  /** Colonne facoltative con almeno un dato nella pagina: le altre non si disegnano. */
  readonly visibili = computed(() =>
    colonneConDati(this.righe(), { mezzo: r => r.automezzo?.targa, fir: r => r.fir })
  )
  readonly colonneTotali = computed(() => 5 + this.visibili().size + (this.puoScrivere() ? 2 : 0))

  readonly generabile = generabile
  readonly data = dataItaliana
  readonly quantita = quantitaItaliana
  readonly etichettaStato = (s: StatoVisibileRitiro): string => ETICHETTA_STATO[s]
  readonly tono = (s: StatoVisibileRitiro) => TONO_STATO_RITIRO[s]
  readonly fascia = (f: keyof typeof ETICHETTA_FASCIA): string => ETICHETTA_FASCIA[f]
  readonly testiAzione = (p: AzionePendente) => TESTI_AZIONE[p.tipo]

  ngOnInit(): void {
    this.carica()
  }

  private filtriRichiesta(): FiltriRitiri {
    const f = this.filtri
    return {
      dal: f.dal || undefined,
      al: f.al || undefined,
      automezzoId: f.automezzoId || undefined,
      trasportatoreId: f.trasportatoreId || undefined,
      produttoreId: f.produttoreId || undefined,
      cerCode: f.cerCode.trim() || undefined,
      statoVisibile: (f.statoVisibile as StatoVisibileRitiro) || undefined,
      pagina: Math.floor(this.primo / this.dimensione) + 1,
      dimensione: this.dimensione,
    }
  }

  cerca(): void {
    this.primo = 0
    this.carica()
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.dimensione = ev.rows || this.dimensione
    this.primo = ev.first ?? 0
    this.carica()
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.servizio.elenca(this.filtriRichiesta()).subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.totale.set(e.totale)
        // la selezione tiene solo i ritiri ancora visibili e generabili
        this.selezione.set(
          new Set(e.righe.filter(r => generabile(r) && this.selezione().has(r.id)).map(r => r.id))
        )
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Impossibile leggere i ritiri.'))
      },
    })
  }

  seleziona(r: RitiroVista, spuntato: boolean): void {
    const nuova = new Set(this.selezione())
    if (spuntato) nuova.add(r.id)
    else nuova.delete(r.id)
    this.selezione.set(nuova)
  }

  selezionaTutti(spuntato: boolean): void {
    this.selezione.set(new Set(spuntato ? this.generabili().map(r => r.id) : []))
  }

  /** Le azioni della riga, in base allo stato (il backend ricontrolla il FIR attivo). */
  azioni(r: RitiroVista): { principale: AzioneRiga | null; altre: AzioneRiga[] } {
    const nome = `il ritiro del ${dataItaliana(r.dataPrevista)} di ${r.produttore.nome}`
    const altre: AzioneRiga[] = []
    if (modificabile(r)) {
      altre.push({
        etichetta: 'Non eseguito',
        icona: 'pi pi-times-circle',
        esegui: () => this.apriAzione('NON_ESEGUITO', r),
      })
    }
    if (r.stato === 'NON_ESEGUITO') {
      altre.push({
        etichetta: 'Riprogramma',
        icona: 'pi pi-calendar',
        esegui: () => this.apriAzione('RIPROGRAMMA', r),
      })
    }
    if (r.stato !== 'ANNULLATO') {
      altre.push({
        etichetta: 'Annulla il ritiro',
        icona: 'pi pi-trash',
        pericolosa: true,
        disabilitata: r.fir !== null,
        motivo: r.fir ? 'Ha un FIR attivo: annulla prima il FIR' : undefined,
        esegui: () => this.apriAzione('ANNULLA', r),
      })
    }
    const principale: AzioneRiga | null = modificabile(r)
      ? {
          etichetta: `Modifica ${nome}`,
          icona: 'pi pi-pencil',
          esegui: () => this.apriDialog(r),
        }
      : null
    return { principale, altre }
  }

  apriDialog(r: RitiroVista | null): void {
    if (!r) {
      this.inModifica.set(null)
      this.dialogAperto.set(true)
      return
    }
    // il dettaglio ha tutti i campi del rifiuto, l'elenco no
    this.servizio.dettaglio(r.id).subscribe({
      next: d => {
        this.inModifica.set(d)
        this.dialogAperto.set(true)
      },
      error: err => this.toast.error(messaggioErroreRitiri(err, 'Impossibile aprire il ritiro.')),
    })
  }

  chiudiDialog(): void {
    this.dialogAperto.set(false)
    this.inModifica.set(null)
  }

  salvato(r: RisultatoCreazioneRitiri | RitiroVista): void {
    this.chiudiDialog()
    if ('ritiri' in r) {
      const n = r.ritiri.length
      if (r.giaRegistrato) this.toast.info('Questi ritiri erano già stati registrati.')
      else this.toast.success(n === 1 ? 'Ritiro creato.' : `${n} ritiri creati.`)
    } else {
      this.toast.success('Ritiro aggiornato.')
    }
    this.carica()
  }

  generaFir(): void {
    const ids = this.selezionati().map(r => r.id)
    if (!ids.length || this.generazione()) return
    if (ids.length > MAX_RITIRI_PER_LOTTO) {
      this.toast.warn(`Al massimo ${MAX_RITIRI_PER_LOTTO} ritiri alla volta.`)
      return
    }
    this.generazione.set(true)
    this.servizio.generaFir(ids).subscribe({
      next: r => {
        this.generazione.set(false)
        this.esiti.set(r.esiti)
      },
      error: err => {
        this.generazione.set(false)
        this.toast.error(messaggioErroreRitiri(err, 'Impossibile generare i FIR.'))
      },
    })
  }

  chiudiEsiti(): void {
    this.esiti.set(null)
    this.selezione.set(new Set())
    this.carica()
  }

  apriAzione(tipo: TipoAzione, ritiro: RitiroVista): void {
    this.motivo = ''
    this.nuovaData = ''
    this.erroreAzione.set(null)
    this.pendente.set({ tipo, ritiro })
  }

  chiudiAzione(): void {
    this.pendente.set(null)
    this.erroreAzione.set(null)
  }

  confermaAzione(): void {
    const p = this.pendente()
    if (!p || this.inCorso()) return
    const { ritiro } = p
    let richiesta: Observable<RitiroVista>
    if (p.tipo === 'RIPROGRAMMA') {
      if (!this.nuovaData) {
        this.erroreAzione.set('Indica la nuova data.')
        return
      }
      richiesta = this.servizio.riprogramma(ritiro.id, this.nuovaData, ritiro.versione)
    } else {
      const motivo = this.motivo.trim()
      if (!motivo) {
        this.erroreAzione.set('Il motivo è obbligatorio.')
        return
      }
      richiesta =
        p.tipo === 'ANNULLA'
          ? this.servizio.annulla(ritiro.id, motivo, ritiro.versione)
          : this.servizio.nonEseguito(ritiro.id, motivo, ritiro.versione)
    }
    this.inCorso.set(true)
    this.erroreAzione.set(null)
    richiesta.subscribe({
      next: () => {
        this.inCorso.set(false)
        this.pendente.set(null)
        this.toast.success(
          p.tipo === 'ANNULLA'
            ? 'Ritiro annullato.'
            : p.tipo === 'NON_ESEGUITO'
              ? 'Ritiro segnato come non eseguito.'
              : 'Ritiro riprogrammato.'
        )
        this.carica()
      },
      error: err => {
        this.inCorso.set(false)
        this.erroreAzione.set(messaggioErroreRitiri(err, 'Operazione non riuscita.'))
      },
    })
  }
}
