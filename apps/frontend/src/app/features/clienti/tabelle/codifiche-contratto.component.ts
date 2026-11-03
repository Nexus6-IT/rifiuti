import { CommonModule } from '@angular/common'
import { Component, Input, OnInit, inject } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { CodificaContratto, GenereCodifica } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CONCORDANZA_GENERE, ETICHETTE_GENERE } from '../vocabolario-clienti'
import { CodificaDialogComponent } from './codifica-dialog.component'
import { VocabolarioCodifiche } from './codifica-comune'
import { AzioneCodifica, CodificheGrigliaComponent } from './codifiche-griglia.component'
import { CodificheTabellaBase } from './codifiche-tabella-base'

const TITOLI: Readonly<Record<GenereCodifica, string>> = {
  CATEGORIA: 'Categorie',
  TIPO: 'Tipi di contratto',
  MOTIVO_ANNULLO: 'Motivi di annullo',
}

/** Elenco e gestione di un genere di codifiche (categorie, tipi o motivi di annullo). */
@Component({
  selector: 'app-codifiche-contratto',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    CodificheGrigliaComponent,
    CodificaDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <h2 [attr.data-testid]="'codifiche-titolo-' + genere">{{ titolo() }}</h2>
      <p-button
        *ngIf="puoScrivere()"
        [label]="concordanza().nuovo"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        [attr.data-testid]="'codifica-nuova-' + genere"
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
    <app-codifica-dialog
      [visible]="dialogoAperto()"
      [genere]="genere"
      [elemento]="selezionata()"
      (visibleChange)="dialogoAperto.set($event)"
      (salvato)="carica()"
      (salvatoDopoChiusura)="carica()"
    />
    <p-confirmDialog />
  `,
  styles: [
    `
      .barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      h2 {
        margin: 0;
        font-size: 1.1rem;
      }
    `,
  ],
})
export class CodificheContrattoComponent
  extends CodificheTabellaBase<CodificaContratto, GenereCodifica>
  implements OnInit
{
  protected readonly api = inject(TabelleFatturazioneService).codifiche
  protected readonly vocabolario: VocabolarioCodifiche<GenereCodifica> = {
    etichetta: g => ETICHETTE_GENERE[g],
    concordanza: g => CONCORDANZA_GENERE[g],
  }

  @Input() genere: GenereCodifica = 'CATEGORIA'

  /** `data-testid` con il genere: nella stessa pagina ci sono tre schede. */
  readonly testid = (azione: AzioneCodifica, c: { codice: string }): string =>
    `codifica-${azione}-${this.genere}-${c.codice}`

  protected genereCorrente(): GenereCodifica {
    return this.genere
  }

  titolo(): string {
    return TITOLI[this.genere]
  }

  ngOnInit(): void {
    this.carica()
  }
}
