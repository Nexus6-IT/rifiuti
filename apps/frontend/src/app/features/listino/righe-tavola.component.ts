import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core'
import { TableModule } from 'primeng/table'
import { AzioneRiga, AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import {
  cascataItaliana,
  decimaleItaliano,
  importoItaliano,
  totaleFissiAnnuo,
} from './listino-calcoli'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { RigaAddebito } from './listino.model'
import { ETICHETTE_TIPO_QUANTITA } from './vocabolario-listino'

/**
 * Tavola delle righe di un elenco (D28, `riempitavola`): colonne, numeri in formato italiano,
 * "Totale fissi", apertura della riga (doppio clic, Invio o pulsante "Apri") ed eliminazione.
 * Qui si emettono `apri` ed `elimina`: dialog e conferma sono della pagina.
 */
@Component({
  selector: 'app-righe-tavola',
  standalone: true,
  imports: [CommonModule, AzioniRigaComponent, TableModule],
  template: `
    <p *ngIf="errore" role="alert" class="field-error" data-testid="listino-errore-righe">
      {{ errore }}
    </p>
    <!-- Se le colonne piene non stanno nello spazio, scorre la tavola e non la pagina. -->
    <div class="tavola">
      <p-table
        [value]="righe()"
        [loading]="caricamento"
        styleClass="p-datatable-sm lista-telefono"
        class="tabella-fitta"
      >
        <ng-template pTemplate="caption">
          <span class="sr-only">Righe dell'elenco</span>
        </ng-template>
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" class="m-hide">Tipo</th>
            <th scope="col">CER / addebito</th>
            <th scope="col" *ngIf="colonne().has('riferimento')">Rif.</th>
            <th scope="col" *ngIf="colonne().has('descrizione')">Descrizione</th>
            <th scope="col" *ngIf="colonne().has('um')">U.M.</th>
            <th scope="col" *ngIf="colonne().has('quantita')" class="num-col">Quantità</th>
            <th scope="col" class="num-col">Prezzo</th>
            <th scope="col" *ngIf="colonne().has('sconto')" class="num-col">Sconto</th>
            <th scope="col" class="m-hide">IVA</th>
            <th scope="col" *ngIf="colonne().has('provvigione')" class="num-col">Provvigione</th>
            <th scope="col" *ngIf="colonne().has('condizione')">Cond.</th>
            <th scope="col" *ngIf="colonne().has('minimo')" class="num-col">Minimo</th>
            <th scope="col" *ngIf="colonne().has('categoria')">Categoria</th>
            <th scope="col" *ngIf="colonne().has('appunti')">Appunti</th>
            <th scope="col" class="azioni-col"><span class="visually-hidden">Azioni</span></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr (dblclick)="apri.emit(r)" [attr.data-testid]="'listino-riga-' + r.id">
            <td class="m-hide" [attr.title]="r.etichettaTipo">{{ r.tipo }}</td>
            <td class="cella-codice">{{ r.cerCode ?? r.addebito?.codice }}</td>
            <td *ngIf="colonne().has('riferimento')" class="m-hide">{{ r.riferimento }}</td>
            <td
              *ngIf="colonne().has('descrizione')"
              class="cella-testo"
              [attr.title]="r.descrizione ?? r.addebito?.descrizione"
            >
              {{ r.descrizione ?? r.addebito?.descrizione }}
            </td>
            <td *ngIf="colonne().has('um')" class="m-hide">{{ r.unitaMisura }}</td>
            <td *ngIf="colonne().has('quantita')" class="num-col m-hide">{{ quantita(r) }}</td>
            <td class="num-col m2">{{ r.prezzoSpeciale ? 'speciale' : prezzo(r.prezzo) }}</td>
            <td *ngIf="colonne().has('sconto')" class="num-col m-hide">{{ cascata(r.sconto) }}</td>
            <td class="m-hide">{{ r.codiceIva.codice }}</td>
            <td *ngIf="colonne().has('provvigione')" class="num-col m-hide">
              {{ cascata(r.provvigione) }}
            </td>
            <td *ngIf="colonne().has('condizione')" class="m-hide">{{ r.condizione }}</td>
            <td *ngIf="colonne().has('minimo')" class="num-col m-hide">
              {{ prezzo(r.minimoFatturabile) }}
            </td>
            <td *ngIf="colonne().has('categoria')" class="m-hide">
              {{ r.categoria?.descrizione }}
            </td>
            <td
              *ngIf="colonne().has('appunti')"
              class="cella-testo m-hide"
              [attr.title]="r.appunti"
            >
              {{ r.appunti }}
            </td>
            <td class="azioni-col">
              <app-azioni-riga
                [principale]="azioniDi(r).principale"
                [altre]="azioniDi(r).altre"
                [nome]="codiceRiga(r)"
              />
              <!-- Visibile anche a menu chiuso: una riga usata dai legami non si elimina. -->
              <small
                *ngIf="puoEliminare && !r.eliminabile"
                class="cell-sub"
                aria-hidden="true"
                [attr.title]="MOTIVO_IN_USO"
                [attr.data-testid]="'listino-in-uso-' + r.id"
                >In uso</small
              >
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="numeroColonne()">Nessuna riga.</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
    <p class="totale" data-testid="listino-totale-fissi">Totale fissi: {{ totaleFissiTesto() }}</p>
  `,
  styles: [
    `
      .tavola {
        overflow-x: auto;
      }
      .tabella-fitta {
        --spacing-md: 0.5rem;
      }
      .totale {
        text-align: right;
        font-weight: 600;
      }
      /* Descrizione e appunti su una riga sola: l'ellissi taglia, il title dice tutto. */
      .cella-testo {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 16rem;
      }
      .cella-codice {
        white-space: nowrap;
        font-weight: 500;
      }
      th.azioni-col,
      td.azioni-col {
        text-align: right;
        white-space: nowrap;
        min-width: 6.5rem;
        position: sticky;
        right: 0;
        z-index: 1;
        background: var(--surface-ground);
        box-shadow: -1px 0 0 var(--rule);
      }
      /* PrimeNG vuole l'intestazione trasparente: sul th serve !important, sul td no. */
      th.azioni-col {
        background: var(--surface-ground) !important;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      /* Telefono: codice sopra, descrizione sotto, prezzo sulla terza riga. */
      @media (max-width: 640px) {
        th.azioni-col,
        td.azioni-col {
          position: static;
          box-shadow: none;
          width: auto;
          min-width: 0;
        }
        .cella-testo {
          max-width: none;
        }
        .cella-codice {
          font-weight: 500;
        }
      }
    `,
  ],
})
export class RigheTavolaComponent {
  readonly righe = signal<RigaAddebito[]>([])
  readonly totaleFissiTesto = computed(() => importoItaliano(totaleFissiAnnuo(this.righe())))

  /** Colonne facoltative con almeno un dato: le altre non si mostrano. */
  readonly colonne = computed(() =>
    colonneConDati<RigaAddebito>(this.righe(), {
      riferimento: r => r.riferimento,
      descrizione: r => r.descrizione ?? r.addebito?.descrizione,
      um: r => r.unitaMisura,
      quantita: r => this.quantita(r),
      sconto: r => r.sconto,
      provvigione: r => r.provvigione,
      condizione: r => r.condizione,
      minimo: r => r.minimoFatturabile,
      categoria: r => r.categoria?.descrizione,
      appunti: r => r.appunti,
    })
  )
  /** Intestazioni mostrate (per il colspan del messaggio vuoto): cinque sempre presenti. */
  readonly numeroColonne = computed(() => 5 + this.colonne().size)

  @Input({ required: true }) set elementi(v: RigaAddebito[]) {
    this.righe.set(v)
  }
  @Input() caricamento = false
  @Input() errore: string | null = null
  /** Mostra "Elimina" su ogni riga: solo a chi scrive, con elenco modificabile e contratto attivo. */
  @Input() set puoEliminare(v: boolean) {
    this.eliminaAbilitato.set(v)
  }
  get puoEliminare(): boolean {
    return this.eliminaAbilitato()
  }
  private readonly eliminaAbilitato = signal(false)
  @Output() apri = new EventEmitter<RigaAddebito>()
  @Output() elimina = new EventEmitter<RigaAddebito>()

  readonly MOTIVO_IN_USO = 'In uso: la riga è citata da movimenti'

  /** Azioni di ogni riga, calcolate una volta per cambio di righe: il menu aperto non vede il modello cambiare. */
  private readonly azioniPerRiga = computed(
    () => new Map(this.righe().map(r => [r.id, this.costruisciAzioni(r)]))
  )

  azioniDi(r: RigaAddebito): { principale: AzioneRiga; altre: AzioneRiga[] } {
    return this.azioniPerRiga().get(r.id) ?? this.costruisciAzioni(r)
  }

  codiceRiga(r: RigaAddebito): string {
    return r.cerCode ?? r.addebito?.codice ?? r.tipo
  }

  /**
   * «Apri» sulla riga; «Elimina» nel menu ⋯ (in rosso), solo a chi scrive. Disabilitata, non
   * nascosta, se la riga e' usata dai legami: il motivo e' nella voce.
   */
  private costruisciAzioni(r: RigaAddebito): { principale: AzioneRiga; altre: AzioneRiga[] } {
    return {
      principale: {
        etichetta: 'Apri la riga',
        icona: 'pi pi-external-link',
        esegui: () => this.apri.emit(r),
      },
      altre: this.eliminaAbilitato()
        ? [
            {
              etichetta: 'Elimina',
              pericolosa: true,
              disabilitata: !r.eliminabile,
              motivo: r.eliminabile ? undefined : this.MOTIVO_IN_USO,
              esegui: () => this.elimina.emit(r),
            },
          ]
        : [],
    }
  }

  /** Fisso: quantità fissa (vuota = 1); `CER`/`V`: etichetta del tipo di quantità (E15). */
  quantita(r: RigaAddebito): string {
    if (r.tipo === 'F') return decimaleItaliano(r.quantitaFissa ?? '1')
    return r.tipoQuantita ? ETICHETTE_TIPO_QUANTITA[r.tipoQuantita] : ''
  }

  cascata(v: string | null): string {
    return cascataItaliana(v)
  }

  prezzo(v: string | null): string {
    return decimaleItaliano(v, 2)
  }
}
