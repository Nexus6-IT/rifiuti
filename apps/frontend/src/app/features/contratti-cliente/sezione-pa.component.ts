import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { FormContratto, codiceDestinatarioVero } from './contratto-cliente-form'

/**
 * Sezione "Pubblica amministrazione": codice destinatario e riferimento amministrazione (SDI),
 * CIG, CUP, documento PA ed esclusione della dichiarazione d'intento. Le regole (formato di CIG e
 * CUP, documento obbligatorio con CIG o CUP) sono del backend (D20, D27): qui c'è solo un
 * indicatore. Il riferimento amministrazione ha senso solo con un codice destinatario vero (D3):
 * senza, si mostra vuoto e "non usato", e non viene inviato (R41).
 */
@Component({
  selector: 'app-sezione-pa',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextModule],
  template: `
    <div class="sezione" [formGroup]="form">
      <label for="contratto-dlg-codice-dest">Codice destinatario SDI</label>
      <input
        pInputText
        id="contratto-dlg-codice-dest"
        formControlName="codiceDestinatario"
        maxlength="7"
        data-testid="contratto-dlg-codice-dest"
      />
      <label for="contratto-dlg-rif-amm">Riferimento amministrazione</label>
      <input
        *ngIf="riferimentoUsato(); else nonUsato"
        pInputText
        id="contratto-dlg-rif-amm"
        formControlName="riferimentoAmministrazione"
        maxlength="20"
        data-testid="contratto-dlg-rif-amm"
      />
      <ng-template #nonUsato>
        <input
          pInputText
          id="contratto-dlg-rif-amm"
          value=""
          placeholder="non usato"
          disabled
          data-testid="contratto-dlg-rif-amm-non-usato"
        />
      </ng-template>
      <small class="field-hint"
        >Se li lasci vuoti valgono quelli del cliente di fatturazione (o del cliente). Il
        riferimento si indica solo con un codice destinatario diverso da 0000000.</small
      >

      <label for="contratto-dlg-cig">CIG</label>
      <input
        pInputText
        id="contratto-dlg-cig"
        formControlName="codiceCig"
        maxlength="15"
        data-testid="contratto-dlg-cig"
      />
      <label for="contratto-dlg-cup">CUP</label>
      <input
        pInputText
        id="contratto-dlg-cup"
        formControlName="codiceCup"
        maxlength="15"
        data-testid="contratto-dlg-cup"
      />
      <label for="contratto-dlg-doc-pa">Documento PA (contratto, convenzione o ordine)</label>
      <input
        pInputText
        id="contratto-dlg-doc-pa"
        formControlName="idDocumentoPa"
        maxlength="20"
        data-testid="contratto-dlg-doc-pa"
      />
      <small
        *ngIf="documentoObbligatorio()"
        class="field-hint"
        data-testid="contratto-dlg-doc-pa-obbligatorio"
        >Con CIG o CUP il documento PA è obbligatorio.</small
      >

      <label class="casella">
        <input
          type="checkbox"
          formControlName="escludiDichiarazioneIntento"
          data-testid="contratto-dlg-escludi-intento"
        />
        Escludi la dichiarazione d'intento
      </label>
    </div>
  `,
  styles: [
    `
      .sezione {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .casella {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    `,
  ],
})
export class SezionePaComponent {
  @Input({ required: true }) form!: FormContratto

  riferimentoUsato(): boolean {
    return codiceDestinatarioVero(this.form.controls.codiceDestinatario.value)
  }

  /** Solo un indicatore: la regola resta al backend. */
  documentoObbligatorio(): boolean {
    const f = this.form.controls
    const conCodice = f.codiceCig.value.trim() !== '' || f.codiceCup.value.trim() !== ''
    return conCodice && f.idDocumentoPa.value.trim() === ''
  }
}
