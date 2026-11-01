import { Component, Input } from '@angular/core'
import { AgenteDialogComponent } from './agente-dialog.component'
import { OpzioniFatturazione } from './opzioni-fatturazione'
import { CondizionePagamentoDialogComponent } from './tabelle/condizione-pagamento-dialog.component'
import { ContoCorrenteDialogComponent } from './tabelle/conto-corrente-dialog.component'
import { RegistroIvaDialogComponent } from './tabelle/registro-iva-dialog.component'
import { SpesaAccessoriaDialogComponent } from './tabelle/spesa-accessoria-dialog.component'

/**
 * I sei sub-dialog "Nuovo …" dei campi di `OpzioniFatturazione`, collegati alla sua aggiunta in
 * linea: condizione, conto, spese (tipo INCASSO), bollo (tipo BOLLO), registro e agente.
 */
@Component({
  selector: 'app-sotto-dialog-fatturazione',
  standalone: true,
  imports: [
    AgenteDialogComponent,
    CondizionePagamentoDialogComponent,
    ContoCorrenteDialogComponent,
    RegistroIvaDialogComponent,
    SpesaAccessoriaDialogComponent,
  ],
  template: `
    <app-condizione-pagamento-dialog
      [visible]="opzioni.inLinea.aperto === 'condizione'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoCondizione($event)"
    />
    <app-conto-corrente-dialog
      [visible]="opzioni.inLinea.aperto === 'conto'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoConto($event)"
    />
    <app-spesa-accessoria-dialog
      [visible]="opzioni.inLinea.aperto === 'spese'"
      tipo="INCASSO"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoSpese($event)"
    />
    <app-spesa-accessoria-dialog
      [visible]="opzioni.inLinea.aperto === 'bollo'"
      tipo="BOLLO"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoBollo($event)"
    />
    <app-registro-iva-dialog
      [visible]="opzioni.inLinea.aperto === 'registro'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoRegistro($event)"
    />
    <app-agente-dialog
      [visible]="opzioni.inLinea.aperto === 'agente'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoAgente($event)"
    />
  `,
})
export class SottoDialogFatturazioneComponent {
  @Input({ required: true }) opzioni!: OpzioniFatturazione
}
