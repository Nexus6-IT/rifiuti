import { Component, computed, inject } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { CodificaContratto, GenereCodifica } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CONCORDANZA_GENERE, ETICHETTE_GENERE } from '../vocabolario-clienti'
import {
  CodificaDialogBase,
  ConfigCodificaDialog,
  IMPORT_CODIFICA_DIALOG,
  STILI_CODIFICA_DIALOG,
  TEMPLATE_CODIFICA_DIALOG,
} from './codifica-comune'

/**
 * Dialog delle codifiche del contratto (categorie, tipi, motivi di annullo). Logica e template
 * sono in `codifica-comune` (R25); qui solo le differenze: codice alfanumerico fino a 3 caratteri,
 * descrizione fino a 60, rotte della 4.1.
 */
@Component({
  selector: 'app-codifica-dialog',
  standalone: true,
  imports: [...IMPORT_CODIFICA_DIALOG, ReactiveFormsModule],
  template: TEMPLATE_CODIFICA_DIALOG,
  styles: [STILI_CODIFICA_DIALOG],
})
export class CodificaDialogComponent extends CodificaDialogBase<CodificaContratto, GenereCodifica> {
  protected readonly api = inject(TabelleFatturazioneService).codifiche
  readonly cfg: ConfigCodificaDialog<GenereCodifica> = {
    testid: 'codifica-dlg',
    idCampi: 'codifica',
    etichettaCodice: 'Codice (fino a 3 caratteri, vuoto = automatico)',
    descrizioneMax: 60,
    codiceNumerico: false,
    codiceDuplicato: 'CODIFICA_CONTRATTO_CODICE_DUPLICATO',
    etichetta: g => ETICHETTE_GENERE[g],
    concordanza: g => CONCORDANZA_GENERE[g],
  }
  // Il dialog del contratto non verifica il ruolo: lo fa chi lo apre (differenza da confermare, R25).
  readonly puoScrivere = computed(() => true)

  constructor() {
    super()
    this.genere = 'CATEGORIA'
  }
}
