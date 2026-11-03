import { Component, inject } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { permessoScrittura } from '../../clienti/tabelle/tabella-comune'
import {
  CodificaDialogBase,
  ConfigCodificaDialog,
  IMPORT_CODIFICA_DIALOG,
  STILI_CODIFICA_DIALOG,
  TEMPLATE_CODIFICA_DIALOG,
} from '../../clienti/tabelle/codifica-comune'
import { ListinoService } from '../listino.service'
import { CodificaAddebito, GenereCodificaAddebito } from '../listino.model'
import { CONCORDANZA_GENERE_ADDEBITO, ETICHETTE_GENERE_ADDEBITO } from '../vocabolario-listino'

/**
 * Dialog delle codifiche di addebito. Logica e template sono in `clienti/tabelle/codifica-comune`
 * (R25); qui solo le differenze: codice di sole cifre (da 1 a 3, completato a tre dal server),
 * descrizione fino a 45, rotte della 4.2a e verifica del ruolo di scrittura.
 */
@Component({
  selector: 'app-codifica-addebito-dialog',
  standalone: true,
  imports: [...IMPORT_CODIFICA_DIALOG, ReactiveFormsModule],
  template: TEMPLATE_CODIFICA_DIALOG,
  styles: [STILI_CODIFICA_DIALOG],
})
export class CodificaAddebitoDialogComponent extends CodificaDialogBase<
  CodificaAddebito,
  GenereCodificaAddebito
> {
  protected readonly api = inject(ListinoService).codifiche
  readonly cfg: ConfigCodificaDialog<GenereCodificaAddebito> = {
    testid: 'codifica-add-dlg',
    idCampi: 'codifica-add',
    etichettaCodice: 'Codice (da 1 a 3 cifre, vuoto = automatico)',
    descrizioneMax: 45,
    codiceNumerico: true,
    codiceDuplicato: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO',
    etichetta: g => ETICHETTE_GENERE_ADDEBITO[g],
    concordanza: g => CONCORDANZA_GENERE_ADDEBITO[g],
  }
  readonly puoScrivere = permessoScrittura()

  constructor() {
    super()
    this.genere = 'GRUPPO'
  }
}
