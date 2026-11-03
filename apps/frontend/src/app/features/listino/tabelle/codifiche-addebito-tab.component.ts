import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { SelectButtonModule } from 'primeng/selectbutton'
import { VocabolarioCodifiche } from '../../clienti/tabelle/codifica-comune'
import {
  AzioneCodifica,
  CodificheGrigliaComponent,
} from '../../clienti/tabelle/codifiche-griglia.component'
import { CodificheTabellaBase } from '../../clienti/tabelle/codifiche-tabella-base'
import { ListinoService } from '../listino.service'
import { CodificaAddebito, GenereCodificaAddebito } from '../listino.model'
import {
  CONCORDANZA_GENERE_ADDEBITO,
  ETICHETTE_GENERE_ADDEBITO,
  OPZIONI_GENERE_ADDEBITO,
} from '../vocabolario-listino'
import { CodificaAddebitoDialogComponent } from './codifica-addebito-dialog.component'

/** Scheda "Gruppi e categorie di addebito": il genere si sceglie con un `p-selectButton` (D28). */
@Component({
  selector: 'app-codifiche-addebito-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    SelectButtonModule,
    CodificheGrigliaComponent,
    CodificaAddebitoDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <span id="codifiche-add-genere" class="visually-hidden">Genere della codifica</span>
      <p-selectButton
        [options]="generi"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        [ngModel]="genere()"
        (ngModelChange)="scegli($event)"
        ariaLabelledBy="codifiche-add-genere"
        data-testid="codifiche-add-genere"
      />
      <p-button
        *ngIf="puoScrivere()"
        [label]="concordanza().nuovo"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="codifica-add-nuova"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <app-codifiche-griglia
      [righe]="righe()"
      [puoScrivere]="puoScrivere()"
      [testid]="testid"
      (modifica)="apri($event)"
      (cambiaStato)="cambiaStato($event)"
      (elimina)="elimina($event)"
    />
    <app-codifica-addebito-dialog
      [visible]="dialogoAperto()"
      [genere]="genere()"
      [elemento]="selezionata()"
      (visibleChange)="dialogoAperto.set($event)"
      (salvato)="carica()"
    />
    <p-confirmDialog />
  `,
  styles: [
    `
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class CodificheAddebitoTabComponent
  extends CodificheTabellaBase<CodificaAddebito, GenereCodificaAddebito>
  implements OnInit
{
  protected readonly api = inject(ListinoService).codifiche
  protected readonly vocabolario: VocabolarioCodifiche<GenereCodificaAddebito> = {
    etichetta: g => ETICHETTE_GENERE_ADDEBITO[g],
    concordanza: g => CONCORDANZA_GENERE_ADDEBITO[g],
  }

  readonly generi = OPZIONI_GENERE_ADDEBITO
  readonly genere = signal<GenereCodificaAddebito>('GRUPPO')

  /** Un solo elenco alla volta: il genere non compare nei `data-testid`. */
  readonly testid = (azione: AzioneCodifica, c: { codice: string }): string =>
    `codifica-add-${azione}-${c.codice}`

  protected genereCorrente(): GenereCodificaAddebito {
    return this.genere()
  }

  ngOnInit(): void {
    this.carica()
  }

  scegli(genere: GenereCodificaAddebito): void {
    if (genere === this.genere()) return
    this.genere.set(genere)
    this.righe.set([])
    this.carica()
  }
}
